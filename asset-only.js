import express from "express";
import fs from "node:fs";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const assetBase64 = fs.readFileSync(new URL("./assets/la-fiesta-q30.b64", import.meta.url), "utf8").trim();
const assetBuffer = Buffer.from(assetBase64, "base64");

app.get("/health", (_req, res) => res.json({ ok: true, service: "mycity-assets" }));
app.get("/la-fiesta.jpg", (_req, res) => {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(assetBuffer);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`mycity-assets listening on ${PORT}; bytes=${assetBuffer.length}`);
});
