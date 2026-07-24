// messages.ts — mensajes de runtime en los dos idiomas.
// El español es el tipo de referencia: `const en: Messages` obliga al compilador a
// exigir cada clave y cada firma. Los mensajes con datos son funciones.
// NO entran aquí: los logs a stderr ni la validación de config (que corre antes
// de que exista config y por eso no puede consultar el idioma).
//
// Criterio de nombres:
// - Sufijo `NotFound` para toda entidad que no existe (antes convivía con
//   `Missing` para la misma idea; unificado).
// - Ninguna clave se nombra como si fuera un predicado booleano (`isX`) cuando en
//   realidad es un mensaje: se nombra por lo que dice, no por la condición que lo
//   dispara (p.ej. `cannotSplitTransfer`, no `isTransfer`).
// - Sufijo `Item` para la versión abreviada de un mensaje que se usa como campo
//   `error` de un ítem dentro de un lote (categorize_transactions); la clave sin
//   sufijo es la versión que se lanza como excepción para una única transacción
//   (update_transaction, split_transaction). Ambas formas pueden coexistir para
//   la misma condición (p.ej. `splitChild` / `splitChildItem`).
// - Prefijo de dominio (`transfer`, `schedule`, `spending`, `split`...) solo
//   cuando agrupa varias claves relacionadas y ayuda a leerlas juntas; se omite
//   cuando el nombre ya es autoexplicativo en solitario (`alreadySplit`,
//   `echoPending`, `ambiguousNewRow`).
//
// Las claves se agrupan en bloques (mismo orden en `es` y en `en`, para leerlos
// en paralelo): formato y validación de entrada, no encontrado, guardas de
// estado y consistencia de escritura, e infraestructura del presupuesto.
import type { Config } from './config.js';

