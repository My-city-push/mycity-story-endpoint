import {promotionAssistant,sanitizeBusiness,sanitizeCampaign} from './promotion-assistant.js';
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
  return {
    async get(owner){if(!valid(owner))throw fail(401,'Cuenta inválida.');const path=node(owner);return decode((await database.ref(path).get()).val(),path);},
    async transaction(owner,mutate){if(!valid(owner))throw fail(401,'Cuenta inválida.');const path=node(owner);const result=await database.ref(path).transaction(value=>{const next=mutate(decode(value,path));return next===undefined?undefined:encode(next,path);},undefined,false);return {committed:result.committed,value:decode(result.snapshot.val(),path)};}
  };
}

export function registerPromotionIntake(app,{store,authenticate,env=process.env,assistant=promotionAssistant}){
  const aiReady=()=>env.PROMOTION_AI_ENABLED==='true'&&!!env.OPENAI_API_KEY&&!!env.PROMOTION_AI_MODEL;
  console.info('promotion-assistant configuration_enabled='+String(env.PROMOTION_AI_ENABLED==='true')+' key_configured='+String(!!env.OPENAI_API_KEY)+' model_configured='+String(!!env.PROMOTION_AI_MODEL));
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-MyCity-User-Id');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
  router.use(async(req,res,next)=>{
    if(env.PROMOTION_INTAKE_ENABLED!=='true'||!store)return res.status(503).json({error:'Recepción de promociones pendiente de activación.'});
    try{const token=/^Promotion ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization')||'')?.[1];if(!token)throw fail(401,'Verifica tu cuenta para abrir Promoción.');req.owner=await authenticate(token,req.get('X-MyCity-User-Id'));next();}catch(e){res.status(e.status||401).json({error:e.status?e.message:'Vuelve a verificar tu cuenta.'});}
  });
  const view=(owner,row)=>({user:{id:owner.id,name:owner.name},entitlement:{active:false,status:'inactive'},business:row.business||{verificationStatus:'pending'},campaign:row.campaign||{status:'draft'},messages:row.messages||[],capabilities:{assistant:aiReady(),checkout:false,publishing:false,intake:true}});
  router.get('/session',async(req,res,next)=>{try{res.json(view(req.owner,await store.get(req.owner.id)));}catch(e){next(e);}});
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
          const row=claimed.value;const answer=await assistant({business:row.business||{},campaign:row.campaign?.draft||{},messages:row.messages,env});
          const reply={id:'assistant_'+id,role:'assistant',text:answer.reply,createdAt:Date.now()};
          const committed=await store.transaction(req.owner.id,current=>{if(current.requests?.[id]?.status==='done')return current;if(current.lease?.id!==lease)return;current.messages=[...current.messages,reply].slice(-100);current.business={...sanitizeBusiness(answer.business),verificationStatus:'pending'};current.campaign={status:'draft',draft:sanitizeCampaign(answer.campaign),updatedAt:Date.now()};current.requests[id]={status:'done',messages:[user,reply]};const ids=Object.keys(current.requests);for(const old of ids.slice(0,Math.max(0,ids.length-100)))delete current.requests[old];current.lease=null;current.updatedAt=Date.now();return current;});
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
  router.get('/reports/:report',async(req,res,next)=>{try{const row=await store.get(req.owner.id);res.json({items:req.params.report==='publications'&&row.campaign?.draft?[{title:row.campaign.draft.title||'Borrador de promoción',summary:[row.campaign.draft.offer,'Audiencia: '+row.campaign.draft.audience,row.campaign.draft.time+' · '+row.campaign.draft.timezone].filter(Boolean).join(' · '),status:'Borrador · publicación pendiente'}]:req.params.report==='business'&&row.business?[{name:row.business.commercialName||'Negocio pendiente',summary:[row.business.activity,row.business.serviceArea,row.business.presentation].filter(Boolean).join(' · '),status:'Verificación comercial pendiente'}]:[],updatedAt:row.updatedAt||null,status:'pending'});}catch(e){next(e);}});
  router.post('/campaign/actions',(_req,res)=>res.status(503).json({error:'La programación de publicaciones todavía no está activada.'}));
  router.post('/billing/:action',(_req,res)=>res.status(503).json({error:'Los cobros todavía no están activados.'}));
  router.use((error,_req,res,_next)=>res.status(error.status||503).json({error:error.status?error.message:'No se pudo guardar la solicitud. Si adjuntaste un archivo, envía primero el texto; los adjuntos siguen pendientes.'}));
  app.use('/api/promotion',router);
}
