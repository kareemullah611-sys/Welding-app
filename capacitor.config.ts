const serverUrl = process.env.CAPACITOR_SERVER_URL || "";

const config = {
  appId: "com.mrf.kandahar",
  appName: "MRF Kandahar",
  webDir: "capacitor-web",
  bundledWebRuntime: false,
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith("http://"),
        },
      }
    : {}),
};

export default config;
