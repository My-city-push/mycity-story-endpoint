import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import Stripe from 'stripe';

const clean = (v, max = 6000) => String(v ?? '').trim().slice(0, max);
const key = v => /^[A-Za-z0-9_-]{1,128}$/.test(clean(v, 200));
const fail = (status, message) => Object.assign(new Error(message), {status});
const root = owner => `promotionByOwner/${owner}`;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const MONTHLY_LIMIT = 8;
export function hasAccess(billing, now = Date.now()) {
  return ['active', 'trialing'].includes(billing?.status) && Number(billing?.expiresAt) > now;
}
export function sanitizeBusiness(input = {}) {
  const output = {};
  for (const name of ['commercialName', 'responsibleName', 'activity', 'serviceArea', 'contact', 'presentation', 'language'])
    output[name] = clean(input[name], name === 'presentation' ? 1500 : 300);
  output.type = ['physical', 'mobile', 'online'].includes(input.type) ? input.type : '';
  // Verification is set by an administrator, never by a client or model.
  return output;
}
export function sanitizeCampaign(input = {}) {
  const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number))];
  if (days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw fail(400, 'Días inválidos');
  const time = clean(input.time, 5) || '10:00';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw fail(400, 'Horario inválido');
  const timezone = clean(input.timezone, 80) || 'America/New_York';
  try { new Intl.DateTimeFormat('en', {timeZone: timezone}); } catch { throw fail(400, 'Zona horaria inválida'); }
  return {title: clean(input.title, 180), offer: clean(input.offer, 3000),
    audience: ['followers', 'following', 'both'].includes(input.audience) ? input.audience : 'both',
    days, time, timezone, monthlyLimit: MONTHLY_LIMIT};
}

export function createPromotionStore(database) {
  return {
    get: async path => (await database.ref(path).get()).val(),
    set: (path, value) => database.ref(path).set(value),
    update: updates => database.ref().update(updates),
    transaction: async (path, mutate) => {
      const result = await database.ref(path).transaction(mutate, undefined, false);
      return {committed: result.committed, value: result.snapshot.val()};
    }
  };
}

// Never decode a front JWT as proof: GoodBarber validates it for this app and user.
export async function goodbarberPromotionIdentity(token, userId, {env = process.env, fetchImpl = fetch} = {}) {
  if (!/^\d{1,20}$/.test(String(userId || '')) || typeof token !== 'string' || token.length > 12000) throw fail(401, 'Sesión de My City inválida.');
  if (!/^\d{1,20}$/.test(env.PROMOTION_GOODBARBER_APP_ID || '') || !env.PROMOTION_GOODBARBER_API_TOKEN) throw fail(503, 'La verificación de My City todavía necesita su conexión.');
  let response;
  try {
    response = await fetchImpl(`https://classic.goodbarber.dev/publicapi/v1/general/auth/${env.PROMOTION_GOODBARBER_APP_ID}/validate/`, {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json', token:env.PROMOTION_GOODBARBER_API_TOKEN},
      body:JSON.stringify({jwt:token,user_id:String(userId)})
    });
  } catch { throw fail(503, 'No se pudo comprobar la sesión de My City.'); }
  if (response.status === 400) throw fail(401, 'La sesión de My City no es válida.');
  if (!response.ok) throw fail(503, 'La verificación de My City no está disponible.');
  let result; try { result = await response.json(); } catch { throw fail(503, 'Respuesta de verificación inválida.'); }
  if (result?.is_anonymous !== false || result.error_code) throw fail(401, 'Inicia sesión en tu cuenta de My City.');
  return {id:String(userId),name:'',email:'',admin:false};
}

export async function promotionIdentity(admin, store, token) {
  const claims = await admin.auth().verifyIdToken(token, true);
  // Provision this binding through a trusted GoodBarber account-verification flow.
  // A localStorage ID or email in a request is never accepted as ownership proof.
  if (!key(claims.uid)) throw fail(403, 'Identidad no compatible con la vinculación.');
  const binding = await store.get(`promotionIdentityByUid/${claims.uid}`);
  if (!binding?.verified || !key(binding.goodbarberUserId)) throw fail(403, 'La cuenta de My City necesita vinculación verificada.');
  return {id: binding.goodbarberUserId, name: clean(binding.name, 180),
    email: clean(binding.email, 300), admin: claims.promotionAdmin === true};
}

