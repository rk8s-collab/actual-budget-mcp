// config.ts — entorno validado con Zod. Único punto de lectura de variables de
// entorno; el resto de módulos consume el objeto Config ya validado.
import { z } from 'zod';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// config.ts vive en src/core (dev) o dist/core (build): ../../ es la raíz del paquete en ambos
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  MESSAGES_LANG: z.enum(['es', 'en'], { message: "MESSAGES_LANG debe ser 'es' o 'en'" }).default('es'),
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
  messagesLang: 'es' | 'en';
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
    dataDir: path.isAbsolute(e.ACTUAL_DATA_DIR) ? e.ACTUAL_DATA_DIR : path.resolve(PKG_ROOT, e.ACTUAL_DATA_DIR),
    locale: e.LOCALE,
    currency: e.CURRENCY,
    syncTtlSeconds: e.SYNC_TTL_SECONDS,
    enableWrite: e.ENABLE_WRITE,
    messagesLang: e.MESSAGES_LANG,
  };
}
