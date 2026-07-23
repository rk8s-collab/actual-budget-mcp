import { describe, it, expect, afterEach } from 'vitest';
import { tool } from '../../src/tools/create_schedule.js';
import { mockApi, testConfig } from '../helpers/mock-api.js';
import { setMessageLanguage } from '../../src/core/messages.js';

// El idioma activo es estado de módulo: restaurarlo o se contamina el resto del fichero.
afterEach(() => setMessageLanguage('es'));

// Los ids de entrada se validan como UUID (ID en src/core/types.ts).
const A1 = 'aaaaaaaa-1111-4111-8111-111111111111';

const payees = [{ id: 'p1', name: 'Gimnasio Metropolitan' }, { id: 'p2', name: 'Netflix' }];

describe('create_schedule', () => {
  it('creates a monthly recurring schedule resolving payee by name', async () => {
    const api = mockApi({ getPayees: async () => payees });
    const r: any = await tool.handler(
      { name: 'Gimnasio', payee_name: 'gimnasio metropolitan', account_id: A1, amount: -35,
        recurrence: { frequency: 'monthly', start: '2026-08-01' } },
      { api, config: testConfig },
    );
    expect(api.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gimnasio',
      payee: 'p1',
      account: A1,
      amount: -3500,
      amountOp: 'is',
      posts_transaction: false,
      date: expect.objectContaining({ frequency: 'monthly', start: '2026-08-01' }),
    }));
    expect(r).toMatchObject({ created: true, schedule: { id: 'sched-id', amount: -35 } });
  });
  it('accepts a one-off date string', async () => {
    const api = mockApi({ getPayees: async () => payees });
    await tool.handler(
      { name: 'Pago único', payee_name: 'Netflix', account_id: A1, amount: -12.99, date: '2026-09-15' },
      { api, config: testConfig },
    );
    expect((api.createSchedule as any).mock.calls[0][0].date).toBe('2026-09-15');
  });
  it('requires exactly one of date or recurrence, and errors on unknown payee', async () => {
    const api = mockApi({ getPayees: async () => payees });
    await expect(tool.handler(
      { name: 'X', payee_name: 'Netflix', account_id: A1, amount: -1 },
      { api, config: testConfig },
    )).rejects.toThrow(/date|recurrence/i);
    await expect(tool.handler(
      { name: 'X', payee_name: 'NoExiste', account_id: A1, amount: -1, date: '2026-09-15' },
      { api, config: testConfig },
    )).rejects.toThrow(/NoExiste/);
  });
  it('reporta en inglés el mensaje de date/recurrence tras cambiar el idioma (Tarea 7)', async () => {
    setMessageLanguage('en');
    const api = mockApi({ getPayees: async () => payees });
    await expect(tool.handler(
      { name: 'X', payee_name: 'Netflix', account_id: A1, amount: -1 },
      { api, config: testConfig },
    )).rejects.toThrow('Specify exactly one: date (one-off) or recurrence (recurring)');
  });
});