export async function promotionAssistant({business, campaign, messages, env = process.env}) {
  if (!env.OPENAI_API_KEY || !env.PROMOTION_AI_MODEL) throw fail(503, 'El asistente todavía necesita su conexión de IA.');
  const fields = ['commercialName', 'responsibleName', 'activity', 'serviceArea', 'contact', 'presentation', 'language', 'type'];
  const schema = {type: 'object', additionalProperties: false, required: ['reply', 'business', 'campaign'], properties: {
    reply: {type: 'string'},
    business: {type: 'object', additionalProperties: false, required: fields, properties: Object.fromEntries(fields.map(f => [f, {type: 'string'}]))},
    campaign: {type: 'object', additionalProperties: false, required: ['title', 'offer', 'audience', 'days', 'time', 'timezone'], properties: {
      title: {type: 'string'}, offer: {type: 'string'}, audience: {type: 'string', enum: ['followers','following','both']},
      days: {type: 'array', items: {type: 'integer'}}, time: {type: 'string'}, timezone: {type: 'string'}
    }}
  }};
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(45000), headers: {'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: env.PROMOTION_AI_MODEL, store: false, max_output_tokens: 2200,
      instructions: 'Eres My City, asistente exclusivamente de promoción en la app. Recopila datos del negocio por etapas, sin inventarlos: nombre comercial, responsable, actividad, local/domicilio/en línea, zona, contacto, materiales y presentación. Mantén datos previos salvo cambios explícitos. Propón borradores y horarios, hasta 8 publicaciones/mes por $9.99, prueba 14 días/2 publicaciones. Nunca afirmes publicar, verificar, cobrar ni enviar correos: solo preparas. No atiendas inspecciones ni trámites ajenos. Pregunta pocos datos cada vez. No prometas ventas. Las aperturas de correo no prueban lectura. Usa el idioma del usuario. La evidencia comercial se revisa por separado, pagar no verifica un negocio.',
      input: [{role:'developer',content: JSON.stringify({business,campaign})}, ...messages.slice(-20).map(m => ({role:m.role, content:clean(m.text,6000) || 'El usuario adjuntó material de promoción.'}))],
      text: {format: {type: 'json_schema', name: 'promotion_draft', strict: true, schema}}})
  });
  if (!response.ok) throw fail(502, 'No se pudo consultar el asistente. Tu mensaje está guardado; puedes reintentar.');
  const data = await response.json();
  const text = (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
  let parsed; try { parsed = JSON.parse(text); } catch { throw fail(502, 'La respuesta del asistente no pudo procesarse.'); }
  if (!clean(parsed.reply)) throw fail(502, 'Respuesta vacía del asistente.');
  return {reply: clean(parsed.reply), business: sanitizeBusiness(parsed.business), campaign: sanitizeCampaign(parsed.campaign)};
}

// Register before the application's JSON body parser to preserve webhook bytes.
export function registerPromotionWebhook(app, {store, stripe, env = process.env}) {
  app.post('/api/promotion/stripe/webhook', express.raw({type:'application/json',limit:'1mb'}), async (req,res) => {
    if (env.PROMOTION_ENABLED !== 'true' || !stripe || !store || !env.PROMOTION_STRIPE_WEBHOOK_SECRET) return res.status(503).json({error:'Payments are not configured'});
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), env.PROMOTION_STRIPE_WEBHOOK_SECRET); }
    catch { return res.status(400).json({error:'Invalid Stripe signature'}); }
    const handled = ['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed','invoice.paid','invoice.payment_failed'];
    if (!handled.includes(event.type)) return res.json({received:true});
    try {
      const object = event.data.object;
      let subscriptionId = event.type.startsWith('customer.subscription.') ? object.id : object.subscription || object.parent?.subscription_details?.subscription;
      if (typeof subscriptionId === 'object') subscriptionId = subscriptionId.id;
      if (!subscriptionId) return res.json({received:true});
      // Retrieve current state instead of trusting event order or client metadata.
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const owner = await store.get(`promotionStripeOwners/${customerId}`);
      if (!key(owner)) return res.json({received:true});
      if (!(sub.items?.data || []).some(item => item.price.id === env.PROMOTION_STRIPE_PRICE_ID)) return res.json({received:true});
      const expiresAt = 1000 * (sub.trial_end && sub.status === 'trialing' ? sub.trial_end : Math.max(0,...sub.items.data.map(item => Number(item.current_period_end || sub.current_period_end || 0))));
      const billing = {customerId,subscriptionId:sub.id,status:sub.status,expiresAt,updatedAt:Date.now(),cancelAtPeriodEnd:sub.cancel_at_period_end === true};
      await store.transaction(root(owner), row => {
        row = row || {};
        // A newer refresh wins if webhooks complete concurrently.
        if (Number(row.billing?.updatedAt) > billing.updatedAt) return;
        row.billing = billing;
        if (!hasAccess(billing) && row.campaign?.status === 'active') row.campaign = {...row.campaign,status:'paused',pauseReason:'billing'};
        return row;
      });
      return res.json({received:true});
    } catch { return res.status(500).json({error:'Subscription synchronization failed'}); }
  });
}

