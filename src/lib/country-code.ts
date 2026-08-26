export const COUNTRY_CODES = {
  PAKISTAN: "PK",
  AFGHANISTAN: "AF",
} as const;

type CountryIdentity = { code?: string | null; name?: string | null } | null | undefined;

export function isPakistanCountry(country: CountryIdentity) {
  return String(country?.code || "").toUpperCase() === COUNTRY_CODES.PAKISTAN;
}

export function isAfghanistanCountry(country: CountryIdentity) {
  return String(country?.code || "").toUpperCase() === COUNTRY_CODES.AFGHANISTAN;
}
