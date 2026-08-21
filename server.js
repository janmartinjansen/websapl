/**
 * Zero-dependency local static web server for WebSapl testing
 * Usage: node server.js [port]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.argv[2], 10) || 8080;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".cfp": "text/plain",
  ".jmvm": "text/plain",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/" || reqPath === "") {
    reqPath = "/index.html";
  }

  const filePath = path.join(BASE_DIR, reqPath);

  // Prevent path traversal
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "text/plain";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": ext === ".pdf" ? "inline" : "inline",
      "Cache-Control": "no-cache"
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 WebSapl server draait op: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
