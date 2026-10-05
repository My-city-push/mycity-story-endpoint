import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {goodbarberPromotionIdentity,registerGoodbarberSessionCheck} from './goodbarber-session.js';
const env={MYCITY_AUTH_CHECK_ENABLED:'true',GOODBARBER_APP_ID:'2817182',GOODBARBER_READ_TOKEN:'server-only'};
test('existing server credentials validate exact app/user without trusting JWT claims',async()=>{
 let request;const owner=await goodbarberPromotionIdentity('native','629388',{env,fetchImpl:async(url,options)=>{request={url,options};return{ok:true,status:200,json:async()=>({is_anonymous:false})}}});
 assert.equal(owner.id,'629388');assert.equal(owner.admin,false);assert.equal(request.options.headers.token,'server-only');assert.deepEqual(JSON.parse(request.options.body),{jwt:'native',user_id:'629388'});assert.match(request.url,/2817182\/validate/);
});
test('anonymous, malformed, invalid and unavailable upstream never grant access',async()=>{
 for(const data of [{is_anonymous:true},{},{is_anonymous:false,error_code:'4002'}])await assert.rejects(()=>goodbarberPromotionIdentity('native','629388',{env,fetchImpl:async()=>({ok:true,json:async()=>data})}),e=>e.status===401);
 await assert.rejects(()=>goodbarberPromotionIdentity('native','629388',{env,fetchImpl:async()=>({ok:false,status:400,json:async()=>({error_code:"4002"})})}),e=>e.status===401);
 await assert.rejects(()=>goodbarberPromotionIdentity('native','629388',{env,fetchImpl:async()=>{throw Error('offline')}}),e=>e.status===503);
 await assert.rejects(()=>goodbarberPromotionIdentity('native','bad/id',{env}),e=>e.status===401);
 await assert.rejects(()=>goodbarberPromotionIdentity('native','629388',{env:{}}),e=>e.status===503);
});
test('diagnostic rejects missing authentication and checks origin; success issues no credentials',async()=>{
 const app=express();registerGoodbarberSessionCheck(app,{env,fetchImpl:async()=>({ok:true,json:async()=>({is_anonymous:false})})});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/mycity/verify-session`;
 try{assert.equal((await fetch(url,{method:'POST'})).status,401);assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://evil.test'}})).status,403);const r=await fetch(url,{method:'POST',headers:{Authorization:'GoodBarber native','X-MyCity-User-Id':'629388'}});assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{verified:true,user:{id:'629388'},scope:'session-check-only'});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
