import { describe, it, expect } from 'vitest';
import { tool } from '../../src/tools/get_payees.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';
const payees = [
  { id: P1, name: 'Landlord', transfer_acct: null },
  { id: P2, name: 'Savings', transfer_acct: A1 },
];

describe('get_payees', () => {
  it('returns every payee with its transfer account', async () => {
    const r: any = await tool.handler({}, { api: mockApi({ getPayees: async () => payees }), config: testConfig });
    expect(r.payees).toEqual([
      { id: P1, name: 'Landlord', transfer_account_id: null },
      { id: P2, name: 'Savings', transfer_account_id: A1 },
    ]);
  });

  it('filters down to transfer payees on request', async () => {
    const r: any = await tool.handler({ only_transfers: true }, { api: mockApi({ getPayees: async () => payees }), config: testConfig });
    expect(r.payees).toHaveLength(1);
    expect(r.payees[0].id).toBe(P2);
  });

  it('is a read tool', () => {
    expect(tool.readOnly).toBe(true);
  });
});
