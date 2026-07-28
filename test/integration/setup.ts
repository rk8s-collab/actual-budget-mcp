// Ensures the ephemeral actual-server is up and bootstrapped with a known password.
export async function ensureServerReady(
  url = 'http://localhost:5006',
  password = 'test-pass',
): Promise<void> {
  // poll /info until it responds
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${url}/info`);
      if (r.ok) break;
    } catch {}
    await new Promise((res) => setTimeout(res, 1000));
  }
  // idempotent bootstrap
  const r = await fetch(`${url}/account/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = await r.json().catch(() => ({}));
  const ok = body?.status === 'ok' || body?.reason === 'already-bootstrapped';
  if (!ok) throw new Error(`bootstrap failed: ${JSON.stringify(body)}`);
}
