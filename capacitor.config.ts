const legacyServerUrl = process.env.CAPACITOR_SERVER_URL || "";
const allowCleartextHttp = process.env.CAPACITOR_ALLOW_CLEARTEXT_HTTP === "true";

if (legacyServerUrl.startsWith("http://") && !allowCleartextHttp) {
  throw new Error("CAPACITOR_SERVER_URL must use HTTPS unless CAPACITOR_ALLOW_CLEARTEXT_HTTP=true is set for local development.");
}

const config = {
  appId: "com.mrf.kandahar",
  appName: "MRF Kandahar",
  webDir: "out",
  bundledWebRuntime: false,
  plugins: {
    CapacitorHttp: { enabled: true },
    BackgroundRunner: {
      label: "com.mrf.kandahar.offline.sync",
      src: "runners/offline-sync.js",
      event: "mrfOfflineSync",
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
