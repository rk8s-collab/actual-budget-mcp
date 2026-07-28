import { describe, it, expect } from 'vitest';
import { loadDemoEnv } from './env.js';

describe('loadDemoEnv', () => {
  it('throws with the var name when missing', () => {
    delete process.env.ACTUAL_SYNC_ID;
    expect(() => loadDemoEnv(['ACTUAL_SYNC_ID'])).toThrow(/ACTUAL_SYNC_ID/);
  });
  it('throws when the var is present but empty', () => {
    process.env.ACTUAL_EMPTY = '';
    expect(() => loadDemoEnv(['ACTUAL_EMPTY'])).toThrow(/ACTUAL_EMPTY/);
  });
  it('returns present vars', () => {
    process.env.ACTUAL_SERVER_URL = 'http://x';
    expect(loadDemoEnv(['ACTUAL_SERVER_URL'])).toEqual({ ACTUAL_SERVER_URL: 'http://x' });
  });
});
