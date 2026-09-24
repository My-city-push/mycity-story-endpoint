import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
function key(v){ return safe(v,300).replace(/[.#$\/\[\]]/g,"_"); }
async function publicDb(base,path,method="GET",body){
  const r=await fetch(base+"/"+path.replace(/^\/+|\/+$/g,"")+".json",{
    method,
    headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined
  });
  const text=await r.text();
  if(!r.ok) throw new Error("RTDB "+r.status+" "+text.slice(0,200));
  try{return JSON.parse(text);}catch{return text||true;}
}

const CART_READY={
  userId:"433069",
  name:"Cart Ready",
  avatar:"https://classic-user-pict.ww-cdn.com/userpict/image/v1/400x400/50x50/2817182/img/1731983204131_28/image4330697439693373758053959.jpg/"
};

const c={
  recipientUserId:"658543",
  vehicle:"2017 Toyota RAV4",
  family:"hygiene_quick_cleanup",
  topic:"interior_protection_time_savings",
  expectedIntentType:"product_interest",
  hypothesis:"A rideshare driver may show stronger buying intent for practical interior-protection products when framed as reducing cleanup time between rides rather than as cosmetic accessories.",
  title:"Si cada limpieza te roba minutos, tu RAV4 puede estar costándote tiempo sin moverse",
  caption:"Cuando el carro es parte de tu ingreso, limpiar entre pasajeros también cuenta como tiempo de trabajo.\n\nAlfombras fáciles de lavar, protección para el área de carga y una organización simple pueden hacer que el interior vuelva a estar listo más rápido sin convertir cada jornada en una limpieza profunda.\n\nNo se trata de llenar el carro de accesorios: se trata de probar qué cosas realmente te ahorran minutos y trabajo.\n\n¿Tu carro usa alfombras de tela o de goma?",
  triggerType:"inspection_mileage_updated",
  sourceFingerprint:"garage_658543_inspection_mileage_updated_2026-09-24T14:15:05.009Z",
  editorialFingerprint:"market_v4_658543_2017_toyota_rav4_interior_protection_time_savings",
  visualTheme:"quick_cleanup_interior_protection",
  visualPrompt:"Crear una portada editorial horizontal 1.91:1 para MyCity / Cart Ready. Tema: limpieza rápida y protección interior para un vehículo de rideshare. Mensaje central: ahorrar minutos entre pasajeros con alfombras fáciles de lavar, protección de carga y organización simple. Vehículo de referencia: 2017 Toyota RAV4 solo si puede representarse fielmente; de lo contrario usar una composición limpia de interior de SUV compacto, alfombras all-weather y protector de carga sin logos ni modelo identificable. Estilo minimalista, moderno, alto contraste, fondo blanco o blanco roto, sin personas, sin placas legibles, sin VIN, sin logos grandes. La imagen debe sentirse útil para un conductor que usa su auto para producir dinero. Sin texto o máximo una frase muy corta."
};

async function ensureFollow(recipientUserId){
  const rid=key(recipientUserId);
  const followingBase="https://following-by-user.firebaseio.com";
  const followersBase="https://followers-by-user.firebaseio.com";
  const a=await publicDb(followingBase,CART_READY.userId+"/"+rid).catch(()=>null);
  const b=await publicDb(followersBase,CART_READY.userId+"/"+rid).catch(()=>null);
  if(a||b) return false;
  const now=Date.now();
  const writes=await Promise.all([
    publicDb(followingBase,CART_READY.userId+"/"+rid,"PUT",{id:recipientUserId,userId:recipientUserId,followedUserId:recipientUserId,followerId:CART_READY.userId,createdAt:now,updatedAt:now}),
    publicDb(followersBase,rid+"/"+CART_READY.userId,"PUT",{id:CART_READY.userId,userId:CART_READY.userId,followerId:CART_READY.userId,followedUserId:recipientUserId,name:CART_READY.name,avatar:CART_READY.avatar,createdAt:now,updatedAt:now})
  ]);
  if(!writes.some(Boolean)) throw new Error("follow_failed");
  return true;
}

async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_GARAGE_SIGNAL_ONCE,10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,'');
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const publisherKey=CART_READY.userId;
  const snap=await db.ref("storyVitrineByUser/"+publisherKey).get();
  const existing=snap.exists()?snap.val():{};
  const rows=Object.entries(existing||{}).filter(([,v])=>v&&v.contentType==="article");
  const duplicate=rows.find(([,v])=>v&&v.editorialFingerprint===c.editorialFingerprint&&String(v.recipientUserId||"")===c.recipientUserId);
  if(duplicate){
    console.log("GARAGE_SIGNAL_SKIP duplicate "+duplicate[0]);
    return;
  }
  if(rows.length>=20){
    console.log("GARAGE_SIGNAL_SKIP publisher_article_limit_reached count="+rows.length);
    return;
  }

  const followCreated=await ensureFollow(c.recipientUserId);
  const now=Date.now();
  const articleKey="article_"+now+"_"+Math.random().toString(36).slice(2,9);
  const article={
    id:articleKey,key:articleKey,storyId:articleKey,storyKey:articleKey,gid:articleKey,articleId:articleKey,campaignId:articleKey,
    userId:CART_READY.userId,ownerUserId:CART_READY.userId,fullName:CART_READY.name,ownerName:CART_READY.name,userName:CART_READY.name,avatar:CART_READY.avatar,ownerAvatar:CART_READY.avatar,
    title:c.title,caption:c.caption,description:c.caption,
    audience:"direct",audienceMode:"direct",recipientUserId:c.recipientUserId,audienceUserIds:{[c.recipientUserId]:true},
    visibility:{version:1,mode:"direct",userIds:{[c.recipientUserId]:true}},targeting:{version:1,mode:"direct",recipientUserId:c.recipientUserId,userIds:{[c.recipientUserId]:true}},
    destination:"personalized_campaign",contentType:"article",publicationKind:"article",contentKey:"personalized_article",postProductType:"MYCITY_ARTICLE",
    isArticleSummary:true,showInMainFeed:true,displayTarget:"feed_summary",presentation:{mediaRatio:"landscape_1_91_1",layout:"editorial_carousel"},
    postType:"article",carousel:false,isCarousel:false,itemCount:0,items:[],mediaType:"",mediaKind:"",mediaUrl:"",url:"",imageUrl:"",videoUrl:"",thumbnailUrl:"",thumb:"",width:0,height:0,aspectRatio:0,
    likesCount:0,commentsCount:0,repostsCount:0,sharesCount:0,viewsCount:0,
    createdAtMs:now,publishedAtMs:now,updatedAtMs:now,active:true,public:true,isPublished:true,publicationStatus:"published",notificationEnabled:false,
    origin:"automation",publisherSource:"personalized_content_automation",source:"mycity_automated_article",
    experimentFamily:c.family,experimentTopic:c.topic,hypothesis:c.hypothesis,vehicleYearMakeModelNormalized:c.vehicle,triggerType:c.triggerType,expectedIntentType:c.expectedIntentType,
    sourceFingerprint:c.sourceFingerprint,editorialFingerprint:c.editorialFingerprint,visualTheme:c.visualTheme,visualPrompt:c.visualPrompt,coverSource:"",coverGenerated:false
  };

  await db.ref("/").update({
    ["/storyVitrine/"+articleKey]:article,
    ["/storyVitrineFeed/"+articleKey]:article,
    ["/storyVitrineByUser/"+publisherKey+"/"+articleKey]:article
  });
  const verify=await db.ref("storyVitrine/"+articleKey).get();
  if(!verify.exists()) throw new Error("article_verify_failed");
  console.log("GARAGE_SIGNAL_SUCCESS "+JSON.stringify({articleId:articleKey,recipientUserId:c.recipientUserId,vehicle:c.vehicle,family:c.family,topic:c.topic,followCreated,coverGenerated:false,title:c.title}));
}

try{await run();}catch(e){console.error("GARAGE_SIGNAL_FAILED",e?.message||e);process.exitCode=1;}
