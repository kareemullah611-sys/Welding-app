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
  unlinkedOpeningRecords?: string[];
  cityPackageBlockers?: string[];
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
  blockers.push(...(input.unlinkedOpeningRecords || []).map((item) => `Opening record is not assigned to this cutover revision: ${item}.`));
  blockers.push(...(input.cityPackageBlockers || []));
  if (input.financialYearBlocker) blockers.push(input.financialYearBlocker);
  return { ready: blockers.length === 0, blockers };
}

export async function loadOpeningCutoverReadiness(client: any = prisma, cutoverId?: number) {
  const cutover = cutoverId
    ? await client.openingCutover.findUnique({ where: { id: cutoverId }, include: { participantBalances: true } })
    : await client.openingCutover.findFirst({ where: { status: "draft" }, include: { participantBalances: true }, orderBy: { revision: "desc" } });
  if (!cutover) return null;

  const cutoverEntries = await client.openingCutoverEntry.findMany({
    where: { cutoverId: cutover.id },
    select: { entityType: true, entityId: true },
  });
  const ids = (entityType: string) => cutoverEntries.filter((entry: any) => entry.entityType === entityType).map((entry: any) => entry.entityId);
  const allEntries = await client.openingCutoverEntry.findMany({ select: { entityType: true, entityId: true } });
  const ownedIds = (entityType: string) => allEntries.filter((entry: any) => entry.entityType === entityType).map((entry: any) => entry.entityId);
  const unlinkedSources = await Promise.all([
    client.openingCash.findMany({ where: { id: { notIn: ownedIds("opening_cash") } }, select: { id: true } }),
    client.openingCustomerBalance.findMany({ where: { id: { notIn: ownedIds("opening_customer_balance") } }, select: { id: true } }),
    client.openingBankBalance.findMany({ where: { id: { notIn: ownedIds("opening_bank_balance") } }, select: { id: true } }),
    client.openingCheque.findMany({ where: { id: { notIn: ownedIds("opening_cheque") } }, select: { id: true } }),
    client.openingHajiBalance.findMany({ where: { id: { notIn: ownedIds("opening_haji_balance") } }, select: { id: true } }),
    client.openingLiability.findMany({ where: { id: { notIn: ownedIds("opening_liability") } }, select: { id: true } }),
    client.openingCityLiability.findMany({ where: { id: { notIn: ownedIds("opening_city_liability") } }, select: { id: true } }),
    client.openingInventoryValuation.findMany({ where: { id: { notIn: ownedIds("opening_inventory_valuation") } }, select: { id: true } }),
    client.openingSuperAdminAccountBalance.findMany({ where: { id: { notIn: ownedIds("opening_super_admin_account_balance") } }, select: { id: true } }),
    client.openingEquityAllocation.findMany({ where: { id: { notIn: ownedIds("opening_equity_allocation") } }, select: { id: true } }),
    client.openingCityDueBalance.findMany({ where: { id: { notIn: ownedIds("opening_city_due_balance") } }, select: { id: true } }),
  ]);
  const unlinkedLabels = ["cash", "customer balance", "bank balance", "cheque", "Haji balance", "liability", "city liability", "inventory valuation", "superadmin account", "equity", "city due balance"];
  const unlinkedOpeningRecords = unlinkedSources.flatMap((rows: any[], index: number) => rows.map((row) => `${unlinkedLabels[index]} #${row.id}`));

  const [participants, openingAccount, foreignSources, inventoryRows, openingDateSources, overlappingFinancialYear, activeCities, cityPackages] = await Promise.all([
    client.investmentParticipant.findMany({ where: { isActive: true }, select: { id: true, type: true } }),
    client.account.findUnique({ where: { code: "3900" }, select: { id: true } }),
    Promise.all([
      client.openingCash.findMany({ where: { id: { in: ids("opening_cash") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCustomerBalance.findMany({ where: { id: { in: ids("opening_customer_balance") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingBankBalance.findMany({ where: { id: { in: ids("opening_bank_balance") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCheque.findMany({ where: { id: { in: ids("opening_cheque") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingHajiBalance.findMany({ where: { id: { in: ids("opening_haji_balance") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingLiability.findMany({ where: { id: { in: ids("opening_liability") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCityLiability.findMany({ where: { id: { in: ids("opening_city_liability") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingSuperAdminAccountBalance.findMany({ where: { id: { in: ids("opening_super_admin_account_balance") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
      client.openingCityDueBalance.findMany({ where: { id: { in: ids("opening_city_due_balance") }, currency: { code: { not: "PKR" } } }, select: { id: true, currency: { select: { code: true } } } }),
    ]),
    client.openingInventoryValuation.findMany({
      where: { id: { in: ids("opening_inventory_valuation") } },
      select: { id: true, lotId: true, productId: true, quantity: true, lot: { select: { lotNumber: true } }, product: { select: { name: true } } },
    }),
    Promise.all([
      client.openingCash.findMany({ where: { id: { in: ids("opening_cash") } }, select: { id: true, openingDate: true } }),
      client.openingCustomerBalance.findMany({ where: { id: { in: ids("opening_customer_balance") } }, select: { id: true, openingDate: true } }),
      Promise.resolve([]),
      client.openingBankBalance.findMany({ where: { id: { in: ids("opening_bank_balance") } }, select: { id: true, openingDate: true } }),
      client.openingCheque.findMany({ where: { id: { in: ids("opening_cheque") } }, select: { id: true, openingDate: true } }),
      client.openingHajiBalance.findMany({ where: { id: { in: ids("opening_haji_balance") } }, select: { id: true, openingDate: true } }),
      client.openingLiability.findMany({ where: { id: { in: ids("opening_liability") } }, select: { id: true, openingDate: true } }),
      client.openingCityLiability.findMany({ where: { id: { in: ids("opening_city_liability") } }, select: { id: true, openingDate: true } }),
      client.openingInventoryValuation.findMany({ where: { id: { in: ids("opening_inventory_valuation") } }, select: { id: true, openingDate: true } }),
      client.openingSuperAdminAccountBalance.findMany({ where: { id: { in: ids("opening_super_admin_account_balance") } }, select: { id: true, openingDate: true } }),
      client.openingEquityAllocation.findMany({ where: { id: { in: ids("opening_equity_allocation") } }, select: { id: true, openingDate: true } }),
    ]),
    client.financialYear.findFirst({
      where: { startDate: { lte: cutover.fiscalYearEnd }, endDate: { gte: cutover.fiscalYearStart } },
      select: { id: true, startDate: true, endDate: true, status: true },
    }),
    client.city.findMany({ where: { isActive: true }, select: { id: true, name: true, cityCurrencies: { select: { currencyId: true } } } }),
    client.openingCityPackage.findMany({
      where: { cutoverId: cutover.id },
      select: {
        cityId: true,
        status: true,
        dueBalances: { select: { currencyId: true, cityAmount: true, cityCarryingPkr: true, centralAmount: true, centralCarryingPkr: true } },
      },
    }),
  ]);

  const totals = openingAccount
    ? await client.journalEntry.aggregate({ where: {
        accountId: openingAccount.id,
        currencyCode: "PKR",
        OR: [
          ...cutoverEntries.map((entry: any) => ({ entityType: entry.entityType, entityId: entry.entityId })),
          ...cutover.participantBalances.map((row: any) => ({ entityType: "opening_participant_balance", entityId: row.id })),
        ],
      }, _sum: { debit: true, credit: true } })
    : null;
  const openingClearingPkr = round2(Number(totals?._sum.credit || 0) - Number(totals?._sum.debit || 0));
  const sourceTypes = [
    "opening_cash", "opening_customer_balance", "opening_bank_balance", "opening_cheque",
    "opening_haji_balance", "opening_liability", "opening_city_liability", "opening_super_admin_account", "opening_city_due_balance",
  ];
  const sourceLabels = ["cash", "customer balance", "bank balance", "cheque", "Haji balance", "liability", "city liability", "superadmin account", "city due balance"];
  const layers = await client.foreignCurrencyCarryingLayer.findMany({
    where: { sourceType: { in: sourceTypes }, status: { not: "reversed" } },
    select: { sourceType: true, sourceId: true, sourceLineKey: true },
  });
  const layerKeys = new Set(layers.map((layer: any) => `${layer.sourceType}:${layer.sourceId}`));
  const layerLineKeys = new Set(layers.map((layer: any) => `${layer.sourceType}:${layer.sourceId}:${layer.sourceLineKey}`));
  const missingForeignLayers: string[] = [];
  foreignSources.forEach((rows: any[], index: number) => rows.forEach((row) => {
    if (sourceTypes[index] === "opening_city_due_balance") {
      if (!layerLineKeys.has(`${sourceTypes[index]}:${row.id}:due_from_city`) || !layerLineKeys.has(`${sourceTypes[index]}:${row.id}:due_to_superadmin`)) {
        missingForeignLayers.push(`opening ${sourceLabels[index]} #${row.id} ${row.currency.code}`);
      }
    } else if (!layerKeys.has(`${sourceTypes[index]}:${row.id}`)) missingForeignLayers.push(`opening ${sourceLabels[index]} #${row.id} ${row.currency.code}`);
  }));

  const inventoryMismatches: string[] = [];
  for (const row of inventoryRows) {
    const product = await client.lotProduct.findUnique({ where: { lotId_productId: { lotId: row.lotId, productId: row.productId } }, select: { totalQty: true } });
    if (!product || Math.abs(Number(product.totalQty) - Number(row.quantity)) >= 0.0001) {
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

  const packagesByCity = new Map(cityPackages.map((row: any) => [row.cityId, row]));
  const cityPackageBlockers: string[] = [];
  for (const city of activeCities) {
    const packageRow: any = packagesByCity.get(city.id);
    if (!packageRow || packageRow.status !== "approved") {
      cityPackageBlockers.push(`Every active city must have an approved opening package: ${city.name}.`);
      continue;
    }
    const dueByCurrency = new Map(packageRow.dueBalances.map((row: any) => [row.currencyId, row]));
    for (const { currencyId } of city.cityCurrencies) {
      const due: any = dueByCurrency.get(currencyId);
      if (!due || due.cityAmount === null || due.cityCarryingPkr === null || due.centralAmount === null || due.centralCarryingPkr === null) {
        cityPackageBlockers.push(`City ${city.name} has no explicit Due to/from Superadmin assertion for currency #${currencyId}.`);
      } else if (Math.abs(Number(due.cityAmount) - Number(due.centralAmount)) >= 0.000001 || Math.abs(Number(due.cityCarryingPkr) - Number(due.centralCarryingPkr)) >= 0.01) {
        cityPackageBlockers.push(`City ${city.name} Due to/from Superadmin does not reconcile for currency #${currencyId}.`);
      }
    }
  }

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
    unlinkedOpeningRecords,
    cityPackageBlockers,
    financialYearBlocker: overlappingFinancialYear
      && (overlappingFinancialYear.startDate.getTime() !== cutover.fiscalYearStart.getTime() || overlappingFinancialYear.endDate.getTime() !== cutover.fiscalYearEnd.getTime())
      ? `Financial year conflicts with existing period #${overlappingFinancialYear.id}.`
      : overlappingFinancialYear?.status === "closed"
        ? `Financial year #${overlappingFinancialYear.id} is closed.`
        : null,
  };
  return { cutover, input, ...evaluateOpeningCutoverReadiness(input) };
}
