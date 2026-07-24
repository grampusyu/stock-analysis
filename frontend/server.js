const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const httpProxy = require("http-proxy");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000");
const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

const app = next({ dev });
const handle = app.getRequestHandler();
const proxy = httpProxy.createProxyServer({ ws: true });

proxy.on("error", (err, req, res) => {
  if (res && res.writeHead && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Backend unavailable" }));
  }
});

app.prepare().then(() => {
  // Next.js 내부 WebSocket 업그레이드 핸들러 (HMR 등)
  const upgradeHandler =
    typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    if (parsedUrl.pathname.startsWith("/api/")) {
      proxy.web(req, res, { target: BACKEND });
    } else {
      handle(req, res, parsedUrl);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/api/")) {
      // 백엔드 실시간 WebSocket 프록시
      proxy.ws(req, socket, head, { target: BACKEND });
    } else if (upgradeHandler) {
      // Next.js HMR / 내부 WebSocket 처리
      upgradeHandler(req, socket, head);
    }
    // upgradeHandler 없으면 무시 (연결이 자연히 닫힘)
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
