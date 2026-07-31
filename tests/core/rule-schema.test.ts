import { describe, it, expect } from 'vitest';
import { RULE_OBJECT, ruleToApi, ruleFromApi } from '../../src/core/rule-schema.js';

const CAT = '11111111-1111-4111-8111-111111111111';
const PAYEE = '22222222-2222-4222-8222-222222222222';

const baseRule = {
  stage: null,
  conditionsOp: 'and',
  conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }],
  actions: [{ op: 'set', field: 'category', value: CAT }],
};

describe('RULE_OBJECT validation', () => {
  it('accepts a well-formed rule', () => {
    expect(RULE_OBJECT.safeParse(baseRule).success).toBe(true);
  });

  it('accepts the three stages', () => {
    for (const stage of ['pre', 'post', null]) {
      expect(RULE_OBJECT.safeParse({ ...baseRule, stage }).success, String(stage)).toBe(true);
    }
  });

  it('rejects an unknown stage', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, stage: 'default' }).success).toBe(false);
  });

  it('rejects an unknown condition field and an unknown op', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'nope', op: 'is', value: 'x' }] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'nope', value: 'x' }] }).success).toBe(false);
  });

  it('rejects empty conditions or actions', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, actions: [] }).success).toBe(false);
  });

  it('rejects a non-UUID value on an id-typed field', () => {
    // The AQL compiler interpolates id values unescaped: this is the injection barrier.
    expect(RULE_OBJECT.safeParse({ ...baseRule, actions: [{ op: 'set', field: 'category', value: "x' OR 1=1" }] }).success).toBe(false);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'is', value: 'not-a-uuid' }] }).success).toBe(false);
  });

  it('allows a free-text value on an id field when the op is textual', () => {
    // `payee contains "Landlord"` matches on the payee NAME, not on an id.
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }] }).success).toBe(true);
  });

  it('accepts an array value for oneOf and a range for isbetween', () => {
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'payee', op: 'oneOf', value: [PAYEE] }] }).success).toBe(true);
    expect(RULE_OBJECT.safeParse({ ...baseRule, conditions: [{ field: 'amount', op: 'isbetween', value: { num1: -50, num2: -10 } }] }).success).toBe(true);
  });
});

describe('ruleToApi / ruleFromApi', () => {
  it('converts amount conditions to cents', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] }));
    expect(api.conditions[0].value).toBe(-4550);
  });

  it('converts both ends of an isbetween range', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'isbetween', value: { num1: -50, num2: -10.25 } }] }));
    expect(api.conditions[0].value).toEqual({ num1: -5000, num2: -1025 });
  });

  it('converts every element of an amount oneOf', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'oneOf', value: [-1.5, -2.25] }] }));
    expect(api.conditions[0].value).toEqual([-150, -225]);
  });

  it('converts a set-amount action to cents', () => {
    const api = ruleToApi(RULE_OBJECT.parse({ ...baseRule, actions: [{ op: 'set', field: 'amount', value: 12.34 }] }));
    expect(api.actions[0].value).toBe(1234);
  });

  it('leaves non-amount values alone', () => {
    const api = ruleToApi(RULE_OBJECT.parse(baseRule));
    expect(api.conditions[0].value).toBe('Landlord');
    expect(api.actions[0].value).toBe(CAT);
  });

  it('round-trips back into units', () => {
    const stored = {
      id: 'rule-1',
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'amount', op: 'lt', value: -4550 }],
      actions: [{ op: 'set', field: 'amount', value: 1234 }],
    };
    const out = ruleFromApi(stored);
    expect(out.id).toBe('rule-1');
    expect(out.conditions[0].value).toBe(-45.5);
    expect(out.actions[0].value).toBe(12.34);
  });

  it('does not mutate its input', () => {
    const parsed = RULE_OBJECT.parse({ ...baseRule, conditions: [{ field: 'amount', op: 'lt', value: -45.5 }] });
    ruleToApi(parsed);
    expect(parsed.conditions[0].value).toBe(-45.5);
  });
});