const es = {
  // --- Formato y validación de entrada ---
  invalidInput: 'Entrada inválida',
  dateFormat: 'Fecha en formato YYYY-MM-DD',
  monthFormat: 'Mes en formato YYYY-MM',
  mustBeUuid: 'Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)',
  invalidToolName: (name: string) => `Nombre de tool inválido: ${name}`,
  noFieldToUpdate: 'Debes indicar al menos un campo a actualizar (category_id, payee_name, notes, date, amount, cleared)',
  scheduleDateXorRecurrence: 'Indica exactamente uno: date (puntual) o recurrence (recurrente)',
  transferCategoriesMustDiffer: 'Las categorías de origen y destino deben ser distintas',
  spendingRangeTooLong: 'El rango de fechas no puede superar los 5 años; acorta start_date/end_date.',
  emptyNoteRequiresClear: (name: string) =>
    `Una nota vacía borra la nota existente de "${name}". Pasa clear: true para confirmar.`,
  partsDoNotSum: (sum: string, total: string, missing: boolean, diff: string) =>
    `Las partes difieren del total: suman ${sum} y el movimiento es ${total} (${missing ? 'faltan' : 'sobran'} ${diff}). Ajusta las partes o usa adjust_last=true`,
  createSplitsMismatch: (sum: string, total: string) =>
    `Las partes difieren del total: suman ${sum} y el importe es ${total}`,

  // --- No encontrado ---
  categoryNotFound: (id: string) => `categoría inexistente: ${id} (usa get_categories para ver los ids válidos)`,
  txNotFound: (id: string) => `Transacción no encontrada: ${id}`,
  txNotFoundItem: 'transacción no encontrada',
  payeeNotFound: (name: string, options: string[]) =>
    `Pagador no encontrado: "${name}"${options.length ? ` — ¿quizá: ${options.join(', ')}?` : ''}`,
  transferSourceNotFound: (month: string, id: string) => `Categoría origen no encontrada en ${month}: ${id}`,
  transferTargetNotFound: (month: string, id: string) => `Categoría destino no encontrada en ${month}: ${id}`,

  // --- Guardas de estado y consistencia de escritura ---
  cannotSplitTransfer: 'No se puede dividir una transferencia entre cuentas',
  alreadySplit: 'La transacción ya está dividida; edita sus partes en Actual o deshaz el split primero',
  reconciledNeedsForce: 'La transacción está conciliada; dividirla rompería la conciliación. Vuelve a intentarlo con force: true si estás seguro',
  splitChild: (id: string, parentId: string) =>
    `La transacción ${id} es una parte de un split (padre ${parentId}); edita el split completo con split_transaction o desde Actual`,
  splitParentAmount: (id: string) =>
    `La transacción ${id} es el padre de un split: importe y categoría viven en las partes; usa split_transaction para redividirla (notas, fecha, cleared y pagador sí se pueden editar aquí)`,
  splitChildItem: 'es una parte de un split; usa split_transaction',
  splitParentItem: 'es el padre de un split; la categoría vive en las partes',
  echoPending: 'La escritura se envió pero aún no se refleja al releer; vuelve a consultar la transacción para confirmarla',
  splitCreatedNotFound: (id: string) => `Split creado pero no localizado; el original ${id} NO se ha borrado — revisa duplicados en Actual`,
  splitCreatedNotDeleted: (newId: string, id: string, cause: string) =>
    `Split creado como ${newId} pero no se pudo borrar el original ${id} (${cause}); hay un duplicado visible en Actual — borra el original a mano. Ojo: la copia hereda el mismo id de importación (imported_id) que el original, así que mientras convivan las dos filas comparten la clave de deduplicación del banco y la próxima sincronización bancaria puede confundirse. Si el original estaba conciliado, tendrás que desbloquear la conciliación antes de poder borrarlo`,
  ambiguousNewRow: 'Aparecieron varias filas nuevas con la misma cuenta, fecha e importe; se devuelve la primera. Revisa posibles duplicados en Actual',
  transferRolledBack: (cause: string) =>
    `No se pudo abonar en destino (${cause}); el traspaso se ha revertido y no se ha movido nada`,
  transferRollbackFailed: (cause: string, rollbackCause: string, categoryName: string) =>
    `No se pudo abonar en destino (${cause}) y ADEMÁS falló la reversión del origen (${rollbackCause}); revisa ${categoryName} en Actual`,
  unconfirmedWrites: 'Se enviaron pero no se pudieron confirmar releyendo; vuelve a consultar esas transacciones antes de darlas por categorizadas',

  // --- Infraestructura del presupuesto ---
  budgetClosed: (cause: string, dataDir: string) =>
    'El presupuesto de Actual está cerrado y no se pudo volver a abrir ' +
    `(causa original: ${cause}). Reinicia el servidor MCP; si el error persiste, ` +
    `revisa el log de arranque y que ${dataDir} sea accesible.`,
  budgetOpenFailed: (primaryDir: string, primaryErr: string, fallbackDir: string, fallbackErr: string) =>
    `No se pudo abrir el presupuesto ni en ${primaryDir} (${primaryErr}) ni en la copia propia ` +
    `${fallbackDir} (${fallbackErr}). Si tienes varios clientes MCP conectados a la vez, cierra ` +
    'los que no uses o da a cada uno su propio ACTUAL_DATA_DIR.',
  nativeAbiMismatch: (compiladoPara: number, runtime: number) =>
    'El módulo nativo de esta extensión se compiló para NODE_MODULE_VERSION ' +
    `${compiladoPara}, pero Claude Desktop ejecuta ahora la versión ${runtime}. Esto pasa cuando ` +
    'Claude Desktop actualiza su Electron interno después de instalar el bundle. La extensión no ' +
    'puede funcionar hasta que se reempaquete para esta versión: descarga una nueva desde ' +
    'https://github.com/marcoaperez/actual-budget-mcp-es/releases/latest e instálala de nuevo. ' +
    'Si usas la instalación manual (sin el bundle .mcpb), esto no te afecta.',
};

export type Messages = typeof es;

