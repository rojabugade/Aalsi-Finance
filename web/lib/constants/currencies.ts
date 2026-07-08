/** Common base currencies for money-entry selects. Kept short and scannable;
 *  the API still accepts any ISO-4217 code, this just covers the frequent ones. */
export const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "CHF",
  "SGD",
  "AED",
] as const;
