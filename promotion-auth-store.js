import crypto from 'node:crypto';
// Domain-separated authenticated encryption; no account details or bearer tokens in public RTDB.
export function createEncryptedPromotionAuthStore(database,secret){
 if(!database||String(secret||'').length<32)throw Error('Private authentication storage is not configured');
 const key=crypto.createHash('sha256').update('mycity-promotion-auth-v1:'+secret).digest();
 const path=p=>'promotionAuthEncrypted/'+crypto.createHmac('sha256',key).update(p).digest('hex');
 function encode(value,p){if(value===null)return null;const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(p));const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
 function decode(value,p){if(!value)return null;try{if(value.v!==1)throw Error();const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(p));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString());}catch{throw Object.assign(Error('Verificación temporalmente no disponible.'),{status:503});}}
 return {
  async get(p){const n=path(p);return decode((await database.ref(n).get()).val(),n);},
  async set(p,value){const n=path(p);await database.ref(n).set(encode(value,n));},
  async transaction(p,mutate){const n=path(p),ref=database.ref(n);let listener;try{await new Promise((resolve,reject)=>{listener=()=>resolve();ref.on('value',listener,reject);});const result=await ref.transaction(value=>{const next=mutate(decode(value,n));return next===undefined?undefined:encode(next,n);},undefined,false);return {committed:result.committed,value:decode(result.snapshot.val(),n)};}finally{if(listener)ref.off('value',listener);}}
 };
}
