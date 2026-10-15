const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("platformInfo", {
  runtime: "electron",
  retryRemoteLoad: () => ipcRenderer.invoke("electron:retry-remote-load"),
  getRemoteUrl: () => ipcRenderer.invoke("electron:get-remote-url"),
  getLocalPort: () => ipcRenderer.invoke("electron:get-local-port"),
  hasLocalBuild: () => ipcRenderer.invoke("electron:has-local-build"),
  openRemoteInBrowser: () => ipcRenderer.invoke("electron:open-remote-in-browser"),
  onBackgroundSyncTrigger: (callback) => {
    const listener = (_event, reason) => callback(reason);
    ipcRenderer.on("electron:background-sync-trigger", listener);
    return () => ipcRenderer.removeListener("electron:background-sync-trigger", listener);
  },
});
