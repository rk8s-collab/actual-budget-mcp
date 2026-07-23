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
  txNotFound: (id: string) => `Transacción no encontrada: ${id}`,
  isTransfer: 'No se puede dividir una transferencia entre cuentas',
  alreadySplit: 'La transacción ya está dividida; edita sus partes en Actual o deshaz el split primero',
  reconciledNeedsForce: 'La transacción está conciliada; dividirla rompería la conciliación. Vuelve a intentarlo con force: true si estás seguro',
  partsDoNotSum: (sum: string, total: string, missing: boolean, diff: string) =>
    `Las partes difieren del total: suman ${sum} y el movimiento es ${total} (${missing ? 'faltan' : 'sobran'} ${diff}). Ajusta las partes o usa adjust_last=true`,
  splitCreatedNotFound: (id: string) => `Split creado pero no localizado; el original ${id} NO se ha borrado — revisa duplicados en Actual`,
  splitCreatedNotDeleted: (newId: string, id: string, cause: string) =>
    `Split creado como ${newId} pero no se pudo borrar el original ${id} (${cause}); hay un duplicado visible en Actual — borra el original a mano. Ojo: la copia hereda el mismo id de importación (imported_id) que el original, así que mientras convivan las dos filas comparten la clave de deduplicación del banco y la próxima sincronización bancaria puede confundirse. Si el original estaba conciliado, tendrás que desbloquear la conciliación antes de poder borrarlo`,
  ambiguousNewRow: 'Aparecieron varias filas nuevas con la misma cuenta, fecha e importe; se devuelve la primera. Revisa posibles duplicados en Actual',
  noFieldToUpdate: 'Debes indicar al menos un campo a actualizar (category_id, payee_name, notes, date, amount, cleared)',
  splitChild: (id: string, parentId: string) =>
    `La transacción ${id} es una parte de un split (padre ${parentId}); edita el split completo con split_transaction o desde Actual`,
  splitParentAmount: (id: string) =>
    `La transacción ${id} es el padre de un split: importe y categoría viven en las partes; usa split_transaction para redividirla (notas, fecha, cleared y pagador sí se pueden editar aquí)`,
  echoPending: 'La escritura se envió pero aún no se refleja al releer; vuelve a consultar la transacción para confirmarla',
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
  txNotFound: (id: string) => `Transaction not found: ${id}`,
  isTransfer: 'Cannot split a transfer between accounts',
  alreadySplit: 'The transaction is already split; edit its parts in Actual or undo the split first',
  reconciledNeedsForce: 'The transaction is reconciled; splitting it would break the reconciliation. Try again with force: true if you are sure',
  partsDoNotSum: (sum: string, total: string, missing: boolean, diff: string) =>
    `The parts differ from the total: they sum ${sum} and the transaction is ${total} (${missing ? 'missing' : 'extra'} ${diff}). Adjust the parts or use adjust_last=true`,
  splitCreatedNotFound: (id: string) => `Split created but not located; the original ${id} was NOT deleted — check for duplicates in Actual`,
  splitCreatedNotDeleted: (newId: string, id: string, cause: string) =>
    `Split created as ${newId} but the original ${id} could not be deleted (${cause}); there is a visible duplicate in Actual — delete the original by hand. Note: the copy inherits the same import id (imported_id) as the original, so while both rows coexist they share the bank's deduplication key and the next bank sync may get confused. If the original was reconciled, you will need to unlock the reconciliation before you can delete it`,
  ambiguousNewRow: 'Several new rows appeared with the same account, date and amount; the first one is returned. Check for possible duplicates in Actual',
  noFieldToUpdate: 'You must specify at least one field to update (category_id, payee_name, notes, date, amount, cleared)',
  splitChild: (id: string, parentId: string) =>
    `Transaction ${id} is part of a split (parent ${parentId}); edit the whole split with split_transaction or from Actual`,
  splitParentAmount: (id: string) =>
    `Transaction ${id} is the parent of a split: amount and category live in the parts; use split_transaction to re-split it (notes, date, cleared and payee can be edited here)`,
  echoPending: 'The write was sent but is not yet reflected on re-read; query the transaction again to confirm it',
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
