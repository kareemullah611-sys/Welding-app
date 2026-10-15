const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("uses the permanent MRF Hardware Apple identity", () => {
  const capacitorConfig = read("capacitor.config.ts");
  const nativeSync = read("src/lib/native-background-sync.ts");
  const packageJson = JSON.parse(read("package.json"));

  assert.match(capacitorConfig, /appId:\s*["']com\.mrf\.hardware["']/);
  assert.match(capacitorConfig, /appName:\s*["']MRF Hardware["']/);
  assert.match(capacitorConfig, /label:\s*["']com\.mrf\.hardware\.offline\.sync["']/);
  assert.match(nativeSync, /RUNNER_LABEL\s*=\s*["']com\.mrf\.hardware\.offline\.sync["']/);
  assert.equal(packageJson.dependencies["@capacitor/ios"], packageJson.dependencies["@capacitor/core"]);
  assert.ok(packageJson.scripts["package:ios:sync"]);
  assert.ok(packageJson.scripts["package:ios:open"]);
});

test("contains an App Store-ready iOS target", () => {
  const infoPlist = read("ios/App/App/Info.plist");
  const appDelegate = read("ios/App/App/AppDelegate.swift");
  const sceneDelegate = read("ios/App/App/SceneDelegate.swift");
  const privacyManifest = read("ios/App/App/PrivacyInfo.xcprivacy");
  const project = read("ios/App/App.xcodeproj/project.pbxproj");

  assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>MRF Hardware<\/string>/);
  assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(infoPlist, /<key>BGTaskSchedulerPermittedIdentifiers<\/key>[\s\S]*com\.mrf\.hardware\.offline\.sync/);
  assert.match(infoPlist, /<key>UIBackgroundModes<\/key>[\s\S]*<string>fetch<\/string>[\s\S]*<string>processing<\/string>/);
  assert.match(infoPlist, /<key>UIApplicationSceneManifest<\/key>[\s\S]*<key>UISceneDelegateClassName<\/key>[\s\S]*SceneDelegate/);
  assert.doesNotMatch(infoPlist, /NSAllowsArbitraryLoads/);

  assert.match(appDelegate, /import CapacitorBackgroundRunner/);
  assert.match(appDelegate, /BackgroundRunnerPlugin\.registerBackgroundTask\(\)/);
  assert.match(appDelegate, /BackgroundRunnerPlugin\.handleApplicationDidFinishLaunching/);
  assert.match(sceneDelegate, /class SceneDelegate:\s*UIResponder,\s*UIWindowSceneDelegate/);
  assert.match(project, /SceneDelegate\.swift in Sources/);
  assert.match(project, /com\.apple\.BackgroundModes/);
  assert.match(privacyManifest, /NSPrivacyTracking[\s\S]*<false\/>/);
  assert.match(privacyManifest, /NSPrivacyCollectedDataTypeOtherFinancialInfo/);
  assert.match(privacyManifest, /NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/);
  assert.match(read("scripts/build-packaged.cjs"), /rmSync\(path\.join\(exportPath, "uploads"\)/);

  const iconPath = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
  const icon = fs.readFileSync(iconPath);
  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.ok(![4, 6].includes(icon[25]), "App Store icon must not contain an alpha channel");
});

test("removes city-specific branding from the shared packaged shell", () => {
  assert.doesNotMatch(read("capacitor-web/index.html"), /Kandahar/i);
});

test("exports extensionless packaged routes in a Capacitor-compatible shape", () => {
  const nextConfig = read("next.config.js");
  assert.match(nextConfig, /isElectronBuild[\s\S]*trailingSlash:\s*true/);
});

test("packaged startup renders a visible login shell without a client-only redirect", () => {
  // The packaged root must paint the login shell directly, so App Review never
  // lands on an empty frame before any client-side work runs.
  assert.match(read("src/app/page.tsx"), /return <LoginPage \/>/);
  // Unauthenticated users need a real document load to reach that shell: the
  // packaged build is a static export with no middleware.
  assert.match(read("src/components/layout/AppLayout.tsx"), /window\.location\.href = "\/login\/"/);
  // Leaving the login route is a client-side transition. AuthProvider lives in
  // the root layout so it survives the route change, and the e2e login and
  // logout suites cover both directions.
  const loginPage = read("src/app/login/page.tsx");
  assert.match(loginPage, /router\.replace\("\/dashboard\/"\)/);
  assert.doesNotMatch(loginPage, /window\.location\.(replace|href)/);
});

test("ships reviewer-facing privacy and support information without bundled business data", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.match(read("src/app/privacy/page.tsx"), /Privacy Policy/);
  assert.match(read("src/app/support/page.tsx"), /Support/);
  assert.match(read("docs/apple-app-store-submission.md"), /App Review Notes/);
  assert.match(packageJson.scripts["package:ios:sync"], /offline-seed:empty/);
  assert.ok(packageJson.scripts["offline-seed:empty"]);
  assert.match(read("scripts/generate-empty-offline-seed.cjs"), /modules:\s*\{\}/);
  const middleware = read("src/middleware.ts");
  assert.match(middleware, /publicPaths\s*=\s*\[[^\]]*["']\/privacy["']/s);
  assert.match(middleware, /publicPaths\s*=\s*\[[^\]]*["']\/support["']/s);
});
