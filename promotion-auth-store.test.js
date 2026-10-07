import test from 'node:test';
import assert from 'node:assert/strict';
import {createEncryptedPromotionAuthStore} from './promotion-auth-store.js';
import {createPromotionEmailAuth} from './promotion-email-auth.js';
test('encrypted auth survives process recreation, hides identity, handles transaction replays and rejects tampering',async()=>{
 const rows=new Map();let active=0;
 const database={ref:path=>({get:async()=>({val:()=>rows.get(path)||null}),set:async v=>v===null?rows.delete(path):rows.set(path,v),on:(_e,fn)=>{active++;queueMicrotask(fn)},off:()=>active--,transaction:async fn=>{let v=fn(rows.get(path)||null);if(v!==undefined)v=fn(v);if(v!==undefined)rows.set(path,v);return {committed:v!==undefined,snapshot:{val:()=>rows.get(path)||null}};}})};
 const secret='secret'.repeat(10),env={PROMOTION_EMAIL_AUTH_ENABLED:'true',PROMOTION_EMAIL_AUTH_SECRET:secret};let delivery;
 const create=()=>createPromotionEmailAuth({store:createEncryptedPromotionAuthStore(database,secret),env,lookup:async id=>({id,email:'private@example.test'}),deliver:async p=>delivery=p});
 const auth=create(),c=await auth.start('123','ip'),v=await auth.confirm(c.challengeId,delivery.verificationCode,'123','ip','installation_A_123456789');
 assert.equal((await create().resume(v.accessToken,'123','installation_A_123456789')).verified,true);
 assert.equal(JSON.stringify([...rows]).includes('private@example.test'),false);assert.equal(JSON.stringify([...rows]).includes(v.accessToken),false);assert.equal(active,0);
 const store=createEncryptedPromotionAuthStore(database,secret);await store.set('probe',{account:'private'});const path=[...rows.keys()].at(-1);rows.set(path,{...rows.get(path),data:'AAAA'});await assert.rejects(store.get('probe'),{status:503});assert.equal(active,0);
});
