import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function publishOnce() {
  if (!/^true$/i.test(String(process.env.RUN_LA_FIESTA_PUBLISH_ONCE || "false"))) return;

  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase publish configuration missing");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  const db = admin.database();
  const requestId = "mycity-local-la-fiesta-zoo-2026-09-19-v1";
  const requestRef = db.ref(`aiStoryRequests/${requestId}`);
  const prior = await requestRef.get();
  if (prior.exists() && prior.val()?.storyId) {
    console.log(`LA_FIESTA_PUBLISH duplicate storyId=${prior.val().storyId}`);
    return;
  }

  const now = Date.now();
  const ownerId = String(process.env.MYCITY_USER_ID || "629388");
  const ownerName = String(process.env.MYCITY_USER_NAME || "my city");
  const ownerAvatar = String(process.env.MYCITY_USER_AVATAR || "");
  const mediaUrl = "https://louisvillezoo.org/wp-content/uploads/2025/07/La-FIesta-Temp-Banner.jpg";
  const caption = "La Fiesta at the Zoo llega este sábado 19 de septiembre con música, arte, comida y comunidad latina. 📍 Louisville Zoo ⏰ 10 a.m. – 3 p.m. ¿Vas a ir? ¿Quieres más eventos latinos en MyCity?";

  const story = {
    userId: ownerId,
    fullName: ownerName,
    avatar: ownerAvatar,
    active: true,
    isPublished: true,
    publicationStatus: "published",
    source: "mycity_profile_upload",
    origin: "profile_upload",
    publisherSource: "story_publisher_independent",
    contentType: "story",
    contentKey: "story_upload",
    storyKind: "story_reel",
    storyType: "story_reel",
    displayTarget: "story_vertical",
    caption,
    title: "Louisville celebra lo latino este sábado 🇱🇦",
    postType: "IMAGE",
    postProductType: "MYCITY_STORY",
    imageUrl: mediaUrl,
    mediaUrl,
    thumbnailUrl: mediaUrl,
    cloudinarySecureUrl: mediaUrl,
    externalUrl: "https://louisvillezoo.org/event/la-fiesta-at-the-zoo-a-latin-american-heritage-celebration-2026/",
    viewsCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    likesCount: 0,
    createdAtMs: now,
    updatedAtMs: now,
    publishedAtMs: now,
    remainingLifeMs: 24 * 60 * 60 * 1000,
    aiGenerated: true,
    aiSource: "mycity_local_desk",
    aiRequestId: requestId,
    previewAspectRatio: "9:16",
    storyPreviewAspectRatio: "9:16",
    cloudinaryFitMode: "cover",
    previewScale: 1,
    previewOffsetX: 0,
    previewOffsetY: 0,
    uploadStatus: "uploaded",
    processingStatus: "done"
  };

  const storyRef = db.ref("story").push();
  await storyRef.set(story);

  const vitrine = {
    storyId: storyRef.key,
    userId: ownerId,
    ownerName,
    ownerAvatar,
    title: story.title,
    caption,
    mediaType: "image",
    mediaUrl,
    thumbnailUrl: mediaUrl,
    likesCount: 0,
    viewsCount: 0,
    commentsCount: 0,
    createdAtMs: now,
    publishedAtMs: now,
    updatedAtMs: now,
    externalUrl: story.externalUrl,
    active: true,
    public: true,
    publicationStatus: "published"
  };

  const userKey = ownerId.replace(/[.#$\/\[\]]/g, "_");
  await db.ref("/").update({
    [`/storyVitrine/${storyRef.key}`]: vitrine,
    [`/storyVitrineFeed/${storyRef.key}`]: vitrine,
    [`/storyVitrineByUser/${userKey}/${storyRef.key}`]: vitrine
  });

  await requestRef.set({
    storyId: storyRef.key,
    status: "published",
    mediaType: "image",
    userId: ownerId,
    requestId,
    createdAtMs: now
  });

  console.log(`LA_FIESTA_PUBLISH created storyId=${storyRef.key} status=published`);
}

try {
  await publishOnce();
} catch (error) {
  console.error("LA_FIESTA_PUBLISH failed:", error?.message || error);
}

await import("./index.js");
