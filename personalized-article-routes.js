import crypto from "node:crypto";

export function registerPersonalizedArticleRoutes(app, deps) {
  const { firebaseGet, firebaseRootPatch, safeString, sanitizeUrl, requireApiKey } = deps;

  const CART_READY = Object.freeze({
    userId: "433069",
    fullName: "Cart Ready",
    avatar: "https://classic-user-pict.ww-cdn.com/userpict/image/v1/400x400/50x50/2817182/img/1731983204131_28/image4330697439693373758053959.jpg/"
  });

  const FOLLOWING_DB = "https://following-by-user.firebaseio.com";
  const FOLLOWERS_DB = "https://followers-by-user.firebaseio.com";

  const key = (v) => safeString(v, 300).replace(/[.#$\/\[\]]/g, "_");

  async function rtdb(base, path, method = "GET", body) {
    const url = base + "/" + path.replace(/^\/+|\/+$/g, "") + ".json";
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error("RTDB " + response.status);
    return await response.json();
  }

  async function ensureFollow(recipientUserId) {
    const rid = key(recipientUserId);
    const following = await rtdb(FOLLOWING_DB, "433069/" + rid).catch(() => null);
    const follower = await rtdb(FOLLOWERS_DB, "433069/" + rid).catch(() => null);
    if (following || follower) return { created: false };

    const now = Date.now();
    const writes = await Promise.all([
      rtdb(FOLLOWING_DB, "433069/" + rid, "PUT", {
        id: recipientUserId,
        userId: recipientUserId,
        followedUserId: recipientUserId,
        followerId: "433069",
        createdAt: now,
        updatedAt: now
      }),
      rtdb(FOLLOWERS_DB, rid + "/433069", "PUT", {
        id: "433069",
        userId: "433069",
        followerId: "433069",
        followedUserId: recipientUserId,
        name: CART_READY.fullName,
        avatar: CART_READY.avatar,
        createdAt: now,
        updatedAt: now
      })
    ]);

    const verify = writes.some(Boolean);
    if (!verify) throw new Error("follow_verification_failed");
    return { created: true };
  }

  app.post("/ai/personalized-article", requireApiKey, async (req, res) => {
    try {
      const input = req.body || {};
      const recipientUserId = safeString(input.recipientUserId, 200);
      if (!recipientUserId) return res.status(400).json({ ok: false, error: "recipientUserId required" });

      const follow = await ensureFollow(recipientUserId);
      const publisherKey = key(CART_READY.userId);
      const existing = (await firebaseGet("storyVitrineByUser/" + publisherKey)) || {};
      const rows = Object.entries(existing).filter(([, v]) => v && v.contentType === "article");

      const editorialFingerprint = safeString(input.editorialFingerprint, 300);
      let articleKey = "";
      let prior = null;
      for (const [k, v] of rows) {
        if (
          editorialFingerprint &&
          v.editorialFingerprint === editorialFingerprint &&
          String(v.recipientUserId || "") === recipientUserId
        ) {
          articleKey = k;
          prior = v;
          break;
        }
      }

      if (!articleKey && rows.length >= 20) {
        return res.status(409).json({ ok: false, error: "publisher_article_limit_reached" });
      }

      const now = Date.now();
      if (!articleKey) articleKey = "article_" + now + "_" + crypto.randomBytes(4).toString("hex");

      const title = safeString(input.title || "Cart Ready creó una publicación para ti", 250);
      const caption = safeString(
        input.caption || "Preparamos una recomendación para ayudarte a cuidar mejor tu vehículo.",
        3000
      );
      const mediaUrl = sanitizeUrl(input.mediaUrl || CART_READY.avatar);
      if (!mediaUrl) return res.status(400).json({ ok: false, error: "valid mediaUrl required" });

      const thumbnailUrl = sanitizeUrl(input.thumbnailUrl || mediaUrl) || mediaUrl;
      const summary = input.isArticleSummary !== false;
      const width = Number(input.width || 1200) || 1200;
      const height = Number(input.height || 628) || 628;
      const createdAtMs = Number(prior?.createdAtMs || now);

      const item = {
        id: "media_1",
        index: 0,
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
        uploadStatus: "external"
      };

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
        targeting: {
          version: 1,
          mode: "direct",
          recipientUserId,
          userIds: { [recipientUserId]: true }
        },

        destination: "personalized_campaign",
        contentType: "article",
        publicationKind: "article",
        contentKey: "personalized_article",
        postProductType: "MYCITY_ARTICLE",

        isArticleSummary: summary,
        showInMainFeed: summary,
        displayTarget: summary ? "feed_summary" : "personalized_campaign",
        presentation: summary ? { mediaRatio: "landscape_1_91_1", layout: "editorial_carousel" } : undefined,

        postType: "carousel",
        carousel: true,
        isCarousel: true,
        itemCount: 1,
        items: [item],

        mediaType: "image",
        mediaKind: "image",
        mediaUrl,
        url: mediaUrl,
        imageUrl: mediaUrl,
        videoUrl: "",
        thumbnailUrl,
        thumb: thumbnailUrl,
        width,
        height,
        aspectRatio: width / height,

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
        editorialFingerprint
      };

      Object.keys(article).forEach((k) => article[k] === undefined && delete article[k]);

      const updates = {
        ["/storyVitrine/" + articleKey]: article,
        ["/storyVitrineByUser/" + publisherKey + "/" + articleKey]: article,
        ["/storyVitrineFeed/" + articleKey]: summary ? article : null
      };

      await firebaseRootPatch(updates);

      return res.status(prior ? 200 : 201).json({
        ok: true,
        created: !prior,
        articleId: articleKey,
        publisherUserId: CART_READY.userId,
        recipientUserId,
        autoFollowCreated: follow.created,
        isArticleSummary: summary
      });
    } catch (error) {
      console.error("POST /ai/personalized-article failed:", error);
      return res.status(500).json({ ok: false, error: safeString(error?.message || error, 500) });
    }
  });
}
