const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
// shell used to wake Render in the system browser
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────
function readConfiguredUrl() {
  try {
    const cfgPath = path.join(__dirname, "app-config.json");
    const raw = fs.readFileSync(cfgPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.startUrl === "string" ? parsed.startUrl.trim() : "";
  } catch {
    return "";
  }
}

const REMOTE_URL = process.env.ELECTRON_START_URL || readConfiguredUrl() || "http://localhost:3000";
const STATIC_DIR = path.join(__dirname, "..", "out");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

function hasLocalBuild() {
  return fs.existsSync(path.join(STATIC_DIR, "index.html"));
}

// ── Static file serving ───────────────────────────────────────────────────────
function resolveStaticFile(pathname) {
  if (pathname === "/") return path.join(STATIC_DIR, "index.html");

  let filePath = path.join(STATIC_DIR, pathname);

  if (!path.extname(filePath)) {
    const htmlPath = filePath + ".html";
    if (fs.existsSync(htmlPath)) return htmlPath;
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) return indexPath;
    return path.join(STATIC_DIR, "index.html");
  }

  return filePath;
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(STATIC_DIR, "index.html"), (err2, fallback) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
        res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

// ── API proxy to remote ───────────────────────────────────────────────────────
function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

function rewriteToRemoteUrl(headerValue, remoteOrigin) {
  if (!headerValue) return undefined;
  try {
    const parsed = new URL(headerValue);
    return remoteOrigin + parsed.pathname + parsed.search;
  } catch {
    return remoteOrigin;
  }
}

function sendProxyError(clientRes, statusCode, message) {
  if (clientRes.headersSent) return;
  clientRes.writeHead(statusCode, { "Content-Type": "application/json" });
  clientRes.end(JSON.stringify({
    success: false,
    error: { code: "PROXY_ERROR", message: message },
    _offline: true,
  }));
}

function proxyApiRequest(clientReq, clientRes) {
  readRequestBody(clientReq)
    .then(function (body) {
      const remoteParsed = new URL(REMOTE_URL);
      const isHttps = remoteParsed.protocol === "https:";
      const transport = isHttps ? https : http;
      const remoteOrigin = remoteParsed.origin;

      const headers = {};
      for (const [key, val] of Object.entries(clientReq.headers)) {
        const lower = key.toLowerCase();
        if (lower === "host" || lower === "connection" || lower === "content-length") continue;
        headers[key] = val;
      }

      // Remote server must see its own host/origin (CSRF + cookies), not 127.0.0.1.
      headers.host = remoteParsed.host;
      headers.origin = remoteOrigin;
      if (clientReq.headers.referer) {
        headers.referer = rewriteToRemoteUrl(clientReq.headers.referer, remoteOrigin);
      }
      headers["x-forwarded-host"] = clientReq.headers.host || "127.0.0.1";
      headers["x-forwarded-proto"] = "http";

      if (body.length > 0) {
        headers["content-length"] = String(body.length);
      }

      const options = {
        hostname: remoteParsed.hostname,
        port: remoteParsed.port || (isHttps ? 443 : 80),
        path: clientReq.url,
        method: clientReq.method,
        headers: headers,
      };

      const proxyReq = transport.request(options, function (proxyRes) {
        const responseHeaders = { ...proxyRes.headers };

        if (responseHeaders["set-cookie"]) {
          const cookies = Array.isArray(responseHeaders["set-cookie"])
            ? responseHeaders["set-cookie"]
            : [responseHeaders["set-cookie"]];
          responseHeaders["set-cookie"] = cookies.map(function (c) {
            return c
              .replace(/;\s*Domain=[^;]+/gi, "")
              .replace(/;\s*Secure/gi, "");
          });
        }

        clientRes.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(clientRes);
      });

      proxyReq.on("timeout", function () {
        proxyReq.destroy();
        sendProxyError(clientRes, 504, "Connection to server timed out. Check your internet and try again.");
      });

      proxyReq.on("error", function (err) {
        console.error("Electron API proxy error:", err.message);
        sendProxyError(
          clientRes,
          502,
          "Could not reach server. Check your internet connection."
        );
      });

      proxyReq.setTimeout(30000);

      if (body.length > 0) {
        proxyReq.write(body);
      }
      proxyReq.end();
    })
    .catch(function (err) {
      console.error("Electron API proxy body read error:", err.message);
      sendProxyError(clientRes, 400, "Invalid request body");
    });
}

// ── API proxy allowlist ─────────────────────────────────────────────────────────
const ALLOWED_API_PREFIXES = [
  "/api/v1/auth/", "/api/v1/dashboard", "/api/v1/cash-position", "/api/v1/treasury",
  "/api/v1/sales", "/api/v1/payments", "/api/v1/expenses", "/api/v1/customers",
  "/api/v1/personal-withdrawals", "/api/v1/haji-transfers", "/api/v1/bank-deposits",
  "/api/v1/suppliers", "/api/v1/supplier-payments", "/api/v1/agents",
  "/api/v1/agent-payments", "/api/v1/shipping-lines", "/api/v1/shipping-line-payments",
  "/api/v1/intermediaries", "/api/v1/intermediary-deposits", "/api/v1/intermediary-exchanges",
  "/api/v1/investors", "/api/v1/lots", "/api/v1/lot-costs", "/api/v1/lot-purchases",
  "/api/v1/godowns", "/api/v1/products", "/api/v1/inventory", "/api/v1/openings",
  "/api/v1/city-transfers", "/api/v1/cities", "/api/v1/countries", "/api/v1/currencies",
  "/api/v1/bank-accounts", "/api/v1/super-admin-personal-expenses", "/api/v1/offline/",
  "/api/v1/notifications", "/api/v1/activity-feed", "/api/v1/search", "/api/v1/sessions",
  "/api/v1/users", "/api/v1/finance/", "/api/v1/financial-reports", "/api/v1/city-ledger",
  "/api/v1/profit-report", "/api/v1/accounting", "/api/v1/analytics", "/api/v1/reports/",
  "/api/v1/discounts", "/api/v1/admin-cleanup", "/api/health", "/api/v1/upload",
  "/api/v1/cheques", "/api/v1/godown-permissions",
];

function isApiPathAllowed(pathname) {
  return ALLOWED_API_PREFIXES.some(function (p) { return pathname.startsWith(p); });
}

// ── Local server ──────────────────────────────────────────────────────────────
function createLocalServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      if (!isApiPathAllowed(url.pathname)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "API path not allowed via proxy" } }));
        return;
      }
      proxyApiRequest(req, res);
      return;
    }

    const filePath = resolveStaticFile(url.pathname);
    serveStatic(res, filePath);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createLocalServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

