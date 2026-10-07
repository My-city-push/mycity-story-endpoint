import crypto from 'node:crypto';
import express from 'express';
const fail=(status,message)=>Object.assign(Error(message),{status});
const LOCK='geofence-operator-lock-v1';
export function createGeofenceQueue({store,locks,now=Date.now}){
 async function list(){const jobs=[];for(const owner of await store.listOwners()){const row=await store.get(owner);for(const request of Object.values(row.geofenceRequests||{}))jobs.push({...request,ownerId:owner,zone:row.geofences?.[request.zoneId]});}return jobs.sort((a,b)=>a.createdAt-b.createdAt||a.ownerId.localeCompare(b.ownerId)||a.id.localeCompare(b.id));}
 return {list,
 async claim(){const existing=await locks.get(LOCK);if(existing)return {busy:true,job:existing};const candidate=(await list()).find(j=>j.status==='pending');if(!candidate)return {busy:false,job:null};const token=crypto.randomBytes(32).toString('base64url'),claimedAt=now();const lock={ownerId:candidate.ownerId,id:candidate.id,token,claimedAt};const acquired=await locks.transaction(LOCK,current=>current?undefined:lock);if(!acquired.committed)return {busy:true,job:acquired.value};
 // A lock never expires automatically: a suspended operator may still be editing GoodBarber.
 const result=await store.transaction(candidate.ownerId,row=>{const job=row.geofenceRequests?.[candidate.id];if(job?.status!=='pending')return;job.status='processing';job.claimToken=token;job.claimedAt=claimedAt;row.messages=[...(row.messages||[]),{id:'geo_processing_'+job.id,role:'assistant',text:'Un asistente ha tomado tu solicitud. Te avisaremos aquí cuando termine la configuración y su comprobación.',createdAt:claimedAt}].slice(-100);return row;});
 if(!result.committed){await locks.transaction(LOCK,current=>current?.token===token?null:undefined);return {busy:false,job:null};}return {busy:false,job:{...candidate,status:'processing',token,claimedAt}};
 },
 async finish({ownerId,id,token,status,summary,evidence}){
 if(!['completed','failed'].includes(status)||!summary?.trim()||summary.length>1200)throw fail(400,'Resultado inválido.');
 if(status==='completed'&&(!/^\d+$/.test(String(evidence?.geofenceId||''))||!/^\d+$/.test(String(evidence?.notificationId||''))||!['active','paused'].includes(evidence?.state)||!Number.isFinite(evidence?.verifiedAt)||evidence.verifiedAt>now()+60000||evidence.verifiedAt<now()-3600000))throw fail(400,'Falta la comprobación reciente de GoodBarber.');
 const lock=await locks.get(LOCK);const row=await store.get(ownerId),prior=row.geofenceRequests?.[id];
 if(prior?.claimToken===token&&prior.status===status){await locks.transaction(LOCK,current=>current?.token===token?null:undefined);return {status:prior.status};}
 if(!lock||lock.ownerId!==ownerId||lock.id!==id||lock.token!==token)throw fail(409,'Esta solicitud no está asignada al asistente.');
 await store.transaction(ownerId,current=>{const job=current.geofenceRequests?.[id];if(job?.claimToken!==token||job.status!=='processing')throw fail(409,'Solicitud no disponible.');const zone=current.geofences[job.zoneId];if(status==='completed'&&String(evidence.notificationId)===String(zone.existingNotificationId)&&zone.existingNotificationPurpose==='inspections')throw fail(400,'La notificación de inspecciones debe conservarse.');job.status=status;job.finishedAt=now();job.summary=summary.trim();job.evidence=status==='completed'?evidence:null;
 if(status==='completed'&&((job.action==='pause'&&evidence.state!=='paused')||(job.action==='activate'&&evidence.state!=='active')||(job.action==='create'&&evidence.state!=='paused')))throw fail(400,'El estado comprobado no coincide con la acción aprobada.');
 if(status==='completed')Object.assign(zone,{commercialGeofenceId:String(evidence.geofenceId),commercialNotificationId:String(evidence.notificationId),commercialProvisioningStatus:evidence.state,verifiedAt:evidence.verifiedAt});
 if(zone.pendingRequestId===id){delete zone.pendingRequestId;delete zone.pendingAction;}
 current.messages=[...(current.messages||[]),{id:'geo_result_'+id,role:'assistant',text:(status==='completed'?'Configuración comprobada en GoodBarber. ':'No se pudo completar la solicitud. ')+summary.trim(),createdAt:job.finishedAt}].slice(-100);return current;});
 await locks.transaction(LOCK,current=>current?.token===token?null:undefined);return {status};
 }};
}
export function registerGeofenceOperator(app,{queue,env=process.env}){
 const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');const key=env.PROMOTION_GEOFENCE_OPERATOR_KEY,supplied=req.get('X-MyCity-Operator-Key')||'';if(!queue||!key||key.length<32)return res.status(503).json({error:'Conexión del asistente pendiente.'});const a=Buffer.from(key),b=Buffer.from(supplied);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});next();});
 router.get('/queue',async(req,res,next)=>{try{const jobs=await queue.list();res.json({jobs:jobs.map(({claimToken,...job})=>job),counts:jobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{})});}catch(e){next(e);}});
 router.post('/claim',async(req,res,next)=>{try{res.json(await queue.claim());}catch(e){next(e);}});
 router.post('/result',async(req,res,next)=>{try{res.json(await queue.finish(req.body||{}));}catch(e){next(e);}});
 router.use((e,req,res,next)=>res.status(e.status||503).json({error:e.status?e.message:'Gestión temporalmente no disponible.'}));app.use('/api/promotion-operator',router);
}
