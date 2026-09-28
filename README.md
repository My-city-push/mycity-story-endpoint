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
