import type { PrismaClient } from "@prisma/client";

export type OfflineSyncScope = {
  role: "super_admin" | "city_admin";
  cityId?: number | null;
  countryId?: number | null;
};

function mapLotForOffline(lot: any) {
  const distributions = (lot.lotCityDistributions || []).map((d: any) => ({
    id: d.id,
    cityId: d.cityId,
    cityName: d.city?.name ?? "",
    productId: d.productId,
    productName: d.product?.name ?? "",
    allocatedQty: Number(d.allocatedQty ?? 0),
    godownAllocations: (d.godownAllocations || []).map((ga: any) => ({
      godownId: ga.godownId,
      godownName: ga.godown?.name ?? "",
      qty: Number(ga.qty ?? 0),
    })),
  }));
  return {
    id: lot.id,
    lotNumber: lot.lotNumber,
    lotDate: lot.lotDate instanceof Date ? lot.lotDate.toISOString().slice(0, 10) : lot.lotDate,
    notes: lot.notes ?? "",
    status: lot.status,
    countryId: lot.countryId,
    countryName: lot.country?.name ?? "",
    products: (lot.lotProducts || []).map((lp: any) => ({
      productId: lp.productId,
      productName: lp.product?.name ?? "",
      totalQty: Number(lp.totalQty ?? 0),
    })),
    distributions,
    totalCartons: (lot.lotProducts || []).reduce((s: number, lp: any) => s + Number(lp.totalQty || 0), 0),
    soldCartons: 0,
  };
}

