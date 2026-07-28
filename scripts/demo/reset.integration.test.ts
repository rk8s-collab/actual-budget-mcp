import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ensureServerReady } from '../../test/integration/setup.js';

const execFileAsync = promisify(execFile);

// @actual-app/api's delete calls deadlock when driven in-process under vitest (see
// scripts/demo/reset-check.ts header / Task 2.4 notes); run the flow in a clean subprocess.
describe('reset keeps Sync ID stable and does not duplicate accounts', () => {
  beforeAll(async () => {
    await ensureServerReady();
  });

  it('via reset-check subprocess', async () => {
    const script = fileURLToPath(new URL('./reset-check.ts', import.meta.url));
    // Strip NODE_ENV (vitest sets it to "test"): @actual-app/api takes a different, eager
    // full-resync code path when NODE_ENV==='test' (vs. the normal deferred one), which stalls
    // the same way the in-process deadlock does. The whole point of the subprocess is to run
    // the flow the way the standalone CLIs (reset-demo.ts/seed-demo.ts) actually run it — so it
    // must not inherit vitest's test-mode env.
    const childEnv = { ...process.env, ACTUAL_SERVER_URL: 'http://localhost:5006', ACTUAL_SERVER_PASSWORD: 'test-pass' };
    delete childEnv.NODE_ENV;
    const { stdout } = await execFileAsync('npx', ['tsx', script], {
      env: childEnv,
      timeout: 100_000,
    });
    const line = stdout.split('\n').find((l) => l.startsWith('RESULT='));
    expect(line, stdout).toBeTruthy();
    const result = JSON.parse(line!.slice('RESULT='.length));
    expect(result.syncStable).toBe(true);
    expect(result.accountsStable).toBe(true); // no duplicate accounts
    expect(result.categories).toBeGreaterThan(0);
    expect(result.rules).toBeGreaterThan(0);
  });
});
