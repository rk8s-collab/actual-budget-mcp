// money.ts — única frontera de conversión céntimos<->unidades. Nada fuera de
// este módulo convierte importes.
export function toUnits(cents: number): number {
  return Math.round(cents) / 100;
}

export function toCents(units: number): number {
  return Math.round(units * 100);
}

export function formatAmount(cents: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(toUnits(cents));
}

export function moneyFields(cents: number, locale: string, currency: string) {
  return { amount: toUnits(cents), amount_formatted: formatAmount(cents, locale, currency) };
}
