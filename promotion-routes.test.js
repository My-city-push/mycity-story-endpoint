import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {registerPromotionRoutes, registerPromotionWebhook, hasAccess, sanitizeBusiness, sanitizeCampaign, promotionIdentity, goodbarberPromotionIdentity} from './promotion-routes.js';

function memory(initial={}) {
  const state=structuredClone(initial);
  const read=path=>path.split('/').reduce((v,k)=>v?.[k],state)??null;
  const write=(path,v)=>{const parts=path.split('/');let row=state;for(const p of parts.slice(0,-1))row=row[p]??={};row[parts.at(-1)]=structuredClone(v);};
  return {state,get:async p=>structuredClone(read(p)),set:async(p,v)=>write(p,v),update:async u=>Object.entries(u).forEach(([p,v])=>write(p,v)),transaction:async(p,f)=>{const next=f(structuredClone(read(p)));if(next===undefined)return {committed:false,value:read(p)};write(p,next);return {committed:true,value:next}}};
}
async function withServer(app,fn) {
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try{await fn(async(path,body,token='a',extra={})=>fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined}));}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
function harness({initial={},env={},stripe,assistant}={}) {
  const store=memory(initial),app=express();
  const config={PROMOTION_ENABLED:'true',OPENAI_API_KEY:'fake-key',...env};
  registerPromotionWebhook(app,{store,stripe,env:config});app.use(express.json());
  let calls=0;
  registerPromotionRoutes(app,{store,env:config,stripe,authenticate:async token=>{if(!['a','b'].includes(token))throw Error('invalid');return{id:token,name:'Owner '+token}},assistant:assistant||(async()=>{calls++;return{reply:'¿Qué quieres promocionar?',business:{commercialName:'Taller'},campaign:{offer:'Servicio',days:[1],time:'10:00'}}})});
  return{app,store,calls:()=>calls};
}
test('access expires and pending payments never grant access',()=> {
  assert.equal(hasAccess({status:'active',expiresAt:101},100),true);
  assert.equal(hasAccess({status:'active',expiresAt:100},100),false);
  assert.equal(hasAccess({status:'past_due',expiresAt:200},100),false);
});
test('business verification and user-selected quota cannot be injected',()=> {
  assert.equal(sanitizeBusiness({verificationStatus:'approved'}).verificationStatus,undefined);
  assert.equal(sanitizeCampaign({monthlyLimit:500}).monthlyLimit,8);
  assert.throws(()=>sanitizeCampaign({time:'25:00'}));
});
test('authentication requires server-provisioned GoodBarber binding',async()=> {
  const store=memory(),admin={auth:()=>({verifyIdToken:async()=>({uid:'uid',goodbarberUserId:'forged'})})};
  await assert.rejects(()=>promotionIdentity(admin,store,'token'),e=>e.status===403);
  await store.set('promotionIdentityByUid/uid',{verified:true,goodbarberUserId:'629388',name:'My City'});
  assert.equal((await promotionIdentity(admin,store,'token')).id,'629388');
});
test('disabled routes fail closed; missing tokens and invalid origins rejected',async()=> {
  const h=harness({env:{PROMOTION_ENABLED:'false'}});
  await withServer(h.app,async request=>assert.equal((await request('/api/promotion/session')).status,503));
  const enabled=harness();
  await withServer(enabled.app,async request=>{
    assert.equal((await request('/api/promotion/session',null,'')).status,401);
    assert.equal((await request('/api/promotion/session',null,'a',{Origin:'https://evil.test'})).status,403);
  });
});
test('owner isolation and message retries return existing reply without billing/model duplicates',async()=> {
  const h=harness();
  await withServer(h.app,async request=>{
    const body={text:'Promociona mi taller',clientRequestId:'same-id',ownerId:'b'};
    assert.equal((await request('/api/promotion/messages',body)).status,200);
    assert.equal((await request('/api/promotion/messages',body)).status,200);
    assert.equal(h.calls(),1);
    const other=await(await request('/api/promotion/session',null,'b')).json();
    assert.equal(other.messages.length,0);
    assert.equal(h.store.state.promotionByOwner.b,undefined);
  });
});
test('draft changes invalidate approval and pause an existing campaign',async()=> {
  const h=harness({initial:{promotionByOwner:{a:{business:{...sanitizeBusiness({commercialName:'Taller'}),verificationStatus:'approved'},campaign:{status:'active',approvedHash:'old',draft:{offer:'Old'}}}}}});
  await withServer(h.app,async request=>{
    await request('/api/promotion/messages',{text:'Cambia oferta',clientRequestId:'change'});
    const row=h.store.state.promotionByOwner.a;
    assert.equal(row.campaign.status,'draft');assert.equal(row.campaign.approvedHash,null);
    assert.equal(row.business.verificationStatus,'approved');
  });
});
test('approval needs billing and verification; resume cannot fake running scheduler',async()=> {
  const h=harness({initial:{promotionByOwner:{a:{billing:{status:'active',expiresAt:Date.now()+100000},business:{verificationStatus:'approved'},campaign:{draft:{offer:'Service'},draftHash:'draft-hash'}}}}});
  await withServer(h.app,async request=> {
    assert.equal((await request('/api/promotion/campaign/actions',{action:'approve'})).status,200);
    assert.equal(h.store.state.promotionByOwner.a.campaign.status,'approved');
    assert.equal((await request('/api/promotion/campaign/actions',{action:'resume'})).status,503);
    assert.equal((await request('/api/promotion/campaign/actions',{action:'approve'},'b')).status,402);
  });
});
test('reports deduplicate views, separate email opens, filter profile rows and hide emails',async()=> {
  const now=Date.now();const h=harness({initial:{promotionByOwner:{a:{events:{one:{type:'app_view',recipientId:'629388',recipientName:'My City',createdAt:now,email:'private@test.com'},two:{type:'app_view',recipientId:'629388',createdAt:now},three:{type:'email_open',recipientId:'433069',createdAt:now},old:{type:'app_view',recipientId:'old',createdAt:now-40*86400000}}}}}});
  await withServer(h.app,async request=>{
    const report=await(await request('/api/promotion/reports/results?period=7d')).json();
    assert.equal(report.metrics.appUniqueViews,1);assert.equal(report.metrics.emailUniqueOpens,1);
    const rows=await(await request('/api/promotion/reports/audience?filter=email_open')).json();
    assert.equal(rows.items.length,1);assert.equal(rows.items[0].id,'433069');
    assert.equal(JSON.stringify(rows).includes('private@test.com'),false);
  });
});
test('Stripe webhook checks raw bytes and current subscription state to revoke access',async()=>{
  let raw=false;
  const stripe={webhooks:{constructEvent:(body,signature)=>{raw=Buffer.isBuffer(body);if(signature!=='valid')throw Error();return{type:'customer.subscription.updated',data:{object:{id:'sub'}}}}},subscriptions:{retrieve:async()=>({id:'sub',customer:'cus',status:'past_due',items:{data:[{price:{id:'price'},current_period_end:2000000000}]}})}};
  const h=harness({stripe,env:{PROMOTION_STRIPE_PRICE_ID:'price',PROMOTION_STRIPE_WEBHOOK_SECRET:'secret'},initial:{promotionStripeOwners:{cus:'a'},promotionByOwner:{a:{campaign:{status:'active'}}}}});
  await withServer(h.app,async request=>{
    assert.equal((await request('/api/promotion/stripe/webhook',{},'a',{'stripe-signature':'bad'})).status,400);
    assert.equal((await request('/api/promotion/stripe/webhook',{},'a',{'stripe-signature':'valid'})).status,200);
    assert.equal(raw,true);assert.equal(h.store.state.promotionByOwner.a.campaign.status,'paused');assert.equal(h.store.state.promotionByOwner.a.billing.status,'past_due');
  });
});
test('changing business identity removes existing verification',async()=>{
  const h=harness({initial:{promotionByOwner:{a:{business:{...sanitizeBusiness({commercialName:'Otro negocio'}),verificationStatus:'approved'}}}}});
  await withServer(h.app,async request=>{
    assert.equal((await request('/api/promotion/messages',{text:'Mi nuevo negocio',clientRequestId:'rename'})).status,200);
    assert.equal(h.store.state.promotionByOwner.a.business.verificationStatus,'pending');
  });
});
test('Stripe checkout rejects a different account or incorrect price before creating charges',async()=>{
  for(const wrongAccount of [true,false]){
    let created=false;
    const stripe={accounts:{retrieve:async()=>({id:wrongAccount?'wrong':'expected'})},prices:{retrieve:async()=>({active:true,currency:'usd',unit_amount:1999,recurring:{interval:'month',interval_count:1}})},customers:{create:async()=>{created=true;return{id:'cus'}}}};
    const h=harness({stripe,env:{PROMOTION_STRIPE_ACCOUNT_ID:'expected',PROMOTION_STRIPE_PRICE_ID:'price'}});
    await withServer(h.app,async request=>assert.equal((await request('/api/promotion/billing/checkout',{})).status,503));
    assert.equal(created,false);
  }
});
test('failed assistant retry reuses saved human message',async()=>{
  let n=0;const h=harness({assistant:async()=>{if(n++===0)throw Object.assign(Error('temporarily unavailable'),{status:502});return{reply:'Listo',business:{},campaign:{}}}});
  await withServer(h.app,async request=>{
    const body={text:'Hola',clientRequestId:'retry'};
    assert.equal((await request('/api/promotion/messages',body)).status,502);
    assert.equal((await request('/api/promotion/messages',body)).status,200);
    const messages=Object.values(h.store.state.promotionByOwner.a.messages);
    assert.equal(messages.filter(m=>m.role==='user').length,1);
  });
});

