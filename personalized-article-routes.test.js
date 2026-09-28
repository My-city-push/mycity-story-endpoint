import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerPersonalizedArticleRoutes } from "./personalized-article-routes.js";

function cleanPath(path) {
  return String(path || "").replace(/^\/+|\/+$/g, "");
}

function getAt(root, path) {
  const parts = cleanPath(path).split("/").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current ?? null;
}

function setAt(root, path, value) {
  const parts = cleanPath(path).split("/").filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  if (!parts.length) return;
  const last = parts.at(-1);
  if (value === null) delete current[last];
  else current[last] = structuredClone(value);
}

function createHarness({ initial = {}, articleLimit = 250, dispatchEmail } = {}) {
  const state = structuredClone(initial);
  const relations = new Map();
  const relationCalls = [];
  const rootPatches = [];
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  registerPersonalizedArticleRoutes(app, {
    articleLimit,
    safeString: (value, max = 5000) => String(value ?? "").trim().slice(0, max),
    sanitizeUrl: (value) => {
      try {
        const url = new URL(String(value || ""));
        return /^https?:$/.test(url.protocol) ? url.toString() : "";
      } catch {
        return "";
      }
    },
    requireApiKey: (_req, _res, next) => next(),
    firebaseGet: async (path) => structuredClone(getAt(state, path)),
    firebaseRootPatch: async (updates) => {
      rootPatches.push(structuredClone(updates));
      for (const [path, value] of Object.entries(updates)) setAt(state, path, value);
    },
    relationRequest: async ({ base, path, method = "GET", body }) => {
      const relationKey = base + "|" + path;
      relationCalls.push({ base, path, method });
      if (method === "PUT") {
        relations.set(relationKey, structuredClone(body));
        return structuredClone(body);
      }
      return structuredClone(relations.get(relationKey) || null);
    },
    uploadArticleCoverFromInput: async () => ({
      secureUrl: "https://res.cloudinary.com/dxnxwaigw/image/upload/cart-ready/articles/test-cover.jpg",
      width: 1200,
      height: 628
    }),
    dispatchPersonalizedArticleEmail: dispatchEmail || (async () => ({ status: "accepted" }))
  });

  return { app, state, relations, relationCalls, rootPatches };
}

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function publish(baseUrl, payload, headers = {}) {
  const response = await fetch(baseUrl + "/ai/personalized-article", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: await response.json() };
}

test("publishes and verifies the canonical direct-article contract", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    const payload = {
      requestId: "garage-user-100-preventive-v1",
      recipientUserId: "100",
      title: "Protege tus horas productivas",
      caption: "Una revisión preventiva ayuda a evitar tiempo fuera de servicio.",
      mediaDataUri: "data:image/png;base64,ZmFrZQ==",
      editorialFingerprint: "user-100-preventive",
      sourceFingerprint: "garage-100-vehicle-1",
      experimentFamily: "mantenimiento preventivo",
      experimentTopic: "downtime",
      hypothesis: "El usuario responde mejor cuando el mantenimiento protege horas de trabajo.",
      vehicleYearMakeModelNormalized: "2018 Nissan Altima",
      triggerType: "garage_update",
      expectedIntentType: "service_question"
    };

    const first = await publish(baseUrl, payload);
    assert.equal(first.status, 201);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.firebaseConfirmed, true);
    assert.equal(first.body.coverUploaded, true);
    assert.equal(first.body.emailStatus, "accepted");

    const articleId = first.body.articleId;
    const canonical = getAt(harness.state, "storyVitrine/" + articleId);
    assert.equal(canonical.articleId, articleId);
    assert.equal(canonical.recipientUserId, "100");
    assert.equal(canonical.experimentFamily, "mantenimiento preventivo");
    assert.equal(canonical.coverSource, "cloudinary_generated");
    assert.equal(canonical.mediaUrl.startsWith("https://res.cloudinary.com/"), true);
    assert.equal(getAt(harness.state, "storyVitrineFeed/" + articleId).articleId, articleId);
    assert.equal(getAt(harness.state, "storyVitrineByUser/433069/" + articleId).articleId, articleId);
    assert.equal(getAt(harness.state, "storyVitrineTargetByUser/100/" + articleId).articleId, articleId);
    assert.equal(getAt(harness.state, "personalizedArticleEmailOutbox/" + articleId).status, "accepted");
    assert.equal(getAt(harness.state, "personalizedArticleRequests/garage-user-100-preventive-v1").firebaseConfirmed, true);

    const replay = await publish(baseUrl, payload);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.articleId, articleId);
    assert.equal(Object.keys(getAt(harness.state, "storyVitrine")).length, 1);
  });
});

