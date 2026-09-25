import prisma from "@/lib/prisma";

export type OpeningCutoverReadinessInput = {
  backupAcknowledged: boolean;
  backupReference: string;
  cutoverDate: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  openingClearingPkr: number;
  activeParticipantIds: number[];
  participantBalanceIds: number[];
  managerCount: number;
  totalParticipatingCapitalPkr: number;
  missingForeignLayers: string[];
  inventoryMismatches: string[];
  openingDateMismatches: string[];
  financialYearBlocker?: string | null;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function evaluateOpeningCutoverReadiness(input: OpeningCutoverReadinessInput) {
  const blockers: string[] = [];
  if (!input.backupAcknowledged || !input.backupReference.trim()) {
    blockers.push("A verified backup reference and acknowledgement are required.");
  }
  const cutoverDate = new Date(input.cutoverDate);
  const fiscalYearStart = new Date(input.fiscalYearStart);
  const fiscalYearEnd = new Date(input.fiscalYearEnd);
  if ([cutoverDate, fiscalYearStart, fiscalYearEnd].some((date) => Number.isNaN(date.getTime()))) {
    blockers.push("Valid cutover and financial-year dates are required.");
  } else if (fiscalYearStart > fiscalYearEnd || cutoverDate < fiscalYearStart || cutoverDate > fiscalYearEnd) {
    blockers.push("The cutover date must fall inside the approved financial year.");
  }
  if (Math.abs(round2(input.openingClearingPkr)) >= 0.01) {
    blockers.push(`Opening balances do not reconcile: PKR ${round2(input.openingClearingPkr).toLocaleString("en-US")} remains in account 3900.`);
  }
  const saved = new Set(input.participantBalanceIds);
  for (const participantId of input.activeParticipantIds) {
    if (!saved.has(participantId)) blockers.push(`Active participant ${participantId} has no approved opening balance.`);
  }
  if (input.managerCount !== 1) blockers.push("Exactly one manager participant must be active.");
  if (!(input.totalParticipatingCapitalPkr > 0)) blockers.push("Total participating capital must be greater than zero.");
  blockers.push(...input.missingForeignLayers.map((item) => `Missing immutable foreign carrying layer: ${item}.`));
  blockers.push(...input.inventoryMismatches.map((item) => `Opening inventory mismatch: ${item}.`));
  blockers.push(...input.openingDateMismatches.map((item) => `Opening date outside approved financial year/cutover: ${item}.`));
  if (input.financialYearBlocker) blockers.push(input.financialYearBlocker);
  return { ready: blockers.length === 0, blockers };
}

export async function loadOpeningCutoverReadiness(client: any = prisma, cutoverId?: number) {
  const cutover = cutoverId
    ? await client.openingCutover.findUnique({ where: { id: cutoverId }, include: { participantBalances: true } })
    : await client.openingCutover.findFirst({ where: { status: "draft" }, include: { participantBalances: true }, orderBy: { revision: "desc" } });
  if (!cutover) return null;

  const [participants, openingAccount, foreignSources, inventoryRows, openingDateSources, overlappingFinancialYear] = await Promise.all([
    client.investmentParticipant.findMany({ where: { isActive: true }, select: { id: true, type: true } }),
    client.account.findUnique({ where: { code: "3900" }, select: { id: true } }),
    Promise.all([
      client.openingCash.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCustomerBalance.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingBankBalance.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCheque.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingHajiBalance.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingLiability.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCityLiability.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingSuperAdminAccountBalance.findMany({ where: { currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
    ]),
    client.openingInventoryValuation.findMany({
      select: { lotId: true, productId: true, quantity: true, lot: { select: { lotNumber: true } }, product: { select: { name: true } } },
    }),
    Promise.all([
      client.openingCash.findMany({ select: { id: true, openingDate: true } }),
      client.openingCustomerBalance.findMany({ select: { id: true, openingDate: true } }),
      client.openingStock.findMany({ select: { id: true, openingDate: true } }),
      client.openingBankBalance.findMany({ select: { id: true, openingDate: true } }),
      client.openingCheque.findMany({ select: { id: true, openingDate: true } }),
      client.openingHajiBalance.findMany({ select: { id: true, openingDate: true } }),
      client.openingLiability.findMany({ select: { id: true, openingDate: true } }),
      client.openingCityLiability.findMany({ select: { id: true, openingDate: true } }),
      client.openingInventoryValuation.findMany({ select: { id: true, openingDate: true } }),
      client.openingSuperAdminAccountBalance.findMany({ select: { id: true, openingDate: true } }),
      client.openingEquityAllocation.findMany({ select: { id: true, openingDate: true } }),
    ]),
    client.financialYear.findFirst({
      where: { startDate: { lte: cutover.fiscalYearEnd }, endDate: { gte: cutover.fiscalYearStart } },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
  ]);

  const totals = openingAccount
    ? await client.journalEntry.aggregate({ where: { accountId: openingAccount.id, currencyCode: "PKR" }, _sum: { debit: true, credit: true } })
    : null;
  const openingClearingPkr = round2(Number(totals?._sum.credit || 0) - Number(totals?._sum.debit || 0));
  const sourceTypes = [
    "opening_cash", "opening_customer_balance", "opening_bank_balance", "opening_cheque",
    "opening_haji_balance", "opening_liability", "opening_city_liability", "opening_super_admin_account",
  ];
  const sourceLabels = ["cash", "customer balance", "bank balance", "cheque", "Haji balance", "liability", "city liability", "superadmin account"];
  const layers = await client.foreignCurrencyCarryingLayer.findMany({
    where: { sourceType: { in: sourceTypes }, status: { not: "reversed" } },
    select: { sourceType: true, sourceId: true },
  });
  const layerKeys = new Set(layers.map((layer: any) => `${layer.sourceType}:${layer.sourceId}`));
  const missingForeignLayers: string[] = [];
  foreignSources.forEach((rows: any[], index: number) => rows.forEach((row) => {
    if (!layerKeys.has(`${sourceTypes[index]}:${row.id}`)) missingForeignLayers.push(`opening ${sourceLabels[index]} #${row.id} ${row.currency.code}`);
  }));

  const inventoryMismatches: string[] = [];
  for (const row of inventoryRows) {
    const product = await client.lotProduct.findUnique({ where: { lotId_productId: { lotId: row.lotId, productId: row.productId } }, select: { qty: true } });
    if (!product || Math.abs(Number(product.qty) - Number(row.quantity)) >= 0.0001) {
      inventoryMismatches.push(`${row.lot.lotNumber} / ${row.product.name}`);
    }
  }

  const openingDateLabels = ["cash", "customer balance", "stock", "bank balance", "cheque", "Haji balance", "liability", "city liability", "inventory valuation", "superadmin account", "legacy equity"];
  const openingDateMismatches: string[] = [];
  openingDateSources.forEach((rows: any[], index: number) => rows.forEach((row) => {
    if (row.openingDate < cutover.fiscalYearStart || row.openingDate > cutover.cutoverDate) {
      openingDateMismatches.push(`opening ${openingDateLabels[index]} #${row.id}`);
    }
  }));
  cutover.participantBalances.forEach((row: any) => {
    if (row.openingDate < cutover.fiscalYearStart || row.openingDate > cutover.cutoverDate) {
      openingDateMismatches.push(`participant balance #${row.id}`);
    }
  });

  const input: OpeningCutoverReadinessInput = {
    backupAcknowledged: cutover.backupAcknowledged,
    backupReference: cutover.backupReference,
    cutoverDate: cutover.cutoverDate.toISOString().slice(0, 10),
    fiscalYearStart: cutover.fiscalYearStart.toISOString().slice(0, 10),
    fiscalYearEnd: cutover.fiscalYearEnd.toISOString().slice(0, 10),
    openingClearingPkr,
    activeParticipantIds: participants.map((participant: any) => participant.id),
    participantBalanceIds: cutover.participantBalances.map((row: any) => row.participantId),
    managerCount: participants.filter((participant: any) => participant.type === "manager").length,
    totalParticipatingCapitalPkr: round2(cutover.participantBalances.reduce((sum: number, row: any) => sum + Number(row.capitalPkr), 0)),
    missingForeignLayers,
    inventoryMismatches,
    openingDateMismatches,
    financialYearBlocker: overlappingFinancialYear
      && (overlappingFinancialYear.startDate.getTime() !== cutover.fiscalYearStart.getTime() || overlappingFinancialYear.endDate.getTime() !== cutover.fiscalYearEnd.getTime())
      ? `Financial year conflicts with existing period #${overlappingFinancialYear.id}.`
      : overlappingFinancialYear?.status === "closed"
        ? `Financial year #${overlappingFinancialYear.id} is closed.`
        : null,
  };
  return { cutover, input, ...evaluateOpeningCutoverReadiness(input) };
}
