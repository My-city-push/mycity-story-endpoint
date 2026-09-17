import admin from "firebase-admin";

function parseServiceAccount() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function run() {
  const enabled = /^true$/i.test(String(process.env.RUN_LA_FIESTA_MEDIA_UPDATE || "false"));
  if (!enabled) return;

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
  const mediaUrl = "https://cmsphoto.ww-cdn.com/superstatic/2817182/gal/original/gal-30633473.jpg?v=1789684981";
  const thumbUrl = "https://cmsphoto.ww-cdn.com/resizeapi/d3c6b12125e361bccfc0884dfd7063210a6ef42c/480/853/";
  const now = Date.now();

  const updates = {
    [`/story/${storyId}/imageUrl`]: mediaUrl,
    [`/story/${storyId}/mediaUrl`]: mediaUrl,
    [`/story/${storyId}/thumbnailUrl`]: thumbUrl,
    [`/story/${storyId}/cloudinarySecureUrl`]: mediaUrl,
    [`/story/${storyId}/updatedAtMs`]: now,
    [`/storyVitrine/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrine/${storyId}/thumbnailUrl`]: thumbUrl,
    [`/storyVitrine/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineFeed/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrineFeed/${storyId}/thumbnailUrl`]: thumbUrl,
    [`/storyVitrineFeed/${storyId}/updatedAtMs`]: now,
    [`/storyVitrineByUser/${userId}/${storyId}/mediaUrl`]: mediaUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/thumbnailUrl`]: thumbUrl,
    [`/storyVitrineByUser/${userId}/${storyId}/updatedAtMs`]: now
  };

  await admin.database().ref("/").update(updates);
  console.log(`LA_FIESTA_MEDIA_UPDATE updated storyId=${storyId}`);
}

try {
  await run();
} catch (error) {
  console.error("LA_FIESTA_MEDIA_UPDATE failed:", error?.message || error);
}

await import("./index.js");
