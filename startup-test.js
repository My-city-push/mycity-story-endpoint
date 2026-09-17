import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function runDraftTest() {
  if (!/^true$/i.test(String(process.env.RUN_STARTUP_DRAFT_TEST || "false"))) return;

  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase test configuration missing");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  const db = admin.database();
  const requestId = "chatgpt-startup-draft-test-v1";
  const requestRef = db.ref(`aiStoryRequests/${requestId}`);
  const prior = await requestRef.get();

  if (prior.exists() && prior.val()?.storyId) {
    console.log(`STARTUP_DRAFT_TEST duplicate storyId=${prior.val().storyId}`);
    return;
  }

  const now = Date.now();
  const ownerId = String(process.env.MYCITY_USER_ID || "629388");
  const ownerName = String(process.env.MYCITY_USER_NAME || "my city");
  const ownerAvatar = String(process.env.MYCITY_USER_AVATAR || "");
  const mediaUrl = ownerAvatar || "https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg";

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
    caption: "Prueba técnica MyCity. Borrador no publicado.",
    title: "Prueba técnica MyCity",
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
    aiSource: "startup_draft_test",
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
  await requestRef.set({
    storyId: storyRef.key,
    status: "draft",
    mediaType: "image",
    userId: ownerId,
    requestId,
    createdAtMs: now
  });

  console.log(`STARTUP_DRAFT_TEST created storyId=${storyRef.key} status=draft`);
}

try {
  await runDraftTest();
} catch (error) {
  console.error("STARTUP_DRAFT_TEST failed:", error?.message || error);
}

await import("./index.js");
