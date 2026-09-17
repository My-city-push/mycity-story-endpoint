import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function run() {
  if (!/^true$/i.test(String(process.env.RUN_LA_FIESTA_RENDER_FIX || "false"))) return;
  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
  const serviceAccount = parseServiceAccount();
  if (!databaseURL || !serviceAccount) throw new Error("Firebase config missing");

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL });
  }

  const storyId = "-P1lR_FGADL_0pCpeR8C";
  const userId = String(process.env.MYCITY_USER_ID || "629388");
  const originalUrl = "https://cmsphoto.ww-cdn.com/superstatic/2817182/gal/original/gal-30633473.jpg?v=1789684981";
  const now = Date.now();

  const updates = {
    [`/story/${storyId}/imageUrl`]: originalUrl,
    [`/story/${storyId}/mediaUrl`]: originalUrl,
    [`/story/${storyId}/thumbnailUrl`]: originalUrl,
    [`/story/${storyId}/cloudinarySecureUrl`]: originalUrl,
    [`/story/${storyId}/previewAspectRatio`]: "9:16",
    [`/story/${storyId}/storyPreviewAspectRatio`]: "9:16",
    [`/story/${storyId}/cloudinaryFitMode`]: "fit",
    [`/story/${storyId}/previewScale`]: 1,
    [`/story/${storyId}/previewOffsetX`]: 0,
    [`/story/${storyId}/previewOffsetY`]: 0,
    [`/story/${storyId}/updatedAtMs`]: now,
    [`/storyVitrine/${storyId}/mediaUrl`]: originalUrl,
    [`/storyVitrine/${storyId}/thumbnailUrl`]: originalUrl,
    [`/storyVitrine/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineFeed/${storyId}/mediaUrl`]: originalUrl,
    [`/storyVitrineFeed/${storyId}/thumbnailUrl`]: originalUrl,
    [`/storyVitrineFeed/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineByUser/${userId}/${storyId}/mediaUrl`]: originalUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/thumbnailUrl`]: originalUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/updatedAtMs`]: now
  };

  await admin.database().ref("/").update(updates);
  console.log(`LA_FIESTA_RENDER_FIX updated storyId=${storyId}`);
}

try { await run(); } catch (error) { console.error("LA_FIESTA_RENDER_FIX failed:", error?.message || error); }
await import("./index.js");
