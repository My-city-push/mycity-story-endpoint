# My City promotion workspace: implementation and remaining activation steps

This change adds a **disabled-by-default** backend and UI for the dedicated promotion section. It does not change normal chats, Cart Ready inspections or existing publication workers. It does not activate live charges, send emails or start a new publication scheduler.

## Implemented

- Authenticated owner-scoped session and messages in `promotionByOwner/{GoodBarberId}` in the existing chat RTDB.
- Server-side verified binding: Firebase Auth UID → GoodBarber ID. Local storage is display context only.
- OpenAI Responses integration that collects business information and drafts campaign content; AI cannot approve verification, start delivery or alter billing.
- Message idempotency, persisted human messages, a distributed conversation lease and a daily model-call cap (60 requests).
- Dedicated photo/video uploads to Cloudinary (marketing material only, 20 MB). Do **not** upload private verification documents to this public media channel.
- Campaign drafts, explicit approval and pause. Changes invalidate draft approval; changing business identity returns verification to pending.
- Result, audience, publication, delivery and business panels reading owner-scoped trusted records. Empty reports show no fabricated engagement.
- Stripe Checkout, Customer Portal and signature-verified subscription lifecycle webhooks, including invoices and async checkout completion. Current subscription state is retrieved for synchronization.
- Account check against Barkpicture `acct_1MbTeWG6HRnTAtal`, configured $9.99 USD monthly price, 14-day first subscription trial. Automatic tax is **not** enabled; confirm tax registration/settings before live launch.

## Required before an authenticated test

1. Provide a real session bridge. The current GoodBarber custom chat exposes local profile fields but no verifiable sign-in token. Do not treat an ID/email read from localStorage as authentication. Implement a trusted GoodBarber account verification flow, then issue a Firebase custom token or other verified session. Firebase authentication credentials and the GoodBarber account must be demonstrably linked.
2. Provision `promotionIdentityByUid/{firebaseUid}` on the server with `{verified:true,goodbarberUserId:"...",name:"...",email:"..."}` after that verification. No public client write access to bindings, billing, events, business verification or promotion owner records. Firebase Rules must deny client writes/reads to these roots; access happens through the server API. The current project's Rules were not audited by this change.
3. On the page, set `window.MYCITY_PROMOTION_CONFIG.getAccessToken` to return the Firebase ID token; `apiBase` must target `/api/promotion` on the Render service when embedded in GoodBarber. Same-origin hosting at `/promotion.html` works without a proxy. Native GoodBarber WebView origin behavior must be tested and narrowly allowed; do not add a wildcard.
4. Configure `OPENAI_API_KEY`, `PROMOTION_AI_MODEL`; use a model supporting Responses JSON Schema. Put credentials in Render, not the frontend or GitHub. The model is intentionally not guessed or selected from stale version information.
5. Enable `PROMOTION_ENABLED=true` only after identity and data access rules are tested. No ordinary chat messages are monitored.

## Stripe activation

Use a separate Stripe sandbox on Barkpicture before live billing. Supply a restricted API key with Customer, Price, Subscription, Checkout Session, Account read and Customer Portal permissions. Configure:

