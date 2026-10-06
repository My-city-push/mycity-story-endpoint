import crypto from 'node:crypto';
import {hasPromotionAccess} from './promotion-billing.js';
import {sanitizeCampaign} from './promotion-assistant.js';
const fail=(status,message)=>Object.assign(Error(message),{status});
export const campaignHash=draft=>crypto.createHash('sha256').update(JSON.stringify(sanitizeCampaign(draft))).digest('hex');
export function nextPromotionTime(after,campaign){
 const c=sanitizeCampaign(campaign);if(!c.days.length)return null;
 const f=new Intl.DateTimeFormat('en-US',{timeZone:c.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 for(let t=Math.floor(after/60000)*60000+60000;t<=after+15*86400000;t+=60000){const p=Object.fromEntries(f.formatToParts(t).map(x=>[x.type,x.value]));if(c.days.includes(weekdays.indexOf(p.weekday))&&p.hour+':'+p.minute===c.time)return t;}
 return null;
}
export function promotionRecipients(owner,campaign,{followers={},following={},excluded={}}){
 const maps=campaign.audience==='followers'?[followers]:campaign.audience==='following'?[following]:[followers,following];
 const ids=new Set();for(const map of maps)for(const [id,row]of Object.entries(map||{})){if(row===null||row===false||row?.active===false||row?.blocked===true)continue;const candidate=String(row?.userId||row?.id||id);if(/^\d{1,20}$/.test(candidate)&&candidate!==String(owner)&&!excluded[candidate])ids.add(candidate);}
 if(ids.size>500)throw fail(409,'Esta campaña supera 500 destinatarios; necesita ampliar el procesamiento antes de activarla.');return [...ids].sort();
}
export function createPromotionAutomation({store,billing,publish,relationships,env=process.env,now=Date.now}){
 const ready=()=>env.PROMOTION_AUTOMATION_ENABLED==='true'&&!!billing?.ready()&&!!publish&&!!relationships;
 async function action(owner,action){
  if(!['approve','pause','resume'].includes(action))throw fail(400,'Acción inválida.');
  if(action!=='pause'&&!ready())throw fail(503,'La automatización necesita completar su conexión de Stripe.');
  let row=await store.get(owner.id);
  if(action==='resume'){if(row.billing?.subscriptionId)await billing.syncSubscription(row.billing.subscriptionId);row=await store.get(owner.id);if(!hasPromotionAccess(row.billing,now()))throw fail(402,'Necesitas un plan activo.');}
  const result=await store.transaction(owner.id,r=>{
   if(action==='pause'){r.campaign={...r.campaign,status:'paused',pauseReason:'owner',nextRunAt:null};return r;}
   if(!r.preparation?.confirmedFingerprint)throw fail(409,'Confirma los datos del negocio en el chat.');
   const draft=sanitizeCampaign(r.campaign?.draft);if(!draft.title||!draft.offer||!draft.days.length)throw fail(409,'Completa el título, oferta, audiencia, días y horario antes de aprobar.');
   const hash=campaignHash(draft);
   if(action==='resume'&&r.campaign?.approvedHash!==hash)throw fail(409,'Aprueba primero el borrador actualizado.');
   if(action==='resume'&&!hasPromotionAccess(r.billing,now()))throw fail(402,'Necesitas un plan activo.');
   const active=hasPromotionAccess(r.billing,now());r.ownerName=owner.name;r.campaign={...r.campaign,draft,approvedHash:hash,status:active?'active':'approved',nextRunAt:active?nextPromotionTime(now(),draft):null,updatedAt:now()};return r;
  });return result.value;
 }
 async function run(owner){
  let row=await store.get(owner);if(row.campaign?.status!=='active'||!row.campaign.nextRunAt||row.campaign.nextRunAt>now())return;
  if(!row.billing?.subscriptionId)return;await billing.syncSubscription(row.billing.subscriptionId);row=await store.get(owner);
  if(!hasPromotionAccess(row.billing,now())||!row.preparation?.confirmedFingerprint||row.campaign.status!=='active'||row.campaign.approvedHash!==campaignHash(row.campaign.draft))return;
  const rel=await relationships(owner);const recipients=promotionRecipients(owner,row.campaign.draft,{...rel,excluded:row.excludedRecipients||{}});
  if(!recipients.length){await store.transaction(owner,r=>{if(r.campaign?.nextRunAt===row.campaign.nextRunAt)r.campaign.nextRunAt=nextPromotionTime(now(),r.campaign.draft);return r;});return;}
  const due=row.campaign.nextRunAt,period=String(row.billing.subscriptionId)+':'+row.billing.periodStart,limit=row.billing.status==='trialing'?2:8;
  const runId='promo_'+crypto.createHash('sha256').update(owner+':'+due).digest('hex').slice(0,24),lease=crypto.randomUUID();
  const claimed=await store.transaction(owner,r=>{
   if(!hasPromotionAccess(r.billing,now())||r.campaign?.status!=='active'||r.campaign.nextRunAt!==due||r.campaign.approvedHash!==row.campaign.approvedHash||!r.preparation?.confirmedFingerprint)return;
   const job=r.publicationJobs?.[runId];if(job?.status==='done')return;if(job?.lease===lease)return r;if(job?.until>now())return;
   const usage=r.publicationUsage?.period===period?r.publicationUsage:{period,count:0};if(!job&&usage.count>=limit){r.campaign.nextRunAt=nextPromotionTime(r.billing.expiresAt,r.campaign.draft);r.campaign.pauseReason='quota';return r;}
   if(!job)usage.count++;r.publicationUsage=usage;r.publicationJobs={...r.publicationJobs,[runId]:{status:'processing',lease,until:now()+120000,due,createdAt:job?.createdAt||now()}};return r;
  });
  if(!claimed.committed||claimed.value.publicationJobs?.[runId]?.lease!==lease)return;
  try{
   const current=await store.get(owner);if(current.campaign.status!=='active'||current.campaign.approvedHash!==row.campaign.approvedHash||!hasPromotionAccess(current.billing,now()))return;
   await publish({id:runId,owner,name:row.business.commercialName,business:row.business,campaign:row.campaign.draft,recipients,createdAt:claimed.value.publicationJobs[runId].createdAt});
   await store.transaction(owner,r=>{if(r.publicationJobs?.[runId]?.status==='done')return r;if(r.publicationJobs?.[runId]?.lease!==lease)return;r.publicationJobs[runId]={status:'done',due,createdAt:now()};r.publications={...r.publications,[runId]:{id:runId,title:row.campaign.draft.title,summary:row.campaign.draft.offer,status:'Publicado en My City',recipientCount:recipients.length,createdAt:now()}};if(r.campaign.nextRunAt===due)r.campaign.nextRunAt=nextPromotionTime(now(),r.campaign.draft);r.messages=[...(r.messages||[]),{id:'published_'+runId,role:'assistant',text:`Tu promoción «${row.campaign.draft.title}» se publicó en My City para ${recipients.length} perfiles de tu audiencia. Los correos todavía no están activados.`,createdAt:now()}].slice(-100);return r;});
   console.info('promotion-automation publication=done');
  }catch{await store.transaction(owner,r=>{if(r.publicationJobs?.[runId]?.lease!==lease)return;r.publicationJobs[runId].until=0;r.publicationJobs[runId].status='retry';return r;});console.warn('promotion-automation publication=retry');}
 }
 let timer=null,running=false;
 async function tick(){if(running||!ready())return;running=true;try{for(const owner of await store.listOwners()){try{await run(owner);}catch{console.warn('promotion-automation owner_run=failed');}}}finally{running=false;}}
 return {ready,action,tick,start(){if(!timer){timer=setInterval(()=>tick().catch(()=>console.warn('promotion-automation tick=failed')),60000);timer.unref();}},stop(){clearInterval(timer);timer=null;}};
}
export function promotionArticle({id,owner,name,business,campaign,recipients,createdAt}){
 const audienceUserIds=Object.fromEntries(recipients.map(id=>[id,true]));
 return {id,key:id,storyId:id,storyKey:id,gid:id,articleId:id,campaignId:id,userId:owner,ownerUserId:owner,fullName:name,ownerName:name,userName:name,avatar:'',ownerAvatar:'',title:campaign.title,caption:campaign.offer+'\n\n'+business.contact,description:campaign.offer+'\n\n'+business.contact,audience:'direct',audienceMode:'direct',audienceUserIds,visibility:{version:1,mode:'direct',userIds:audienceUserIds},targeting:{version:1,mode:'direct',userIds:audienceUserIds},destination:'personalized_campaign',contentType:'article',publicationKind:'article',contentKey:'personalized_article',postProductType:'MYCITY_ARTICLE',isArticleSummary:true,showInMainFeed:true,displayTarget:'feed_summary',postType:'article',items:[],itemCount:0,mediaType:'',mediaUrl:'',likesCount:0,commentsCount:0,viewsCount:0,createdAtMs:createdAt,publishedAtMs:createdAt,updatedAtMs:createdAt,active:true,public:true,isPublished:true,publicationStatus:'published',notificationEnabled:false,origin:'automation',publisherSource:'mycity_commercial_promotion',source:'mycity_commercial_promotion'};
}
