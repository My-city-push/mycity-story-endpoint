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
    recipientUserId:"885292", vehicle:"2013 Ford Explorer",
    family:"downtime", topic:"preventive_availability",
    expectedIntentType:"service_interest",
    hypothesis:"A driver using an older SUV for rideshare may value preventive checks that reduce unexpected downtime.",
    title:"Tu Explorer produce dinero solo cuando está disponible",
    caption:"Cuando tu vehículo es parte de tu ingreso, esperar a que algo falle suele salir más caro que revisar antes. Frenos, llantas, suspensión y fluidos son puntos que conviene vigilar por condición y uso, no solo por calendario.\n\nTu carro es parte de tu negocio. Proteger su disponibilidad también protege tus horas productivas.\n\n¿Qué te preocupa más hoy: una reparación inesperada o perder un día de trabajo?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"660723", vehicle:"2021 Acura RDX",
    family:"hygiene", topic:"fast_cleaning",
    expectedIntentType:"cleaning_solution",
    hypothesis:"A rideshare driver may value solutions that reduce turnaround time between passengers.",
    title:"¿Cuánto tiempo te cuesta dejar tu RDX listo para el próximo pasajero?",
    caption:"En rideshare, limpieza también es productividad. Polvo, pelo, bebidas y comida pueden convertir una limpieza pequeña en tiempo perdido entre viajes.\n\nLas soluciones fáciles de retirar, lavar y volver a colocar pueden valer más por el tiempo que ahorran que por cómo se ven.\n\n¿Qué es lo que más tiempo te hace perder al limpiar tu carro?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"523931", vehicle:"2026 Kia Sorento",
    family:"warranty_value", topic:"new_vehicle_preservation",
    expectedIntentType:"maintenance_question",
    hypothesis:"A driver with a newer vehicle may value protecting warranty, condition and resale while accumulating rideshare miles.",
    title:"Un Sorento nuevo también necesita una estrategia de negocio",
    caption:"Un vehículo reciente no solo necesita mantenimiento: necesita conservar condición, historial y valor mientras empieza a acumular millas de trabajo.\n\nSi produces ingresos con él, documentar servicios y atender desgaste temprano puede ayudarte a evitar que el uso intensivo se convierta en deterioro silencioso.\n\n¿Quieres que te prepare una lista simple de qué conviene vigilar durante el primer ciclo de uso?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"437985", vehicle:"2026 Mazda CX-50",
    family:"accessories_organization", topic:"time_saving_cabin",
    expectedIntentType:"product_interest",
    hypothesis:"A rideshare driver with a newer crossover may value practical accessories that reduce cleaning and cabin reset time.",
    title:"Tu CX-50 puede ganar tiempo incluso cuando está estacionado",
    caption:"Organización y limpieza rápida no parecen mantenimiento, pero sí afectan cuánto tardas en volver a producir después de un pasajero difícil, una bebida derramada o un día de mucho uso.\n\nProtectores fáciles de limpiar, organizadores y soluciones simples para el interior pueden reducir ese tiempo muerto.\n\n¿Quieres que te busque accesorios prácticos para tu modelo y año?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"484774", vehicle:"2019 Honda CR-V",
    family:"tires_alignment", topic:"tire_wear_business_cost",
    expectedIntentType:"service_interest",
    hypothesis:"A rideshare driver may respond to the connection between tire wear, alignment and operating cost.",
    title:"Tus llantas no solo se gastan: también hablan de tu negocio",
    caption:"Desgaste irregular, presión incorrecta o una alineación fuera de punto pueden aumentar gastos y reducir la vida útil de las llantas. En un carro de trabajo, eso termina convirtiéndose en costo por milla.\n\nRevisar desgaste y presión con frecuencia puede darte señales antes de que llegue el gasto grande.\n\n¿Quieres que te diga qué patrones de desgaste conviene mirar primero?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"641885", vehicle:"2014 Ford Focus",
    family:"oil_fluids", topic:"severe_use_maintenance",
    expectedIntentType:"maintenance_question",
    hypothesis:"A higher-use rideshare vehicle may generate questions about maintenance intervals and severe-use conditions.",
    title:"El aceite no sabe si manejas por placer o para producir",
    caption:"Muchas horas de manejo, tráfico, ralentí y trayectos cortos pueden hacer que el uso real de un carro sea más exigente que un calendario normal.\n\nMás importante que una marca es usar la especificación correcta y ajustar el mantenimiento al tipo de trabajo que haces con el vehículo.\n\n¿Quieres que revisemos qué especificación y criterio de cambio corresponde a tu modelo?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"460739", vehicle:"2025 Toyota RAV4",
    family:"efficiency", topic:"dead_miles_route_mix",
    expectedIntentType:"maintenance_question",
    hypothesis:"A newer rideshare crossover owner may value understanding how dead miles and route mix affect profitability.",
    title:"No todas las millas de tu RAV4 producen dinero",
    caption:"Las millas entre viajes, búsquedas de pasajeros y regresos vacíos también consumen combustible, llantas, mantenimiento y depreciación.\n\nPor eso, eficiencia no es solo cuántas millas por galón logra el vehículo: también es cuántas de esas millas realmente están pagadas.\n\n¿Quieres que te muestre una forma sencilla de separar millas productivas de millas muertas?",
    triggerType:"inspection_update"
  },
  {
    recipientUserId:"809914", vehicle:"2013 Cadillac SRX",
    family:"cost_per_mile", topic:"multi_platform_reserve",
    expectedIntentType:"service_interest",
    hypothesis:"A driver using several platforms may value a maintenance reserve tied to operating exposure rather than calendar time.",
    title:"Si manejas en varias plataformas, tu reserva de mantenimiento también debería trabajar",
    caption:"Cuando el mismo vehículo produce en más de una plataforma, el desgaste no entiende de aplicaciones: solo acumula horas, millas y ciclos de uso.\n\nSeparar una pequeña parte del ingreso para mantenimiento puede convertir una reparación inesperada en un gasto previsto en vez de un golpe al negocio.\n\n¿Te interesa que te enseñe una forma simple de calcular una reserva por milla?",
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
  if(!/^true$/i.test(safe(process.env.RUN_MARKET_TEST_BATCH_8,10))) return;
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

    const fingerprint="market_v1_"+c.recipientUserId+"_"+c.family+"_"+c.topic;
    const duplicate=existingArticles.find(([,v])=>
      v&&v.editorialFingerprint===fingerprint&&String(v.recipientUserId||"")===c.recipientUserId
    );
    if(duplicate){ results.push({recipientUserId:c.recipientUserId,status:"duplicate",articleId:duplicate[0]}); continue; }

    await ensureFollow(c.recipientUserId);

    const now=Date.now();
    const articleKey="article_"+now+"_"+Math.random().toString(36).slice(2,9);
    const mediaUrl=CART_READY.avatar;
    const item={
      id:"media_1",index:0,mediaKind:"image",mediaType:"image/jpeg",
      mediaUrl,mediaDeliveryUrl:mediaUrl,imageUrl:mediaUrl,videoUrl:"",
      thumbnailUrl:mediaUrl,width:1200,height:628,aspectRatio:1.91,uploadStatus:"external"
    };
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
      postType:"carousel",carousel:true,isCarousel:true,itemCount:1,items:[item],
      mediaType:"image",mediaKind:"image",mediaUrl,url:mediaUrl,imageUrl:mediaUrl,videoUrl:"",
      thumbnailUrl:mediaUrl,thumb:mediaUrl,width:1200,height:628,aspectRatio:1.91,
      likesCount:0,commentsCount:0,repostsCount:0,sharesCount:0,viewsCount:0,
      createdAtMs:now,publishedAtMs:now,updatedAtMs:now,
      active:true,public:true,isPublished:true,publicationStatus:"published",notificationEnabled:false,
      origin:"automation",publisherSource:"personalized_content_automation",source:"mycity_automated_article",
      experimentFamily:c.family,experimentTopic:c.topic,hypothesis:c.hypothesis,
      vehicleYearMakeModelNormalized:c.vehicle,triggerType:c.triggerType,
      expectedIntentType:c.expectedIntentType,
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

  const runKey="batch8_"+Date.now();
  await db.ref("personalizedMarketExperimentRuns/"+runKey).set({
    publisherUserId:CART_READY.userId,
    createdAtMs:Date.now(),
    requestedCount:campaigns.length,
    results
  });

  console.log("MARKET_BATCH_8_SUCCESS "+JSON.stringify(results));
}

try{await run();}catch(e){console.error("MARKET_BATCH_8_FAILED",e?.message||e);process.exitCode=1;}
