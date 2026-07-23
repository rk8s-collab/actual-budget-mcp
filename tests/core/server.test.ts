import { describe, it, expect } from 'vitest';
import { buildToolResult, invalidInputResult } from '../../src/core/server.js';
import { messagesFor } from '../../src/core/messages.js';

describe('buildToolResult', () => {
  it('wraps payload as text + structuredContent', () => {
    const r = buildToolResult({ a: 1 }, { stale: false, lastSynced: '2026-07-21T10:00:00.000Z' });
    expect(r.content[0].type).toBe('text');
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
    expect(r.structuredContent).toEqual({ a: 1 });
  });
  it('adds stale_data flags when stale', () => {
    const r = buildToolResult({ a: 1 }, { stale: true, lastSynced: '2026-07-20T09:00:00.000Z' });
    expect(r.structuredContent).toMatchObject({ a: 1, stale_data: true, last_synced: '2026-07-20T09:00:00.000Z' });
  });
  it('does not spread stale flags into array payloads', () => {
    const r = buildToolResult([{ a: 1 }], { stale: true, lastSynced: 'x' });
    expect(r.structuredContent).toEqual({ items: [{ a: 1 }], stale_data: true, last_synced: 'x' });
  });
});

describe('invalidInputResult', () => {
  const issues = [{ path: ['date'], message: 'Fecha en formato YYYY-MM-DD' }];
  it('titula el error en español por defecto', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Entrada inválida');
  });
  it('titula el error en inglés cuando se pide', () => {
    const r: any = invalidInputResult(issues, messagesFor('en'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Invalid input');
  });
  it('conserva la ruta del campo en el hint', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.hint).toContain('date:');
  });
  it('marca el resultado como error', () => {
    expect((invalidInputResult(issues, messagesFor('es')) as any).isError).toBe(true);
  });
});
