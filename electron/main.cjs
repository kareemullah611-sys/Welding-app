const { app, BrowserWindow, shell } = require("electron");
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

  win.loadURL(APP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
