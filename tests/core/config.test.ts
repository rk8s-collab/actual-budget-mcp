import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
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
      locale: 'en-US',
      currency: 'USD',
      syncTtlSeconds: 60,
      enableWrite: false,
    });
  });
  it('resolves the default dataDir to an absolute path under the package root', () => {
    const c = loadConfig(base);
    expect(path.isAbsolute(c.dataDir)).toBe(true);
    expect(c.dataDir.endsWith('/data')).toBe(true);
  });
  it('preserves an absolute ACTUAL_DATA_DIR override verbatim', () => {
    const c = loadConfig({ ...base, ACTUAL_DATA_DIR: '/tmp/x' });
    expect(c.dataDir).toBe('/tmp/x');
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
  it('defaults the message language to Spanish', () => {
    expect(loadConfig(base).messagesLang).toBe('es');
  });
  it('accepts English', () => {
    expect(loadConfig({ ...base, MESSAGES_LANG: 'en' }).messagesLang).toBe('en');
  });
  it('rejects an unsupported language naming the accepted ones', () => {
    expect(() => loadConfig({ ...base, MESSAGES_LANG: 'fr' })).toThrow(/es.*en|en.*es/);
  });
});
