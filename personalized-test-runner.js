const enabled = /^true$/i.test(String(process.env.RUN_PERSONALIZED_TEST_ONCE || "false"));

async function main() {
  if (!enabled) return;

  const raw = String(process.env.PERSONALIZED_ARTICLE_PAYLOAD_JSON || "").trim();
  if (!raw) throw new Error("PERSONALIZED_ARTICLE_PAYLOAD_JSON is required");

  const key = String(process.env.MYCITY_ENDPOINT_KEY || "").trim();
  if (!key) throw new Error("MYCITY_ENDPOINT_KEY is required");

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error("PERSONALIZED_ARTICLE_PAYLOAD_JSON is invalid JSON");
  }

  const port = Number(process.env.PORT || 10000);
  const url = `http://127.0.0.1:${port}/ai/personalized-article`;

  // Give the parent Express listener a brief moment to finish accepting connections.
  await new Promise((resolve) => setTimeout(resolve, 350));

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
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok || !body?.ok) {
    console.error("PERSONALIZED_ARTICLE_ONCE_FAILED", JSON.stringify({ status: response.status, body }));
    process.exitCode = 1;
    return;
  }

  console.log("PERSONALIZED_ARTICLE_ONCE_SUCCESS", JSON.stringify(body));
}

main().catch((error) => {
  console.error("PERSONALIZED_ARTICLE_ONCE_FAILED", error?.message || error);
  process.exitCode = 1;
});
