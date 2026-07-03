const serverUrl = process.env.CAPACITOR_SERVER_URL || "";
const allowCleartextHttp = process.env.CAPACITOR_ALLOW_CLEARTEXT_HTTP === "true";

if (serverUrl.startsWith("http://") && !allowCleartextHttp) {
  throw new Error("CAPACITOR_SERVER_URL must use HTTPS unless CAPACITOR_ALLOW_CLEARTEXT_HTTP=true is set for local development.");
}

const config = {
  appId: "com.mrf.kandahar",
  appName: "MRF Kandahar",
  webDir: "capacitor-web",
  bundledWebRuntime: false,
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: allowCleartextHttp,
        },
      }
    : {}),
};

export default config;
