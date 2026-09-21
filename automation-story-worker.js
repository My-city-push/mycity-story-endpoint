import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
function sourceKind(url,explicit){
  const kind=safe(explicit,20).toLowerCase();
  if(kind==="video"||kind==="image") return kind;
  return /(?:\/video\/upload\/|\.(?:mp4|mov|m4v|webm)(?:[?#]|$))/i.test(safe(url,4000))?"video":"image";
}
function videoPoster(url){
  const raw=safe(url,4000);
  if(!raw.includes("/video/upload/")) return "";
  return raw.replace("/video/upload/","/video/upload/so_0,w_720,c_limit,q_auto:good,f_jpg/").replace(/\.[^./?]+(?=\?|$)/,".jpg");
}
async function uploadRemote(source,index=0,total=1){
  const sourceUrl=safe(source&&source.url||source,4000);
  const kind=sourceKind(sourceUrl,source&&source.type);
  const cloud=safe(process.env.CLOUDINARY_CLOUD_NAME||"dxnxwaigw",100);
  const preset=safe(process.env.CLOUDINARY_UNSIGNED_PRESET||"mycity_unsigned",200);
  const folder=safe(process.env.CLOUDINARY_STORY_UPLOAD_FOLDER||"mycity/story-uploads",500);
  const fd=new FormData();
  fd.append("file",sourceUrl);
  fd.append("upload_preset",preset);
  if(folder) fd.append("folder",folder);
  fd.append("tags",["mycity","story_upload","ai_generated","automation",kind,total>1?"carousel":"single"].join(","));
  fd.append("context",["source=mycity_local_desk","carousel_index="+index,"carousel_total="+total,"media_kind="+kind].join("|"));
  const res=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloud)+"/"+kind+"/upload",{method:"POST",body:fd});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.secure_url) throw new Error("Cloudinary "+kind+" upload failed: "+safe(data?.error?.message||res.status,300));
  return Object.assign({},data,{_sourceKind:kind,_sourceUrl:sourceUrl});
}
function automatedSources(){
  const itemsJson=safe(process.env.AUTOMATED_STORY_SOURCE_ITEMS_JSON,30000);
  if(itemsJson){
    try{
      const parsed=JSON.parse(itemsJson);
      if(Array.isArray(parsed)){
        const items=parsed.map(v=>typeof v==="string"?{url:safe(v,4000)}:{url:safe(v&&v.url,4000),type:safe(v&&v.type,20)})
          .filter(v=>/^https:\/\//i.test(v.url)).slice(0,10);
        if(items.length) return items;
      }
    }catch(e){}
  }
  const rawJson=safe(process.env.AUTOMATED_STORY_SOURCE_URLS_JSON,20000);
  if(rawJson){
    try{
      const parsed=JSON.parse(rawJson);
      if(Array.isArray(parsed)) return parsed.map(v=>({url:safe(v,4000)})).filter(v=>/^https:\/\//i.test(v.url)).slice(0,10);
    }catch(e){}
  }
  const multi=safe(process.env.AUTOMATED_STORY_SOURCE_URLS,20000);
  if(multi){
    const list=multi.split(/\r?\n|\s*\|\|\s*/).map(v=>({url:safe(v,4000)})).filter(v=>/^https:\/\//i.test(v.url)).slice(0,10);
    if(list.length) return list;
  }
  const single=safe(process.env.AUTOMATED_STORY_SOURCE_URL,4000);
  return /^https:\/\//i.test(single)?[{url:single}]:[];
}
async function sendPublishNotificationHook(storyId, story){
  const url=safe(process.env.PROFILE_STORY_NOTIFY_HOOK_URL||"https://hook.us1.make.com/j1mpnbe8v78bq6m2y9smr3wq6d8mk92q",4000);
  if(!url) return {skipped:true};
  const createdAtMs=Date.now();
  const payload={
    action:"story_feed_publish_notification",
    mode:"notification_only",
    notificationOnly:true,
    firebaseAlreadyWritten:true,
    source:safe(story.source||story.origin)||"mycity_profile_upload",
    contentType:"story",
    contentKey:safe(story.contentKey)||"story_upload",
    displayTarget:safe(story.displayTarget)||"story_vertical",
    mediaType:safe(story.postType).toLowerCase()==="video"?"video":"image",
    userId:safe(story.userId),
    fullName:safe(story.fullName),
    avatar:safe(story.avatar),
    storyKey:safe(storyId),
    firebasePath:"/story/"+safe(storyId),
    sourceUsername:safe(story.sourceUsername),
    sourcePostId:safe(story.sourcePostId),
    sourcePermalink:safe(story.sourcePermalink),
    caption:safe(story.caption),
    message:safe(story.caption),
    postType:safe(story.postType),
    postProductType:safe(story.postProductType),
    mediaUrl:safe(story.mediaUrl),
    imageUrl:safe(story.imageUrl),
    videoUrl:safe(story.videoUrl),
    thumbnailUrl:safe(story.thumbnailUrl),
    cloudinarySecureUrl:safe(story.cloudinarySecureUrl),
    isCarousel:!!story.isCarousel,
    carousel:!!story.carousel,
    itemCount:Number(story.itemCount||0)||0,
    items:Array.isArray(story.items)?story.items:[],
    originalInstagramMediaUrl:safe(story.originalInstagramMediaUrl),
    instagramStats:story.instagramStats||{},
    isRepostInstance:!!story.isRepostInstance,
    repostOfStoryKey:safe(story.repostOfStoryKey),
    repostRootStoryKey:safe(story.repostRootStoryKey),
    originalOwnerUserId:safe(story.originalOwnerUserId),
    originalOwnerName:safe(story.originalOwnerName),
    matchedExistingStoryKey:"",
    rawInstagramPost:null,
    storyKind:safe(story.storyKind||story.storyType||story.contentKey),
    storyType:safe(story.storyType),
    mapStory:false,
    location:null,
    mapAddress:"",
    mapLatitude:0,
    mapLongitude:0,
    locationNotification:null,
    publicationStatus:safe(story.publicationStatus),
    publishedAtMs:Number(story.publishedAtMs||0)||0,
    createdAtMs,
    createdAtISO:new Date(createdAtMs).toISOString()
  };
  const res=await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const text=await res.text().catch(()=>"");
  if(!res.ok) throw new Error("Make notification hook failed: "+res.status+" "+safe(text,300));
  console.log("AUTOMATED_STORY_NOTIFY sent storyId="+storyId+" status="+res.status);
  return {ok:true,status:res.status};
}
async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_AUTOMATED_STORY_DRAFT||"false",10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const requestId=safe(process.env.AUTOMATED_STORY_REQUEST_ID,200);
  const sources=automatedSources();
  const title=safe(process.env.AUTOMATED_STORY_TITLE,250);
  const caption=safe(process.env.AUTOMATED_STORY_CAPTION,5000);
  const category=safe(process.env.AUTOMATED_STORY_CATEGORY,120);
  if(!requestId||!sources.length||!title) throw new Error("Automated story inputs missing");

  const idem=db.ref("aiStoryRequests/"+requestId.replace(/[.#$\/\[\]]/g,"_"));
  const prior=await idem.get();
  if(prior.exists()&&prior.val()?.storyId){
    console.log("AUTOMATED_STORY_DRAFT duplicate storyId="+prior.val().storyId);
    return;
  }

  const uploads=await Promise.all(sources.map((source,index)=>uploadRemote(source,index,sources.length)));
  const items=uploads.map((up,index)=>{
    const kind=sourceKind(up.secure_url,up._sourceKind||up.resource_type);
    const original=safe(up.secure_url,4000);
    const mediaUrl=kind==="image"&&safe(up.format,50).toLowerCase()==="svg"
      ? original.replace("/upload/","/upload/f_jpg,q_auto/")
      : original;
    const poster=kind==="video"?videoPoster(mediaUrl):mediaUrl;
    const width=Number(up.width||0)||0,height=Number(up.height||0)||0;
    return {
      id:"auto_"+index,
      index,
      mediaKind:kind,
      mediaType:kind==="video"?"video/mp4":"image",
      type:kind,
      mediaUrl,
      mediaDeliveryUrl:mediaUrl,
      url:mediaUrl,
      previewUrl:mediaUrl,
      imageUrl:kind==="image"?mediaUrl:poster,
      videoUrl:kind==="video"?mediaUrl:"",
      thumbnailUrl:poster,
      thumb:poster,
      previewThumb:poster,
      cloudinarySecureUrl:mediaUrl,
      cloudinaryPublicId:safe(up.public_id,500),
      cloudinaryAssetId:safe(up.asset_id,500),
      cloudinaryVersion:Number(up.version||0)||0,
      cloudinaryResourceType:safe(up.resource_type||"image",50),
      width,
      height,
      aspectRatio:width&&height?width/height:9/16,
      bytes:Number(up.bytes||0)||0,
      uploadStatus:"uploaded"
    };
  });
  const first=items[0]||{};
  const up=uploads[0]||{};
  const mediaUrl=safe(first.mediaUrl,4000);
  const firstKind=safe(first.mediaKind||first.type,20)||"image";
  const firstThumb=safe(first.thumbnailUrl||first.imageUrl||mediaUrl,4000);
  const isCarousel=items.length>1;
  const now=Date.now();
  const ownerId=safe(process.env.MYCITY_USER_ID||"629388",100);
  const story={
    userId:ownerId,
    fullName:safe(process.env.MYCITY_USER_NAME||"my city",250),
    avatar:safe(process.env.MYCITY_USER_AVATAR,4000),
    active:true,
    isPublished:true,
    publicationStatus:"published",
    source:"mycity_profile_upload",
    origin:"profile_upload",
    publisherSource:"story_publisher_independent",
    contentType:"story",
    contentKey:"story_upload",
    storyKind:"story_reel",
    storyType:"story_reel",
    displayTarget:"story_vertical",
    title,
    caption,
    category,
    postType:isCarousel?"carousel":(firstKind==="video"?"video":"IMAGE"),
    postProductType:"MYCITY_STORY",
    carousel:isCarousel,
    isCarousel,
    itemCount:items.length,
    items,
    mediaType:firstKind,
    mediaKind:firstKind,
    imageUrl:firstKind==="image"?mediaUrl:firstThumb,
    videoUrl:firstKind==="video"?mediaUrl:"",
    mediaUrl,
    thumbnailUrl:firstThumb,
    cloudinarySecureUrl:mediaUrl,
    cloudinaryPublicId:safe(up.public_id,500),
    cloudinaryAssetId:safe(up.asset_id,500),
    cloudinaryResourceType:safe(up.resource_type||"image",50),
    cloudinaryWidth:Number(up.width||0)||0,
    cloudinaryHeight:Number(up.height||0)||0,
    cloudinaryBytes:Number(up.bytes||0)||0,
    cloudinaryFormat:safe(up.format,50),
    width:Number(first.width||0)||0,
    height:Number(first.height||0)||0,
    aspectRatio:Number(first.aspectRatio||0)||0,
    viewsCount:0,commentsCount:0,repostsCount:0,likesCount:0,sharesCount:0,
    createdAtMs:now,updatedAtMs:now,publishedAtMs:now,
    remainingLifeMs:24*60*60*1000,
    aiGenerated:true,aiSource:"mycity_local_desk",aiRequestId:requestId,
    previewAspectRatio:"9:16",storyPreviewAspectRatio:"9:16",
    cloudinaryFitMode:"fit",previewScale:1,previewOffsetX:0,previewOffsetY:0,
    uploadStatus:"uploaded",processingStatus:"done"
  };
  const ref=db.ref("story").push();
  await ref.set(story);

  const vitrineRecord={
    storyId:ref.key,
    userId:ownerId,
    ownerName:story.fullName,
    ownerAvatar:story.avatar,
    title:story.title || "Story Feed",
    caption:story.caption || "",
    mediaType:firstKind,
    mediaKind:firstKind,
    mediaUrl,
    url:mediaUrl,
    imageUrl:firstKind==="image"?mediaUrl:firstThumb,
    videoUrl:firstKind==="video"?mediaUrl:"",
    thumbnailUrl:firstThumb,
    thumb:firstThumb,
    postType:isCarousel?"carousel":"feed",
    postProductType:"MYCITY_FEED",
    carousel:isCarousel,
    isCarousel,
    itemCount:items.length,
    items,
    width:Number(first.width||0)||0,
    height:Number(first.height||0)||0,
    aspectRatio:Number(first.aspectRatio||0)||0,
    likesCount:0,
    viewsCount:0,
    commentsCount:0,
    createdAtMs:now,
    publishedAtMs:now,
    updatedAtMs:now,
    active:true,
    public:true,
    publicationStatus:"published"
  };
  const userKey=ownerId.replace(/[.#$\/\[\]]/g,"_");
  await db.ref("/").update({
    ["/storyVitrine/"+ref.key]:vitrineRecord,
    ["/storyVitrineFeed/"+ref.key]:vitrineRecord,
    ["/storyVitrineByUser/"+userKey+"/"+ref.key]:vitrineRecord
  });

  await idem.set({storyId:ref.key,status:"published",mediaType:firstKind,isCarousel,itemCount:items.length,userId:ownerId,requestId,cloudinarySecureUrl:mediaUrl,createdAtMs:now});
  await sendPublishNotificationHook(ref.key,story);
  console.log("AUTOMATED_STORY_PUBLISHED created storyId="+ref.key+" itemCount="+items.length+" isCarousel="+isCarousel+" secureUrl="+mediaUrl);
}
try{ await run(); }catch(e){ console.error("AUTOMATED_STORY_DRAFT failed:",e?.message||e); }
await import("./index.js");
