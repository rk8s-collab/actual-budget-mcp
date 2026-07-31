import { describe, it, expect } from 'vitest';
import { getPayeeIndex } from '../../src/core/payees.js';
import { mockApi } from '../helpers/mock-api.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

const payees = [
  { id: P1, name: 'Landlord', transfer_acct: null },
  { id: P2, name: 'Savings', transfer_acct: A1 },
];

describe('getPayeeIndex', () => {
  it('indexes by id and by transfer account', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => payees }));
    expect(idx.byId.get(P1)).toEqual({ id: P1, name: 'Landlord', transfer_acct: null });
    expect(idx.byTransferAccount.get(A1)!.id).toBe(P2);
    expect(idx.all).toHaveLength(2);
  });

  it('normalizes a missing transfer_acct to null and keeps it out of the transfer map', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => [{ id: P1, name: 'X' }] }));
    expect(idx.byId.get(P1)!.transfer_acct).toBeNull();
    expect(idx.byTransferAccount.size).toBe(0);
  });

  it('tolerates a null payee list', async () => {
    const idx = await getPayeeIndex(mockApi({ getPayees: async () => null }));
    expect(idx.all).toEqual([]);
  });
});
