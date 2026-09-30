// One-off seed/cleanup for the hard-delete visibility click-through.
// Also creates/removes the "E2E Smoke Bank" fixture used by
// e2e/super-admin-finance.spec.ts (bank-account ledger dialog).
// Usage: node --import tsx scripts/e2e-hard-delete-seed.ts up|down
import prisma from "../src/lib/prisma";
import { getCustomerAccountId, getSalesRevenueAccountId, getCOGSAccountId } from "../src/lib/accounting";

const MARKER = {
  histCust: "E2E-Hist-Cust",
  plainCust: "E2E-Plain-Cust",
  plainPayCust: "E2E-Plain-Pay-Cust",
  histSale: "E2E-H1",
  plainSale: "E2E-P1",
  histPay: "E2E-HIST-PAY",
  plainPay: "E2E-PLAIN-PAY",
  smokeBank: "E2E Smoke Bank",
};

async function up() {
  const city = await prisma.city.findFirst({ where: { name: "Quetta", country: { code: "PK" } } });
  const admin = await prisma.user.findUnique({ where: { username: "superadmin" } });
  const pkr = await prisma.currency.findUnique({ where: { code: "PKR" } });
  if (!city || !admin || !pkr) throw new Error("seed data missing (Quetta/superadmin/PKR)");

  // Bank fixture must exist even when the rest of the seed is already applied.
  if (!(await prisma.superAdminBankAccount.findFirst({ where: { bankName: MARKER.smokeBank } }))) {
    await prisma.superAdminBankAccount.create({
      data: { bankName: MARKER.smokeBank, currencyId: pkr.id, createdBy: admin.id },
    });
  }

  if (await prisma.customer.findFirst({ where: { name: MARKER.histCust } })) {
    console.log("already seeded");
    return;
  }

  const histCust = await prisma.customer.create({ data: { cityId: city.id, name: MARKER.histCust, isActive: true } });
  const plainCust = await prisma.customer.create({ data: { cityId: city.id, name: MARKER.plainCust, isActive: true } });
  const godown = await prisma.godown.create({ data: { cityId: city.id, name: "E2E-Godown" } });
  const lot = await prisma.lot.create({
    data: { countryId: city.countryId, lotNumber: "E2E-LOT", lotDate: new Date("2026-09-01"), createdBy: admin.id },
  });

  // Sale WITH accounting history (SALE + COGS journals)
  const histSale = await prisma.sale.create({
    data: {
      cityId: city.id, customerId: histCust.id, lotId: lot.id, godownId: godown.id,
      voucherNo: MARKER.histSale, saleDate: new Date("2026-09-28"), totalAmount: 1000,
      currencyId: pkr.id, status: "active", createdBy: admin.id,
    },
  });
  const histCustomerAccount = await getCustomerAccountId(histCust.id);
  const revenueAccount = await getSalesRevenueAccountId();
  const cogsAccount = await getCOGSAccountId();
  await prisma.journalEntry.createMany({
    data: [
      { transactionId: `SALE-${histSale.id}`, lineNumber: 1, accountId: histCustomerAccount, debit: 1000, credit: 0, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
      { transactionId: `SALE-${histSale.id}`, lineNumber: 2, accountId: revenueAccount, debit: 0, credit: 1000, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
      { transactionId: `COGS-${histSale.id}`, lineNumber: 1, accountId: cogsAccount, debit: 600, credit: 0, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
      { transactionId: `COGS-${histSale.id}`, lineNumber: 2, accountId: cogsAccount, debit: 0, credit: 600, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
    ],
  });

  // Sale WITHOUT journals (journal-less row the backend still allows to erase)
  const plainSale = await prisma.sale.create({
    data: {
      cityId: city.id, customerId: histCust.id, lotId: lot.id, godownId: godown.id,
      voucherNo: MARKER.plainSale, saleDate: new Date("2026-09-27"), totalAmount: 500,
      currencyId: pkr.id, status: "active", createdBy: admin.id,
    },
  });

  // Payment WITH PAY journals (belongs to histCust; plainCust stays history-free)
  const histPay = await prisma.payment.create({
    data: {
      cityId: city.id, customerId: histCust.id, paymentDate: new Date("2026-09-28"),
      detail: MARKER.histPay, amount: 700, currencyId: pkr.id, paymentMethod: "cash",
      destination: "haji", createdBy: admin.id,
    },
  });
  await prisma.journalEntry.createMany({
    data: [
      { transactionId: `PAY-${histPay.id}`, lineNumber: 1, accountId: revenueAccount, debit: 0, credit: 700, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
      { transactionId: `PAY-${histPay.id}`, lineNumber: 2, accountId: histCustomerAccount, debit: 700, credit: 0, currencyCode: "PKR", description: "E2E seed", entryDate: new Date("2026-09-28"), createdBy: admin.id },
    ],
  });

  // Journal-less payment (own customer so the payments row is locatable by person)
  const plainPayCust = await prisma.customer.create({ data: { cityId: city.id, name: MARKER.plainPayCust, isActive: true } });
  const plainPay = await prisma.payment.create({
    data: {
      cityId: city.id, customerId: plainPayCust.id, paymentDate: new Date("2026-09-27"),
      detail: MARKER.plainPay, amount: 300, currencyId: pkr.id, paymentMethod: "cash",
      destination: "haji", createdBy: admin.id,
    },
  });

  console.log(JSON.stringify({ histSale: histSale.id, plainSale: plainSale.id, histPay: histPay.id, plainPay: plainPay.id }));
}

async function down() {
  const histCust = await prisma.customer.findFirst({ where: { name: MARKER.histCust } });
  const plainCust = await prisma.customer.findFirst({ where: { name: MARKER.plainCust } });
  const plainPayCust = await prisma.customer.findFirst({ where: { name: MARKER.plainPayCust } });
  const custIds = [histCust?.id, plainCust?.id, plainPayCust?.id].filter(Boolean) as number[];
  const sales = await prisma.sale.findMany({ where: { voucherNo: { in: [MARKER.histSale, MARKER.plainSale] } }, select: { id: true } });
  const payments = await prisma.payment.findMany({ where: { detail: { in: [MARKER.histPay, MARKER.plainPay] } }, select: { id: true } });
  const txnIds = [
    ...sales.flatMap((s) => [`SALE-${s.id}`, `COGS-${s.id}`, `REV-SALE-${s.id}`, `REV-COGS-${s.id}`]),
    ...payments.flatMap((p) => [`PAY-${p.id}`, `REV-PAY-${p.id}`]),
  ];
  await prisma.journalEntry.deleteMany({ where: { transactionId: { in: txnIds } } });
  await prisma.sale.deleteMany({ where: { id: { in: sales.map((s) => s.id) } } });
  await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
  await prisma.lot.deleteMany({ where: { lotNumber: "E2E-LOT" } });
  await prisma.godown.deleteMany({ where: { name: "E2E-Godown" } });
  await prisma.superAdminBankAccount.deleteMany({ where: { bankName: MARKER.smokeBank } });
  if (custIds.length) {
    await prisma.account.deleteMany({ where: { code: { in: custIds.map((id) => `1200-C${id}`) }, journalEntries: { none: {} } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  }
  console.log("cleaned");
}

const cmd = process.argv[2];
if (cmd === "up") up().then(() => prisma.$disconnect());
else if (cmd === "down") down().then(() => prisma.$disconnect());
else throw new Error("usage: e2e-hard-delete-seed.ts up|down");
