import { describe, it, expect } from 'vitest';
import { toUnits, toCents, formatAmount, moneyFields } from '../../src/core/money.js';

describe('money', () => {
  it('converts cents to units with 2 decimals', () => {
    expect(toUnits(162498)).toBe(1624.98);
    expect(toUnits(-2305)).toBe(-23.05);
    expect(toUnits(0)).toBe(0);
  });
  it('converts units to integer cents without float drift', () => {
    expect(toCents(60.5)).toBe(6050);
    expect(toCents(0.1 + 0.2)).toBe(30); // classic float trap
    expect(toCents(-19.99)).toBe(-1999);
  });
  it('round-trips', () => {
    expect(toCents(toUnits(33333))).toBe(33333);
  });
  it('formats with es-ES / EUR', () => {
    // Node v26 / ICU 78 (CLDR): el es-ES NO agrupa números de 4 dígitos (1624, no 1.624)
    // y usa espacio duro U+00A0 antes del símbolo. Fijamos el string a lo que ICU emite.
    expect(formatAmount(162498, 'es-ES', 'EUR')).toBe('1624,98 €');
  });
  it('formats with en-US / USD', () => {
    expect(formatAmount(-2305, 'en-US', 'USD')).toBe('-$23.05');
  });
  it('moneyFields returns both fields', () => {
    expect(moneyFields(12000, 'en-US', 'USD')).toEqual({ amount: 120, amount_formatted: '$120.00' });
  });
});

describe('half-away-from-zero (decisión 2026-07-22)', () => {
  it('rounds negative half cents away from zero', () => {
    expect(toCents(-0.015)).toBe(-2);   // Math.round daría -1
    expect(toCents(0.015)).toBe(2);
    expect(toCents(-0.025)).toBe(-3);   // Math.round daría -2
  });
  it('negative round-trip is stable', () => {
    expect(toCents(toUnits(-33333))).toBe(-33333);
  });
  it('does not disturb exact values', () => {
    expect(toCents(-19.99)).toBe(-1999);
    expect(toUnits(-2305)).toBe(-23.05);
  });
});
