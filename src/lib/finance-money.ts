/** Money stays in integer minor units. There is no currency conversion. */
export function currencyExponent(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency))
    throw new Error("Choose a supported three-letter currency.");
  const exponent = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;
  if (exponent === undefined || exponent > 3) throw new Error("Unsupported currency precision.");
  return exponent;
}

/** Strict decimal parsing, including zero and negatives for preserved provider/history rows. */
export function decimalToMinorUnits(value: string | number, currency = "USD"): number {
  const exponent = currencyExponent(currency);
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[3]?.length ?? 0) > exponent)
    throw new Error("Amount does not match the currency's precision.");
  const minor =
    BigInt(match[2]!) * 10n ** BigInt(exponent) +
    BigInt((match[3] ?? "").padEnd(exponent, "0") || "0");
  const signed = match[1] ? -minor : minor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error("Amount exceeds the supported range.");
  return Number(signed);
}

export function parseFinanceAmount(value: string, currency = "USD"): number | null {
  try {
    const text = value.trim().replace(currency === "USD" ? /^\$/ : /$^/, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d+)?$/.test(text) || !text) return null;
    const normalized = text.replaceAll(",", "");
    const amount = decimalToMinorUnits(
      normalized.startsWith(".") ? `0${normalized}` : normalized,
      currency,
    );
    return amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

export function minorUnitsDecimal(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new Error("Amount must be safe integer minor units.");
  const exponent = currencyExponent(currency),
    absolute = BigInt(Math.abs(amount));
  if (!exponent) return `${amount < 0 ? "-" : ""}${absolute}`;
  const digits = absolute.toString().padStart(exponent + 1, "0");
  return `${amount < 0 ? "-" : ""}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function formatFinanceMoney(amount: number, currency: string, locale = "en-US"): string {
  const text = minorUnitsDecimal(amount, currency),
    [whole = "0", fraction] = text.split(".");
  const signedWhole = whole === "-0" ? -0 : BigInt(whole);
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(
    signedWhole,
  );
  const fractionText =
    fraction === undefined
      ? ""
      : new Intl.NumberFormat(locale, {
          useGrouping: false,
          minimumIntegerDigits: fraction.length,
          maximumFractionDigits: 0,
        }).format(Number(fraction));
  return parts.map((part) => (part.type === "fraction" ? fractionText : part.value)).join("");
}
