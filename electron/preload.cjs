const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("platformInfo", {
  runtime: "electron",
});
