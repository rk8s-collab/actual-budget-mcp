// money.ts — única frontera de conversión céntimos<->unidades. Nada fuera de
// este módulo convierte importes.
// Redondeo half-away-from-zero: -1,5 → -2 (Math.round daría -1). Decisión 2026-07-22,
// necesario para splits proporcionales con importes negativos.
function roundHalfAwayFromZero(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function toUnits(cents: number): number {
  return roundHalfAwayFromZero(cents) / 100;
}

export function toCents(units: number): number {
  return roundHalfAwayFromZero(units * 100);
}

export function formatAmount(cents: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toUnits(cents));
}

export function moneyFields(cents: number, locale: string, currency: string) {
  return { amount: toUnits(cents), amount_formatted: formatAmount(cents, locale, currency) };
}
