import {sanitizeGeofenceProposal} from './promotion-geofence-flow.js';
import crypto from 'node:crypto';
import express from 'express';
const fail=(status,message)=>Object.assign(Error(message),{status});
const LOCK='geofence-operator-lock-v1';
export function createGeofenceQueue({store,locks,now=Date.now}){
 async function list(){const jobs=[];for(const owner of await store.listOwners()){const row=await store.get(owner);for(const request of Object.values(row.geofenceRequests||{}))jobs.push({...request,ownerId:owner,zone:row.geofences?.[request.zoneId]});}return jobs.sort((a,b)=>a.createdAt-b.createdAt||a.ownerId.localeCompare(b.ownerId)||a.id.localeCompare(b.id));}
 return {list,
 async enqueue({ownerId,sourceMessageId,proposal,activateAfterCreate=false}){
 const id='operator_'+crypto.createHash('sha256').update(String(ownerId)+':'+String(sourceMessageId)).digest('hex').slice(0,24);
 const result=await store.transaction(ownerId,row=>{if(row.geofenceRequests?.[id])return row;
 if(!(row.messages||[]).some(m=>m.id===sourceMessageId&&m.role==='user'))throw fail(400,'Falta la petición original del usuario.');
 const p=sanitizeGeofenceProposal(proposal,Object.values(row.geofences||{}));if(!p)throw fail(400,'Propuesta incompleta.');
 if(p.action!=='create')throw fail(400,'Esta vía prepara únicamente nuevas ubicaciones.');
 if(Object.keys(row.geofences||{}).length>=50)throw fail(400,'Límite de ubicaciones.');
 const zoneId='draft_'+id;row.geofences={...row.geofences,[zoneId]:{id:zoneId,ownerId,name:p.name,address:p.address,latitude:p.latitude,longitude:p.longitude,observedRadiusMeters:p.radius,bindingStatus:'draft',commercialProvisioningStatus:'pending',proposedMessage:p.message,pendingRequestId:id,pendingAction:'create',createdAt:now()}};
 row.geofenceRequests={...row.geofenceRequests,[id]:{id,zoneId,action:'create',message:p.message,schedule:p.schedule,proposal:p,status:'pending',createdAt:now(),approvedAt:now(),approvalSource:'authorized_operator',sourceMessageId,activateAfterCreate:activateAfterCreate===true}};
 row.messages=[...(row.messages||[]),{id:'geo_registered_'+id,role:'assistant',text:'Un asistente ha revisado tu petición y resuelto la dirección. La solicitud '+id+' está registrada para crear la ubicación de '+p.name+' con radio de '+p.radius+' metros. La comprobación en GoodBarber sigue pendiente; el aviso de inspecciones se conserva.',createdAt:now()}].slice(-100);return row;});return {id,status:result.value.geofenceRequests[id].status};
 },
 async inspect(ownerId){if(!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId))throw fail(400,'Cuenta inválida.');const row=await store.get(ownerId);return {ownerId,proposal:row.geofenceProposal||null,geofences:Object.values(row.geofences||{}),messages:(row.messages||[]).slice(-20)};},
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
 if(status==='completed')Object.assign(zone,{commercialGeofenceId:String(evidence.geofenceId),commercialNotificationId:String(evidence.notificationId),commercialProvisioningStatus:evidence.state,bindingStatus:'linked',verifiedAt:evidence.verifiedAt});
 if(status==='failed')zone.commercialProvisioningStatus='failed';
 if(zone.pendingRequestId===id){delete zone.pendingRequestId;delete zone.pendingAction;}
 if(status==='completed'&&job.action==='create'&&job.activateAfterCreate){const nextId=id+'_activate';current.geofenceRequests[nextId]||={id:nextId,zoneId:job.zoneId,action:'activate',message:job.message,schedule:job.schedule,status:'pending',createdAt:now(),approvedAt:job.approvedAt,approvalSource:job.approvalSource,sourceMessageId:job.sourceMessageId};zone.pendingRequestId=nextId;zone.pendingAction='activate';}

 const trigger={entry:'al entrar en la zona',exit:'al salir de la zona',dwell:'tras permanecer '+job.schedule?.dwellMinutes+' minutos en la zona'}[job.schedule?.trigger]||'según tus ajustes';const doneText=status==='completed'&&evidence.state==='active'?'Listo. Tu notificación en '+zone.name+' está activa '+trigger+'. Podrán recibirla los usuarios de My City que tengan habilitadas las notificaciones y la ubicación, según la repetición elegida. ':status==='completed'?'Configuración comprobada en GoodBarber. ':'No se pudo completar la solicitud. ';
 current.messages=[...(current.messages||[]),{id:'geo_result_'+id,role:'assistant',text:doneText+summary.trim(),createdAt:job.finishedAt}].slice(-100);return current;});
 await locks.transaction(LOCK,current=>current?.token===token?null:undefined);return {status};
 }};
}
export function registerGeofenceOperator(app,{queue,env=process.env}){
 const router=express.Router();router.use((req,res,next)=>{res.set('Cache-Control','no-store');const key=env.PROMOTION_GEOFENCE_OPERATOR_KEY,supplied=req.get('X-MyCity-Operator-Key')||'';if(!queue||!key||key.length<32)return res.status(503).json({error:'Conexión del asistente pendiente.'});const a=Buffer.from(key),b=Buffer.from(supplied);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'});next();});
 router.get('/queue',async(req,res,next)=>{try{const jobs=await queue.list();res.json({jobs:jobs.map(({claimToken,...job})=>job),counts:jobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{})});}catch(e){next(e);}});
 router.get('/accounts/:ownerId',async(req,res,next)=>{try{res.json(await queue.inspect(req.params.ownerId));}catch(e){next(e);}});
 router.post('/requests',async(req,res,next)=>{try{res.json(await queue.enqueue(req.body||{}));}catch(e){next(e);}});
 router.post('/claim',async(req,res,next)=>{try{res.json(await queue.claim());}catch(e){next(e);}});
 router.post('/result',async(req,res,next)=>{try{res.json(await queue.finish(req.body||{}));}catch(e){next(e);}});
 router.use((e,req,res,next)=>res.status(e.status||503).json({error:e.status?e.message:'Gestión temporalmente no disponible.'}));app.use('/api/promotion-operator',router);
}
