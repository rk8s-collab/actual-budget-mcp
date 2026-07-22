import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config.js';

const base = {
  ACTUAL_SERVER_URL: 'https://actual.example.com',
  ACTUAL_SERVER_PASSWORD: 'secret',
  ACTUAL_SYNC_ID: 'abc-123',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      serverUrl: 'https://actual.example.com',
      dataDir: './data',
      locale: 'en-US',
      currency: 'USD',
      syncTtlSeconds: 60,
      enableWrite: false,
    });
  });
  it('reads overrides', () => {
    const c = loadConfig({ ...base, LOCALE: 'es-ES', CURRENCY: 'EUR', SYNC_TTL_SECONDS: '30', ENABLE_WRITE: 'true' });
    expect(c.locale).toBe('es-ES');
    expect(c.currency).toBe('EUR');
    expect(c.syncTtlSeconds).toBe(30);
    expect(c.enableWrite).toBe(true);
  });
  it('names every missing required var in the error', () => {
    expect(() => loadConfig({})).toThrowError(/ACTUAL_SERVER_URL.*ACTUAL_SERVER_PASSWORD.*ACTUAL_SYNC_ID/s);
  });
  it('rejects non-numeric SYNC_TTL_SECONDS', () => {
    expect(() => loadConfig({ ...base, SYNC_TTL_SECONDS: 'soon' })).toThrowError(/SYNC_TTL_SECONDS/);
  });
});
