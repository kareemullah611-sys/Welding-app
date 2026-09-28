import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildDateRange } from "@/lib/date-range";
import { buildTrialBalance, filterTrialBalanceRows, normalizeCurrency } from "@/lib/trial-balance";
import ExcelJS from "exceljs";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("date_from");
    const dateTo = sp.get("date_to");
    const cityIdParam = sp.get("city_id");
    const currencyParam = sp.get("currency");
    const accountTypeParam = sp.get("account_type");
    const searchParam = sp.get("q");

    if (!dateFrom || !dateTo) {
      return errorResponse("VALIDATION_ERROR", "date_from and date_to are required");
    }

    const range = buildDateRange(dateFrom, dateTo);
    if (!range.gte || !range.lt) {
      return errorResponse("VALIDATION_ERROR", "Invalid date range");
    }

    const cityId = cityIdParam ? parseInt(cityIdParam) : undefined;
    const city = cityId ? await prisma.city.findUnique({ where: { id: cityId }, select: { name: true } }) : null;

    const accounts = await prisma.account.findMany({
      where: { OR: [{ isActive: true }, { journalEntries: { some: {} } }] },
      select: { id: true, code: true, name: true, accountType: true, cityId: true, parentId: true },
    });

    const relevantAccounts = cityId
      ? accounts.filter((a) => !a.cityId || a.cityId === cityId)
      : accounts;
    const accountIds = relevantAccounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return errorResponse("VALIDATION_ERROR", "No accounts found");
    }

    // Build currency filter that includes legacy RMB when CNY is requested
    let currencyWhere: Record<string, unknown> | undefined;
    if (currencyParam) {
      const normalized = normalizeCurrency(currencyParam);
      if (normalized === "CNY") {
        currencyWhere = { currencyCode: { in: ["CNY", "RMB"] } };
      } else {
        currencyWhere = { currencyCode: normalized };
      }
    }

    const cityFilter = cityId ? { cityId } : {};
    const [openingGroups, periodGroups] = await Promise.all([
      prisma.journalEntry.groupBy({
        by: ["accountId", "currencyCode"],
        where: { accountId: { in: accountIds }, entryDate: { lt: range.gte }, ...cityFilter, ...(currencyWhere || {}) },
        _sum: { debit: true, credit: true },
      }),
      prisma.journalEntry.groupBy({
        by: ["accountId", "currencyCode"],
        where: { accountId: { in: accountIds }, entryDate: { gte: range.gte, lt: range.lt }, ...cityFilter, ...(currencyWhere || {}) },
        _sum: { debit: true, credit: true },
      }),
    ]);

    const result = buildTrialBalance({ accounts: relevantAccounts, openingGroups, periodGroups });
    const filtered = filterTrialBalanceRows(result, {
      search: searchParam || undefined,
      accountType: accountTypeParam || undefined,
      currency: currencyParam || undefined,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Trial Balance");

    const metaRows = [
      ["Trial Balance"],
      [`Period: ${dateFrom} to ${dateTo}`],
      [`City: ${city?.name || "All Cities"}`],
      [`Currency: ${currencyParam || "All"}`],
      [`Generated: ${new Date().toISOString().slice(0, 10)}`],
      [],
    ];
    for (const row of metaRows) sheet.addRow(row);

    const headerRow = sheet.addRow([
      "Account Code", "Account Name", "Currency",
      "Opening Debit", "Opening Credit",
      "Period Debit", "Period Credit",
      "Closing Debit", "Closing Credit",
    ]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      cell.border = { bottom: { style: "thin" } };
    });

    for (const section of filtered.sections) {
      const sectionRow = sheet.addRow([section.label]);
      sectionRow.font = { bold: true, size: 12 };
      sectionRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      });

      for (const group of section.groups) {
        sheet.addRow([`  ${group.familyLabel}`]).font = { bold: true, italic: true };
        for (const row of group.rows) {
          sheet.addRow([
            row.accountCode,
            row.accountName,
            row.currencyCode,
            row.openingDebit || "",
            row.openingCredit || "",
            row.periodDebit || "",
            row.periodCredit || "",
            row.closingDebit || "",
            row.closingCredit || "",
          ]);
        }
      }
    }

    sheet.addRow([]);
    const totalsHeader = sheet.addRow(["Grand Totals by Currency"]);
    totalsHeader.font = { bold: true, size: 12 };

    for (const [curr, totals] of Object.entries(filtered.currencyTotals)) {
      sheet.addRow([
        curr, "", "",
        totals.openingDebit, totals.openingCredit,
        totals.periodDebit, totals.periodCredit,
        totals.closingDebit, totals.closingCredit,
      ]);
    }

    sheet.addRow([]);
    const reconHeader = sheet.addRow(["Reconciliation"]);
    reconHeader.font = { bold: true, size: 12 };
    sheet.addRow(["Currency", "Opening Diff", "Period Diff", "Closing Diff", "Balanced"]);
    for (const r of filtered.reconciliation) {
      sheet.addRow([r.currency, r.openingDiff, r.periodDiff, r.closingDiff, r.balanced ? "Yes" : "NO"]);
    }

    for (let i = 1; i <= 9; i++) {
      const col = sheet.getColumn(i);
      if (i <= 2) col.width = 30;
      else if (i === 3) col.width = 10;
      else col.width = 15;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="trial-balance-${dateFrom}-to-${dateTo}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Trial balance export error:", error);
    return serverError();
  }
});
