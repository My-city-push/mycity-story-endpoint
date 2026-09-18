import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
async function uploadRemote(sourceUrl){
  const cloud=safe(process.env.CLOUDINARY_CLOUD_NAME||"dxnxwaigw",100);
  const preset=safe(process.env.CLOUDINARY_UNSIGNED_PRESET||"mycity_unsigned",200);
  const folder=safe(process.env.CLOUDINARY_STORY_UPLOAD_FOLDER||"mycity/story-uploads",500);
  const fd=new FormData();
  fd.append("file",sourceUrl);
  fd.append("upload_preset",preset);
  if(folder) fd.append("folder",folder);
  fd.append("tags","mycity,story_upload,ai_generated,automation");
  const res=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloud)+"/image/upload",{method:"POST",body:fd});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.secure_url) throw new Error("Cloudinary upload failed: "+safe(data?.error?.message||res.status,300));
  return data;
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
  const sourceUrl=safe(process.env.AUTOMATED_STORY_SOURCE_URL,4000);
  const title=safe(process.env.AUTOMATED_STORY_TITLE,250);
  const caption=safe(process.env.AUTOMATED_STORY_CAPTION,5000);
  const category=safe(process.env.AUTOMATED_STORY_CATEGORY,120);
  if(!requestId||!/^https:\/\//i.test(sourceUrl)||!title) throw new Error("Automated story inputs missing");

  const idem=db.ref("aiStoryRequests/"+requestId.replace(/[.#$\/\[\]]/g,"_"));
  const prior=await idem.get();
  if(prior.exists()&&prior.val()?.storyId){
    console.log("AUTOMATED_STORY_DRAFT duplicate storyId="+prior.val().storyId);
    return;
  }

  const up=await uploadRemote(sourceUrl);
  const originalCloudinaryUrl=safe(up.secure_url,4000);
  const mediaUrl=safe(up.format,50).toLowerCase()==="svg"
    ? originalCloudinaryUrl.replace("/upload/","/upload/f_jpg,q_auto/")
    : originalCloudinaryUrl;
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
    postType:"IMAGE",
    postProductType:"MYCITY_STORY",
    imageUrl:mediaUrl,
    mediaUrl,
    thumbnailUrl:mediaUrl,
    cloudinarySecureUrl:mediaUrl,
    cloudinaryPublicId:safe(up.public_id,500),
    cloudinaryAssetId:safe(up.asset_id,500),
    cloudinaryResourceType:safe(up.resource_type||"image",50),
    cloudinaryWidth:Number(up.width||0)||0,
    cloudinaryHeight:Number(up.height||0)||0,
    cloudinaryBytes:Number(up.bytes||0)||0,
    cloudinaryFormat:safe(up.format,50),
    viewsCount:0,commentsCount:0,repostsCount:0,likesCount:0,
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
    mediaType:"image",
    mediaUrl,
    thumbnailUrl:mediaUrl,
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

  await idem.set({storyId:ref.key,status:"published",mediaType:"image",userId:ownerId,requestId,cloudinarySecureUrl:mediaUrl,createdAtMs:now});
  await sendPublishNotificationHook(ref.key,story);
  console.log("AUTOMATED_STORY_PUBLISHED created storyId="+ref.key+" secureUrl="+mediaUrl);
}
try{ await run(); }catch(e){ console.error("AUTOMATED_STORY_DRAFT failed:",e?.message||e); }
await import("./index.js");
