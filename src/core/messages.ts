// messages.ts — mensajes de runtime en los dos idiomas.
// El español es el tipo de referencia: `const en: Messages` obliga al compilador a
// exigir cada clave y cada firma. Los mensajes con datos son funciones.
// NO entran aquí: los logs a stderr ni la validación de config (que corre antes
// de que exista config y por eso no puede consultar el idioma).
import type { Config } from './config.js';

const es = {
  invalidInput: 'Entrada inválida',
  dateFormat: 'Fecha en formato YYYY-MM-DD',
  monthFormat: 'Mes en formato YYYY-MM',
  mustBeUuid: 'Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)',
  categoryNotFound: (id: string) => `categoría inexistente: ${id} (usa get_categories para ver los ids válidos)`,
  budgetClosed: (cause: string, dataDir: string) =>
    'El presupuesto de Actual está cerrado y no se pudo volver a abrir ' +
    `(causa original: ${cause}). Reinicia el servidor MCP; si el error persiste, ` +
    `revisa el log de arranque y que ${dataDir} sea accesible.`,
  budgetOpenFailed: (primaryDir: string, primaryErr: string, fallbackDir: string, fallbackErr: string) =>
    `No se pudo abrir el presupuesto ni en ${primaryDir} (${primaryErr}) ni en la copia propia ` +
    `${fallbackDir} (${fallbackErr}). Si tienes varios clientes MCP conectados a la vez, cierra ` +
    'los que no uses o da a cada uno su propio ACTUAL_DATA_DIR.',
  invalidToolName: (name: string) => `Nombre de tool inválido: ${name}`,
};

export type Messages = typeof es;

const en: Messages = {
  invalidInput: 'Invalid input',
  dateFormat: 'Date in YYYY-MM-DD format',
  monthFormat: 'Month in YYYY-MM format',
  mustBeUuid: 'Must be a UUID (use get_accounts / get_categories / get_transactions to obtain them)',
  categoryNotFound: (id: string) => `unknown category: ${id} (use get_categories to list valid ids)`,
  budgetClosed: (cause: string, dataDir: string) =>
    'The Actual budget is closed and could not be reopened ' +
    `(original cause: ${cause}). Restart the MCP server; if it persists, ` +
    `check the startup log and that ${dataDir} is readable.`,
  budgetOpenFailed: (primaryDir: string, primaryErr: string, fallbackDir: string, fallbackErr: string) =>
    `Could not open the budget either at ${primaryDir} (${primaryErr}) or at the own copy ` +
    `${fallbackDir} (${fallbackErr}). If you have several MCP clients connected at the same time, ` +
    'close the ones you are not using or give each its own ACTUAL_DATA_DIR.',
  invalidToolName: (name: string) => `Invalid tool name: ${name}`,
};

const CATALOGUES: Record<'es' | 'en', Messages> = { es, en };

export function messagesFor(lang: 'es' | 'en'): Messages {
  return CATALOGUES[lang];
}

export function msg(config: Config): Messages {
  return messagesFor(config.messagesLang);
}

// Los esquemas Zod se construyen al cargar el módulo y el SDK los valida ANTES de
// llamar al handler, así que su mensaje no puede depender de config: se resuelve
// al parsear, contra este idioma activo. Es el único sitio donde el idioma no
// viaja en config, y es honesto: un proceso servidor tiene un único config.
let activo: Messages = es;

export function setMessageLanguage(lang: 'es' | 'en'): void {
  activo = CATALOGUES[lang];
}

export function activeMessages(): Messages {
  return activo;
}
