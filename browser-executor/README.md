# My City browser executor — pilot

Dedicated headed Chromium session and authenticated noVNC desktop. Processes only already linked commercial pause/activate requests, serially, through the protected operator queue. Never edits offers or inspection notifications.

Deploy as a Docker web service in Ohio, 1 CPU/2 GB, one instance, with a 1 GB persistent disk mounted at `/data`. Dockerfile and context: `browser-executor/`. Health check `/healthz`.

Required configuration:
- `EXECUTOR_ADMIN_PASSWORD`: a user-chosen strong password of at least 24 characters, entered privately in Render. HTTP Basic username `mycity`. This authorizes access to the GoodBarber desktop; do not share it in chat.
- `PROMOTION_GEOFENCE_OPERATOR_KEY`: existing queue operator key, copied privately server-side only after access is approved.
- `PROMOTION_SERVER_URL`: `https://mycity-story-endpoint.onrender.com`.
- `EXECUTOR_DATA_DIR`: `/data`.

Starts disabled. Open the protected service URL, open its desktop, sign into GoodBarber yourself, then press Enable. Disable before manually changing the browser. Only one operator may work at a time. Never operate the same queue manually while this executor is enabled.

If authentication expires, a UI operation is blocked, or verification fails, the executor stops. A journal records an in-flight claim before any mutation; on restart it stays stopped until an operator inspects that job. It never expires locks or retries ambiguous mutations automatically. Results must be read back from the persisted GoodBarber UI before completion is sent to the account chat. Screenshots remain on the private disk. Session files and journal must never be published.

Not yet validated against a real signed-in server browser. No promise of uninterrupted sessions or notification delivery.

## Creation flow
Checkout-approved map coordinates support new commercial locations, entry/exit/dwell triggers, always-on timing and the checkout repeat options. The workflow reads back stored geometry, message, destination and repeat settings, pauses preparation, then lets the existing queue issue activation. Submission is journaled before clicking; ambiguous creates are never automatically resubmitted. A retained creation requires operator review. The pilot environment variable can authorize the single specified pending checkout job for the first integration test.
