import express from "express";
import crypto from "node:crypto";
import admin from "firebase-admin";

const app = express();
app.use(express.json({ limit: "12mb" }));

const PORT = Number(process.env.PORT || 10000);
const FIREBASE_DATABASE_URL = String(process.env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");
const ENDPOINT_KEY = String(process.env.MYCITY_ENDPOINT_KEY || "");
const OWNER = Object.freeze({
  userId: String(process.env.MYCITY_USER_ID || "629388"),
  fullName: String(process.env.MYCITY_USER_NAME || "my city"),
  avatar: String(process.env.MYCITY_USER_AVATAR || "https://userstorage.ww-api.com/userpict/storage/v1/2817182/img/1755398780174_29/image62938842324881721979097225.jpg/")
});
const ALLOW_PUBLISH = /^true$/i.test(String(process.env.ALLOW_PUBLISH || "false"));
const ALLOW_PUBLIC_RTDB_FALLBACK = /^true$/i.test(String(process.env.ALLOW_PUBLIC_RTDB_FALLBACK || "false"));
const CLOUDINARY_CLOUD_NAME = String(process.env.CLOUDINARY_CLOUD_NAME || "dxnxwaigw");
const CLOUDINARY_UNSIGNED_PRESET = String(process.env.CLOUDINARY_UNSIGNED_PRESET || "mycity_unsigned");
const CLOUDINARY_STORY_UPLOAD_FOLDER = String(process.env.CLOUDINARY_STORY_UPLOAD_FOLDER || "mycity/story-uploads");

const VITRINE_ROOT = "storyVitrine";
const VITRINE_FEED = "storyVitrineFeed";
const VITRINE_BY_USER = "storyVitrineByUser";
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

let firebaseMode = "none";
let db = null;

function safeString(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function parseServiceAccount() {
  const raw = safeString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 100000);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

function initFirebase() {
  if (!FIREBASE_DATABASE_URL) return;
  try {
    const serviceAccount = parseServiceAccount();
    if (serviceAccount) {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: FIREBASE_DATABASE_URL
        });
      }
      db = admin.database();
      firebaseMode = "admin";
      return;
    }
  } catch (error) {
    console.error("Firebase Admin init failed:", error.message);
  }
  if (ALLOW_PUBLIC_RTDB_FALLBACK) firebaseMode = "rest-public";
}

initFirebase();

