import { NextRequest } from "next/server";
import { withAuth, ApiHandler } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import prisma from "@/lib/prisma";

const syncAllHandler: ApiHandler = async (_request, _context, user) => {
  try {
    const isCityAdmin = user.role === "city_admin";
    const cityFilter = isCityAdmin ? user.cityId! : undefined;
    const countryFilter = isCityAdmin ? user.countryId! : undefined;
    const emptyArr: never[] = [];

    const lotWhere = isCityAdmin
      ? {
          countryId: countryFilter,
          lotCityDistributions: { some: { cityId: cityFilter } },
        }
      : undefined;

    // ── Accessible to both roles ──
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
        include: {
          cities: cityFilter ? { where: { id: cityFilter } } : true,
        },
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

    // ── Super-admin only entities ──
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

    // ── Transactional data (no take limits — full offline archive) ──
    const [
      lots,
      sales,
      payments,
      expenses,
      personalWithdrawals,
      hajiTransfers,
      bankDeposits,
      cityTransfers,
      voucherSequences,
    ] = await Promise.all([
      prisma.lot.findMany({
        where: lotWhere,
        orderBy: { lotDate: "desc" },
      }),
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
    ]);

    // ── Super-admin only transactional data ──
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

    const counts = {
      countries: countries.length, currencies: currencies.length,
      cityCurrencies: cityCurrencies.length, cities: cities.length,
      godowns: godowns.length, products: products.length,
      customers: customers.length, suppliers: suppliers.length,
      agents: agents.length, shippingLines: shippingLines.length,
      intermediaries: intermediaries.length, investors: investors.length,
      bankAccounts: bankAccounts.length, lots: lots.length, sales: sales.length,
      payments: payments.length, expenses: expenses.length,
      personalWithdrawals: personalWithdrawals.length, hajiTransfers: hajiTransfers.length,
      supplierPayments: supplierPayments.length, agentPayments: agentPayments.length,
      shippingLinePayments: shippingLinePayments.length,
      bankDeposits: bankDeposits.length, cityTransfers: cityTransfers.length,
      openingCashes: openingCashes.length, openingCustomerBalances: openingCustomerBalances.length,
      openingStocks: openingStocks.length, openingLiabilities: openingLiabilities.length,
      intermediaryDeposits: intermediaryDeposits.length, intermediaryExchanges: intermediaryExchanges.length,
      investorDeposits: investorDeposits.length, investorWithdrawals: investorWithdrawals.length,
      superAdminExpenses: superAdminExpenses.length, voucherSequences: voucherSequences.length,
    };

    return successResponse({
      syncedAt: new Date().toISOString(),
      countries, currencies, cityCurrencies, cities, godowns, products, customers,
      suppliers, agents, shippingLines, intermediaries, investors, bankAccounts,
      lots, sales, payments, expenses, personalWithdrawals, hajiTransfers,
      supplierPayments, agentPayments, shippingLinePayments,
      bankDeposits, cityTransfers,
      openingCashes, openingCustomerBalances, openingStocks, openingLiabilities,
      intermediaryDeposits, intermediaryExchanges,
      investorDeposits, investorWithdrawals,
      superAdminExpenses, voucherSequences,
      counts,
    });
  } catch (error) {
    console.error("sync-all error:", error);
    return errorResponse("SYNC_FAILED", "Failed to sync data", 500);
  }
};

export const GET = withAuth(syncAllHandler);
