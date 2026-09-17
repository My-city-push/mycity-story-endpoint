import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function run() {
  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase config missing");

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL
    });
  }

  const storyId = "-P1lR_FGADL_0pCpeR8C";
  const userId = String(process.env.MYCITY_USER_ID || "629388");
  const mediaUrl = "https://mycity-assets.onrender.com/la-fiesta.jpg";
  const now = Date.now();

  const updates = {
    [`/story/${storyId}/imageUrl`]: mediaUrl,
    [`/story/${storyId}/mediaUrl`]: mediaUrl,
    [`/story/${storyId}/thumbnailUrl`]: mediaUrl,
    [`/story/${storyId}/updatedAtMs`]: now,
    [`/story/${storyId}/previewAspectRatio`]: "9:16",
    [`/story/${storyId}/storyPreviewAspectRatio`]: "9:16",
    [`/story/${storyId}/cloudinaryFitMode`]: "fit",
    [`/story/${storyId}/previewScale`]: 1,
    [`/story/${storyId}/previewOffsetX`]: 0,
    [`/story/${storyId}/previewOffsetY`]: 0,
    [`/storyVitrine/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrine/${storyId}/thumbnailUrl`]: mediaUrl,
    [`/storyVitrine/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineFeed/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrineFeed/${storyId}/thumbnailUrl`]: mediaUrl,
    [`/storyVitrineFeed/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineByUser/${userId}/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/thumbnailUrl`]: mediaUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/updatedAtMs`]: now
  };

  await admin.database().ref("/").update(updates);
  console.log(`LA_FIESTA_RENDER_ASSET updated storyId=${storyId}`);
}

try {
  await run();
} catch (error) {
  console.error("LA_FIESTA_RENDER_ASSET failed:", error?.message || error);
}

await import("./index.js");
