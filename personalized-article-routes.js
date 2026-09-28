import crypto from "node:crypto";

const CART_READY = Object.freeze({
  userId: "433069",
  fullName: "Cart Ready",
  avatar: "https://classic-user-pict.ww-cdn.com/userpict/image/v1/400x400/50x50/2817182/img/1731983204131_28/image4330697439693373758053959.jpg/"
});

const FOLLOWING_DB = "https://following-by-user.firebaseio.com";
const FOLLOWERS_DB = "https://followers-by-user.firebaseio.com";
const ARTICLE_REQUEST_ROOT = "personalizedArticleRequests";
const EMAIL_OUTBOX_ROOT = "personalizedArticleEmailOutbox";
const STORY_URL = "https://www.mycity.city/story-desarrollo";

function isActiveArticle(value) {
  return Boolean(
    value &&
    value.contentType === "article" &&
    value.active !== false &&
    value.isPublished !== false &&
    !["archived", "deleted", "unpublished"].includes(String(value.publicationStatus || "").toLowerCase())
  );
}

function engagementScore(value) {
  const likes = Number(value?.likesCount || 0);
  const comments = Number(value?.commentsCount || 0);
  const shares = Number(value?.sharesCount || 0) + Number(value?.repostsCount || 0);
  const views = Number(value?.viewsCount || 0);
  return likes * 5 + comments * 8 + shares * 10 + Math.min(views, 100) * 0.05;
}

function archiveCandidate(rows) {
  return rows
    .map(([key, value]) => ({
      key,
      value,
      score: engagementScore(value),
      createdAtMs: Number(value?.createdAtMs || value?.publishedAtMs || 0)
    }))
    .sort((a, b) => {
      const aEngaged = a.score === 0 ? 0 : 1;
      const bEngaged = b.score === 0 ? 0 : 1;
      if (aEngaged !== bEngaged) return aEngaged - bEngaged;
      if (a.score !== b.score) return a.score - b.score;
      return a.createdAtMs - b.createdAtMs;
    })[0] || null;
}

function isCloudinaryUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "res.cloudinary.com";
  } catch {
    return false;
  }
}

