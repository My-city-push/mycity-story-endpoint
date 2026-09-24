import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function key(v){ return safe(v,300).replace(/[.#$\/\[\]]/g,"_"); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
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
async function uploadCover(sourceUrl){
  const url=safe(sourceUrl,4000);
  if(!/^https:\/\//i.test(url)) return null;
  const cloud=safe(process.env.CLOUDINARY_CLOUD_NAME||"dxnxwaigw",100);
  const preset=safe(process.env.CLOUDINARY_UNSIGNED_PRESET||"mycity_unsigned",200);
  const folder=safe(process.env.CLOUDINARY_ARTICLE_UPLOAD_FOLDER||"cart-ready/articles",500);
  const fd=new FormData();
  fd.append("file",url);
  fd.append("upload_preset",preset);
  if(folder) fd.append("folder",folder);
  fd.append("tags","mycity,cart_ready,personalized_article,automation");
  const res=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloud)+"/image/upload",{method:"POST",body:fd});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.secure_url) throw new Error("Cloudinary upload failed: "+safe(data?.error?.message||res.status,300));
  return data;
}

const CART_READY={
  userId:"433069",
  name:"Cart Ready",
  avatar:"https://classic-user-pict.ww-cdn.com/userpict/image/v1/400x400/50x50/2817182/img/1731983204131_28/image4330697439693373758053959.jpg/"
};

async function ensureFollow(recipientUserId){
  const rid=key(recipientUserId);
  const followingBase="https://following-by-user.firebaseio.com";
  const followersBase="https://followers-by-user.firebaseio.com";
  const a=await publicDb(followingBase,CART_READY.userId+"/"+rid).catch(()=>null);
  const b=await publicDb(followersBase,CART_READY.userId+"/"+rid).catch(()=>null);
  if(a||b) return {created:false};
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
  return {created:true};
}

async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_MARKET_DELTA||"false",10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const raw=safe(process.env.MARKET_DELTA_CAMPAIGN_JSON,30000);
  if(!raw) throw new Error("MARKET_DELTA_CAMPAIGN_JSON missing");
  const c=JSON.parse(raw);
  const recipientUserId=safe(c.recipientUserId,100);
  const vehicle=safe(c.vehicle,250);
  const family=safe(c.family,120);
  const topic=safe(c.topic,160);
  const title=safe(c.title,300);
  const caption=safe(c.caption,6000);
  if(!recipientUserId||!vehicle||!family||!topic||!title||!caption) throw new Error("Campaign fields missing");

  const publisherKey=CART_READY.userId;
  const snap=await db.ref("storyVitrineByUser/"+publisherKey).get();
  const existing=snap.exists()?snap.val():{};
  const articles=Object.entries(existing||{}).filter(([,v])=>v&&v.contentType==="article");
  if(articles.length>=20){
    console.log("MARKET_DELTA_RESULT "+JSON.stringify({status:"skipped_limit",count:articles.length}));
    return;
  }

  const fingerprint=safe(c.editorialFingerprint,300)||["market_delta",recipientUserId,vehicle,family,topic].join("_").toLowerCase().replace(/[^a-z0-9_]+/g,"_");
  const duplicate=articles.find(([,v])=>v&&String(v.recipientUserId||"")===recipientUserId&&(
    v.editorialFingerprint===fingerprint ||
    (String(v.vehicleYearMakeModelNormalized||"")===vehicle && String(v.experimentTopic||"")===topic)
  ));
  if(duplicate){
    console.log("MARKET_DELTA_RESULT "+JSON.stringify({status:"duplicate",articleId:duplicate[0],recipientUserId,vehicle,family,topic}));
    return;
  }

  await ensureFollow(recipientUserId);

  let cover=null;
  try{ cover=await uploadCover(c.coverSourceUrl); }
  catch(e){ console.error("MARKET_DELTA_COVER_SKIPPED",safe(e?.message||e,500)); }

  const hasMedia=!!cover?.secure_url;
  const mediaUrl=hasMedia?safe(cover.secure_url,4000):"";
  const width=hasMedia?(Number(cover.width||0)||1200):0;
  const height=hasMedia?(Number(cover.height||0)||628):0;
  const aspectRatio=hasMedia&&height?width/height:0;
  const item=hasMedia?{
    id:"media_1",index:0,mediaKind:"image",mediaType:"image/jpeg",
    mediaUrl,mediaDeliveryUrl:mediaUrl,imageUrl:mediaUrl,videoUrl:"",thumbnailUrl:mediaUrl,
    width,height,aspectRatio,uploadStatus:"external"
  }:null;

  const recipientArticles=articles.filter(([,v])=>v&&String(v.recipientUserId||"")===recipientUserId);
  const summary=recipientArticles.length===0;
  const now=Date.now();
  const articleKey="article_"+now+"_"+Math.random().toString(36).slice(2,9);
  const article={
    id:articleKey,key:articleKey,storyId:articleKey,storyKey:articleKey,gid:articleKey,
    articleId:articleKey,campaignId:articleKey,
    userId:CART_READY.userId,ownerUserId:CART_READY.userId,
    fullName:CART_READY.name,ownerName:CART_READY.name,userName:CART_READY.name,
    avatar:CART_READY.avatar,ownerAvatar:CART_READY.avatar,
    title,caption,description:caption,
    audience:"direct",audienceMode:"direct",recipientUserId,
    audienceUserIds:{[recipientUserId]:true},
    visibility:{version:1,mode:"direct",userIds:{[recipientUserId]:true}},
    targeting:{version:1,mode:"direct",recipientUserId,userIds:{[recipientUserId]:true}},
    destination:"personalized_campaign",contentType:"article",publicationKind:"article",
    contentKey:"personalized_article",postProductType:"MYCITY_ARTICLE",
    isArticleSummary:summary,showInMainFeed:summary,displayTarget:summary?"feed_summary":"article_direct",
    presentation:{mediaRatio:"landscape_1_91_1",layout:"editorial_carousel"},
    postType:hasMedia?"carousel":"article",carousel:hasMedia,isCarousel:hasMedia,itemCount:hasMedia?1:0,items:hasMedia?[item]:[],
    mediaType:hasMedia?"image":"",mediaKind:hasMedia?"image":"",mediaUrl:hasMedia?mediaUrl:"",url:hasMedia?mediaUrl:"",
    imageUrl:hasMedia?mediaUrl:"",videoUrl:"",thumbnailUrl:hasMedia?mediaUrl:"",thumb:hasMedia?mediaUrl:"",
    width,height,aspectRatio,
    likesCount:0,commentsCount:0,repostsCount:0,sharesCount:0,viewsCount:0,
    createdAtMs:now,publishedAtMs:now,updatedAtMs:now,
    active:true,public:true,isPublished:true,publicationStatus:"published",notificationEnabled:false,
    origin:"automation",publisherSource:"personalized_content_automation",source:"mycity_automated_article",
    experimentFamily:family,experimentTopic:topic,hypothesis:safe(c.hypothesis,1200),
    vehicleYearMakeModelNormalized:vehicle,triggerType:safe(c.triggerType,120)||"garage_signal",
    expectedIntentType:safe(c.expectedIntentType,120),
    visualTheme:safe(c.visualTheme,160)||topic,
    visualPrompt:safe(c.visualPrompt,2000),
    coverSource:hasMedia?"cloudinary_generated":"",
    coverGenerated:hasMedia,
    sourceFingerprint:safe(c.sourceFingerprint,400),
    editorialFingerprint:fingerprint
  };

  const updates={
    ["/storyVitrine/"+articleKey]:article,
    ["/storyVitrineByUser/"+publisherKey+"/"+articleKey]:article
  };
  if(summary) updates["/storyVitrineFeed/"+articleKey]=article;
  await db.ref("/").update(updates);

  const check=await db.ref("storyVitrine/"+articleKey).get();
  if(!check.exists()) throw new Error("article_verify_failed");

  const result={
    status:"created",articleId:articleKey,recipientUserId,vehicle,family,topic,
    summary,coverGenerated:hasMedia,coverUrl:hasMedia?mediaUrl:""
  };
  await db.ref("personalizedMarketExperimentRuns/"+articleKey).set({...result,createdAtMs:Date.now()});
  console.log("MARKET_DELTA_RESULT "+JSON.stringify(result));
}

try{await run();}catch(e){console.error("MARKET_DELTA_FAILED",e?.message||e);process.exitCode=1;}
