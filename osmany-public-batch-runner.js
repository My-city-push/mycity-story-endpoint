import admin from "firebase-admin";

const SELLER = Object.freeze({
  userId:"279436",
  fullName:"Osmany quintana",
  avatar:"https://classic-user-pict.ww-cdn.com/userpict/image/v1/1200x1200/50x50/2817182/img/1731506782178_29/image2794362641389330850009863.jpg/"
});

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
function amazon(q){ return "https://www.amazon.com/s?k="+encodeURIComponent(q)+"&tag=mycity048-20"; }

const posts = [
  {
    fingerprint:"osmany_public_v1_rideshare_led",
    title:"¿Trabajas de noche? Haz que tus pasajeros te identifiquen más fácil",
    caption:"Si haces Uber o Lyft de noche, un letrero LED para rideshare puede ayudarte a que el pasajero identifique tu carro más rápido en aeropuertos, eventos o zonas con mucho movimiento.\n\nOpciones para comparar:\n"+amazon("Uber Lyft rideshare LED sign")+"\n\nDéjame un comentario si te interesa o si buscas otro accesorio para trabajar manejando. Si tienes tu carro registrado en MyCity, puedo ayudarte después a buscar cosas más específicas para ti."
  },
  {
    fingerprint:"osmany_public_v1_car_aroma",
    title:"Un carro limpio también se siente: aromas para jornadas largas",
    caption:"Si pasas muchas horas haciendo Uber, Lyft o delivery, un aroma suave puede hacer que el interior se sienta más fresco sin convertir el carro en una perfumería. Busca opciones discretas, duraderas y fáciles de reemplazar.\n\nOpciones para comparar:\n"+amazon("car air freshener best sellers")+"\n\n¿Prefieres aroma limpio, cítrico, cuero o algo más suave? Déjame un comentario y busco opciones."
  },
  {
    fingerprint:"osmany_public_v1_driver_seat_cushion",
    title:"¿Muchas horas sentado manejando? Mira estas opciones de comodidad",
    caption:"Quien trabaja manejando sabe que después de varias horas el asiento se siente diferente. Un cojín de asiento o apoyo lumbar puede hacer la jornada más cómoda. No es un producto médico ni sustituye una evaluación si tienes dolor; es una opción de confort para el día a día.\n\nOpciones para comparar:\n"+amazon("driver seat cushion lumbar support car")+"\n\nDéjame un comentario si buscas algo para asiento, espalda baja o jornadas largas."
  },
  {
    fingerprint:"osmany_public_v1_breathable_shoes",
    title:"Para delivery y personal drivers: zapatos cómodos y transpirables",
    caption:"Si manejas, caminas, subes escaleras y vuelves al carro todo el día, el calzado también es parte de tu equipo de trabajo. Hay opciones ligeras, transpirables y antideslizantes que pueden ser más prácticas para jornadas largas.\n\nOpciones para comparar:\n"+amazon("breathable slip resistant walking shoes")+"\n\n¿Buscas zapatos para hombre, mujer, lluvia o verano? Déjame un comentario."
  },
  {
    fingerprint:"osmany_public_v1_ambient_lights",
    title:"Dale otro ambiente al carro sin complicarlo",
    caption:"Las luces LED interiores pueden darle al carro un ambiente más moderno para trabajo nocturno, especialmente si quieres una cabina cuidada para pasajeros. Mejor algo discreto, regulable y que no distraiga mientras manejas.\n\nOpciones para comparar:\n"+amazon("car interior ambient LED lights USB")+"\n\nSi te interesa, comenta qué carro tienes y qué estilo buscas: discreto, elegante o más llamativo."
  }
];

async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_OSMANY_PUBLIC_BATCH_ONCE,10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("firebase_config_missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const existingSnap=await db.ref("storyVitrineByUser/"+SELLER.userId).get();
  const existing=existingSnap.exists()?Object.values(existingSnap.val()||{}):[];
  const existingFingerprints=new Set(existing.map(x=>safe(x?.editorialFingerprint,300)).filter(Boolean));
  const created=[];

  for(const p of posts){
    if(existingFingerprints.has(p.fingerprint)){
      console.log("OSMANY_PUBLIC_SKIP_DUPLICATE "+p.fingerprint);
      continue;
    }
    const now=Date.now();
    const postId="feed_"+now+"_"+Math.random().toString(36).slice(2,9);
    const record={
      id:postId,key:postId,storyId:postId,storyKey:postId,gid:postId,
      userId:SELLER.userId,ownerUserId:SELLER.userId,
      fullName:SELLER.fullName,ownerName:SELLER.fullName,userName:SELLER.fullName,
      avatar:SELLER.avatar,ownerAvatar:SELLER.avatar,
      title:p.title,caption:p.caption,description:p.caption,
      audience:"everyone",audienceMode:"everyone",audienceUserIds:{},
      visibility:{version:1,mode:"everyone",userIds:{}},
      targeting:{version:1,mode:"everyone",recipientUserId:"",userIds:{}},
      destination:"feed",contentType:"feed",publicationKind:"publication",contentKey:"feed_upload",
      displayTarget:"feed",isArticleSummary:false,showInMainFeed:true,presentation:{},
      origin:"automation",publisherSource:"osmany_public_seller_automation",
      postProductType:"MYCITY_FEED",postType:"text",carousel:false,isCarousel:false,itemCount:0,items:[],
      mediaType:"none",mediaKind:"none",mediaUrl:"",url:"",imageUrl:"",videoUrl:"",thumbnailUrl:"",thumb:"",
      externalUrl:(p.caption.match(/https:\/\/www\.amazon\.com\/[^\s]+/)||[])[0]||"",
      externalUrls:[...(p.caption.matchAll(/https:\/\/www\.amazon\.com\/[^\s]+/g))].map(m=>m[0]),
      likesCount:0,commentsCount:0,repostsCount:0,sharesCount:0,viewsCount:0,
      createdAtMs:now,publishedAtMs:now,updatedAtMs:now,
      active:true,public:true,isPublished:true,publicationStatus:"published",notificationEnabled:true,
      source:"mycity_feed_upload",editorialFingerprint:p.fingerprint,
      sellerAutomation:true,sellerType:"driver_accessories",affiliateTag:"mycity048-20"
    };
    await db.ref("/").update({
      ["/storyVitrine/"+postId]:record,
      ["/storyVitrineFeed/"+postId]:record,
      ["/storyVitrineByUser/"+SELLER.userId+"/"+postId]:record
    });
    const verify=await db.ref("storyVitrine/"+postId).get();
    if(!verify.exists()) throw new Error("verify_failed_"+postId);
    created.push({postId,title:p.title});
    console.log("OSMANY_PUBLIC_ITEM_SUCCESS "+JSON.stringify({postId,title:p.title}));
    await new Promise(r=>setTimeout(r,180));
  }
  console.log("OSMANY_PUBLIC_BATCH_SUCCESS "+JSON.stringify({createdCount:created.length,created}));
}
try{await run();}catch(e){console.error("OSMANY_PUBLIC_BATCH_FAILED",e?.stack||e?.message||e);process.exitCode=1;}
