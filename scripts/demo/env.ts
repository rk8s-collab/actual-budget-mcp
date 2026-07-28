export function loadDemoEnv(required: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of required) {
    const v = process.env[key];
    if (!v) throw new Error(`Missing required env var: ${key}`);
    out[key] = v;
  }
  return out;
}
