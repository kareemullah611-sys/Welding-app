import assert from "node:assert/strict";
import test from "node:test";

test("isSessionActive rejects tokens with no server session row", async () => {
  const prismaModule = await import("./prisma");
  const originalFindFirst = prismaModule.default.userSession.findFirst;
  (prismaModule.default.userSession as any).findFirst = async () => null;

  try {
    const { isSessionActive } = await import("./session");
    assert.equal(await isSessionActive("fake-token"), false);
  } finally {
    (prismaModule.default.userSession as any).findFirst = originalFindFirst;
  }
});
