const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("platformInfo", {
  runtime: "electron",
  retryRemoteLoad: () => ipcRenderer.invoke("electron:retry-remote-load"),
  getRemoteUrl: () => ipcRenderer.invoke("electron:get-remote-url"),
});
