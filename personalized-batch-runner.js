const enabled = /^true$/i.test(String(process.env.RUN_PERSONALIZED_BATCH_ONCE || "false"));

async function main() {
  if (!enabled) return;

  const raw = String(process.env.PERSONALIZED_ARTICLE_BATCH_JSON || "").trim();
  if (!raw) throw new Error("PERSONALIZED_ARTICLE_BATCH_JSON is required");

  const key = String(process.env.MYCITY_ENDPOINT_KEY || "").trim();
  if (!key) throw new Error("MYCITY_ENDPOINT_KEY is required");

  let batch;
  try {
    batch = JSON.parse(raw);
  } catch {
    throw new Error("PERSONALIZED_ARTICLE_BATCH_JSON is invalid JSON");
  }

  if (!Array.isArray(batch) || !batch.length) throw new Error("batch must be a non-empty array");
  if (batch.length > 20) throw new Error("batch max is 20");

  const port = Number(process.env.PORT || 10000);
  const url = `http://127.0.0.1:${port}/ai/personalized-article`;
  await new Promise((resolve) => setTimeout(resolve, 450));

  const results = [];
  for (const payload of batch) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mycity-key": key
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    results.push({ status: response.status, body });
    if (!response.ok || !body?.ok) {
      console.error("PERSONALIZED_BATCH_ITEM_FAILED", JSON.stringify({ status: response.status, body, recipientUserId: payload?.recipientUserId }));
      break;
    }
    console.log("PERSONALIZED_BATCH_ITEM_SUCCESS", JSON.stringify(body));
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const ok = results.every((r) => r.status >= 200 && r.status < 300 && r.body?.ok);
  console.log(ok ? "PERSONALIZED_BATCH_SUCCESS" : "PERSONALIZED_BATCH_PARTIAL", JSON.stringify({ count: results.length, results }));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("PERSONALIZED_BATCH_FAILED", error?.message || error);
  process.exitCode = 1;
});
