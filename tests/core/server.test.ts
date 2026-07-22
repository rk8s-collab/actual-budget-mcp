import { describe, it, expect } from 'vitest';
import { buildToolResult } from '../../src/core/server.js';

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
