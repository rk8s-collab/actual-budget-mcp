import { describe, it, expect } from 'vitest';
import { ID } from '../../src/core/types.js';

describe('ID schema', () => {
  it('accepts a real UUID', () => {
    expect(ID.safeParse('571f5507-a390-43fa-b7bd-34bc46eacc98').success).toBe(true);
  });
  it('rejects SQL-injection style ids', () => {
    expect(ID.safeParse("aaa' OR '1'='1").success).toBe(false);
    expect(ID.safeParse("x') OR 1=1 --").success).toBe(false);
  });
  it('rejects AQL field references starting with $', () => {
    expect(ID.safeParse('$notes').success).toBe(false);
  });
});
