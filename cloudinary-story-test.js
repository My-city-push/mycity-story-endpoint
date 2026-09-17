import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function uploadImageToCloudinary(dataUri) {
  const fd = new FormData();
  fd.append("file", dataUri);
  fd.append("upload_preset", String(process.env.CLOUDINARY_UNSIGNED_PRESET || "mycity_unsigned"));
  fd.append("folder", String(process.env.CLOUDINARY_STORY_UPLOAD_FOLDER || "mycity/story-uploads"));
  fd.append("tags", "mycity,story_upload,ai_generated");
  fd.append("context", "source=mycity_ai_story_endpoint|publisher=story_publisher_independent|userId=" + String(process.env.MYCITY_USER_ID || "629388"));

  const cloud = String(process.env.CLOUDINARY_CLOUD_NAME || "dxnxwaigw");
  const res = await fetch("https://api.cloudinary.com/v1_1/" + encodeURIComponent(cloud) + "/image/upload", {
    method: "POST",
    body: fd
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    throw new Error("Cloudinary upload failed: " + (data?.error?.message || res.status));
  }
  return data;
}

async function run() {
  if (!/^true$/i.test(String(process.env.RUN_CLOUDINARY_STORY_TEST || "false"))) return;

  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase config missing");

  const dataUri = String(process.env.CLOUDINARY_TEST_IMAGE_DATA_URI || "").trim();
  if (!dataUri.startsWith("data:image/")) throw new Error("CLOUDINARY_TEST_IMAGE_DATA_URI missing");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  const db = admin.database();
  const requestId = "localdesk-la-fiesta-zoo-cloudinary-v1";
  const reqRef = db.ref("aiStoryRequests/" + requestId);
  const prior = await reqRef.get();
  if (prior.exists() && prior.val()?.storyId) {
    console.log("CLOUDINARY_STORY_TEST duplicate storyId=" + prior.val().storyId);
    return;
  }

  const uploaded = await uploadImageToCloudinary(dataUri);
  const mediaUrl = String(uploaded.secure_url);
  const now = Date.now();
  const ownerId = String(process.env.MYCITY_USER_ID || "629388");
  const ownerName = String(process.env.MYCITY_USER_NAME || "my city");
  const ownerAvatar = String(process.env.MYCITY_USER_AVATAR || "");

  const story = {
    userId: ownerId,
    fullName: ownerName,
    avatar: ownerAvatar,
    active: false,
    isPublished: false,
    publicationStatus: "draft",
    source: "mycity_profile_upload",
    origin: "profile_upload",
    publisherSource: "story_publisher_independent",
    contentType: "story",
    contentKey: "story_upload",
    storyKind: "story_reel",
    storyType: "story_reel",
    displayTarget: "story_vertical",
    caption: "La Fiesta at the Zoo llega este sábado 19 de septiembre con música, arte, comida y ambiente familiar. 📍 Louisville Zoo ⏰ 10 a.m. – 4 p.m. ¿Vas a ir? ¿Quieres más eventos latinos en MyCity?",
    title: "Louisville celebra lo latino este sábado 🇱🇦",
    postType: "IMAGE",
    postProductType: "MYCITY_STORY",
    imageUrl: mediaUrl,
    mediaUrl,
    thumbnailUrl: mediaUrl,
    cloudinarySecureUrl: mediaUrl,
    cloudinaryPublicId: String(uploaded.public_id || ""),
    cloudinaryAssetId: String(uploaded.asset_id || ""),
    cloudinaryResourceType: String(uploaded.resource_type || "image"),
    cloudinaryWidth: Number(uploaded.width || 0) || 0,
    cloudinaryHeight: Number(uploaded.height || 0) || 0,
    cloudinaryBytes: Number(uploaded.bytes || 0) || 0,
    cloudinaryFormat: String(uploaded.format || ""),
    viewsCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    likesCount: 0,
    createdAtMs: now,
    updatedAtMs: now,
    publishedAtMs: 0,
    remainingLifeMs: 24 * 60 * 60 * 1000,
    aiGenerated: true,
    aiSource: "mycity_local_desk",
    aiRequestId: requestId,
    previewAspectRatio: "9:16",
    storyPreviewAspectRatio: "9:16",
    cloudinaryFitMode: "fit",
    previewScale: 1,
    previewOffsetX: 0,
    previewOffsetY: 0,
    uploadStatus: "uploaded",
    processingStatus: "done"
  };

  const storyRef = db.ref("story").push();
  await storyRef.set(story);
  await reqRef.set({
    storyId: storyRef.key,
    status: "draft",
    mediaType: "image",
    userId: ownerId,
    requestId,
    cloudinarySecureUrl: mediaUrl,
    cloudinaryPublicId: String(uploaded.public_id || ""),
    createdAtMs: now
  });

  console.log("CLOUDINARY_STORY_TEST created storyId=" + storyRef.key + " secureUrl=" + mediaUrl + " size=" + (uploaded.width || 0) + "x" + (uploaded.height || 0));
}

try {
  await run();
} catch (error) {
  console.error("CLOUDINARY_STORY_TEST failed:", error?.message || error);
}

await import("./index.js");
