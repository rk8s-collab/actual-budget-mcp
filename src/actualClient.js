// actualClient.js — Módulo singleton para gestionar la conexión a Actual Budget
import * as api from '@actual-app/api';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let initialized = false;

/**
 * Inicializa la conexión con Actual Budget.
 * Si ya está inicializado, no hace nada.
 * Si falla, permite reintentar en la siguiente llamada.
 */
export async function initActual() {
  if (initialized) return;

  try {
    // Ruta absoluta para evitar problemas con el directorio de trabajo
    const dataDir = join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    await api.init({
      dataDir,
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_SERVER_PASSWORD,
    });

    await api.downloadBudget(process.env.ACTUAL_SYNC_ID);
    initialized = true;
    console.error('[actual-mcp] Conexión a Actual Budget establecida correctamente');
  } catch (err) {
    console.error('[actual-mcp] Error al conectar con Actual Budget:', err.message);
    throw err;
  }
}

/**
 * Cierra la conexión con Actual Budget.
 */
export async function shutdownActual() {
  if (initialized) {
    await api.shutdown();
    initialized = false;
    console.error('[actual-mcp] Conexión a Actual Budget cerrada');
  }
}

export { api };