function requireApiKey(req, res, next) {
  if (!ENDPOINT_KEY) return res.status(503).json({ ok: false, error: "MYCITY_ENDPOINT_KEY is not configured" });
  const supplied = safeString(req.get("x-mycity-key"), 1000);
  const a = Buffer.from(supplied);
  const b = Buffer.from(ENDPOINT_KEY);
  if (!supplied || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

function normalizeStatus(value) {
  const requested = safeString(value || "draft", 30).toLowerCase();
  if (requested === "published" && ALLOW_PUBLISH) return "published";
  return "draft";
}

function normalizeMediaType(value, mediaUrl) {
  const type = safeString(value, 20).toLowerCase();
  if (type === "video") return "video";
  if (type === "image") return "image";
  return /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(mediaUrl) ? "video" : "image";
}

function sanitizeUrl(value) {
  const raw = safeString(value, 4000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function baseStoryFields(caption, status, now) {
  const published = status === "published";
  return {
    userId: OWNER.userId,
    fullName: OWNER.fullName,
    avatar: OWNER.avatar,
    active: published,
    isPublished: published,
    publicationStatus: status,
    source: "mycity_profile_upload",
    origin: "profile_upload",
    publisherSource: "story_publisher_independent",
    contentType: "story",
    contentKey: "story_upload",
    storyKind: "story_reel",
    storyType: "story_reel",
    displayTarget: "story_vertical",
    caption,
    viewsCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    likesCount: 0,
    createdAtMs: now,
    updatedAtMs: now,
    publishedAtMs: published ? now : 0,
    remainingLifeMs: STORY_TTL_MS
  };
}

function buildStoryPayload(input) {
  const now = Date.now();
  const status = normalizeStatus(input.status);
  const mediaUrl = sanitizeUrl(input.mediaUrl || input.imageUrl || input.videoUrl);
  const thumbnailUrl = sanitizeUrl(input.thumbnailUrl || input.imageUrl || mediaUrl);
  if (!mediaUrl) throw new Error("mediaUrl must be a valid http(s) URL");
  const mediaType = normalizeMediaType(input.mediaType, mediaUrl);
  const caption = safeString(input.caption, 500);

  const story = {
    ...baseStoryFields(caption, status, now),
    postType: mediaType === "video" ? "VIDEO" : "IMAGE",
    postProductType: "MYCITY_STORY",
    imageUrl: mediaType === "video" ? thumbnailUrl : mediaUrl,
    videoUrl: mediaType === "video" ? mediaUrl : "",
    mediaUrl,
    thumbnailUrl: thumbnailUrl || mediaUrl,
    cloudinarySecureUrl: sanitizeUrl(input.cloudinarySecureUrl || mediaUrl),
    cloudinaryPublicId: safeString(input.cloudinaryPublicId, 500),
    externalUrl: sanitizeUrl(input.externalUrl),
    linkIconUrl: sanitizeUrl(input.linkIconUrl),
    title: safeString(input.title || "Story Feed", 180),
    aiGenerated: true,
    aiSource: safeString(input.aiSource || "mycity_story_endpoint", 120),
    aiRequestId: safeString(input.requestId, 200),
    previewAspectRatio: safeString(input.previewAspectRatio || "9:16", 20),
    storyPreviewAspectRatio: safeString(input.storyPreviewAspectRatio || "9:16", 20),
    cloudinaryFitMode: safeString(input.cloudinaryFitMode || "fit", 20),
    previewScale: Number(input.previewScale || 1) || 1,
    previewOffsetX: Number(input.previewOffsetX || 0) || 0,
    previewOffsetY: Number(input.previewOffsetY || 0) || 0,
    uploadStatus: "uploaded",
    processingStatus: "done"
  };

  for (const key of Object.keys(story)) {
    if (story[key] === "" || story[key] == null) delete story[key];
  }
  return { story, status, mediaType };
}

function vitrineRecord(storyId, story) {
  if (story.publicationStatus !== "published") return null;
  return {
    storyId,
    userId: story.userId,
    ownerName: story.fullName,
    ownerAvatar: story.avatar,
    title: story.title || "Story Feed",
    caption: story.caption || "",
    mediaType: story.postType === "VIDEO" ? "video" : "image",
    mediaUrl: story.mediaUrl,
    thumbnailUrl: story.thumbnailUrl || story.mediaUrl,
    likesCount: Number(story.likesCount || 0),
    viewsCount: Number(story.viewsCount || 0),
    commentsCount: Number(story.commentsCount || 0),
    createdAtMs: story.createdAtMs,
    publishedAtMs: story.publishedAtMs || story.createdAtMs,
    updatedAtMs: story.updatedAtMs,
    externalUrl: story.externalUrl || undefined,
    linkIconUrl: story.linkIconUrl || undefined,
    active: true,
    public: true,
    publicationStatus: "published"
  };
}

async function adminGet(path) {
  const snap = await db.ref(path).get();
  return snap.exists() ? snap.val() : null;
}

async function adminSet(path, value) {
  await db.ref(path).set(value);
}

async function adminUpdate(updates) {
  await db.ref("/").update(updates);
}

async function restRequest(path, method = "GET", body) {
  const url = `${FIREBASE_DATABASE_URL}/${path.replace(/^\/+/, "")}.json`;
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Firebase REST ${res.status}`);
  return await res.json();
}

async function firebaseGet(path) {
  if (firebaseMode === "admin") return adminGet(path);
  if (firebaseMode === "rest-public") return restRequest(path, "GET");
  throw new Error("Firebase is not configured");
}

async function firebaseSet(path, value) {
  if (firebaseMode === "admin") return adminSet(path, value);
  if (firebaseMode === "rest-public") return restRequest(path, "PUT", value);
  throw new Error("Firebase is not configured");
}

async function firebaseRootPatch(updates) {
  if (firebaseMode === "admin") return adminUpdate(updates);
  if (firebaseMode === "rest-public") return restRequest("", "PATCH", updates);
  throw new Error("Firebase is not configured");
}

async function createStoryRecord(story) {
  if (firebaseMode === "admin") {
    const ref = db.ref("story").push();
    await ref.set(story);
    return ref.key;
  }
  if (firebaseMode === "rest-public") {
    const data = await restRequest("story", "POST", story);
    return data?.name;
  }
  throw new Error("Firebase is not configured");
}


async function uploadToCloudinaryFromInput(input) {
  const raw = safeString(input.mediaDataUri || input.dataUri || input.base64DataUri, 12000000);
  if (!raw) return null;
  if (!/^data:(image|video)\//i.test(raw)) {
    throw new Error("mediaDataUri must be a valid image/video data URI");
  }

  const mediaType = /^data:video\//i.test(raw) ? "video" : "image";
  const form = new FormData();
  form.append("file", raw);
  form.append("upload_preset", CLOUDINARY_UNSIGNED_PRESET);
  if (CLOUDINARY_STORY_UPLOAD_FOLDER) form.append("folder", CLOUDINARY_STORY_UPLOAD_FOLDER);
  form.append("tags", "mycity,story_upload,ai_generated");
  form.append("context", [
    "source=mycity_ai_story_endpoint",
    "publisher=story_publisher_independent",
    "userId=" + OWNER.userId
  ].join("|"));

  const endpoint = "https://api.cloudinary.com/v1_1/" +
    encodeURIComponent(CLOUDINARY_CLOUD_NAME) + "/" + mediaType + "/upload";

  const response = await fetch(endpoint, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.secure_url) {
    throw new Error("Cloudinary upload failed: " + safeString(data?.error?.message || response.status, 300));
  }

  return {
    mediaType,
    secureUrl: safeString(data.secure_url, 4000),
    thumbnailUrl: mediaType === "video"
      ? safeString(String(data.secure_url).replace(/\.[a-z0-9]+(?:\?.*)?$/i, ".jpg"), 4000)
      : safeString(data.secure_url, 4000),
    publicId: safeString(data.public_id, 500),
    assetId: safeString(data.asset_id, 500),
    resourceType: safeString(data.resource_type || mediaType, 50),
    width: Number(data.width || 0) || 0,
    height: Number(data.height || 0) || 0,
    bytes: Number(data.bytes || 0) || 0,
    format: safeString(data.format, 50)
  };
}

async function resolveStoryMediaInput(input) {
  const uploaded = await uploadToCloudinaryFromInput(input);
  if (!uploaded) return input;

  return {
    ...input,
    mediaType: uploaded.mediaType,
    mediaUrl: uploaded.secureUrl,
    imageUrl: uploaded.mediaType === "image" ? uploaded.secureUrl : uploaded.thumbnailUrl,
    videoUrl: uploaded.mediaType === "video" ? uploaded.secureUrl : "",
    thumbnailUrl: uploaded.thumbnailUrl,
    cloudinarySecureUrl: uploaded.secureUrl,
    cloudinaryPublicId: uploaded.publicId,
    cloudinaryAssetId: uploaded.assetId,
    cloudinaryResourceType: uploaded.resourceType,
    cloudinaryWidth: uploaded.width,
    cloudinaryHeight: uploaded.height,
    cloudinaryBytes: uploaded.bytes,
    cloudinaryFormat: uploaded.format
  };
}

function idempotencyPath(requestId) {
  return `aiStoryRequests/${requestId.replace(/[.#$\/\[\]]/g, "_")}`;
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    service: "mycity-story-endpoint",
    firebaseConfigured: firebaseMode !== "none",
    firebaseMode,
    publishEnabled: ALLOW_PUBLISH,
    owner: { userId: OWNER.userId, fullName: OWNER.fullName }
  });
});

app.post("/ai/story", requireApiKey, async (req, res) => {
  try {
    const rawInput = req.body || {};
    const requestId = safeString(rawInput.requestId, 200);

    if (requestId) {
      const prior = await firebaseGet(idempotencyPath(requestId));
      if (prior?.storyId) {
        return res.status(200).json({ ok: true, duplicate: true, ...prior });
      }
    }

    const input = await resolveStoryMediaInput(rawInput);
    const { story, status, mediaType } = buildStoryPayload(input);
    const storyId = await createStoryRecord(story);
    if (!storyId) throw new Error("Firebase did not return a story id");

    if (status === "published") {
      const record = vitrineRecord(storyId, story);
      const userKey = OWNER.userId.replace(/[.#$\/\[\]]/g, "_");
      const updates = {
        [`/${VITRINE_ROOT}/${storyId}`]: record,
        [`/${VITRINE_FEED}/${storyId}`]: record,
        [`/${VITRINE_BY_USER}/${userKey}/${storyId}`]: record
      };
      await firebaseRootPatch(updates);
    }

    const result = {
      storyId,
      status,
      mediaType,
      userId: OWNER.userId,
      createdAtMs: story.createdAtMs
    };

    if (requestId) {
      await firebaseSet(idempotencyPath(requestId), {
        ...result,
        requestId,
        createdAtMs: Date.now()
      });
    }

    res.status(201).json({ ok: true, duplicate: false, ...result });
  } catch (error) {
    console.error("POST /ai/story failed:", error);
    res.status(500).json({ ok: false, error: safeString(error?.message || error, 500) });
  }
});

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`mycity-story-endpoint listening on ${PORT}; firebaseMode=${firebaseMode}; publishEnabled=${ALLOW_PUBLISH}`);
});