export function promotionStripe(env = process.env) {
  if (!env.PROMOTION_STRIPE_KEY) return null;
  // Live billing requires explicit enablement; the existing connected account is not an API key.
  if (/^(sk|rk)_live_/.test(env.PROMOTION_STRIPE_KEY) && env.PROMOTION_LIVE_PAYMENTS !== 'true') return null;
  return new Stripe(env.PROMOTION_STRIPE_KEY, {apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2});
}

export function registerPromotionRoutes(app, deps) {
  const {store, authenticate, stripe = null, assistant = promotionAssistant, env = process.env, uploadMedia, authenticateGoodbarber} = deps;
  const router = express.Router();
  router.use((req,res,next) => {
    res.set('Cache-Control','no-store');
    const origin = req.get('origin');
    const allowed = (env.PROMOTION_ALLOWED_ORIGINS || 'https://www.mycity.city').split(',').map(x => x.trim());
    if (origin && !allowed.includes(origin)) return res.status(403).json({error:'Origen no autorizado'});
    if (origin) { res.set('Access-Control-Allow-Origin',origin); res.vary('Origin'); }
    res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-MyCity-User-Id');
    res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  router.use(async (req,res,next) => {
    if (env.PROMOTION_ENABLED !== 'true' || !store) return res.status(503).json({error:'Promoción todavía no está habilitada.'});
    const auth = /^(Bearer|GoodBarber) (.+)$/.exec(req.get('authorization') || '');
    const token = auth?.[2];
    if (!token) return res.status(401).json({error:'Inicia sesión en My City.'});
    try { req.owner = auth[1] === 'GoodBarber' ? await (authenticateGoodbarber || goodbarberPromotionIdentity)(token, req.get('X-MyCity-User-Id'), {env}) : await authenticate(token); if (!key(req.owner.id)) throw fail(403,'Cuenta inválida'); next(); }
    catch (e) { res.status([403,503].includes(e.status) ? e.status : 401).json({error:[403,503].includes(e.status) ? e.message : 'La sesión no es válida.'}); }
  });
  const route = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { next(e); } };
  const view = (owner,row = {}) => ({user:{id:owner.id,name:owner.name},entitlement:{active:hasAccess(row.billing),status:row.billing?.status||'inactive',expiresAt:row.billing?.expiresAt||null},business:row.business||{},campaign:row.campaign||{status:'draft'},messages:Object.values(row.messages||{}).sort((a,b)=>a.createdAt-b.createdAt).slice(-100),capabilities:{assistant:!!env.OPENAI_API_KEY,checkout:!!stripe,publishing:false}});
  router.get('/session',route(async(req,res) => res.json(view(req.owner,await store.get(root(req.owner.id)) || {}))));
  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:3,fieldSize:24000}}).single('media');
  router.post('/messages',upload,route(async(req,res) => {
    const text = clean(req.body?.text), id = clean(req.body?.clientRequestId,128);
    if (!key(id) || (!text && !req.file)) throw fail(400,'Mensaje o identificador inválido.');
    if (req.file && !/^(image|video)\//.test(req.file.mimetype)) throw fail(400,'Solo fotos o videos.');
    if (req.file && !uploadMedia) throw fail(503,'Adjuntos todavía no están conectados.');
    if (!env.OPENAI_API_KEY && assistant === promotionAssistant) throw fail(503,'El asistente todavía necesita su conexión de IA.');
    const path = root(req.owner.id), now = Date.now(), lease = crypto.randomUUID();
    const claimed = await store.transaction(path,row => {
      row = row || {};
      if (row.requests?.[id]?.status === 'done') return;
      if (Number(row.chatLease?.until) > now) return;
      const day = new Date(now).toISOString().slice(0,10);
      const count = row.chatUsage?.day === day ? row.chatUsage.count : 0;
      if (count >= 60) return;
      row.chatUsage={day,count:count+1};row.chatLease={id:lease,until:now+90000};
      row.requests={...row.requests,[id]:{status:'processing',updatedAt:now}};
      return row;
    });
    if (!claimed.committed) {
      const row = await store.get(path) || {};
      if (row.requests?.[id]?.status === 'done') return res.json({messages:row.requests[id].messages});
      throw fail(429,'Espera a que termine la respuesta o reintenta más tarde.');
    }
    try {
      const media = req.file ? [await uploadMedia(req.file,req.owner.id)] : [];
      const userMessage = {id:`user_${id}`,role:'user',text,media,createdAt:now};
      await store.set(`${path}/messages/${userMessage.id}`,userMessage);
      const row = await store.get(path) || {};
      const answer = await assistant({business:row.business||{},campaign:row.campaign||{},messages:Object.values(row.messages||{}).sort((a,b)=>a.createdAt-b.createdAt),env});
      const reply={id:`assistant_${id}`,role:'assistant',text:answer.reply,createdAt:Date.now()};
      const committed = await store.transaction(path,current => {
        if (current?.chatLease?.id !== lease) return;
        current.messages={...current.messages,[reply.id]:reply};
        const identityFields = ['commercialName','responsibleName','activity','serviceArea','contact','type'];
        const business = sanitizeBusiness(answer.business);
        const businessChanged = identityFields.some(field => business[field] !== (current.business?.[field] || ''));
        business.verificationStatus = businessChanged ? 'pending' : current.business?.verificationStatus || 'pending';
        const campaign = sanitizeCampaign(answer.campaign);
        const changed=hash(campaign)!==hash(current.campaign?.draft || {});
        current.business=business;current.campaign={...current.campaign,draft:campaign,status:changed?'draft':current.campaign?.status||'draft',draftHash:hash(campaign),updatedAt:Date.now()};
        if(changed) current.campaign.approvedHash=null;
        current.requests[id]={status:'done',messages:[userMessage,reply],updatedAt:Date.now()};current.chatLease=null;
        return current;
      });
      if(!committed.committed) throw fail(409,'La conversación cambió; reintenta.');
      res.json({messages:[userMessage,reply]});
    } catch(e) {
      await store.transaction(path,current => {if(current?.chatLease?.id!==lease)return;current.chatLease=null;current.requests[id]={status:'failed',updatedAt:Date.now()};return current;});
      throw e;
    }
  }));
  router.post('/campaign/actions',route(async(req,res)=> {
    const action=req.body?.action;
    if(!['pause','resume','approve'].includes(action)) throw fail(400,'Acción inválida.');
    const path=root(req.owner.id);
    if(action!=='pause') {
      const row=await store.get(path)||{};
      if(!hasAccess(row.billing)) throw fail(402,'Necesitas un plan activo.');
      if(row.business?.verificationStatus!=='approved') throw fail(409,'Tu negocio necesita revisión.');
      if(!row.campaign?.draft?.offer) throw fail(409,'Prepara una promoción antes de activarla.');
      if(action==='resume') throw fail(503,'La publicación automática todavía está en preparación.');
    }
    await store.transaction(path,row=> {
      row=row||{};
      if(action!=='pause'&&(!hasAccess(row.billing)||row.business?.verificationStatus!=='approved'))return;
      row.campaign={...row.campaign,status:action==='pause'?'paused':'approved',updatedAt:Date.now()};
      if(action==='approve')row.campaign.approvedHash=row.campaign.draftHash;
      if(action==='resume'&&row.campaign.approvedHash!==row.campaign.draftHash){row.campaign.status='draft';}
      return row;
    });
    res.json(view(req.owner,await store.get(path)||{}));
  }));
  router.get('/reports/:panel',route(async(req,res)=> {
    if(!['results','audience','publications','deliveries','business'].includes(req.params.panel))throw fail(404,'Panel desconocido.');
    const row=await store.get(root(req.owner.id))||{};
    if(req.params.panel==='business')return res.json({items:row.business?.commercialName?[{id:req.owner.id,name:row.business.commercialName,summary:[row.business.activity,row.business.serviceArea,row.business.presentation].filter(Boolean).join(' · '),status:row.business.verificationStatus||'pending'}]:[],updatedAt:row.campaign?.updatedAt||null});
    const period=req.query.period==='30d'?30:7, since=Date.now()-period*86400000;
    const events=Object.values(row.events||{}).filter(e=>Number(e.createdAt)>=since);
    const types=['app_view','email_delivered','email_open','email_click','interested'];
    const counts=Object.fromEntries(types.map(type=>[type,new Set(events.filter(e=>e.type===type&&e.recipientId).map(e=>e.recipientId)).size]));
    const metrics={appUniqueViews:counts.app_view,emailDelivered:events.filter(e=>e.type==='email_delivered').length,emailUniqueOpens:counts.email_open,emailUniqueClicks:counts.email_click,interested:counts.interested};
    let items=[];
    if(req.params.panel==='audience') {
      const filtered=events.filter(e=>key(e.recipientId)&&(req.query.filter==='all'||!req.query.filter||e.type===req.query.filter));
      items=[...new Map(filtered.map(e=>[e.recipientId,{id:e.recipientId,name:e.recipientName||'Usuario',status:e.type,profileUrl:`https://www.mycity.city/public-profile?userId=${encodeURIComponent(e.recipientId)}`}])).values()];
    }else if(req.params.panel==='publications'||req.params.panel==='deliveries')items=Object.values(row[req.params.panel]||{}).filter(x=>Number(x.createdAt)>=since).map(x=>({id:x.id,title:clean(x.title,180),summary:clean(x.summary,300),status:clean(x.status,80)}));
    const q=clean(req.query.q,180).toLowerCase();items=items.filter(x=>!q||[x.name,x.title,x.summary].join(' ').toLowerCase().includes(q));
    const filteredEvents=events.filter(e=>!req.query.filter||req.query.filter==='all'||e.type===req.query.filter);
    res.json({metrics,items,updatedAt:filteredEvents.length?Math.max(...filteredEvents.map(e=>Number(e.createdAt))):null});
  }));
  router.post('/billing/checkout',route(async(req,res)=> {
    if(!stripe||!env.PROMOTION_STRIPE_PRICE_ID)throw fail(503,'Stripe todavía no está configurado.');
    const account=await stripe.accounts.retrieve();
    if(account.id!==env.PROMOTION_STRIPE_ACCOUNT_ID)throw fail(503,'La cuenta de cobro no coincide con Barkpicture/My City.');
    const price=await stripe.prices.retrieve(env.PROMOTION_STRIPE_PRICE_ID);
    if(!price.active||price.currency!=='usd'||price.unit_amount!==999||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw fail(503,'El precio debe ser $9.99 USD al mes.');
    const path=root(req.owner.id), row=await store.get(path)||{};
    if(hasAccess(row.billing))throw fail(409,'Ya tienes un plan activo.');
    let customerId=row.billing?.customerId;
    if(!customerId){const customer=await stripe.customers.create({name:req.owner.name,...(req.owner.email?{email:req.owner.email}:{})},{idempotencyKey:`promotion-customer-${req.owner.id}`});customerId=customer.id;await store.update({[`${path}/billing/customerId`]:customerId,[`promotionStripeOwners/${customerId}`]:req.owner.id});}
    const previous=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100});
    if(previous.data.some(s=>['active','trialing','past_due','unpaid','incomplete','paused'].includes(s.status))) throw fail(409,'Ya existe una suscripción. Gestiona el plan desde el portal.');
    if(row.checkoutSessionId){const existing=await stripe.checkout.sessions.retrieve(row.checkoutSessionId);if(existing.status==='open'&&existing.url)return res.json({url:existing.url});}
    const url=env.PROMOTION_PUBLIC_URL;
    if(!url||!url.startsWith('https://'))throw fail(503,'La URL de retorno no está configurada.');
    const session=await stripe.checkout.sessions.create({customer:customerId,mode:'subscription',line_items:[{price:price.id,quantity:1}],
      integration_identifier:'mycity_promotion_'+Array.from(crypto.randomBytes(8),b=>String.fromCharCode(97+b%26)).join(''),success_url:url+'?payment=return',cancel_url:url,
      subscription_data:previous.data.length?{}:{trial_period_days:14,trial_settings:{end_behavior:{missing_payment_method:'cancel'}}}});
    await store.set(`${path}/checkoutSessionId`,session.id);
    res.json({url:session.url});
  }));
  router.post('/billing/portal',route(async(req,res)=> {
    if(!stripe||!env.PROMOTION_PUBLIC_URL)throw fail(503,'Stripe todavía no está configurado.');
    const row=await store.get(root(req.owner.id))||{};
    if(!row.billing?.customerId)throw fail(409,'No tienes un plan registrado.');
    const portal=await stripe.billingPortal.sessions.create({customer:row.billing.customerId,return_url:env.PROMOTION_PUBLIC_URL});
    res.json({url:portal.url});
  }));
  router.use((err,_req,res,_next)=>res.status(err.status|| (err instanceof multer.MulterError ? 400 : 500)).json({error:err.status||err instanceof multer.MulterError?err.message:'No se pudo completar la operación.'}));
  app.use('/api/promotion',router);
}
