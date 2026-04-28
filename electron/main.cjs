const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

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

const APP_URL = process.env.ELECTRON_START_URL || readConfiguredUrl() || "http://localhost:3000";
const REMOTE_BOOT_TIMEOUT_MS = 7000;

function loadOfflineFallback(win) {
  const fallbackPath = path.join(__dirname, "offline-start.html");
  return win.loadFile(fallbackPath, { query: { appUrl: APP_URL } });
}

function createWindow() {
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

  let didFinish = false;
  const timeout = setTimeout(() => {
    if (!didFinish && !win.isDestroyed()) {
      loadOfflineFallback(win).catch(() => {});
    }
  }, REMOTE_BOOT_TIMEOUT_MS);

  win.webContents.once("did-finish-load", () => {
    didFinish = true;
    clearTimeout(timeout);
  });

  win.webContents.once("did-fail-load", () => {
    if (!win.isDestroyed()) {
      loadOfflineFallback(win).catch(() => {});
    }
  });

  win.loadURL(APP_URL).catch(() => {
    if (!win.isDestroyed()) {
      loadOfflineFallback(win).catch(() => {});
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  ipcMain.handle("electron:retry-remote-load", async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) return false;
    try {
      await senderWindow.loadURL(APP_URL);
      return true;
    } catch {
      return false;
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