- `PROMOTION_STRIPE_KEY`
- `PROMOTION_STRIPE_ACCOUNT_ID` (the actual sandbox account ID for sandbox tests; Barkpicture's confirmed ID for live)
- `PROMOTION_STRIPE_PRICE_ID` for an active $9.99 USD/month Price
- `PROMOTION_STRIPE_WEBHOOK_SECRET`
- `PROMOTION_PUBLIC_URL`

Webhook URL: `https://mycity-story-endpoint.onrender.com/api/promotion/stripe/webhook`.
Subscribe to checkout completed/async succeeded, customer.subscription created/updated/deleted/paused/resumed and invoice paid/payment_failed. Validate renewal, failed payment, cancellation and replay in a sandbox. Live billing additionally requires `PROMOTION_LIVE_PAYMENTS=true`. Do not enable while the product still lacks delivery.

Existing MCP authorization to manage the Stripe account is not a backend credential. No payment is enabled merely by merging this PR.

## Publication and email work still required

There is deliberately no new dispatcher in this change. `/campaign/actions` with `resume` returns 503; approval stores a reviewed draft without claiming automation is running. Existing personalized article routes hardcode Cart Ready and can create follow relationships. The multi-business dispatcher must instead use the verified author, existing followers/following union and never manufacture a follow relationship to qualify a recipient.

Implement a durable due-job queue with per-owner and per-period quota reservation, idempotent publication/delivery keys, verified author and current campaign approval checks, and rechecks of active Stripe entitlement and business verification. Trial quota is 2 publications; paid quota 8/month. Individual direct deliveries need a separately agreed cap and count, not an unlimited expansion of those 8 posts. Retries and crashes must not double count or duplicate articles. Reuse the canonical direct-article shape from existing tested routes, including recuento support.

Populate `publications`, `deliveries` and `events` only from trusted delivery/engagement workers. Event schema is `{type,recipientId,recipientName,createdAt}`; supported types are app_view, email_delivered, email_open, email_click, interested. Email opens without a confirmed profile match stay unattributed. App views must follow the existing visibility timer. Add pagination/indexes before high-volume use; these first endpoints are suitable for limited test accounts, not unrestricted full-history reporting.

Email campaigns require a verified sending domain/provider, opted-in marketing recipients, suppression/bounce/unsubscribe handling, per-recipient tracked links, confirmed GoodBarber profile matching, and batched delivery. Do not infer marketing consent from follow relationships or chat notification settings.

Business evidence review still needs an administrator workflow; payment never sets verification. Private evidence needs private storage and restricted access.

## Validation

`npm test` includes ownership, authentication, message retries, draft approval invalidation, entitlement expiry, report filtering and raw Stripe webhook tests, alongside the existing Garage/chat tests. Tests use local mocks, not live model requests, charges or mail. Run `npm run check` for syntax checks. Browser/device integration is pending until verified sign-in is available.

## Native GoodBarber authentication

The UI now asks `gb.user.getCurrent` immediately before each API request and sends the native JWT with its user ID. The server POSTs `{jwt,user_id}` to the official Classic `/publicapi/v1/general/auth/{webzine_id}/validate/` endpoint, authenticated with a server-only `token` header. Only HTTP success with `is_anonymous: false` grants owner access. No client name, email, admin flag or decoded JWT is trusted. No native JWT is saved in localStorage. Logout clears the private view; login reloads the current owner.

Configure `PROMOTION_GOODBARBER_APP_ID` and `PROMOTION_GOODBARBER_API_TOKEN` on the server. Never put the Public API token in custom HTML. Native JWT delivery requires App API version 2/3 and a build after September 14, 2026. The Firebase binding flow remains available for an explicitly configured web provider.

Official references: https://app.goodbarber.dev/v2/documentation/ and https://classic.goodbarber.dev/publicapi/v1/documentation/ (machine schemas `/api/schema_v2/` and `/api/schema_v1/`). The Classic example uses `token` in its body while the request schema specifies `jwt`; implementation follows the schema. A real My City native test must confirm this contract before enablement. Validate owner A/B isolation, logout, expired JWT, anonymous rejection, app mismatch and unavailable upstream. Mock tests do not replace that native test.

## Email verification fallback
Implemented in promotion-email-auth.js and commercial chat; disabled pending setup.
Server queries the exact memberships prospect ID and verifies returned user_id.
Only the server-returned email receives the code. Mailbox confirmation does not verify a business.
Codes expire in 10 minutes, allow 5 failures, and are consumed atomically once.
Resend cooldown: 60 seconds; 3/hour and 5/day per account, plus IP limits.
Sessions: 24 hours, browser memory only, server stores token hashes, logout revokes.

Dedicated Make scenario (inactive until tested):
- Custom webhook with API Key authentication via x-make-apikey.
- Filter action = promotion_verification_code, validate fields.
- Existing Gmail connection Push@mycity.city; To = recipientEmail;
  subject: Tu código de verificación de My City; text includes verificationCode,
  expiration in 10 minutes and notice to ignore an unsolicited request.
- Webhook response AFTER successful Gmail send: HTTP 200, application/json,
  {"status":"sent","challengeId":"<mapped challengeId>"}.
  Do not acknowledge delivery before Gmail succeeds.
- Set PROMOTION_VERIFICATION_WEBHOOK_URL and matching KEY privately in Render.
  Use a separate random PROMOTION_EMAIL_AUTH_SECRET of at least 32 characters.
- Audit Firebase rules: promotionAuthChallenges, promotionAuthSessions and
  promotionAuthLimits must deny all client reads/writes. An ancestor true rule
  overrides child denial; relocate auth storage if needed. Establish expiry cleanup.
- Enable only after these checks, exact Cart Ready lookup, and a real delivery test.

POST /api/mycity/email-verification/start {userId}
POST /api/mycity/email-verification/confirm {userId,challengeId,code}
Promotion routes accept Authorization: Promotion <accessToken> and X-MyCity-User-Id.
This does not enable billing, business verification or automatic publication.
