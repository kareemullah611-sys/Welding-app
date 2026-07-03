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

test("isSessionActive rejects tokens when session lookup fails", async () => {
  const prismaModule = await import("./prisma");
  const originalFindFirst = prismaModule.default.userSession.findFirst;
  const originalConsoleError = console.error;
  (prismaModule.default.userSession as any).findFirst = async () => {
    throw new Error("database unavailable");
  };
  console.error = () => {};

  try {
    const { isSessionActive } = await import("./session");
    assert.equal(await isSessionActive("fake-token"), false);
  } finally {
    (prismaModule.default.userSession as any).findFirst = originalFindFirst;
    console.error = originalConsoleError;
  }
});

test("cleanupExpiredSessions deactivates expired active sessions", async () => {
  const prismaModule = await import("./prisma");
  const originalUpdateMany = prismaModule.default.userSession.updateMany;
  let capturedArgs: unknown;
  (prismaModule.default.userSession as any).updateMany = async (args: unknown) => {
    capturedArgs = args;
    return { count: 3 };
  };

  try {
    const { cleanupExpiredSessions } = await import("./session");
    assert.equal(await cleanupExpiredSessions(), 3);
    assert.deepEqual(capturedArgs, {
      where: {
        isActive: true,
        expiresAt: { lt: capturedArgs && (capturedArgs as any).where.expiresAt.lt },
      },
      data: { isActive: false },
    });
    assert.ok((capturedArgs as any).where.expiresAt.lt instanceof Date);
  } finally {
    (prismaModule.default.userSession as any).updateMany = originalUpdateMany;
  }
});
