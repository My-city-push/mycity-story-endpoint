import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
function key(v){ return safe(v,300).replace(/[.#$\\/\\[\\]]/g,"_"); }

async function publicDb(base,path,method="GET",body){
  const r=await fetch(base+"/"+path.replace(/^\\/+|\\/+$/g,"")+".json",{
    method,
    headers:body?{"content-type":"application/json"}:undefined,
    body:body?JSON.stringify(body):undefined
  });
  if(!r.ok) throw new Error("RTDB "+r.status);
  return await r.json();
}

async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_PERSONALIZED_TEST_ONCE,10))) return;

  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const recipientUserId=safe(process.env.PERSONALIZED_TEST_RECIPIENT_ID||"885099",100);
  const publisherId="433069";
  const publisherName="Cart Ready";
  const publisherAvatar="https://classic-user-pict.ww-cdn.com/userpict/image/v1/400x400/50x50/2817182/img/1731983204131_28/image4330697439693373758053959.jpg/";
  const requestKey="cartready_personalized_test_v1_"+key(recipientUserId);
  const idemRef=db.ref("personalizedArticleTestRuns/"+requestKey);
  const prior=await idemRef.get();
  if(prior.exists()&&prior.val()?.articleId){
    console.log("PERSONALIZED_TEST duplicate articleId="+prior.val().articleId);
    return;
  }

  const rid=key(recipientUserId);
  const followingBase="https://following-by-user.firebaseio.com";
  const followersBase="https://followers-by-user.firebaseio.com";
  const existingFollow=await publicDb(followingBase,publisherId+"/"+rid).catch(()=>null);
  const existingFollower=await publicDb(followersBase,publisherId+"/"+rid).catch(()=>null);
  const now=Date.now();

  if(!existingFollow&&!existingFollower){
    await Promise.all([
      publicDb(followingBase,publisherId+"/"+rid,"PUT",{
        id:recipientUserId,userId:recipientUserId,followedUserId:recipientUserId,
        followerId:publisherId,createdAt:now,updatedAt:now
      }),
      publicDb(followersBase,rid+"/"+publisherId,"PUT",{
        id:publisherId,userId:publisherId,followerId:publisherId,followedUserId:recipientUserId,
        name:publisherName,avatar:publisherAvatar,createdAt:now,updatedAt:now
      })
    ]);
  }

  const verify=await publicDb(followingBase,publisherId+"/"+rid).catch(()=>null);
  if(!verify) throw new Error("Cart Ready follow verification failed");

  const byUserRef=db.ref("storyVitrineByUser/"+publisherId);
  const byUserSnap=await byUserRef.get();
  const existing=byUserSnap.exists()?byUserSnap.val():{};
  const articles=Object.entries(existing||{}).filter(([,v])=>v&&v.contentType==="article");
  if(articles.length>=20) throw new Error("Cart Ready article limit reached");

  const articleKey="article_"+now+"_cartready_test";
  const mediaUrl=publisherAvatar;
  const title="Prueba de Cart Ready: una recomendación preparada para ti";
  const caption="Estamos probando una nueva forma de compartir recomendaciones de mantenimiento y cuidado del vehículo directamente contigo dentro de MyCity.";

  const item={
    id:"media_1",index:0,mediaKind:"image",mediaType:"image/jpeg",
    mediaUrl,mediaDeliveryUrl:mediaUrl,imageUrl:mediaUrl,videoUrl:"",
    thumbnailUrl:mediaUrl,width:1200,height:628,aspectRatio:1.91,uploadStatus:"external"
  };

  const article={
    id:articleKey,key:articleKey,storyId:articleKey,storyKey:articleKey,gid:articleKey,
    articleId:articleKey,campaignId:articleKey,
    userId:publisherId,ownerUserId:publisherId,fullName:publisherName,ownerName:publisherName,userName:publisherName,
    avatar:publisherAvatar,ownerAvatar:publisherAvatar,
    title,caption,description:caption,
    audience:"direct",audienceMode:"direct",recipientUserId,
    audienceUserIds:{[recipientUserId]:true},
    visibility:{version:1,mode:"direct",userIds:{[recipientUserId]:true}},
    targeting:{version:1,mode:"direct",recipientUserId,userIds:{[recipientUserId]:true}},
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
    sourceFingerprint:"manual_test_885099_v1",editorialFingerprint:"test_885099_cartready_v1"
  };

  const ghostKey="ghost_cartready_test_"+now;
  const ghostVehicle={
    vehicleId:ghostKey,
    test:true,
    ghost:true,
    label:"TEST VEHICLE — Cart Ready automation",
    make:"Toyota",
    model:"Corolla",
    year:2020,
    createdAtMs:now,
    updatedAtMs:now,
    source:"cartready_personalized_test",
    ownerUserId:recipientUserId
  };

  await db.ref("/").update({
    ["/storyVitrine/"+articleKey]:article,
    ["/storyVitrineFeed/"+articleKey]:article,
    ["/storyVitrineByUser/"+publisherId+"/"+articleKey]:article,
    ["/testGarageVehiclesByUser/"+rid+"/"+ghostKey]:ghostVehicle
  });

  const check=await db.ref("storyVitrine/"+articleKey).get();
  if(!check.exists()) throw new Error("Article verification failed");

  await idemRef.set({
    ok:true,articleId:articleKey,recipientUserId,publisherUserId:publisherId,
    ghostVehicleKey:ghostKey,createdAtMs:now
  });

  console.log("PERSONALIZED_TEST_SUCCESS articleId="+articleKey+" recipient="+recipientUserId+" ghostVehicleKey="+ghostKey);
}

try{ await run(); }catch(e){ console.error("PERSONALIZED_TEST_FAILED",e?.message||e); process.exitCode=1; }