test('native identity requires upstream confirmation for exact app and user',async()=> {
  const env={PROMOTION_GOODBARBER_APP_ID:'123',PROMOTION_GOODBARBER_API_TOKEN:'server-secret'};
  let sent;
  const fetchImpl=async(url,options)=>{sent={url,options};return {ok:true,status:200,json:async()=>({is_anonymous:false})}};
  const owner=await goodbarberPromotionIdentity('native-jwt','629388',{env,fetchImpl});
  assert.equal(owner.id,'629388');assert.equal(owner.admin,false);
  assert.equal(sent.url,'https://classic.goodbarber.dev/publicapi/v1/general/auth/123/validate/');
  assert.deepEqual(JSON.parse(sent.options.body),{jwt:'native-jwt',user_id:'629388'});
  assert.equal(sent.options.headers.token,'server-secret');
  await assert.rejects(()=>goodbarberPromotionIdentity('native-jwt','629388',{env:{},fetchImpl}),e=>e.status===503);
  for(const result of [{is_anonymous:true},{},{is_anonymous:false,error_code:'4002'}]){
    await assert.rejects(()=>goodbarberPromotionIdentity('native-jwt','629388',{env,fetchImpl:async()=>({ok:true,status:200,json:async()=>result})}),e=>e.status===401);
  }
  await assert.rejects(()=>goodbarberPromotionIdentity('native-jwt','someone/else',{env,fetchImpl}),e=>e.status===401);
  await assert.rejects(()=>goodbarberPromotionIdentity('native-jwt','629388',{env,fetchImpl:async()=>({ok:false,status:400})}),e=>e.status===401);
  await assert.rejects(()=>goodbarberPromotionIdentity('native-jwt','629388',{env,fetchImpl:async()=>{throw Error('offline')}}),e=>e.status===503);
});
test('native route uses validated owner and fails closed on unavailable verifier',async()=>{
 const store=memory(),app=express();app.use(express.json());
 registerPromotionRoutes(app,{store,env:{PROMOTION_ENABLED:'true'},authenticate:async()=>{throw Error('Wrong verifier')},authenticateGoodbarber:async(token,id)=>{if(token!=='native'||id!=='42')throw Object.assign(Error('invalid'),{status:401});return{id:'42'}}});
 await withServer(app,async request=>{
   const response=await request('/api/promotion/session',null,'unused',{'Authorization':'GoodBarber native','X-MyCity-User-Id':'42'});
   assert.equal(response.status,200);assert.equal((await response.json()).user.id,'42');
   assert.equal((await request('/api/promotion/session',null,'unused',{'Authorization':'GoodBarber native','X-MyCity-User-Id':'43'})).status,401);
 });
});