test("archives the lowest-engagement active article instead of deleting it", async () => {
  const baseArticle = {
    contentType: "article",
    active: true,
    public: true,
    isPublished: true,
    publicationStatus: "published"
  };
  const harness = createHarness({
    articleLimit: 2,
    initial: {
      storyVitrine: {
        low: { ...baseArticle, articleId: "low", recipientUserId: "200", createdAtMs: 1 },
        high: { ...baseArticle, articleId: "high", recipientUserId: "201", likesCount: 20, createdAtMs: 2 }
      },
      storyVitrineFeed: {
        low: { ...baseArticle, articleId: "low", recipientUserId: "200" },
        high: { ...baseArticle, articleId: "high", recipientUserId: "201" }
      },
      storyVitrineByUser: {
        "433069": {
          low: { ...baseArticle, articleId: "low", recipientUserId: "200", createdAtMs: 1 },
          high: { ...baseArticle, articleId: "high", recipientUserId: "201", likesCount: 20, createdAtMs: 2 }
        }
      },
      storyVitrineTargetByUser: {
        "200": { low: { ...baseArticle, articleId: "low", recipientUserId: "200" } },
        "201": { high: { ...baseArticle, articleId: "high", recipientUserId: "201" } }
      }
    }
  });

  await withServer(harness.app, async (baseUrl) => {
    const result = await publish(baseUrl, {
      requestId: "limit-replacement-v1",
      recipientUserId: "202",
      title: "Nueva señal",
      caption: "Nueva publicación",
      editorialFingerprint: "limit-replacement",
      emailNotificationRequested: false
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.archivedArticleId, "low");
    assert.equal(getAt(harness.state, "storyVitrine/low").publicationStatus, "archived");
    assert.equal(getAt(harness.state, "storyVitrineByUser/433069/low").active, false);
    assert.equal(getAt(harness.state, "storyVitrineFeed/low"), null);
    assert.equal(getAt(harness.state, "storyVitrineTargetByUser/200/low"), null);
    assert.equal(getAt(harness.state, "storyVitrine/high").publicationStatus, "published");
  });
});

test("repairs a one-sided follow relationship and updates an existing fingerprint", async () => {
  const existing = {
    articleId: "existing",
    contentType: "article",
    active: true,
    isPublished: true,
    publicationStatus: "published",
    recipientUserId: "300",
    editorialFingerprint: "same-topic",
    createdAtMs: 123,
    likesCount: 4
  };
  const harness = createHarness({
    initial: {
      storyVitrine: { existing },
      storyVitrineByUser: { "433069": { existing } },
      storyVitrineTargetByUser: { "300": { existing } }
    }
  });
  harness.relations.set("https://following-by-user.firebaseio.com|433069/300", { userId: "300" });

  await withServer(harness.app, async (baseUrl) => {
    const result = await publish(baseUrl, {
      recipientUserId: "300",
      title: "Título actualizado",
      caption: "Contenido actualizado",
      editorialFingerprint: "same-topic",
      emailNotificationRequested: false
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.created, false);
    assert.equal(result.body.articleId, "existing");
    assert.equal(result.body.followRecordsRepaired, 1);
    assert.equal(getAt(harness.state, "storyVitrine/existing").createdAtMs, 123);
    assert.equal(getAt(harness.state, "storyVitrine/existing").likesCount, 4);
    assert.equal(getAt(harness.state, "storyVitrine/existing").title, "Título actualizado");
  });
});

test("recovers an incomplete idempotent request instead of accepting a partial publish", async () => {
  const article = {
    articleId: "article_recovery",
    contentType: "article",
    active: true,
    isPublished: true,
    publicationStatus: "published",
    isArticleSummary: true,
    recipientUserId: "400",
    createdAtMs: 123
  };
  const harness = createHarness({
    initial: {
      storyVitrine: { article_recovery: article },
      storyVitrineFeed: { article_recovery: article },
      storyVitrineByUser: { "433069": { article_recovery: article } },
      personalizedArticleRequests: {
        recovery_v1: {
          requestId: "recovery_v1",
          articleId: "article_recovery",
          recipientUserId: "400",
          firebaseConfirmed: false
        }
      }
    }
  });

  await withServer(harness.app, async (baseUrl) => {
    const result = await publish(baseUrl, {
      requestId: "recovery_v1",
      recipientUserId: "400",
      title: "Publicación recuperada",
      caption: "Se completan los nodos que faltaban.",
      emailNotificationRequested: false
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.replayed, false);
    assert.equal(result.body.recovered, true);
    assert.equal(result.body.firebaseConfirmed, true);
    assert.equal(result.body.articleId, "article_recovery");
    assert.equal(getAt(harness.state, "storyVitrineTargetByUser/400/article_recovery").articleId, "article_recovery");
    assert.equal(getAt(harness.state, "personalizedArticleRequests/recovery_v1").firebaseConfirmed, true);
  });
});

test("reactivating an archived fingerprint preserves the active limit", async () => {
  const active = {
    articleId: "active",
    contentType: "article",
    active: true,
    isPublished: true,
    publicationStatus: "published",
    recipientUserId: "500",
    createdAtMs: 1
  };
  const archived = {
    articleId: "archived",
    contentType: "article",
    active: false,
    isPublished: false,
    publicationStatus: "archived",
    recipientUserId: "501",
    editorialFingerprint: "reactivate-topic",
    createdAtMs: 2
  };
  const harness = createHarness({
    articleLimit: 1,
    initial: {
      storyVitrine: { active, archived },
      storyVitrineFeed: { active },
      storyVitrineByUser: { "433069": { active, archived } },
      storyVitrineTargetByUser: {
        "500": { active },
        "501": { archived }
      }
    }
  });

  await withServer(harness.app, async (baseUrl) => {
    const result = await publish(baseUrl, {
      recipientUserId: "501",
      title: "Tema reactivado",
      caption: "Nueva versión",
      editorialFingerprint: "reactivate-topic",
      emailNotificationRequested: false
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.articleId, "archived");
    assert.equal(result.body.archivedArticleId, "active");
    assert.equal(getAt(harness.state, "storyVitrine/active").publicationStatus, "archived");
    assert.equal(getAt(harness.state, "storyVitrine/archived").publicationStatus, "published");
  });
});

test("rejects an invalid generated cover before creating follow records", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    const result = await publish(baseUrl, {
      recipientUserId: "600",
      title: "Sin portada",
      coverGenerated: true,
      emailNotificationRequested: false
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "Generated article cover requires a Cloudinary image URL");
    assert.equal(harness.relationCalls.length, 0);
  });
});