const en: Messages = {
  // --- Formato y validación de entrada ---
  invalidInput: 'Invalid input',
  dateFormat: 'Date in YYYY-MM-DD format',
  monthFormat: 'Month in YYYY-MM format',
  mustBeUuid: 'Must be a UUID (use get_accounts / get_categories / get_transactions to obtain them)',
  invalidToolName: (name: string) => `Invalid tool name: ${name}`,
  noFieldToUpdate: 'You must specify at least one field to update (category_id, payee_name, notes, date, amount, cleared)',
  scheduleDateXorRecurrence: 'Specify exactly one: date (one-off) or recurrence (recurring)',
  transferCategoriesMustDiffer: 'Source and destination categories must be different',
  spendingRangeTooLong: 'The date range cannot exceed 5 years; shorten start_date/end_date.',
  emptyNoteRequiresClear: (name: string) =>
    `An empty note erases the existing note of "${name}". Pass clear: true to confirm.`,
  partsDoNotSum: (sum: string, total: string, missing: boolean, diff: string) =>
    `The parts differ from the total: they add up to ${sum} and the transaction is ${total} (${missing ? 'missing' : 'extra'} ${diff}). Adjust the parts or use adjust_last=true`,
  createSplitsMismatch: (sum: string, total: string) =>
    `The parts differ from the total: they add up to ${sum} and the amount is ${total}`,

  // --- No encontrado ---
  categoryNotFound: (id: string) => `unknown category: ${id} (use get_categories to list valid ids)`,
  txNotFound: (id: string) => `Transaction not found: ${id}`,
  txNotFoundItem: 'transaction not found',
  payeeNotFound: (name: string, options: string[]) =>
    `Payee not found: "${name}"${options.length ? ` — maybe: ${options.join(', ')}?` : ''}`,
  transferSourceNotFound: (month: string, id: string) => `Source category not found in ${month}: ${id}`,
  transferTargetNotFound: (month: string, id: string) => `Target category not found in ${month}: ${id}`,

  // --- Guardas de estado y consistencia de escritura ---
  cannotSplitTransfer: 'Cannot split a transfer between accounts',
  alreadySplit: 'The transaction is already split; edit its parts in Actual or undo the split first',
  reconciledNeedsForce: 'The transaction is reconciled; splitting it would break the reconciliation. Try again with force: true if you are sure',
  splitChild: (id: string, parentId: string) =>
    `Transaction ${id} is part of a split (parent ${parentId}); edit the whole split with split_transaction or from Actual`,
  splitParentAmount: (id: string) =>
    `Transaction ${id} is the parent of a split: amount and category live in the parts; use split_transaction to re-split it (notes, date, cleared and payee can be edited here)`,
  splitChildItem: 'it is part of a split; use split_transaction',
  splitParentItem: 'it is the parent of a split; the category lives in the parts',
  echoPending: 'The write was sent but is not yet reflected on re-read; query the transaction again to confirm it',
  splitCreatedNotFound: (id: string) => `Split created but not located; the original ${id} was NOT deleted — check for duplicates in Actual`,
  splitCreatedNotDeleted: (newId: string, id: string, cause: string) =>
    `Split created as ${newId} but the original ${id} could not be deleted (${cause}); there is a visible duplicate in Actual — delete the original by hand. Note: the copy inherits the same import id (imported_id) as the original, so while both rows coexist they share the bank's deduplication key and the next bank sync may get confused. If the original was reconciled, you will need to unlock the reconciliation before you can delete it`,
  ambiguousNewRow: 'Several new rows appeared with the same account, date and amount; the first one is returned. Check for possible duplicates in Actual',
  transferRolledBack: (cause: string) =>
    `Could not credit the target (${cause}); the transfer was rolled back and nothing was moved`,
  transferRollbackFailed: (cause: string, rollbackCause: string, categoryName: string) =>
    `Could not credit the target (${cause}) and the source rollback ALSO failed (${rollbackCause}); check ${categoryName} in Actual`,
  unconfirmedWrites: 'They were sent but could not be confirmed by re-reading; query those transactions again before considering them categorized',

  // --- Infraestructura del presupuesto ---
  budgetClosed: (cause: string, dataDir: string) =>
    'The Actual budget is closed and could not be reopened ' +
    `(original cause: ${cause}). Restart the MCP server; if it persists, ` +
    `check the startup log and that ${dataDir} is accessible.`,
  budgetOpenFailed: (primaryDir: string, primaryErr: string, fallbackDir: string, fallbackErr: string) =>
    `Could not open the budget either at ${primaryDir} (${primaryErr}) or in its own copy at ` +
    `${fallbackDir} (${fallbackErr}). If you have several MCP clients connected at the same time, ` +
    'close the ones you are not using or give each its own ACTUAL_DATA_DIR.',
  nativeAbiMismatch: (compiladoPara: number, runtime: number) =>
    "This extension's native module was compiled for NODE_MODULE_VERSION " +
    `${compiladoPara}, but Claude Desktop is now running version ${runtime}. This happens when ` +
    'Claude Desktop updates its internal Electron after the bundle was installed. The extension ' +
    'cannot work until it is repackaged for this version: download a new one from ' +
    'https://github.com/marcoaperez/actual-budget-mcp-es/releases/latest and reinstall it. ' +
    'If you use the manual installation (without the .mcpb bundle), this does not affect you.',
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
