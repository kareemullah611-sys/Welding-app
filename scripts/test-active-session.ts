import prisma from "../src/lib/prisma";

(prisma.userSession.findFirst as unknown as { mock?: unknown }) = (async () => ({
  isActive: true,
  expiresAt: new Date("2999-12-31T23:59:59.999Z"),
})) as never;
