import admin from "firebase-admin";

function safe(v,max=10000){ return String(v ?? "").trim().slice(0,max); }
function parseServiceAccount(){
  const raw=safe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON,100000);
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  if(parsed.private_key) parsed.private_key=parsed.private_key.replace(/\\n/g,"\n");
  return parsed;
}
async function uploadVideo(sourceUrl){
  const cloud=safe(process.env.CLOUDINARY_CLOUD_NAME||"dxnxwaigw",100);
  const preset=safe(process.env.CLOUDINARY_UNSIGNED_PRESET||"mycity_unsigned",200);
  const folder=safe(process.env.CLOUDINARY_STORY_UPLOAD_FOLDER||"mycity/story-uploads",500);
  const fd=new FormData();
  fd.append("file",sourceUrl);
  fd.append("upload_preset",preset);
  if(folder) fd.append("folder",folder);
  fd.append("tags","mycity,story_upload,ai_generated,video");
  const res=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloud)+"/video/upload",{method:"POST",body:fd});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.secure_url) throw new Error("Cloudinary video upload failed: "+safe(data?.error?.message||res.status,300));
  return data;
}
function posterUrl(videoUrl){
  return safe(videoUrl,4000).replace(/\/video\/upload\//,"/video/upload/so_0,f_jpg/");
}
async function run(){
  if(!/^true$/i.test(safe(process.env.RUN_AUTOMATED_VIDEO_STORY_DRAFT||"false",10))) return;
  const databaseURL=safe(process.env.FIREBASE_DATABASE_URL,1000).replace(/\/+$/,"");
  const serviceAccount=parseServiceAccount();
  if(!databaseURL||!serviceAccount) throw new Error("Firebase config missing");
  if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL});
  const db=admin.database();

  const requestId=safe(process.env.AUTOMATED_VIDEO_STORY_REQUEST_ID,200);
  const sourceUrl=safe(process.env.AUTOMATED_VIDEO_STORY_SOURCE_URL,4000);
  const title=safe(process.env.AUTOMATED_VIDEO_STORY_TITLE,250);
  const caption=safe(process.env.AUTOMATED_VIDEO_STORY_CAPTION,5000);
  const category=safe(process.env.AUTOMATED_VIDEO_STORY_CATEGORY,120);
  if(!requestId||!/^https:\/\//i.test(sourceUrl)||!title) throw new Error("Automated video Story inputs missing");

  const idem=db.ref("aiStoryRequests/"+requestId.replace(/[.#$\/\[\]]/g,"_"));
  const prior=await idem.get();
  if(prior.exists()&&prior.val()?.storyId){
    console.log("AUTOMATED_VIDEO_STORY_DRAFT duplicate storyId="+prior.val().storyId);
    return;
  }

  const up=await uploadVideo(sourceUrl);
  const mediaUrl=safe(up.secure_url,4000);
  const thumbUrl=posterUrl(mediaUrl);
  const now=Date.now();
  const ownerId=safe(process.env.MYCITY_USER_ID||"629388",100);
  const story={
    userId:ownerId,
    fullName:safe(process.env.MYCITY_USER_NAME||"my city",250),
    avatar:safe(process.env.MYCITY_USER_AVATAR,4000),
    active:false,
    isPublished:false,
    publicationStatus:"draft",
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
    postType:"VIDEO",
    postProductType:"MYCITY_STORY",
    imageUrl:thumbUrl,
    videoUrl:mediaUrl,
    mediaUrl,
    thumbnailUrl:thumbUrl,
    cloudinarySecureUrl:mediaUrl,
    cloudinaryPublicId:safe(up.public_id,500),
    cloudinaryAssetId:safe(up.asset_id,500),
    cloudinaryResourceType:safe(up.resource_type||"video",50),
    cloudinaryWidth:Number(up.width||0)||0,
    cloudinaryHeight:Number(up.height||0)||0,
    cloudinaryDuration:Number(up.duration||0)||0,
    cloudinaryBytes:Number(up.bytes||0)||0,
    cloudinaryFormat:safe(up.format,50),
    viewsCount:0,commentsCount:0,repostsCount:0,likesCount:0,
    createdAtMs:now,updatedAtMs:now,publishedAtMs:0,
    remainingLifeMs:24*60*60*1000,
    aiGenerated:true,aiSource:"mycity_local_desk_video",aiRequestId:requestId,
    previewAspectRatio:"9:16",storyPreviewAspectRatio:"9:16",
    cloudinaryFitMode:"fit",previewScale:1,previewOffsetX:0,previewOffsetY:0,
    uploadStatus:"uploaded",processingStatus:"done"
  };
  const ref=db.ref("story").push();
  await ref.set(story);
  await idem.set({storyId:ref.key,status:"draft",mediaType:"video",userId:ownerId,requestId,cloudinarySecureUrl:mediaUrl,thumbnailUrl:thumbUrl,createdAtMs:now});
  console.log("AUTOMATED_VIDEO_STORY_DRAFT created storyId="+ref.key+" secureUrl="+mediaUrl+" thumbnail="+thumbUrl);
}
try{ await run(); }catch(e){ console.error("AUTOMATED_VIDEO_STORY_DRAFT failed:",e?.message||e); }
await import("./index.js");
