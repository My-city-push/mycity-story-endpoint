import crypto from 'node:crypto';
import express from 'express';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const idOK=id=>/^\d{1,20}$/.test(String(id||''));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const codeHash=(secret,id,code)=>crypto.createHmac('sha256',secret).update(`${id}:${code}`).digest('hex');
const invalid=()=>fail(401,'Código incorrecto o vencido. Solicita uno nuevo.');

export async function registeredPromotionAccount(userId,{env=process.env,fetchImpl=fetch}={}) {
  if(!idOK(userId)) throw fail(400,'Abre Promoción desde tu cuenta de My City.');
  const appId=env.PROMOTION_GOODBARBER_APP_ID||env.GOODBARBER_APP_ID;
  const key=env.PROMOTION_GOODBARBER_API_TOKEN||env.GOODBARBER_READ_TOKEN;
  if(!idOK(appId)||!key) throw fail(503,'La conexión de verificación todavía está pendiente.');
  let response;
  try { response=await fetchImpl(`https://classic.goodbarber.dev/publicapi/v1/general/prospects/${appId}/prospect/${userId}/`,{headers:{token:key},redirect:'error',signal:AbortSignal.timeout(10000)}); }
  catch { throw fail(503,'No se pudo consultar la cuenta de My City.'); }
  if(!response.ok) throw fail(503,'No se pudo consultar la cuenta de My City.');
  let account;try{account=await response.json()}catch{throw fail(503,'Respuesta de cuenta inválida.');}
  // Never trust an email, display name or internal note supplied by the client.
  if(String(account.user_id)!==String(userId)||account.is_active===false||!/^\S+@\S+\.\S+$/.test(account.email||'')) throw fail(503,'No se pudo consultar la cuenta de My City.');
  return {id:String(account.user_id),email:account.email,name:[account.first_name,account.last_name].filter(Boolean).join(' ').slice(0,180),admin:false};
}

export function createPromotionEmailAuth({store,env=process.env,lookup=registeredPromotionAccount,deliver,now=Date.now}) {
  function ready(){if(env.PROMOTION_EMAIL_AUTH_ENABLED!=='true'||env.PROMOTION_AUTH_STORAGE_PRIVATE!=='true'||!store||String(env.PROMOTION_EMAIL_AUTH_SECRET||'').length<32)throw fail(503,'La verificación por correo todavía está pendiente de activación.');}
  async function quota(key,limit,windowMs){const time=now();const result=await store.transaction(`promotionAuthLimits/${digest(key)}`,old=>{const row=old&&old.until>time?old:{until:time+windowMs,count:0};if(row.count>=limit)return;return {...row,count:row.count+1};});if(!result.committed)throw fail(429,'Espera antes de volver a solicitar un código.');}
  return {
    async start(userId,ip){ready();if(!idOK(userId))throw fail(400,'Cuenta inválida.');await quota('ip:'+ip,20,3600000);await quota('cooldown:'+userId,1,60000);await quota('hour:'+userId,3,3600000);await quota('day:'+userId,5,86400000);
      const account=await lookup(String(userId),{env});const challengeId=crypto.randomBytes(24).toString('hex');const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');const expiresAt=now()+600000;
      await store.set(`promotionAuthChallenges/${challengeId}`,{account,hash:codeHash(env.PROMOTION_EMAIL_AUTH_SECRET,challengeId,code),expiresAt,attempts:0,used:false,delivered:false});
      try {await deliver({action:'promotion_verification_code',recipientUserId:account.id,recipientEmail:account.email,verificationCode:code,expiresAt,challengeId});await store.transaction(`promotionAuthChallenges/${challengeId}`,row=>row?{...row,delivered:true}:undefined);}
      catch {await store.set(`promotionAuthChallenges/${challengeId}`,null);throw fail(503,'No se pudo enviar el código. Inténtalo más tarde.');}
      return {challengeId,expiresAt,message:'Enviamos un código al correo registrado en tu cuenta de My City.'};
    },
    async confirm(challengeId,code,userId,ip){ready();await quota('confirm:'+ip,60,3600000);if(!/^[a-f0-9]{48}$/.test(challengeId||'')||!/^\d{6}$/.test(code||'')||!idOK(userId))throw invalid();
      const expected=codeHash(env.PROMOTION_EMAIL_AUTH_SECRET,challengeId,code);let accepted=false;
      const result=await store.transaction(`promotionAuthChallenges/${challengeId}`,row=>{accepted=false;if(!row||!row.delivered||row.used||row.expiresAt<=now()||row.attempts>=5||row.account.id!==String(userId))return;accepted=crypto.timingSafeEqual(Buffer.from(row.hash,'hex'),Buffer.from(expected,'hex'));return {...row,attempts:row.attempts+1,used:accepted};});
      if(!result.committed||!accepted||!result.value.used)throw invalid();
      const token=crypto.randomBytes(32).toString('base64url');const expiresAt=now()+86400000;
      await store.set(`promotionAuthSessions/${digest(token)}`,{account:result.value.account,expiresAt,challengeId});
      return {verified:true,user:{id:result.value.account.id,name:result.value.account.name},accessToken:token,expiresAt};
    },
    async authenticate(token,userId){ready();if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))throw fail(401,'Vuelve a verificar tu cuenta.');const row=await store.get(`promotionAuthSessions/${digest(token)}`);if(!row||row.expiresAt<=now()||row.account.id!==String(userId))throw fail(401,'Vuelve a verificar tu cuenta.');return row.account;},
    async logout(token){if(/^[A-Za-z0-9_-]{43}$/.test(token||''))await store.set(`promotionAuthSessions/${digest(token)}`,null);}
  };
}

