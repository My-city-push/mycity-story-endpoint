import {hasPromotionAccess} from './promotion-billing.js';
import {promotionAssistant,sanitizeBusiness,sanitizeCampaign,preparePromotionFlow} from './promotion-assistant.js';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const valid=v=>/^[A-Za-z0-9_-]{1,128}$/.test(String(v||''));
export function createEncryptedPromotionIntake(database,secret){
  if(!database||String(secret||'').length<32)return null;
  const encryptionKey=crypto.createHash('sha256').update('mycity-promotion-intake-v1:'+secret).digest();
  const node=owner=>'promotionIntakeEncrypted/'+crypto.createHmac('sha256',encryptionKey).update(owner).digest('hex');
  function decode(value,path){
    if(!value)return {};
    try{if(value.version!==1)throw Error();const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(path));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString());}
    catch{throw fail(503,'No se pudo leer la conversación guardada.');}
  }
  function encode(row,path){const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv);cipher.setAAD(Buffer.from(path));const data=Buffer.concat([cipher.update(JSON.stringify(row)),cipher.final()]);return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
  const customerPath=id=>'promotionStripeBindingsEncrypted/'+crypto.createHmac('sha256',encryptionKey).update(String(id)).digest('hex');
  return {
    async bindCustomer(id,owner){const path=customerPath(id);await database.ref(path).set(encode({owner},path));},
    async ownerForCustomer(id){const path=customerPath(id);return decode((await database.ref(path).get()).val(),path).owner||null;},
    async listOwners(){const values=(await database.ref('promotionIntakeEncrypted').get()).val()||{};return Object.entries(values).map(([id,value])=>{try{const row=decode(value,'promotionIntakeEncrypted/'+id);return valid(row.ownerId)&&node(row.ownerId)==='promotionIntakeEncrypted/'+id?row.ownerId:null;}catch{console.warn('promotion-intake encrypted_record=unreadable');return null;}}).filter(Boolean);},
    async get(owner){if(!valid(owner))throw fail(401,'Cuenta inválida.');const path=node(owner);return decode((await database.ref(path).get()).val(),path);},
    async transaction(owner,mutate){if(!valid(owner))throw fail(401,'Cuenta inválida.');const path=node(owner),ref=database.ref(path);let listener;
      // Retain the server value: cold transactions may see null before synchronization.
      try{await new Promise((resolve,reject)=>{listener=()=>resolve();ref.on('value',listener,reject);});
        const result=await ref.transaction(value=>{const next=mutate(decode(value,path));if(next===undefined)return;next.ownerId=owner;return encode(next,path);},undefined,false);
        return {committed:result.committed,value:decode(result.snapshot.val(),path)};
      }finally{if(listener)ref.off('value',listener);}}
  };
}