function probeRemoteHealth() {
  return new Promise(function (resolve) {
    let remoteParsed;
    try {
      remoteParsed = new URL(REMOTE_URL);
    } catch {
      resolve(false);
      return;
    }
    const isHttps = remoteParsed.protocol === "https:";
    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        hostname: remoteParsed.hostname,
        port: remoteParsed.port || (isHttps ? 443 : 80),
        path: "/api/health",
        method: "GET",
        timeout: 20000,
      },
      function (res) {
        let body = "";
        res.on("data", function (chunk) { body += chunk; });
        res.on("end", function () {
          resolve(res.statusCode === 200 && body.includes('"ok":true'));
        });
      }
    );
    req.on("timeout", function () {
      req.destroy();
      resolve(false);
    });
    req.on("error", function () {
      resolve(false);
    });
    req.end();
  });
}

// ── Electron window ───────────────────────────────────────────────────────────
function createWindow(localPort) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0a1324",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (localPort) {
    win.loadURL(`http://127.0.0.1:${localPort}`);
  } else {
    win.loadURL(REMOTE_URL).catch(() => {
      const fallbackPath = path.join(__dirname, "offline-start.html");
      win.loadFile(fallbackPath, { query: { appUrl: REMOTE_URL } }).catch(() => {});
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
let localServer = null;
let localPort = null;

app.whenReady().then(async () => {
  if (hasLocalBuild()) {
    try {
      const result = await startServer();
      localServer = result.server;
      localPort = result.port;
    } catch {
      localPort = null;
    }
  }

  ipcMain.handle("electron:get-local-port", () => localPort);
  ipcMain.handle("electron:get-remote-url", () => REMOTE_URL);
  ipcMain.handle("electron:has-local-build", () => hasLocalBuild());

  ipcMain.handle("electron:retry-remote-load", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) return false;
    try {
      await senderWindow.loadURL(REMOTE_URL);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("electron:open-remote-in-browser", async () => {
    await shell.openExternal(REMOTE_URL);
    return true;
  });

  const serverHealthy = await probeRemoteHealth();
  if (!serverHealthy) {
    const choice = await dialog.showMessageBox({
      type: "warning",
      title: "Server not ready",
      message: "Cannot reach the welding-app server",
      detail:
        REMOTE_URL +
        " is not responding (Render may be waking, suspended, or the last deploy failed).\n\n" +
        "1. Open Render Dashboard → welding-app → confirm Latest Deploy is Live\n" +
        "2. Set JWT_SECRET and DATABASE_URL\n" +
        "3. Open the URL in Safari until login works, then reopen this app",
      buttons: ["Open in Browser", "Continue Offline Shell"],
      defaultId: 0,
    });
    if (choice.response === 0) {
      await shell.openExternal(REMOTE_URL);
    }
  }

  createWindow(localPort);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(localPort);
  });
});

app.on("before-quit", () => {
  if (localServer) localServer.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
