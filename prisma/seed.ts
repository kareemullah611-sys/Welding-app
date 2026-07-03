// prisma/seed.ts
// Run: npx tsx prisma/seed.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

function requiredSeedPassword(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for seeding user accounts.`);
  }
  if (value.length < 8) {
    throw new Error(`${name} must be at least 8 characters.`);
  }
  return value;
}

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Countries
  const pakistan = await prisma.country.upsert({
    where: { code: "PK" },
    update: {},
    create: { name: "Pakistan", code: "PK" },
  });

  const afghanistan = await prisma.country.upsert({
    where: { code: "AF" },
    update: {},
    create: { name: "Afghanistan", code: "AF" },
  });

  console.log("✅ Countries: Pakistan, Afghanistan");

  // 2. Currencies
  const pkr = await prisma.currency.upsert({
    where: { code: "PKR" },
    update: {},
    create: { code: "PKR", name: "Pakistani Rupee", symbol: "Rs" },
  });

  const afn = await prisma.currency.upsert({
    where: { code: "AFN" },
    update: {},
    create: { code: "AFN", name: "Afghan Afghani", symbol: "؋" },
  });

  const usd = await prisma.currency.upsert({
    where: { code: "USD" },
    update: {},
    create: { code: "USD", name: "US Dollar", symbol: "$" },
  });

  const cny = await prisma.currency.upsert({
    where: { code: "CNY" },
    update: {},
    create: { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  });

  console.log("✅ Currencies: PKR, AFN, USD, CNY");

  // 3. Cities (all 6)
  const existingKarachi = await prisma.city.findUnique({
    where: { countryId_name: { countryId: pakistan.id, name: "Karachi" } },
  });
  const existingQuetta = await prisma.city.findUnique({
    where: { countryId_name: { countryId: pakistan.id, name: "Quetta" } },
  });

  const quetta = existingKarachi && !existingQuetta
    ? await prisma.city.update({
        where: { id: existingKarachi.id },
        data: { name: "Quetta" },
      })
    : await prisma.city.upsert({
        where: { countryId_name: { countryId: pakistan.id, name: "Quetta" } },
        update: {},
        create: { countryId: pakistan.id, name: "Quetta" },
      });

  const lahore = await prisma.city.upsert({
    where: { countryId_name: { countryId: pakistan.id, name: "Lahore" } },
    update: {},
    create: { countryId: pakistan.id, name: "Lahore" },
  });

  const kabul = await (async () => {
    const renamed = await prisma.city.findUnique({
      where: { countryId_name: { countryId: afghanistan.id, name: "Saif Uddin" } },
    });
    if (renamed) return renamed;
    const legacy = await prisma.city.findUnique({
      where: { countryId_name: { countryId: afghanistan.id, name: "Kabul" } },
    });
    if (legacy) {
      return prisma.city.update({ where: { id: legacy.id }, data: { name: "Saif Uddin" } });
    }
    return prisma.city.create({ data: { countryId: afghanistan.id, name: "Saif Uddin" } });
  })();

  const herat = await (async () => {
    const renamed = await prisma.city.findUnique({
      where: { countryId_name: { countryId: afghanistan.id, name: "Abdul Khaliq" } },
    });
    if (renamed) return renamed;
    const legacy = await prisma.city.findUnique({
      where: { countryId_name: { countryId: afghanistan.id, name: "Herat" } },
    });
    if (legacy) {
      return prisma.city.update({ where: { id: legacy.id }, data: { name: "Abdul Khaliq" } });
    }
    return prisma.city.create({ data: { countryId: afghanistan.id, name: "Abdul Khaliq" } });
  })();

  const kandahar = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Kandahar" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Kandahar" },
  });

  const weshBorder = await prisma.city.upsert({
    where: { countryId_name: { countryId: afghanistan.id, name: "Wesh Border" } },
    update: {},
    create: { countryId: afghanistan.id, name: "Wesh Border" },
  });

  console.log("✅ Cities: Quetta, Lahore, Saif Uddin, Abdul Khaliq, Kandahar, Wesh Border");

  // 4. City Currencies
  const cityCurrencyPairs = [
    { cityId: quetta.id,    currencyId: pkr.id },
    { cityId: lahore.id,    currencyId: pkr.id },
    { cityId: kabul.id,     currencyId: afn.id },
    { cityId: kabul.id,     currencyId: usd.id },
    { cityId: herat.id,     currencyId: afn.id },
    { cityId: herat.id,     currencyId: usd.id },
    { cityId: kandahar.id,  currencyId: afn.id },
    { cityId: kandahar.id,  currencyId: usd.id },
    { cityId: weshBorder.id, currencyId: afn.id },
    { cityId: weshBorder.id, currencyId: usd.id },
  ];

  for (const pair of cityCurrencyPairs) {
    await prisma.cityCurrency.upsert({
      where: { cityId_currencyId: pair },
      update: {},
      create: pair,
    });
  }

  console.log("✅ City-Currency mappings");

  // 5. Voucher sequences
  for (const city of [quetta, lahore, kabul, herat, kandahar, weshBorder]) {
    await prisma.voucherSequence.upsert({
      where: { cityId: city.id },
      update: {},
      create: { cityId: city.id, currentNumber: 0 },
    });
  }

  console.log("✅ Voucher sequences");

  // 6. Super Admin user
  const adminPassword = requiredSeedPassword("ADMIN_PASSWORD");
  const cityAdminSeedPassword = requiredSeedPassword("CITY_ADMIN_PASSWORD");
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const superAdmin = await prisma.user.upsert({
    where: { username: "superadmin" },
    update: {},
    create: {
      username: "superadmin",
      passwordHash,
      fullName: "Super Administrator",
      role: "super_admin",
      cityId: null,
    },
  });

  console.log("✅ Super Admin: superadmin");

  // 7. City Admin users
  const cityAdminPassword = await bcrypt.hash(cityAdminSeedPassword, 12);

  const legacyKarachiAdmin = await prisma.user.findUnique({
    where: { username: "karachi_admin" },
  });
  const existingQuettaAdmin = await prisma.user.findUnique({
    where: { username: "quetta_admin" },
  });

  if (legacyKarachiAdmin && !existingQuettaAdmin) {
    await prisma.user.update({
      where: { id: legacyKarachiAdmin.id },
      data: {
        username: "quetta_admin",
        fullName: "Quetta Admin",
        cityId: quetta.id,
      },
    });
  }

  const cityAdmins = [
    { username: "quetta_admin",   fullName: "Quetta Admin",      cityId: quetta.id },
    { username: "lahore_admin",   fullName: "Lahore Admin",      cityId: lahore.id },
    { username: "kabul_admin",    fullName: "Saif Uddin Admin",   cityId: kabul.id },
    { username: "herat_admin",    fullName: "Abdul Khaliq Admin", cityId: herat.id },
    { username: "kandahar_admin", fullName: "Kandahar Admin",    cityId: kandahar.id },
    { username: "wesh_admin",     fullName: "Wesh Border Admin", cityId: weshBorder.id },
  ];

  for (const admin of cityAdmins) {
    await prisma.user.upsert({
      where: { username: admin.username },
      update: {
        fullName: admin.fullName,
        cityId: admin.cityId,
      },
      create: {
        username: admin.username,
        passwordHash: cityAdminPassword,
        fullName: admin.fullName,
        role: "city_admin",
        cityId: admin.cityId,
      },
    });
  }

  console.log("✅ City Admins: quetta_admin, lahore_admin, kabul_admin, herat_admin, kandahar_admin, wesh_admin");

  // 8. Products (your real product names)
  const products = ["3.2mm", "7018-12", "5.0mm", "2.5mm", "7018-10", "4.0mm"];
  for (const name of products) {
    await prisma.product.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log("✅ Products: 3.2mm, 7018-12, 5.0mm, 2.5mm, 7018-10, 4.0mm");

  // 9. Godowns (all 7)
  const quettaGodownRenames = [
    { from: "Karachi Main Warehouse", to: "Quetta Main Warehouse" },
    { from: "Karachi Port Godown", to: "Quetta City Godown" },
  ];

  for (const rename of quettaGodownRenames) {
    const oldGodown = await prisma.godown.findUnique({
      where: { cityId_name: { cityId: quetta.id, name: rename.from } },
    });
    const newGodown = await prisma.godown.findUnique({
      where: { cityId_name: { cityId: quetta.id, name: rename.to } },
    });
    if (oldGodown && !newGodown) {
      await prisma.godown.update({
        where: { id: oldGodown.id },
        data: { name: rename.to },
      });
    }
  }

  for (const rename of [
    { cityId: kabul.id, from: "Kabul Main Godown", to: "Saif Uddin Main Godown" },
    { cityId: herat.id, from: "Herat Warehouse", to: "Abdul Khaliq Warehouse" },
  ]) {
    const oldGodown = await prisma.godown.findUnique({
      where: { cityId_name: { cityId: rename.cityId, name: rename.from } },
    });
    const newGodown = await prisma.godown.findUnique({
      where: { cityId_name: { cityId: rename.cityId, name: rename.to } },
    });
    if (oldGodown && !newGodown) {
      await prisma.godown.update({
        where: { id: oldGodown.id },
        data: { name: rename.to },
      });
    }
  }

  const godownData = [
    { cityId: quetta.id,     name: "Quetta Main Warehouse" },
    { cityId: quetta.id,     name: "Quetta City Godown" },
    { cityId: lahore.id,     name: "Lahore Central Godown" },
    { cityId: kabul.id,      name: "Saif Uddin Main Godown" },
    { cityId: herat.id,      name: "Abdul Khaliq Warehouse" },
    { cityId: kandahar.id,   name: "Kandahar Main Godown" },
    { cityId: weshBorder.id, name: "Wesh Border Godown" },
  ];

  for (const gd of godownData) {
    await prisma.godown.upsert({
      where: { cityId_name: gd },
      update: {},
      create: gd,
    });
  }

  console.log("✅ Godowns: 7 godowns across 6 cities");

  // 10. Default supplier
  await prisma.supplier.upsert({
    where: { id: 1 },
    update: {},
    create: { name: "Main Welding Company", country: "China", contact: "supplier@example.com", notes: "Primary welding materials supplier" },
  });

  console.log("✅ Default supplier created");

  console.log("\n🎉 Seed complete! Usernames:");
  console.log("   superadmin     (Super Admin)");
  console.log("   quetta_admin");
  console.log("   lahore_admin");
  console.log("   kabul_admin");
  console.log("   herat_admin");
  console.log("   kandahar_admin");
  console.log("   wesh_admin");
  console.log("Passwords were read from ADMIN_PASSWORD and CITY_ADMIN_PASSWORD.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
