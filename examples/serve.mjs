/**
 * Tiny zero-dependency static server for the ReTeX playground.
 *
 *   npm run playground      # builds the library, then serves this folder
 *   node examples/serve.mjs # serve only (expects dist/ to already exist)
 *
 * ES module imports (`../dist/index.js`) need HTTP, not `file://`, which is the
 * only reason this exists. Serves the repo root so the page can reach `dist/`.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 5173;
const entry = "/examples/playground.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = entry;
    // Confine every request to the repo root (no `..` traversal).
    const filePath = normalize(join(root, path));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

const noOpen = process.argv.includes("--no-open") || process.env.OPEN === "0";

server.listen(port, () => {
  const url = `http://localhost:${port}${entry}`;
  console.log(`\n  ReTeX playground → ${url}\n  (Ctrl-C to stop)\n`);
  if (noOpen) return;
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" })
    .on("error", () => {})
    .unref();
});
