// Static file server for the Playwright E2E suite (no dependencies).
// Serves the repo root so /tests/e2e/harness/index.html and the built
// /dist-harness/* assets resolve under one origin. Started automatically
// by playwright.config.ts (webServer); also usable standalone:
//   node scripts/e2e-serve.mjs
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT ?? 4599);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = path.normalize(path.join(root, rel === "" ? "index.html" : rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      throw new Error("path traversal");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`e2e server: http://127.0.0.1:${port}/tests/e2e/harness/index.html`);
});
