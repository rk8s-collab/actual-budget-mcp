// rule-schema.ts — shape, validation and unit<->cent conversion for Actual rules.
//
// The field and op lists come from RuleConditionEntity in @actual-app/core
// (types/models/rule.d.ts). The full field x op matrix is NOT encoded: it is long,
// it changes upstream, and Actual validates the cross itself. What we do enforce is
// that the field and the op are known, the arrays are non-empty, id-typed values are
// UUIDs, and amounts arrive in currency units.
import { z } from 'zod';
import { toCents, toUnits } from './money.js';
import { activeMessages } from './messages.js';
import { ID } from './types.js';

/** Condition fields, exactly the union in RuleConditionEntity. */
const CONDITION_FIELDS = [
  'account', 'amount', 'category', 'category_group', 'date', 'notes',
  'payee', 'imported_payee', 'saved', 'cleared', 'reconciled', 'transfer',
] as const;

/** Every op that appears in the union, flattened. */
const CONDITION_OPS = [
  'is', 'isNot', 'oneOf', 'notOneOf', 'contains', 'doesNotContain', 'matches',
  'onBudget', 'offBudget', 'isapprox', 'isbetween', 'gt', 'gte', 'lt', 'lte',
  'hasTags', 'hasAnyTag',
] as const;

/** Fields whose value is an id when the op compares by identity. */
const ID_FIELDS = new Set(['account', 'category', 'category_group', 'payee']);
/** Ops that compare by identity rather than by text. */
const ID_OPS = new Set(['is', 'isNot', 'oneOf', 'notOneOf']);

const AMOUNT_RANGE = z.object({ num1: z.number(), num2: z.number() });

const CONDITION = z.object({
  field: z.enum(CONDITION_FIELDS, { error: () => activeMessages().unknownRuleField }),
  op: z.enum(CONDITION_OPS, { error: () => activeMessages().unknownRuleOp }),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), AMOUNT_RANGE, z.null()]),
  options: z.record(z.string(), z.unknown()).optional(),
});

const ACTION = z.object({
  op: z.literal('set'),
  field: z.enum(CONDITION_FIELDS, { error: () => activeMessages().unknownRuleField }),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const RULE_SHAPE = {
  stage: z.union([z.literal('pre'), z.literal('post'), z.null()], { error: () => activeMessages().unknownRuleStage })
    .describe("When the rule runs: 'pre', 'post', or null for the default stage"),
  conditionsOp: z.enum(['and', 'or']).describe('Whether all conditions must match or any of them'),
  conditions: z.array(CONDITION).min(1).max(20).describe('Conditions the transaction must satisfy'),
  actions: z.array(ACTION).min(1).max(20).describe('What to set on a matching transaction'),
};

export const RULE_OBJECT = z.object(RULE_SHAPE).superRefine((rule, ctx) => {
  // Identity comparisons on id fields must be UUIDs: the AQL compiler interpolates
  // them unescaped. Text comparisons (contains/matches) match names, not ids.
  const checkId = (value: unknown, path: (string | number)[]) => {
    if (!ID.safeParse(value).success) {
      ctx.addIssue({ code: 'custom', path, message: activeMessages().mustBeUuid });
    }
  };
  rule.conditions.forEach((c, i) => {
    if (!ID_FIELDS.has(c.field) || !ID_OPS.has(c.op)) return;
    const path = ['conditions', i, 'value'];
    if (Array.isArray(c.value)) c.value.forEach((v, j) => checkId(v, [...path, j]));
    else checkId(c.value, path);
  });
  rule.actions.forEach((a, i) => {
    if (ID_FIELDS.has(a.field)) checkId(a.value, ['actions', i, 'value']);
  });
});

const toCentsValue = (value: unknown): unknown => {
  if (typeof value === 'number') return toCents(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? toCents(v) : v));
  if (value && typeof value === 'object' && 'num1' in value && 'num2' in value) {
    const range = value as { num1: number; num2: number };
    return { num1: toCents(range.num1), num2: toCents(range.num2) };
  }
  return value;
};

const toUnitsValue = (value: unknown): unknown => {
  if (typeof value === 'number') return toUnits(value);
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? toUnits(v) : v));
  if (value && typeof value === 'object' && 'num1' in value && 'num2' in value) {
    const range = value as { num1: number; num2: number };
    return { num1: toUnits(range.num1), num2: toUnits(range.num2) };
  }
  return value;
};

/** Validated rule (units) -> the object @actual-app/api expects (cents). */
export function ruleToApi(rule: z.infer<typeof RULE_OBJECT>): any {
  return {
    stage: rule.stage,
    conditionsOp: rule.conditionsOp,
    conditions: rule.conditions.map((c) => ({ ...c, value: c.field === 'amount' ? toCentsValue(c.value) : c.value })),
    actions: rule.actions.map((a) => ({ ...a, value: a.field === 'amount' ? toCentsValue(a.value) : a.value })),
  };
}

/** A stored rule (cents) -> the shape tools return (units). */
export function ruleFromApi(entity: any): any {
  return {
    id: entity.id,
    stage: entity.stage ?? null,
    conditionsOp: entity.conditionsOp,
    conditions: (entity.conditions ?? []).map((c: any) => ({ ...c, value: c.field === 'amount' ? toUnitsValue(c.value) : c.value })),
    actions: (entity.actions ?? []).map((a: any) => ({ ...a, value: a.field === 'amount' ? toUnitsValue(a.value) : a.value })),
  };
}
