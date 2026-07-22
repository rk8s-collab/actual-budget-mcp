// config.ts — entorno validado con Zod. Único punto de lectura de variables de
// entorno; el resto de módulos consume el objeto Config ya validado.
import { z } from 'zod';

const envSchema = z.object({
  ACTUAL_SERVER_URL: z.url({ message: 'ACTUAL_SERVER_URL debe ser una URL válida' }),
  ACTUAL_SERVER_PASSWORD: z.string().min(1, 'ACTUAL_SERVER_PASSWORD es obligatoria'),
  ACTUAL_SYNC_ID: z.string().min(1, 'ACTUAL_SYNC_ID es obligatorio'),
  ACTUAL_DATA_DIR: z.string().default('./data'),
  LOCALE: z.string().default('en-US'),
  CURRENCY: z.string().length(3).default('USD'),
  SYNC_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  ENABLE_WRITE: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
});

export interface Config {
  serverUrl: string;
  password: string;
  syncId: string;
  dataDir: string;
  locale: string;
  currency: string;
  syncTtlSeconds: number;
  enableWrite: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${details}`);
  }
  const e = parsed.data;
  return {
    serverUrl: e.ACTUAL_SERVER_URL,
    password: e.ACTUAL_SERVER_PASSWORD,
    syncId: e.ACTUAL_SYNC_ID,
    dataDir: e.ACTUAL_DATA_DIR,
    locale: e.LOCALE,
    currency: e.CURRENCY,
    syncTtlSeconds: e.SYNC_TTL_SECONDS,
    enableWrite: e.ENABLE_WRITE,
  };
}