/** Full offline archive payload — shared by sync-all API and offline seed generator. */
export async function buildOfflineSyncPayload(
  prisma: PrismaClient,
  scope: OfflineSyncScope
): Promise<Record<string, unknown>> {
  const isCityAdmin = scope.role === "city_admin";
  const cityFilter = isCityAdmin ? scope.cityId! : undefined;
  const countryFilter = isCityAdmin ? scope.countryId! : undefined;
  const emptyArr: never[] = [];

  const lotWhere = isCityAdmin
    ? {
        countryId: countryFilter,
        lotCityDistributions: { some: { cityId: cityFilter } },
      }
    : undefined;

  const godownTransferWhere = cityFilter
    ? {
        OR: [
          { fromGodown: { cityId: cityFilter } },
          { toGodown: { cityId: cityFilter } },
        ],
      }
    : undefined;

  const [
    countries,
    currencies,
    cityCurrencies,
    cities,
    godowns,
    products,
    customers,
    bankAccounts,
    openingCashes,
    openingCustomerBalances,
    openingStocks,
  ] = await Promise.all([
    prisma.country.findMany({
      where: countryFilter ? { id: countryFilter } : undefined,
      include: { cities: cityFilter ? { where: { id: cityFilter } } : true },
    }),
    prisma.currency.findMany(),
    cityFilter
      ? prisma.cityCurrency.findMany({
          where: { cityId: cityFilter },
          include: { currency: { select: { id: true, code: true, symbol: true } } },
          orderBy: { currencyId: "asc" },
        })
      : prisma.cityCurrency.findMany({
          include: { currency: { select: { id: true, code: true, symbol: true } } },
          orderBy: [{ cityId: "asc" }, { currencyId: "asc" }],
        }),
    prisma.city.findMany({ where: cityFilter ? { id: cityFilter } : undefined }),
    prisma.godown.findMany({ where: cityFilter ? { cityId: cityFilter } : undefined }),
    prisma.product.findMany({ where: { isActive: true } }),
    prisma.customer.findMany({ where: cityFilter ? { cityId: cityFilter } : undefined }),
    prisma.bankAccount.findMany({ where: cityFilter ? { cityId: cityFilter } : undefined }),
    cityFilter
      ? prisma.openingCash.findMany({
          where: { cityId: cityFilter },
          include: { currency: { select: { code: true, symbol: true } } },
        })
      : isCityAdmin
        ? Promise.resolve(emptyArr)
        : prisma.openingCash.findMany({
            include: { currency: { select: { code: true, symbol: true } } },
          }),
    cityFilter
      ? prisma.openingCustomerBalance.findMany({
          where: { customer: { cityId: cityFilter } },
          include: {
            customer: { select: { id: true, name: true } },
            currency: { select: { code: true, symbol: true } },
          },
        })
      : isCityAdmin
        ? Promise.resolve(emptyArr)
        : prisma.openingCustomerBalance.findMany({
            include: {
              customer: { select: { id: true, name: true } },
              currency: { select: { code: true, symbol: true } },
            },
          }),
    cityFilter
      ? prisma.openingStock.findMany({
          where: { cityId: cityFilter },
          include: {
            godown: { select: { id: true, name: true } },
            product: { select: { id: true, name: true } },
          },
        })
      : isCityAdmin
        ? Promise.resolve(emptyArr)
        : prisma.openingStock.findMany({
            include: {
              godown: { select: { id: true, name: true } },
              product: { select: { id: true, name: true } },
            },
          }),
  ]);

  const [
    suppliers,
    agents,
    shippingLines,
    intermediaries,
    investors,
    openingLiabilities,
  ] = isCityAdmin
    ? [emptyArr, emptyArr, emptyArr, emptyArr, emptyArr, emptyArr]
    : await Promise.all([
        prisma.supplier.findMany(),
        prisma.agent.findMany(),
        prisma.shippingLine.findMany(),
        prisma.intermediary.findMany(),
        prisma.investor.findMany({ include: { accounts: true } }),
        prisma.openingLiability.findMany({
          include: {
            currency: { select: { id: true, code: true, symbol: true } },
            supplier: { select: { id: true, name: true } },
            shippingLine: { select: { id: true, name: true } },
            agent: { select: { id: true, name: true } },
            intermediary: { select: { id: true, name: true } },
          },
        }),
      ]);

  const rawLots = await prisma.lot.findMany({
    where: lotWhere,
    orderBy: { lotDate: "desc" },
    include: {
      country: { select: { name: true, code: true } },
      lotProducts: { include: { product: { select: { id: true, name: true } } } },
      lotCityDistributions: {
        include: {
          city: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
          godownAllocations: { include: { godown: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  const lots = rawLots.map(mapLotForOffline);

  const [
    sales,
    payments,
    expenses,
    personalWithdrawals,
    hajiTransfers,
    bankDeposits,
    cityTransfers,
    voucherSequences,
    lotPurchases,
    lotCosts,
    godownTransfers,
  ] = await Promise.all([
    prisma.sale.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      include: { items: true, discounts: true },
      orderBy: { saleDate: "desc" },
    }),
    prisma.payment.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      orderBy: { paymentDate: "desc" },
    }),
    prisma.expense.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      orderBy: { expenseDate: "desc" },
    }),
    prisma.personalWithdrawal.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      orderBy: { withdrawalDate: "desc" },
    }),
    prisma.hajiTransfer.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      orderBy: { transferDate: "desc" },
    }),
    prisma.bankDeposit.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
      orderBy: { depositDate: "desc" },
    }),
    prisma.cityTransfer.findMany({
      where: cityFilter
        ? { OR: [{ fromCityId: cityFilter }, { toCityId: cityFilter }] }
        : undefined,
      orderBy: { transferDate: "desc" },
    }),
    prisma.voucherSequence.findMany({
      where: cityFilter ? { cityId: cityFilter } : undefined,
    }),
    prisma.lotPurchase.findMany({
      where: lotWhere ? { lot: lotWhere } : undefined,
      include: { product: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
      orderBy: { id: "desc" },
    }),
    prisma.lotCost.findMany({
      where: lotWhere ? { lot: lotWhere } : undefined,
      orderBy: { id: "desc" },
    }),
    prisma.godownTransfer.findMany({
      where: godownTransferWhere,
      include: {
        fromGodown: { select: { id: true, name: true, cityId: true } },
        toGodown: { select: { id: true, name: true, cityId: true } },
        product: { select: { id: true, name: true } },
        lot: { select: { id: true, lotNumber: true } },
      },
      orderBy: { transferDate: "desc" },
    }),
  ]);

  const [
    supplierPayments,
    agentPayments,
    shippingLinePayments,
    intermediaryDeposits,
    intermediaryExchanges,
    investorDeposits,
    investorWithdrawals,
    superAdminExpenses,
  ] = isCityAdmin
    ? [emptyArr, emptyArr, emptyArr, emptyArr, emptyArr, emptyArr, emptyArr, emptyArr]
    : await Promise.all([
        prisma.supplierPayment.findMany({ orderBy: { paymentDate: "desc" } }),
        prisma.agentPayment.findMany({ orderBy: { paymentDate: "desc" } }),
        prisma.shippingLinePayment.findMany({ orderBy: { paymentDate: "desc" } }),
        prisma.intermediaryDeposit.findMany({ orderBy: { depositDate: "desc" } }),
        prisma.intermediaryExchange.findMany({ orderBy: { exchangeDate: "desc" } }),
        prisma.investorDeposit.findMany({ orderBy: { depositDate: "desc" } }),
        prisma.investorWithdrawal.findMany({ orderBy: { withdrawalDate: "desc" } }),
        prisma.superAdminPersonalExpense.findMany({ orderBy: { expenseDate: "desc" } }),
      ]);

  const payload: Record<string, unknown> = {
    countries,
    currencies,
    cityCurrencies,
    cities,
    godowns,
    products,
    customers,
    suppliers,
    agents,
    shippingLines,
    intermediaries,
    investors,
    bankAccounts,
    lots,
    sales,
    payments,
    expenses,
    personalWithdrawals,
    hajiTransfers,
    supplierPayments,
    agentPayments,
    shippingLinePayments,
    bankDeposits,
    cityTransfers,
    openingCashes,
    openingCustomerBalances,
    openingStocks,
    openingLiabilities,
    intermediaryDeposits,
    intermediaryExchanges,
    investorDeposits,
    investorWithdrawals,
    superAdminExpenses,
    voucherSequences,
    lotPurchases,
    lotCosts,
    godownTransfers,
  };

  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(payload)) {
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  payload.counts = counts;
  payload.syncedAt = new Date().toISOString();

  return payload;
}
