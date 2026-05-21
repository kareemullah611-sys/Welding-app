const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("platformInfo", {
  runtime: "electron",
  retryRemoteLoad: () => ipcRenderer.invoke("electron:retry-remote-load"),
  getRemoteUrl: () => ipcRenderer.invoke("electron:get-remote-url"),
  getLocalPort: () => ipcRenderer.invoke("electron:get-local-port"),
  hasLocalBuild: () => ipcRenderer.invoke("electron:has-local-build"),
  openRemoteInBrowser: () => ipcRenderer.invoke("electron:open-remote-in-browser"),
});