export function registerPromotionIntake(app,{store,authenticate,env=process.env,assistant=promotionAssistant,billing=null,automation=null}){
  const aiReady=()=>env.PROMOTION_AI_ENABLED==='true'&&!!env.OPENAI_API_KEY&&!!env.PROMOTION_AI_MODEL;
  console.info('promotion-assistant configuration_enabled='+String(env.PROMOTION_AI_ENABLED==='true')+' key_configured='+String(!!env.OPENAI_API_KEY)+' model_configured='+String(!!env.PROMOTION_AI_MODEL));
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-MyCity-User-Id');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
  router.use(async(req,res,next)=>{
    if(env.PROMOTION_INTAKE_ENABLED!=='true'||!store)return res.status(503).json({error:'Recepción de promociones pendiente de activación.'});
    try{const token=/^Promotion ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'')?.[1];if(!token)throw fail(401,'Verifica tu cuenta para abrir Promoción.');req.owner=await authenticate(token,req.get('X-MyCity-User-Id'));next();}catch(e){res.status(e.status||401).json({error:e.status?e.message:'Vuelve a verificar tu cuenta.'});}
  });
  const view=(owner,row)=>({user:{id:owner.id,name:owner.name},entitlement:{active:hasPromotionAccess(row.billing),status:row.billing?.status||'inactive',expiresAt:row.billing?.expiresAt||null},business:row.business||{verificationStatus:'pending'},geofences:Object.values(row.geofences||{}),geofenceRequests:Object.values(row.geofenceRequests||{}).map(({claimToken,...request})=>request),campaign:row.campaign||{status:'draft'},messages:row.messages||[],preparation:row.preparation||{stage:'collect_business'},capabilities:{geofenceFreePilot:env.PROMOTION_GEOFENCE_FREE_PILOT==='true',geofenceCheckout:false,assistant:aiReady(),checkout:!!billing?.ready(),publishing:!!automation?.ready(),intake:true}});
  router.get('/session',async(req,res,next)=>{try{res.json(view(req.owner,await store.get(req.owner.id)));}catch(e){next(e);}});
  router.post('/geofences/drafts',async(req,res,next)=>{try{
    const id=req.body?.clientRequestId,name=String(req.body?.name||'').trim().slice(0,120),address=String(req.body?.address||'').trim().slice(0,240),latitude=Number(req.body?.latitude),longitude=Number(req.body?.longitude),radius=Number(req.body?.radius);
    if(!valid(id)||!name||!address||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||!Number.isFinite(radius)||radius<100||radius>150)throw fail(400,'Confirma nombre, dirección, coordenadas y radio entre 100 y 150 metros.');
    const createdAt=Date.now();const result=await store.transaction(req.owner.id,row=>{const key='draft_'+id;if(row.geofences?.[key])return row;if(Object.keys(row.geofences||{}).length>=50)throw fail(400,'Has alcanzado el límite de ubicaciones preparadas.');row.geofences={...row.geofences,[key]:{id:key,ownerId:req.owner.id,name,address,latitude,longitude,observedRadiusMeters:radius,bindingStatus:'draft',commercialProvisioningStatus:'pending',managementMode:'backoffice',createdAt}};row.messages=[...(row.messages||[]),{id:'geo_draft_'+id,role:'assistant',text:'Guardé la propuesta de ubicación «'+name+(env.PROMOTION_GEOFENCE_FREE_PILOT==='true'?'». La prueba es gratuita. Falta crearla en GoodBarber; podemos preparar su mensaje.':'». Aún no está creada en GoodBarber ni pagada. Podemos preparar su mensaje.'),createdAt}].slice(-100);return row;});res.json(view(req.owner,result.value));
  }catch(e){next(e);}});
  router.post('/geofences/:id/actions',async(req,res,next)=>{try{
    const zoneId=req.params.id,action=req.body?.action,requestId=req.body?.clientRequestId;
    if(!valid(zoneId)||!valid(requestId)||!['pause','activate','edit_message','edit_schedule'].includes(action))throw fail(400,'Solicitud inválida.');
    const createdAt=Date.now();const result=await store.transaction(req.owner.id,row=>{
      const zone=row.geofences?.[zoneId];if(!zone)throw fail(404,'Ubicación no vinculada a tu cuenta.');
      if(row.geofenceRequests?.[requestId])return row;
      const text=String(req.body?.message||'').trim().slice(0,240);if(action==='edit_message'&&!text)throw fail(400,'Escribe el mensaje propuesto.');
      row.geofenceRequests={...row.geofenceRequests,[requestId]:{id:requestId,zoneId,action,message:text,status:'pending',createdAt}};
      row.geofences[zoneId]={...zone,pendingAction:action,pendingRequestId:requestId,...(action==='edit_message'?{proposedMessage:text}:{})};
      const label={pause:'pausar',activate:'activar',edit_message:'actualizar el mensaje de',edit_schedule:'revisar los horarios de'}[action];
      row.messages=[...(row.messages||[]),{id:'geo_'+requestId,role:'assistant',text:'Recibí tu solicitud para '+label+' '+zone.name+'. Está pendiente de aplicar y comprobar en GoodBarber. El aviso existente de inspecciones se conserva.',createdAt}].slice(-100);return row;
    });res.json(view(req.owner,result.value));
  }catch(e){next(e);}});
  const parse=multer({limits:{fields:3,fieldSize:24000,files:0}}).none();
  router.post('/messages',parse,async(req,res,next)=>{
    try{
      const text=String(req.body?.text||'').trim().slice(0,6000);const id=req.body?.clientRequestId;
      if(!text||!valid(id))throw fail(400,'Escribe tu solicitud de promoción.');
      const now=Date.now(),user={id:'user_'+id,role:'user',text,createdAt:now};
      if(aiReady()){
        const lease=crypto.randomUUID();
        console.info('promotion-chat phase=claim');
        const claimed=await store.transaction(req.owner.id,row=>{
          if(Array.isArray(row.requests?.[id])||row.requests?.[id]?.status==='done')return;
          if(row.lease?.id===lease)return row;
          if(row.lease?.until>now)throw fail(429,'Espera a que termine la respuesta.');
          const day=new Date(now).toISOString().slice(0,10),count=row.usage?.day===day?row.usage.count:0;
          if(count>=60)throw fail(429,'Has alcanzado el límite de solicitudes de hoy.');
          if(!(row.messages||[]).some(m=>m.id===user.id))row.messages=[...(row.messages||[]),user].slice(-100);
          row.requests={...row.requests,[id]:{status:'processing'}};row.lease={id:lease,until:now+90000};row.usage={day,count:count+1};row.updatedAt=now;return row;
        });
        if(!claimed.committed){const previous=claimed.value.requests[id];return res.json({messages:Array.isArray(previous)?previous:previous.messages});}
        try{
          console.info('promotion-chat phase=assistant');
          const row=claimed.value;const answer=await assistant({business:row.business||{},campaign:row.campaign?.draft||{},preparation:row.preparation||{},messages:row.messages,geofences:Object.values(row.geofences||{}),env});
          const business=sanitizeBusiness(answer.business);const flow=env.PROMOTION_GEO_CHAT_ENABLED==='true'?{reply:answer.reply,preparation:row.preparation||{}}:preparePromotionFlow({previous:row.business||{},business,preparation:row.preparation||{},text,reply:answer.reply});
          const reply={id:'assistant_'+id,role:'assistant',text:flow.reply,createdAt:Date.now()};
          const committed=await store.transaction(req.owner.id,current=>{if(current.requests?.[id]?.status==='done')return current;if(current.lease?.id!==lease)return;current.messages=[...current.messages,reply].slice(-100);current.preparation=flow.preparation;current.business={...business,verificationStatus:'pending'};const draft=env.PROMOTION_GEO_CHAT_ENABLED==='true'?current.campaign?.draft:sanitizeCampaign(answer.campaign);const changed=JSON.stringify(draft)!==JSON.stringify(current.campaign?.draft);current.campaign={...current.campaign,status:changed?'draft':current.campaign?.status||'draft',draft,...(changed?{approvedHash:null}:{}),updatedAt:Date.now()};current.requests[id]={status:'done',messages:[user,reply]};const ids=Object.keys(current.requests);for(const old of ids.slice(0,Math.max(0,ids.length-100)))delete current.requests[old];current.lease=null;current.updatedAt=Date.now();return current;});
          if(!committed.committed&&committed.value.requests?.[id]?.status!=='done')throw fail(409,'La conversación cambió. Reintenta el envío.');console.info('promotion-chat phase=done');return res.json({messages:[user,reply]});
        }catch(error){await store.transaction(req.owner.id,row=>{if(row.requests?.[id]?.status==='failed')return row;if(row.lease?.id!==lease)return;row.lease=null;row.requests[id]={status:'failed'};return row;});throw error;}
      }
      const reply={id:'assistant_'+id,role:'assistant',text:'Tu solicitud quedó guardada en esta conversación. Para preparar tu promoción, envía el nombre del negocio, qué ofreces, la zona donde atiendes y cómo quieres que te contacten. La revisión del negocio y la programación de publicaciones siguen pendientes; este mensaje todavía no se ha publicado.',createdAt:now+1};
      const result=await store.transaction(req.owner.id,row=>{
        if(row.requests?.[id])return;
        const day=new Date(now).toISOString().slice(0,10),count=row.usage?.day===day?row.usage.count:0;
        if(count>=60)throw fail(429,'Has alcanzado el límite de solicitudes de hoy.');
        row.messages=[...(row.messages||[]),user,reply].slice(-100);row.requests={...(row.requests||{}),[id]:[user,reply]};const ids=Object.keys(row.requests);for(const old of ids.slice(0,Math.max(0,ids.length-100)))delete row.requests[old];row.usage={day,count:count+1};row.status='received';row.updatedAt=now;return row;
      });
      res.json({messages:result.value.requests[id]});
    }catch(e){console.warn('promotion-chat phase=failed status='+String(e.status||503));next(e);}
  });
  router.get('/reports/:report',async(req,res,next)=>{try{
    const row=await store.get(req.owner.id);const panel=req.params.report;if(!['results','audience','publications','deliveries','business'].includes(panel))throw fail(404,'Panel desconocido.');
    const since=Date.now()-(req.query.period==='30d'?30:7)*86400000;const publications=Object.values(row.publications||{}).filter(p=>p.createdAt>=since);
    const draft=row.campaign?.draft;const days=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    let items=panel==='publications'?[...(draft?[{title:draft.title||'Borrador de promoción',summary:[draft.offer,'Audiencia: '+draft.audience,(draft.days||[]).map(d=>days[d]).join(', '),draft.time+' · '+draft.timezone].filter(Boolean).join(' · '),status:row.campaign.status==='active'?'Programación activa':row.campaign.status==='approved'?'Borrador aprobado · activa tu plan y pulsa Reactivar':'Borrador · pendiente de aprobación'}]:[]),...publications]:panel==='business'&&row.business?[{name:row.business.commercialName||'Negocio pendiente',summary:[row.business.activity,row.business.serviceArea,row.business.contact,row.business.presentation].filter(Boolean).join(' · '),status:row.preparation?.confirmedFingerprint?'Datos confirmados · revisión comercial pendiente':'Datos pendientes de confirmar'}]:panel==='results'?[{title:'Publicaciones realizadas',summary:String(publications.length)+' publicaciones; '+publications.reduce((n,p)=>n+(p.recipientCount||0),0)+' destinos en total (pueden repetirse entre publicaciones)',status:'Registros del servidor'}]:[];
    if(panel==='business')for(const zone of Object.values(row.geofences||{}))items.push({name:'Ubicación vinculada: '+zone.name,summary:'Geofence existente · radio observado '+zone.observedRadiusMeters+' metros. El aviso actual de inspecciones se conserva.',status:'Vinculada · aviso comercial pendiente de configurar'});
    const q=String(req.query.q||'').toLowerCase();items=items.filter(x=>!q||[x.name,x.title,x.summary].join(' ').toLowerCase().includes(q));
    res.json({items,updatedAt:row.updatedAt||null,status:panel==='deliveries'?'email_pending':'ready',nextRunAt:row.campaign?.nextRunAt||null});
  }catch(e){next(e);}});
  router.post('/campaign/actions',async(req,res,next)=>{try{if(!automation)throw fail(503,'La programación sigue pendiente.');await automation.action(req.owner,req.body?.action);res.json(view(req.owner,await store.get(req.owner.id)));}catch(e){next(e);}});
  router.post('/billing/:action',async(req,res,next)=>{try{if(!billing||!['checkout','portal'].includes(req.params.action))throw fail(503,'Falta completar la conexión de Stripe.');res.json(await billing[req.params.action](req.owner));}catch(e){next(e);}});
  router.use((error,_req,res,_next)=>res.status(error.status||503).json({error:error.status?error.message:'No se pudo guardar la solicitud. Si adjuntaste un archivo, envía primero el texto; los adjuntos siguen pendientes.'}));
  app.use('/api/promotion',router);
}
