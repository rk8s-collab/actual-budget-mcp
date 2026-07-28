import { describe, it, expect } from 'vitest';
import { buildDemoDataset } from './dataset.js';

describe('buildDemoDataset', () => {
  const d = buildDemoDataset();

  it('has on-budget and off-budget accounts', () => {
    expect(d.accounts.some(a => !a.offBudget)).toBe(true);
    expect(d.accounts.some(a => a.offBudget)).toBe(true);
  });
  it('covers a transfer, a split, and an uncategorized transaction', () => {
    expect(d.transactions.some(t => t.transferAccount)).toBe(true);
    expect(d.transactions.some(t => t.splits && t.splits.length > 0)).toBe(true);
    expect(d.transactions.some(t => t.category === null)).toBe(true);
  });
  it('defines transfer payees and at least one rule', () => {
    expect(d.payees.some(p => p.transferAccount)).toBe(true);
    expect(d.rules.length).toBeGreaterThan(0);
  });
  it('references only accounts/categories it defines', () => {
    const accts = new Set(d.accounts.map(a => a.name));
    const cats = new Set(d.categories.map(c => c.name));
    for (const t of d.transactions) {
      expect(accts.has(t.account)).toBe(true);
      if (t.category) expect(cats.has(t.category)).toBe(true);
    }
  });
  it('is deterministic', () => {
    expect(buildDemoDataset()).toEqual(buildDemoDataset());
  });
});
