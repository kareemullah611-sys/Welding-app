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

  // Local-first boot: always open the bundled local shell first.
  loadOfflineFallback(win).catch(() => {});

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

  ipcMain.handle("electron:get-remote-url", () => APP_URL);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
