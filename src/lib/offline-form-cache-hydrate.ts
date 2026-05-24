import { readOfflineAuthCache } from "@/lib/offline-auth-cache";
import { writeOfflineFormCache } from "@/lib/offline-form-cache";

const EXPENSES_FORM_CACHE_KEY = "mrf-expenses-form-cache-v1";
const PAYMENTS_FORM_CACHE_KEY = "mrf-payments-form-cache-v1";
const HAJI_FORM_CACHE_KEY = "mrf-haji-form-cache-v1";
const WITHDRAWALS_FORM_CACHE_KEY = "mrf-withdrawals-form-cache-v1";
const BANK_DEPOSITS_FORM_CACHE_KEY = "mrf-bank-deposits-form-cache-v1";
const CITY_TRANSFERS_FORM_CACHE_KEY = "mrf-city-transfers-form-cache-v1";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mergeCitiesWithCurrencies(cities: unknown[], cityCurrencies: unknown[]): unknown[] {
  const currenciesByCity = new Map<number, unknown[]>();
  for (const row of cityCurrencies) {
    const record = row as { cityId?: number; currency?: unknown };
    const cityId = Number(record.cityId);
    if (!cityId) continue;
    const currency = record.currency ?? record;
    if (!currenciesByCity.has(cityId)) currenciesByCity.set(cityId, []);
    currenciesByCity.get(cityId)!.push(currency);
  }
  return cities.map((city) => {
    const c = city as { id?: number };
    return { ...c, currencies: currenciesByCity.get(Number(c.id)) || [] };
  });
}

function ongoingLots(lots: unknown[]): unknown[] {
  return lots.filter((lot) => String((lot as { status?: string }).status || "") === "ongoing");
}

function inHandCheques(payments: unknown[]): unknown[] {
  return payments.filter((payment) => {
    const p = payment as {
      status?: string;
      paymentMethod?: string;
      destination?: string;
      chequeStatus?: string;
    };
    return (
      p.status === "active" &&
      p.paymentMethod === "cheque" &&
      p.destination === "our_account" &&
      p.chequeStatus === "in_hand"
    );
  });
}

function cityBankAccounts(bankAccounts: unknown[], cityId: number | null): unknown[] {
  if (!cityId) return asArray(bankAccounts);
  return bankAccounts.filter((row) => Number((row as { cityId?: number }).cityId) === cityId);
}

function withdraweeOptions(withdrawals: unknown[]): string[] {
  const names = new Set<string>();
  for (const row of withdrawals) {
    const name = String((row as { withdrawnBy?: string }).withdrawnBy || "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function currenciesForCity(citiesWithCurrencies: unknown[], cityId: number | null): unknown[] {
  if (!cityId) return [];
  const city = citiesWithCurrencies.find((c) => Number((c as { id?: number }).id) === cityId);
  return asArray((city as { currencies?: unknown[] })?.currencies);
}

function uniqueCurrencies(cityCurrencies: unknown[]): unknown[] {
  const seen = new Set<number>();
  const result: unknown[] = [];
  for (const row of cityCurrencies) {
    const record = row as { currency?: { id?: number }; currencyId?: number };
    const currency = record.currency ?? row;
    const id = Number((currency as { id?: number })?.id ?? record.currencyId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(currency);
  }
  return result;
}

/** Seed create-form dropdown caches from a completed full sync payload. */
export function hydrateFormCachesFromSyncData(data: Record<string, unknown>): void {
  if (typeof window === "undefined") return;

  const cachedUser = readOfflineAuthCache(window.localStorage)?.user;
  const cityId = cachedUser?.cityId ?? null;
  const countryName = cachedUser?.countryName ?? null;

  const cities = mergeCitiesWithCurrencies(asArray(data.cities), asArray(data.cityCurrencies));
  const lots = ongoingLots(asArray(data.lots));
  const allLots = asArray(data.lots);
  const products = asArray(data.products);
  const godowns = asArray(data.godowns);
  const bankAccounts = asArray(data.bankAccounts);
  const payments = asArray(data.payments);
  const withdrawals = asArray(data.personalWithdrawals);
  const cheques = inHandCheques(payments);
  const cityCurrencies = asArray(data.cityCurrencies);
  const currencies = cityId
    ? currenciesForCity(cities, cityId)
    : uniqueCurrencies(cityCurrencies);
  const cityAccounts = cityId ? cityBankAccounts(bankAccounts, cityId) : bankAccounts;

  if (currencies.length === 0) return;

  writeOfflineFormCache(EXPENSES_FORM_CACHE_KEY, {
    lots,
    currencies,
    bankAccounts: cityAccounts,
    inHandCheques: cheques,
  });

  writeOfflineFormCache(PAYMENTS_FORM_CACHE_KEY, {
    lots: allLots,
    currencies,
    cityBankAccounts: cityAccounts,
    superAdminBankAccounts: [],
  });

  writeOfflineFormCache(HAJI_FORM_CACHE_KEY, {
    lots,
    currencies,
    bankAccounts: cityAccounts,
    inHandCheques: cheques,
  });

  writeOfflineFormCache(WITHDRAWALS_FORM_CACHE_KEY, {
    currencies,
    inHandCheques: cheques,
    withdraweeOptions: withdraweeOptions(withdrawals),
  });

  writeOfflineFormCache(BANK_DEPOSITS_FORM_CACHE_KEY, {
    bankAccounts: cityAccounts,
    currencies,
    inHandCheques: cheques,
  });

  const transferCities = countryName && cityId
    ? cities.filter(
        (c) =>
          Number((c as { id?: number }).id) !== cityId &&
          String(
            (c as { country?: { name?: string }; countryName?: string }).country?.name ||
              (c as { countryName?: string }).countryName ||
              ""
          ) === countryName
      )
    : cities.filter((c) => !cityId || Number((c as { id?: number }).id) !== cityId);
  const myGodowns = cityId
    ? godowns.filter((g) => Number((g as { cityId?: number }).cityId) === cityId)
    : godowns;

  writeOfflineFormCache(CITY_TRANSFERS_FORM_CACHE_KEY, {
    cities: transferCities,
    godowns: myGodowns,
    products,
    lots: allLots,
  });
}
