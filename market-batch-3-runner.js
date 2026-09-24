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

const campaigns=[
  {
    recipientUserId:"885312", vehicle:"2013 Nissan Versa",
    family:"cost_per_mile", topic:"small_car_profitability",
    expectedIntentType:"maintenance_question",
    hypothesis:"A driver using an older compact car may respond to the idea that low operating cost matters more than appearance.",
    title:"Tu Versa puede ser sencillo, pero eso no significa que tu negocio lo sea",
    caption:"Cuando un carro trabaja para producir ingreso, lo importante no es que sea llamativo: es que siga siendo económico, predecible y disponible.\n\nUn vehículo compacto puede ayudarte con consumo y costos, pero solo si controlas mantenimiento, llantas, frenos y pequeños problemas antes de que se conviertan en tiempo perdido.\n\n¿Quieres que te prepare una lista corta de qué revisar primero para proteger tu costo por milla?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"644432", vehicle:"2015 Jeep Grand Cherokee",
    family:"downtime", topic:"high_use_preventive_reserve",
    expectedIntentType:"service_interest",
    hypothesis:"A high-use midsize SUV driver may value preventive inspection and a repair reserve more than reactive repairs.",
    title:"Una Grand Cherokee parada no produce, aunque todavía se vea fuerte",
    caption:"Cuando un vehículo acumula mucho trabajo, esperar a que aparezca una falla grande puede convertir una reparación en varios días sin producir.\n\nLa mejor defensa es mirar antes: frenos, suspensión, llantas, fluidos y señales tempranas de desgaste. No se trata de cambiar piezas por cambiar; se trata de reducir sorpresas.\n\n¿Te interesa que te arme una revisión preventiva enfocada en evitar tiempo parado?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"885685", vehicle:"2015 Subaru Legacy",
    family:"weather_traction", topic:"awd_tires_weather",
    expectedIntentType:"service_interest",
    hypothesis:"A Subaru driver may engage with the link between traction confidence, tire condition and weather-related operating reliability.",
    title:"La tracción ayuda, pero las llantas siguen siendo las que tocan la calle",
    caption:"En lluvia o clima frío, un sistema de tracción puede darte más confianza al mover el carro, pero el agarre real sigue dependiendo mucho de la condición y presión de las llantas.\n\nPara un vehículo de trabajo, revisar desgaste y presión antes de una semana pesada puede evitar problemas justo cuando más necesitas producir.\n\n¿Quieres que te diga qué señales de desgaste conviene revisar primero?",
    triggerType:"inspection_update"
  }
];

async function ensureFollow(recipientUserId){
  const rid=key(recipientUserId);
  const followingBase="https://following-by-user.firebaseio.com";
  const followersBase="https://followers-by-user.firebaseio.com";
  const a=await publicDb(followingBase,CART_READY.userId+"/"+rid).catch(()=>null);
  const b=await publicDb(followersBase,CART_READY.userId+"/"+rid).catch(()=>null);
  if(a||b) return false;
  const now=Date.now();
  const writes=await Promise.all([
    publicDb(followingBase,CART_READY.userId+"/"+rid,"PUT",{
      id:recipientUserId,userId:recipientUserId,followedUserId:recipientUserId,
      followerId:CART_READY.userId,createdAt:now,updatedAt:now
    }),
    publicDb(followersBase,rid+"/"+CART_READY.userId,"PUT",{
      id:CART_READY.userId,userId:CART_READY.userId,followerId:CART_READY.userId,
      followedUserId:recipientUserId,name:CART_READY.name,avatar:CART_READY.avatar,
      createdAt:now,updatedAt:now
    })
  ]);
  if(!writes.some(Boolean)) throw new Error("follow_failed_"+recipientUserId);
  return true;
}

