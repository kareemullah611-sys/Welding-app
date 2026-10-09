import { expect, test } from "@playwright/test";
import { loginAsCityAdmin } from "./helpers";
import prisma from "../src/lib/prisma";

for (const username of ["quetta_admin", "kabul_admin"]) {
  for (const pageName of ["sales", "payments"]) {
    test(`${username} ${pageName} loads independent form reads concurrently`, async ({ page }) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { username } });
      const sessions = await prisma.userSession.findMany({ where: { userId: user.id }, select: { id: true } });
      const audits = await prisma.auditLog.findMany({ where: { userId: user.id }, select: { id: true } });
      await loginAsCityAdmin(page, username);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let setupStarted = false;
      let summaryStarted = false;
      await page.route("**/api/v1/**", async (route) => {
        const url = new URL(route.request().url());
        const setup = url.pathname === (pageName === "sales" ? "/api/v1/godowns" : "/api/v1/cities");
        const summary = url.pathname === (pageName === "sales" ? "/api/v1/sales" : "/api/v1/finance/combined") && url.searchParams.get("limit") === "1";
        if (setup) setupStarted = true;
        if (summary) summaryStarted = true;
        if ((pageName === "sales" && setup) || (pageName === "payments" && summary)) await held;
        await route.continue();
      });
      try {
        await page.goto(`/${pageName}?embed=1&create=${pageName === "sales" ? "1" : "payment"}`);
        await expect.poll(() => setupStarted && summaryStarted, { timeout: 15000 }).toBe(true);
        release();
        await expect(page.getByText(/customer \*/i).first()).toBeVisible({ timeout: 15000 });
        if (pageName === "sales") await expect(page.getByText(/godown \*/i).first()).toBeVisible();
        else await expect(page.getByText(/amount \*/i).first()).toBeVisible();
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
        await prisma.userSession.deleteMany({ where: { userId: user.id, id: { notIn: sessions.map(row => row.id) } } });
        await prisma.auditLog.deleteMany({ where: { userId: user.id, id: { notIn: audits.map(row => row.id) } } });
      }
    });
  }
}
