const fs = require("node:fs");
const path = require("node:path");

const gradlePath = path.resolve(__dirname, "..", "android", "app", "build.gradle");
const marker = "../../node_modules/@capacitor/background-runner/android/src/main/libs";

if (!fs.existsSync(gradlePath)) {
  throw new Error("Android project is missing. Run npm run package:android:init first.");
}

const source = fs.readFileSync(gradlePath, "utf8");
if (source.includes(marker)) process.exit(0);
const updated = source.replace(
  /dirs '\.\.\/capacitor-cordova-android-plugins\/src\/main\/libs', 'libs'/,
  `dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'\n        dirs '${marker}', 'libs'`
);
if (updated === source) throw new Error("Could not locate Android flatDir repository configuration.");
fs.writeFileSync(gradlePath, updated);