export async function sendPromotionVerification(payload,{env=process.env,fetchImpl=fetch}={}) {
  const url=env.PROMOTION_VERIFICATION_WEBHOOK_URL,key=env.PROMOTION_VERIFICATION_WEBHOOK_KEY;
  if(!url||!key)throw fail(503,'Envío de verificación pendiente.');
  const target=new URL(url);if(target.protocol!=='https:'||!/^hook\.(?:[a-z0-9-]+\.)?make\.com$/.test(target.hostname))throw fail(503,'Conexión de correo inválida.');
  const response=await fetchImpl(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','x-make-apikey':key},body:JSON.stringify(payload)});
  if(!response.ok)throw fail(503,'Envío de verificación fallido.');
  const result=await response.json();if(result?.status!=='sent'||result.challengeId!==payload.challengeId)throw fail(503,'El envío no fue confirmado.');
}

export function registerPromotionEmailAuth(app,auth,{env=process.env}={}) {
  const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');const origin=req.get('origin');const allowed=(env.PROMOTION_ALLOWED_ORIGINS||'https://www.mycity.city').split(',').map(x=>x.trim());if(origin&&!allowed.includes(origin))return res.status(403).json({error:'Origen no autorizado'});if(origin){res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');}res.set('Access-Control-Allow-Headers','Content-Type, Authorization, X-MyCity-User-Id');res.set('Access-Control-Allow-Methods','POST, OPTIONS');if(req.method==='OPTIONS')return res.status(204).end();next();});
  const route=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status([400,401,429,503].includes(e.status)?e.status:503).json({error:e.status?e.message:'Verificación temporalmente no disponible.'});}};
  router.post('/start',route(req=>auth.start(req.body?.userId,req.ip)));
  router.post('/confirm',route(req=>auth.confirm(req.body?.challengeId,req.body?.code,req.body?.userId,req.ip)));
  router.post('/logout',route(async req=>{await auth.logout(/^Promotion (.+)$/.exec(req.get('authorization')||'')?.[1]);return {ok:true};}));
  app.use('/api/mycity/email-verification',router);
}
