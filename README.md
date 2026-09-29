# MyCity Story Endpoint

Small Node.js service that reproduces the MyCity Story Publisher data contract for the fixed MyCity account.

## Endpoints

- `GET /health`
- `POST /ai/story` — authenticated with `X-MyCity-Key`
- `POST /ai/personalized-article` — idempotent Cart Ready article publishing, authenticated with `X-MyCity-Key`

The service defaults to **draft-only** mode. Set `ALLOW_PUBLISH=true` only after validating the draft flow.

## Required environment variables

- `FIREBASE_DATABASE_URL=https://mycity-video-story.firebaseio.com`
- `FIREBASE_SERVICE_ACCOUNT_JSON=<Firebase Admin service account JSON>`
- `MYCITY_ENDPOINT_KEY=<long random secret>`
- `MYCITY_USER_ID=629388`
- `MYCITY_USER_NAME=my city`
- `MYCITY_USER_AVATAR=<avatar URL>`

Optional:

- `ALLOW_PUBLISH=false`
- `ALLOW_PUBLIC_RTDB_FALLBACK=false` (keep false for production)
- `PERSONALIZED_ARTICLE_LIMIT=250` (maximum active personalized articles)
- `CLOUDINARY_ARTICLE_UPLOAD_FOLDER=cart-ready/articles`
- `FIREBASE_RELATION_AUTH_TOKEN=<optional RTDB relation token>`
- `PERSONALIZED_ARTICLE_EMAIL_WEBHOOK_URL=<optional post-publication email webhook>`
- `PERSONALIZED_ARTICLE_EMAIL_WEBHOOK_KEY=<optional webhook secret>`

Personalized article requests should include a stable `requestId` or `Idempotency-Key` header. The endpoint writes the article to the canonical vitrine, publisher, feed-summary, and recipient-target nodes, then reads those nodes back before returning `firebaseConfirmed: true`. When the active-article limit is reached, the lowest-engagement article is archived rather than deleted. Email delivery is recorded in `personalizedArticleEmailOutbox` and is dispatched only after Firebase verification when a webhook is configured.

## Example

```bash
curl -X POST https://YOUR-SERVICE.onrender.com/ai/story \
  -H 'content-type: application/json' \
  -H 'x-mycity-key: YOUR_SECRET' \
  -d '{
    "requestId":"garage-example-v1",
    "status":"draft",
    "caption":"Contenido de prueba",
    "mediaType":"image",
    "mediaUrl":"https://example.com/image.jpg",
    "thumbnailUrl":"https://example.com/image.jpg"
  }'
```

## Render

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Recommended region: Ohio
- Plan: Free for initial testing

Never commit Firebase service-account credentials or `MYCITY_ENDPOINT_KEY` to GitHub.

## Cart Ready chat assistant (test user only)

This repository also contains `cart-ready-chat-worker.js`, a separate long-running process for the test conversation between My City (629388) and Cart Ready (433069). It can answer in either direction but ignores its own messages to prevent a reply loop. It uses the Firebase service account to read the chat database and Garage database. It does not run through `npm start` and does not change the story publisher.

Run it as a separate Render Background Worker with build command `npm install` and start command `npm run chat:cart-ready`. Set `FIREBASE_SERVICE_ACCOUNT_JSON` in the worker's private environment, plus `CART_READY_CHAT_ENABLED=true` and `CART_READY_CHAT_TEST_USER_ID=629388`. The ID is required; the worker cannot answer another account. Keep the existing web service environment and start command as they are.

When My City writes to Cart Ready, the worker answers text about inspection status and payment preference. It checks the live Garage status and never approves a vehicle or confirms a charge. When Cart Ready writes to My City, My City answers general process questions without disclosing another user's Garage data. Voice notes and images are marked for human review and receive no automated answer. The UI's existing chat notification webhook is not called by this worker; test replies appear in the chat when opened. Validate the test conversation before any wider release.
