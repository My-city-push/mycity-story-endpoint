import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function run() {
  if (!/^true$/i.test(String(process.env.RUN_LA_FIESTA_DRAFT_V2 || "false"))) return;

  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase config missing");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  const db = admin.database();
  const requestId = "localdesk-la-fiesta-zoo-2026-09-19-v2";
  const priorRef = db.ref(`aiStoryRequests/${requestId}`);
  const prior = await priorRef.get();
  if (prior.exists() && prior.val()?.storyId) {
    console.log(`LA_FIESTA_DRAFT_V2 duplicate storyId=${prior.val().storyId}`);
    return;
  }

  const now = Date.now();
  const ownerId = String(process.env.MYCITY_USER_ID || "629388");
  const ownerName = String(process.env.MYCITY_USER_NAME || "my city");
  const ownerAvatar = String(process.env.MYCITY_USER_AVATAR || "");
  const mediaUrl = "https://cmsphoto.ww-cdn.com/superstatic/2817182/gal/original/gal-30633541.jpg?v=1789688036";

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
  await priorRef.set({
    storyId: storyRef.key,
    status: "draft",
    mediaType: "image",
    userId: ownerId,
    requestId,
    createdAtMs: now
  });
  console.log(`LA_FIESTA_DRAFT_V2 created storyId=${storyRef.key} status=draft`);
}

try {
  await run();
} catch (error) {
  console.error("LA_FIESTA_DRAFT_V2 failed:", error?.message || error);
}

await import("./index.js");
