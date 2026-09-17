await import("./index.js");

const port = Number(process.env.PORT || 10000);
const apiKey = String(process.env.MYCITY_ENDPOINT_KEY || "");
const requestId = "mycity-endpoint-smoke-test-2026-09-17-01";

setTimeout(async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ai/story`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mycity-key": apiKey
      },
      body: JSON.stringify({
        requestId,
        status: "draft",
        mediaType: "image",
        mediaUrl: "https://userstorage.ww-api.com/userpict/storage/v1/2817182/img/1755398780174_29/image62938842324881721979097225.jpg/",
        caption: "Prueba técnica de integración MyCity. Borrador no publicado.",
        title: "Prueba técnica MyCity",
        aiSource: "chatgpt_smoke_test"
      })
    });
    const text = await response.text();
    console.log(`SELFTEST_HTTP ${response.status} ${text}`);
  } catch (error) {
    console.error("SELFTEST_FAILED", error?.message || error);
  }
}, 2500);
