import assert from "node:assert/strict";
import test from "node:test";

const globals = globalThis as Record<string, unknown>;

function withRuntime<T>(capacitor: unknown, run: () => T): T {
  const previous = globals.window;
  const hadWindow = "window" in globals;
  globals.window = capacitor ? { Capacitor: capacitor } : {};
  try {
    return run();
  } finally {
    if (hadWindow) globals.window = previous;
    else delete globals.window;
  }
}

async function loadModule() {
  return import("./quickform-embed");
}

test("Capacitor quickform iframes target the exported file, not the SPA route", async () => {
  const { getQuickformSrc } = await loadModule();

  const url = withRuntime({ getPlatform: () => "ios" }, () => getQuickformSrc("sales", "1"));

  // WebViewAssetHandler maps every extensionless path to the root index.html,
  // so "/sales" would hand the iframe the login page instead of the module.
  assert.equal(url, "/sales/index.html?create=1&embed=1");
  assert.match(url, /^\/sales\/index\.html\?/);
});

test("web and Electron quickform iframes keep the server-routed path", async () => {
  const { getQuickformSrc } = await loadModule();

  const sales = withRuntime(undefined, () => getQuickformSrc("sales", "1"));
  const payment = withRuntime(undefined, () => getQuickformSrc("payments", "payment"));

  assert.equal(sales, "/sales?create=1&embed=1");
  assert.equal(payment, "/payments?create=payment&embed=1");
});

test("quickform src is derived, never a duplicated literal in the dashboard", async () => {
  const dashboard = await import("node:fs").then((fs) =>
    fs.readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8"),
  );

  assert.match(dashboard, /getQuickformSrc/);
  assert.doesNotMatch(dashboard, /src="\/sales\?create=1&embed=1"/);
  assert.doesNotMatch(dashboard, /openQuickForm\("Sale", "\/sales\?/);
  assert.doesNotMatch(dashboard, /openQuickForm\("Payment", "\/payments\?/);
});