function sameUrl(a, b) {
  return String(a || "").replace(/\/+$/, "") === String(b || "").replace(/\/+$/, "");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function registerPersonalizedArticleRoutes(app, deps) {
  const {
    firebaseGet,
    firebaseRootPatch,
    safeString,
    sanitizeUrl,
    requireApiKey,
    uploadArticleCoverFromInput,
    dispatchPersonalizedArticleEmail
  } = deps;

  const key = (value) => safeString(value, 300).replace(/[.#$\/\[\]]/g, "_");
  const configuredLimit = Number(deps.articleLimit ?? process.env.PERSONALIZED_ARTICLE_LIMIT ?? 250);
  const articleLimit = Math.max(1, Math.min(1000, Number.isFinite(configuredLimit) ? configuredLimit : 250));
  const relationAuthToken = safeString(process.env.FIREBASE_RELATION_AUTH_TOKEN, 4000);

  async function defaultRelationRequest({ base, path, method = "GET", body }) {
    const url = new URL(base + "/" + path.replace(/^\/+|\/+$/g, "") + ".json");
    if (relationAuthToken) url.searchParams.set("auth", relationAuthToken);
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error("RTDB " + response.status);
    return await response.json();
  }

  const relationRequest = deps.relationRequest || defaultRelationRequest;

  async function ensureFollow(recipientUserId) {
    const recipientKey = key(recipientUserId);
    const followingPath = CART_READY.userId + "/" + recipientKey;
    const followerPath = recipientKey + "/" + CART_READY.userId;
    const [following, follower] = await Promise.all([
      relationRequest({ base: FOLLOWING_DB, path: followingPath }),
      relationRequest({ base: FOLLOWERS_DB, path: followerPath })
    ]);

    const now = Date.now();
    const writes = [];
    if (!following) {
      writes.push(relationRequest({
        base: FOLLOWING_DB,
        path: followingPath,
        method: "PUT",
        body: {
          id: recipientUserId,
          userId: recipientUserId,
          followedUserId: recipientUserId,
          followerId: CART_READY.userId,
          createdAt: now,
          updatedAt: now
        }
      }));
    }
    if (!follower) {
      writes.push(relationRequest({
        base: FOLLOWERS_DB,
        path: followerPath,
        method: "PUT",
        body: {
          id: CART_READY.userId,
          userId: CART_READY.userId,
          followerId: CART_READY.userId,
          followedUserId: recipientUserId,
          name: CART_READY.fullName,
          avatar: CART_READY.avatar,
          createdAt: now,
          updatedAt: now
        }
      }));
    }
    if (writes.length) await Promise.all(writes);

    const [verifiedFollowing, verifiedFollower] = await Promise.all([
      relationRequest({ base: FOLLOWING_DB, path: followingPath }),
      relationRequest({ base: FOLLOWERS_DB, path: followerPath })
    ]);
    if (!verifiedFollowing || !verifiedFollower) throw new Error("follow_verification_failed");
    return { created: writes.length > 0, repairedRecords: writes.length };
  }

  app.post("/ai/personalized-article", requireApiKey, async (req, res) => {
    try {
      const input = req.body || {};
      const recipientUserId = safeString(input.recipientUserId, 200);
      if (!recipientUserId) throw httpError(400, "recipientUserId required");

      const requestId = safeString(input.requestId || req.get("idempotency-key"), 200);
      const requestKey = requestId ? key(requestId) : "";
      const requestPath = requestKey ? ARTICLE_REQUEST_ROOT + "/" + requestKey : "";
      let recoveryArticleKey = "";
      let recoveryPrior = null;
      if (requestPath) {
        const previousRequest = await firebaseGet(requestPath);
        if (previousRequest?.articleId) {
          const previousArticleKey = key(previousRequest.articleId);
          const previousArticle = await firebaseGet("storyVitrine/" + previousArticleKey);
          if (previousArticle) {
            const previousRecipientKey = key(previousArticle.recipientUserId || recipientUserId);
            const previousConfirmationPaths = [
              "storyVitrineByUser/" + key(CART_READY.userId) + "/" + previousArticleKey,
              "storyVitrineTargetByUser/" + previousRecipientKey + "/" + previousArticleKey
            ];
            if (previousArticle.isArticleSummary !== false) {
              previousConfirmationPaths.push("storyVitrineFeed/" + previousArticleKey);
            }
            const previousConfirmations = await Promise.all(
              previousConfirmationPaths.map((path) => firebaseGet(path))
            );
            const fullyPublished = previousConfirmations.every(
              (value) => value && value.articleId === previousArticleKey
            );
            if (fullyPublished && previousRequest.firebaseConfirmed === true) {
              return res.status(200).json({
                ...previousRequest,
                ok: true,
                replayed: true,
                firebaseConfirmed: true
              });
            }
            recoveryArticleKey = previousArticleKey;
            recoveryPrior = previousArticle;
          }
        }
      }

      const publisherKey = key(CART_READY.userId);
      const existing = (await firebaseGet("storyVitrineByUser/" + publisherKey)) || {};
      const rows = Object.entries(existing).filter(([, value]) => value && value.contentType === "article");
      const activeRows = rows.filter(([, value]) => isActiveArticle(value));

      const editorialFingerprint = safeString(input.editorialFingerprint, 300);
      let articleKey = recoveryArticleKey;
      let prior = recoveryPrior;
      if (!articleKey) {
        for (const [existingKey, value] of rows) {
          if (
            editorialFingerprint &&
            value.editorialFingerprint === editorialFingerprint &&
            String(value.recipientUserId || "") === recipientUserId
          ) {
            articleKey = existingKey;
            prior = value;
            break;
          }
        }
      }

      const needsActiveSlot = !prior || !isActiveArticle(prior);
      const archivePool = activeRows.filter(([existingKey]) => existingKey !== articleKey);
      const articleToArchive = needsActiveSlot && archivePool.length >= articleLimit
        ? archiveCandidate(archivePool)
        : null;

      const now = Date.now();
      if (!articleKey) {
        articleKey = requestId
          ? "article_" + crypto.createHash("sha256").update("personalized:" + requestId).digest("hex").slice(0, 20)
          : "article_" + now + "_" + crypto.randomBytes(4).toString("hex");
      }

      const title = safeString(input.title || "Cart Ready creó una publicación para ti", 250);
      const caption = safeString(
        input.caption || "Preparamos una recomendación para ayudarte a cuidar mejor tu vehículo.",
        3000
      );

      const inputMediaUrls = Array.isArray(input.mediaUrls) ? input.mediaUrls : [];
      const mediaUrls = inputMediaUrls
        .map((url) => sanitizeUrl(url || ""))
        .filter(Boolean)
        .slice(0, 10);
      const singleMediaUrl = sanitizeUrl(input.mediaUrl || "");
      if (!mediaUrls.length && singleMediaUrl) mediaUrls.push(singleMediaUrl);

      let uploadedCover = null;
      if (!mediaUrls.length && (input.mediaDataUri || input.dataUri || input.base64DataUri)) {
        if (typeof uploadArticleCoverFromInput !== "function") {
          throw httpError(503, "Article cover upload is not configured");
        }
        uploadedCover = await uploadArticleCoverFromInput(input);
        if (uploadedCover?.secureUrl) mediaUrls.push(sanitizeUrl(uploadedCover.secureUrl));
      }

      if (mediaUrls.some((url) => sameUrl(url, CART_READY.avatar))) {
        throw httpError(400, "Publisher avatar cannot be used as article media");
      }

      const coverGenerated = Boolean(uploadedCover) || input.coverGenerated === true;
      if (coverGenerated && !mediaUrls.length) {
        throw httpError(400, "Generated article cover requires a Cloudinary image URL");
      }
      if (coverGenerated && mediaUrls.some((url) => !isCloudinaryUrl(url))) {
        throw httpError(400, "Generated article covers must use a Cloudinary URL");
      }

      const inputThumbnailUrls = Array.isArray(input.thumbnailUrls) ? input.thumbnailUrls : [];
      const summary = input.isArticleSummary !== false;
      const width = Math.max(1, Number(input.width || uploadedCover?.width || 1200) || 1200);
      const height = Math.max(1, Number(input.height || uploadedCover?.height || 628) || 628);
      const createdAtMs = Number(prior?.createdAtMs || now);
      const hasMedia = mediaUrls.length > 0;
      const items = mediaUrls.map((mediaUrl, index) => {
        const requestedThumb = sanitizeUrl(
          inputThumbnailUrls[index] || (index === 0 ? input.thumbnailUrl : "") || mediaUrl
        );
        const thumbnailUrl = requestedThumb || mediaUrl;
        return {
          id: "media_" + (index + 1),
          index,
          mediaKind: "image",
          mediaType: "image/jpeg",
          mediaUrl,
          mediaDeliveryUrl: mediaUrl,
          imageUrl: mediaUrl,
          videoUrl: "",
          thumbnailUrl,
          width,
          height,
          aspectRatio: width / height,
          uploadStatus: uploadedCover && index === 0 ? "uploaded" : "external"
        };
      });
      const primaryItem = items[0] || null;

      const article = {
        id: articleKey,
        key: articleKey,
        storyId: articleKey,
        storyKey: articleKey,
        gid: articleKey,
        articleId: articleKey,
        campaignId: articleKey,
        userId: CART_READY.userId,
        ownerUserId: CART_READY.userId,
        fullName: CART_READY.fullName,
        ownerName: CART_READY.fullName,
        userName: CART_READY.fullName,
        avatar: CART_READY.avatar,
        ownerAvatar: CART_READY.avatar,
        title,
        caption,
        description: caption,
        audience: "direct",
        audienceMode: "direct",
        audienceUserIds: { [recipientUserId]: true },
        recipientUserId,
        visibility: { version: 1, mode: "direct", userIds: { [recipientUserId]: true } },
        targeting: { version: 1, mode: "direct", recipientUserId, userIds: { [recipientUserId]: true } },
        destination: "personalized_campaign",
        contentType: "article",
        publicationKind: "article",
        contentKey: "personalized_article",
        postProductType: "MYCITY_ARTICLE",
        isArticleSummary: summary,
        showInMainFeed: summary,
        displayTarget: summary ? "feed_summary" : "personalized_campaign",
        presentation: summary ? { mediaRatio: "landscape_1_91_1", layout: "editorial_carousel" } : undefined,
        postType: hasMedia ? "carousel" : "article",
        carousel: hasMedia,
        isCarousel: hasMedia,
        itemCount: items.length,
        items,
        mediaType: hasMedia ? "image" : "",
        mediaKind: hasMedia ? "image" : "",
        mediaUrl: primaryItem?.mediaUrl || "",
        url: primaryItem?.mediaUrl || "",
        imageUrl: primaryItem?.imageUrl || "",
        videoUrl: "",
        thumbnailUrl: primaryItem?.thumbnailUrl || "",
        thumb: primaryItem?.thumbnailUrl || "",
        width: hasMedia ? width : 0,
        height: hasMedia ? height : 0,
        aspectRatio: hasMedia ? width / height : 0,
        likesCount: Number(prior?.likesCount || 0),
        commentsCount: Number(prior?.commentsCount || 0),
        repostsCount: Number(prior?.repostsCount || 0),
        sharesCount: Number(prior?.sharesCount || 0),
        viewsCount: Number(prior?.viewsCount || 0),
        createdAtMs,
        publishedAtMs: createdAtMs,
        updatedAtMs: now,
        active: true,
        public: true,
        isPublished: true,
        publicationStatus: "published",
        notificationEnabled: false,
        origin: "automation",
        publisherSource: "personalized_content_automation",
        source: "mycity_automated_article",
        sourceFingerprint: safeString(input.sourceFingerprint, 300),
        editorialFingerprint,
        experimentFamily: safeString(input.experimentFamily, 120),
        experimentTopic: safeString(input.experimentTopic, 240),
        hypothesis: safeString(input.hypothesis, 1200),
        vehicleYearMakeModelNormalized: safeString(input.vehicleYearMakeModelNormalized, 240),
        triggerType: safeString(input.triggerType, 120),
        expectedIntentType: safeString(input.expectedIntentType, 120),
        visualTheme: safeString(input.visualTheme, 120),
        visualPrompt: safeString(input.visualPrompt, 1200),
        coverSource: uploadedCover ? "cloudinary_generated" : safeString(input.coverSource, 120),
        coverGenerated
      };

      Object.keys(article).forEach((field) => article[field] === undefined && delete article[field]);

      const follow = await ensureFollow(recipientUserId);
      const recipientKey = key(recipientUserId);
      const emailRequested = input.emailNotificationRequested !== false;
      const updates = {
        ["/storyVitrine/" + articleKey]: article,
        ["/storyVitrineByUser/" + publisherKey + "/" + articleKey]: article,
        ["/storyVitrineFeed/" + articleKey]: summary ? article : null,
        ["/storyVitrineTargetByUser/" + recipientKey + "/" + articleKey]: article
      };

      if (articleToArchive && articleToArchive.key !== articleKey) {
        const archived = {
          ...articleToArchive.value,
          active: false,
          public: false,
          isPublished: false,
          publicationStatus: "archived",
          archivedAtMs: now,
          updatedAtMs: now
        };
        const archivedRecipient = key(articleToArchive.value?.recipientUserId || "");
        updates["/storyVitrine/" + articleToArchive.key] = archived;
        updates["/storyVitrineByUser/" + publisherKey + "/" + articleToArchive.key] = archived;
        updates["/storyVitrineFeed/" + articleToArchive.key] = null;
        if (archivedRecipient) {
          updates["/storyVitrineTargetByUser/" + archivedRecipient + "/" + articleToArchive.key] = null;
        }
      }

      if (emailRequested) {
        updates["/" + EMAIL_OUTBOX_ROOT + "/" + articleKey] = {
          articleId: articleKey,
          recipientUserId,
          publisherUserId: CART_READY.userId,
          title,
          heroUrl: primaryItem?.mediaUrl || "",
          ctaUrl: STORY_URL,
          status: "pending",
          requestId,
          createdAtMs: now,
          updatedAtMs: now
        };
      }

      if (requestPath) {
        updates["/" + requestPath] = {
          requestId,
          articleId: articleKey,
          publisherUserId: CART_READY.userId,
          recipientUserId,
          status: prior ? "updated" : "published",
          firebaseConfirmed: false,
          emailStatus: emailRequested ? "queued" : "omitted",
          createdAtMs: now,
          updatedAtMs: now
        };
      }

      await firebaseRootPatch(updates);

      const confirmationPaths = [
        "storyVitrine/" + articleKey,
        "storyVitrineByUser/" + publisherKey + "/" + articleKey,
        "storyVitrineTargetByUser/" + recipientKey + "/" + articleKey
      ];
      if (summary) confirmationPaths.push("storyVitrineFeed/" + articleKey);
      const confirmations = await Promise.all(confirmationPaths.map((path) => firebaseGet(path)));
      if (confirmations.some((value) => !value || value.articleId !== articleKey)) {
        throw new Error("article_verification_failed");
      }

      let emailStatus = emailRequested ? "queued" : "omitted";
      let emailError = "";
      if (emailRequested && typeof dispatchPersonalizedArticleEmail === "function") {
        try {
          const delivery = await dispatchPersonalizedArticleEmail({
            articleId: articleKey,
            recipientUserId,
            publisherUserId: CART_READY.userId,
            title,
            heroUrl: primaryItem?.mediaUrl || "",
            ctaUrl: STORY_URL,
            requestId
          });
          emailStatus = safeString(delivery?.status || "accepted", 40);
        } catch (error) {
          emailStatus = "failed";
          emailError = safeString(error?.message || error, 500);
        }
      }

      const completionUpdates = {};
      if (emailRequested) {
        completionUpdates["/" + EMAIL_OUTBOX_ROOT + "/" + articleKey + "/status"] = emailStatus;
        completionUpdates["/" + EMAIL_OUTBOX_ROOT + "/" + articleKey + "/updatedAtMs"] = Date.now();
        if (emailError) completionUpdates["/" + EMAIL_OUTBOX_ROOT + "/" + articleKey + "/error"] = emailError;
      }
      if (requestPath) {
        completionUpdates["/" + requestPath + "/firebaseConfirmed"] = true;
        completionUpdates["/" + requestPath + "/emailStatus"] = emailStatus;
        completionUpdates["/" + requestPath + "/updatedAtMs"] = Date.now();
      }
      if (Object.keys(completionUpdates).length) await firebaseRootPatch(completionUpdates);

      return res.status(prior ? 200 : 201).json({
        ok: true,
        created: !prior,
        replayed: false,
        recovered: Boolean(recoveryArticleKey),
        status: prior ? "updated" : "published",
        firebaseConfirmed: true,
        articleId: articleKey,
        publisherUserId: CART_READY.userId,
        recipientUserId,
        requestId: requestId || null,
        autoFollowCreated: follow.created,
        followRecordsRepaired: follow.repairedRecords,
        isArticleSummary: summary,
        archivedArticleId: articleToArchive?.key || null,
        articleLimit,
        activeArticleCountBefore: activeRows.length,
        coverUploaded: Boolean(uploadedCover),
        emailStatus
      });
    } catch (error) {
      console.error("POST /ai/personalized-article failed:", error);
      const status = Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
      return res.status(status).json({ ok: false, error: safeString(error?.message || error, 500) });
    }
  });
}

export const personalizedArticleInternals = {
  archiveCandidate,
  engagementScore,
  isActiveArticle,
  isCloudinaryUrl
};
