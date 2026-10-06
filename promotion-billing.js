import crypto from 'node:crypto';
import express from 'express';
import Stripe from 'stripe';
export const BILLING_EVENTS=['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed'];
const fail=(status,message)=>Object.assign(Error(message),{status});
export const hasPromotionAccess=(billing,now=Date.now())=>['active','trialing'].includes(billing?.status)&&billing.expiresAt>now&&!billing.collectionPaused;
export function createPromotionPayments(env=process.env){
 if(!env.PROMOTION_STRIPE_KEY)return null;
 if(/^(sk|rk)_live_/.test(env.PROMOTION_STRIPE_KEY)&&env.PROMOTION_LIVE_PAYMENTS!=='true')return null;
 return new Stripe(env.PROMOTION_STRIPE_KEY,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:20000});
}
export function createPromotionBilling({store,stripe,env=process.env}){
 const ready=()=>!!stripe&&!!store&&!!env.PROMOTION_STRIPE_ACCOUNT_ID&&!!env.PROMOTION_STRIPE_PRICE_ID&&!!env.PROMOTION_STRIPE_WEBHOOK_SECRET;
 async function validate(){
  if(!ready())throw fail(503,'Falta completar la conexión de Stripe de My City.');
  const account=await stripe.accounts.retrieve();if(account.id!==env.PROMOTION_STRIPE_ACCOUNT_ID)throw fail(503,'La cuenta de cobro no coincide con Barkpicture/My City.');
  const p=await stripe.prices.retrieve(env.PROMOTION_STRIPE_PRICE_ID);
  if(!p.active||p.currency!=='usd'||p.unit_amount!==999||p.recurring?.interval!=='month'||p.recurring.interval_count!==1)throw fail(503,'El precio de My City debe ser $9.99 USD al mes.');
  return p;
 }
 async function syncSubscription(id){
  await validate();const started=Date.now();const sub=await stripe.subscriptions.retrieve(id);
  const customer=typeof sub.customer==='string'?sub.customer:sub.customer.id;
  const owner=await store.ownerForCustomer(customer);if(!owner)return null;
  const row=await store.get(owner);if(row.billing?.customerId!==customer)return null;if(row.billing?.subscriptionCreated&&sub.created<row.billing.subscriptionCreated)return null;
  const items=sub.items?.data||[];if(!items.some(x=>x.price.id===env.PROMOTION_STRIPE_PRICE_ID))return null;
  const end=sub.status==='trialing'?sub.trial_end:Math.max(0,...items.map(x=>x.current_period_end||sub.current_period_end||0));
  const start=sub.status==='trialing'?sub.trial_start:Math.min(...items.map(x=>x.current_period_start||sub.current_period_start||sub.start_date||0));
  const billing={customerId:customer,subscriptionId:sub.id,status:sub.status,subscriptionCreated:Number(sub.created||0),expiresAt:Number(end)*1000,periodStart:Number(start)*1000,cancelAtPeriodEnd:!!sub.cancel_at_period_end,collectionPaused:!!sub.pause_collection,updatedAt:started};
  await store.transaction(owner,current=>{if((current.billing?.updatedAt||0)>started)return current;current.billing=billing;if(!hasPromotionAccess(billing)&&current.campaign?.status==='active')current.campaign={...current.campaign,status:'paused',pauseReason:'billing'};return current;});return billing;
 }
 async function checkout(owner){
  const price=await validate();let row=await store.get(owner.id);
  if(!row.preparation?.confirmedFingerprint)throw fail(409,'Confirma primero los datos de tu negocio en el chat.');
  if(hasPromotionAccess(row.billing))throw fail(409,'Ya tienes un plan activo. Usa «Mi plan».');
  const url=env.PROMOTION_PUBLIC_URL;if(!/^https:\/\//.test(url||''))throw fail(503,'Falta la dirección de retorno del chat.');
  let customer=row.billing?.customerId;
  if(!customer){const c=await stripe.customers.create({name:owner.name,...(owner.email?{email:owner.email}:{})},{idempotencyKey:'mycity-promotion-customer-'+owner.id});customer=c.id;
   await store.bindCustomer(customer,owner.id);await store.transaction(owner.id,r=>{r.billing={...r.billing,customerId:customer};return r;});}
  const previous=await stripe.subscriptions.list({customer,status:'all',limit:100});
  if(previous.has_more||previous.data.some(s=>['active','trialing','past_due','unpaid','incomplete','paused'].includes(s.status)))throw fail(409,'Ya existe un plan. Gestiona la suscripción desde «Mi plan».');
  row=await store.get(owner.id);if(row.checkoutSessionId){const s=await stripe.checkout.sessions.retrieve(row.checkoutSessionId);if(s.status==='open'&&s.url)return {url:s.url};await store.transaction(owner.id,r=>{if(r.checkoutSessionId===s.id){r.checkoutSessionId=null;r.checkoutAttempt=null;}return r;});}
  // One stable attempt across concurrent clicks; expired attempts receive a new key.
  const claimed=await store.transaction(owner.id,r=>{if(!r.checkoutAttempt||r.checkoutAttempt.createdAt<Date.now()-25*3600000)r.checkoutAttempt={id:crypto.randomUUID(),createdAt:Date.now()};return r;});
  const trial=!previous.data.length;
  const session=await stripe.checkout.sessions.create({customer,mode:'subscription',line_items:[{price:price.id,quantity:1}],integration_identifier:'mycity_promotion_'+Array.from(crypto.createHash('sha256').update(claimed.value.checkoutAttempt.id).digest().subarray(0,8),b=>String.fromCharCode(97+b%26)).join(''),success_url:url+'?payment=return',cancel_url:url,subscription_data:trial?{trial_period_days:14,trial_settings:{end_behavior:{missing_payment_method:'cancel'}}}:{},custom_text:{submit:{message:'My City: 8 publicaciones por mes. Primera prueba: 14 días y hasta 2 publicaciones. Después $9.99 USD/mes. Puedes cancelar desde Mi plan.'}}},{idempotencyKey:'mycity-checkout-'+claimed.value.checkoutAttempt.id});
  await store.transaction(owner.id,r=>{r.checkoutSessionId=session.id;return r;});return {url:session.url};
 }
 async function portal(owner){await validate();const row=await store.get(owner.id);if(!row.billing?.customerId)throw fail(409,'Todavía no tienes un plan registrado.');return stripe.billingPortal.sessions.create({customer:row.billing.customerId,return_url:env.PROMOTION_PUBLIC_URL,...(env.PROMOTION_STRIPE_PORTAL_ID?{configuration:env.PROMOTION_STRIPE_PORTAL_ID}:{})});}
 return {ready,validate,checkout,portal,syncSubscription};
}
export function registerPromotionPaymentWebhook(app,{billing,stripe,env=process.env}){
 app.post('/api/promotion/stripe/webhook',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
  if(!billing.ready())return res.status(503).json({error:'Stripe configuration pending'});
  let event;try{event=stripe.webhooks.constructEvent(req.body,req.get('stripe-signature'),env.PROMOTION_STRIPE_WEBHOOK_SECRET);}catch{return res.status(400).json({error:'Invalid signature'});}
  if(!BILLING_EVENTS.includes(event.type))return res.json({received:true});
  try{const o=event.data.object;let id=event.type.startsWith('customer.subscription.')?o.id:o.subscription||o.parent?.subscription_details?.subscription;if(typeof id==='object')id=id?.id;if(id)await billing.syncSubscription(id);return res.json({received:true});}catch{console.warn('promotion-billing synchronization_failed');return res.status(500).json({error:'Synchronization failed'});}
 });
}