async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_MARKET_TEST_BATCH_3,10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const publisherKey=CART_READY.userId;
  const snap=await db.ref("storyVitrineByUser/"+publisherKey).get();
  const existing=snap.exists()?snap.val():{};
  const existingArticles=Object.entries(existing||{}).filter(([,v])=>v&&v.contentType==="article");
  let available=Math.max(0,20-existingArticles.length);
  const results=[];

  for(const c of campaigns){
    if(available<=0){ results.push({recipientUserId:c.recipientUserId,status:"skipped_limit"}); continue; }

    const fingerprint="market_v2_"+c.recipientUserId+"_"+c.family+"_"+c.topic;
    const duplicate=existingArticles.find(([,v])=>
      v&&v.editorialFingerprint===fingerprint&&String(v.recipientUserId||"")===c.recipientUserId
    );
    if(duplicate){ results.push({recipientUserId:c.recipientUserId,status:"duplicate",articleId:duplicate[0]}); continue; }

    await ensureFollow(c.recipientUserId);

    const now=Date.now();
    const articleKey="article_"+now+"_"+Math.random().toString(36).slice(2,9);
    const article={
      id:articleKey,key:articleKey,storyId:articleKey,storyKey:articleKey,gid:articleKey,
      articleId:articleKey,campaignId:articleKey,
      userId:CART_READY.userId,ownerUserId:CART_READY.userId,
      fullName:CART_READY.name,ownerName:CART_READY.name,userName:CART_READY.name,
      avatar:CART_READY.avatar,ownerAvatar:CART_READY.avatar,
      title:c.title,caption:c.caption,description:c.caption,
      audience:"direct",audienceMode:"direct",recipientUserId:c.recipientUserId,
      audienceUserIds:{[c.recipientUserId]:true},
      visibility:{version:1,mode:"direct",userIds:{[c.recipientUserId]:true}},
      targeting:{version:1,mode:"direct",recipientUserId:c.recipientUserId,userIds:{[c.recipientUserId]:true}},
      destination:"personalized_campaign",contentType:"article",publicationKind:"article",
      contentKey:"personalized_article",postProductType:"MYCITY_ARTICLE",
      isArticleSummary:true,showInMainFeed:true,displayTarget:"feed_summary",
      presentation:{mediaRatio:"landscape_1_91_1",layout:"editorial_carousel"},
      postType:"article",carousel:false,isCarousel:false,itemCount:0,items:[],
      mediaType:"",mediaKind:"",mediaUrl:"",url:"",imageUrl:"",videoUrl:"",
      thumbnailUrl:"",thumb:"",width:0,height:0,aspectRatio:0,
      likesCount:0,commentsCount:0,repostsCount:0,sharesCount:0,viewsCount:0,
      createdAtMs:now,publishedAtMs:now,updatedAtMs:now,
      active:true,public:true,isPublished:true,publicationStatus:"published",notificationEnabled:false,
      origin:"automation",publisherSource:"personalized_content_automation",source:"mycity_automated_article",
      experimentFamily:c.family,experimentTopic:c.topic,hypothesis:c.hypothesis,
      vehicleYearMakeModelNormalized:c.vehicle,triggerType:c.triggerType,
      expectedIntentType:c.expectedIntentType,
      visualTheme:c.topic,
      visualPrompt:"",
      coverSource:"",
      coverGenerated:false,
      sourceFingerprint:"garage_"+c.recipientUserId+"_"+c.triggerType,
      editorialFingerprint:fingerprint
    };

    await db.ref("/").update({
      ["/storyVitrine/"+articleKey]:article,
      ["/storyVitrineFeed/"+articleKey]:article,
      ["/storyVitrineByUser/"+publisherKey+"/"+articleKey]:article
    });

    const check=await db.ref("storyVitrine/"+articleKey).get();
    if(!check.exists()) throw new Error("article_verify_failed_"+c.recipientUserId);

    available-=1;
    existingArticles.push([articleKey,article]);
    results.push({recipientUserId:c.recipientUserId,status:"created",articleId:articleKey,family:c.family,vehicle:c.vehicle,title:c.title});
  }

  await db.ref("personalizedMarketExperimentRuns/batch3_"+Date.now()).set({
    publisherUserId:CART_READY.userId,
    createdAtMs:Date.now(),
    requestedCount:campaigns.length,
    results
  });

  console.log("MARKET_BATCH_3_SUCCESS "+JSON.stringify(results));
}

try{await run();}catch(e){console.error("MARKET_BATCH_3_FAILED",e?.message||e);process.exitCode=1;}
