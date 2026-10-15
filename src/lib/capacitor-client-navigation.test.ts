import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

const LOGIN_PAGE = "src/app/login/page.tsx";

test("the login flow leaves the login route without reloading the WebView", () => {
  const page = read(LOGIN_PAGE);

  assert.match(page, /import \{ useRouter \} from "next\/navigation"/);
  assert.match(page, /const router = useRouter\(\)/);
  assert.doesNotMatch(page, /window\.location\.(replace|assign)/);
  assert.doesNotMatch(page, /window\.location\.href\s*=/);
});

test("both login redirects use the same client-side dashboard transition", () => {
  const page = read(LOGIN_PAGE);
  const redirects = page.match(/router\.replace\("\/dashboard\/"\)/g) || [];

  assert.equal(redirects.length, 2, "expected the cached-session and post-submit redirects to both navigate");
});

test("client-side login navigation relies on an auth provider that survives route changes", () => {
  const rootLayout = read("src/app/layout.tsx");

  assert.match(rootLayout, /<AuthProvider>[\s\S]*<OfflineProvider>[\s\S]*\{children\}/);
});
test("logging out of an authenticated route never reloads the WebView", () => {
  const auth = read("src/hooks/useAuth.tsx");
  const settings = read("src/app/(dashboard)/settings/page.tsx");

  // Logout, idle timeout, offline-device revocation and account deletion each
  // used window.location, restarting the packaged document load.
  for (const source of [auth, settings]) {
    assert.doesNotMatch(source, /window\.location\.(replace|assign)\(/);
    assert.doesNotMatch(source, /window\.location\.href\s*=/);
    assert.match(source, /router\.replace\("\/login"\)/);
    // A trailing slash does not match the dev build's route manifest, so the
    // client router falls back to a hard document navigation.
    assert.doesNotMatch(source, /router\.replace\("\/login\/"\)/);
  }
});

test("the unauthenticated guard redirects from an effect and keeps the App Review document load", () => {
  const layout = read("src/components/layout/AppLayout.tsx");

  // Navigating during render re-fired on every render. The packaged build is a
  // static export with no middleware, so this path must keep a real document
  // load — that is what scripts/apple-platform-readiness.test.cjs enforces.
  assert.match(layout, /useEffect\(\(\) => \{\s*if \(shouldRedirectToLogin\) window\.location\.href = "\/login\/"/);
  assert.match(layout, /const shouldRedirectToLogin = !loading && !user && !isEmbed/);
});
