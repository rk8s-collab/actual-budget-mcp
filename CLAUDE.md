# Contexto del proyecto: Actual-MCP

## Descripción
Servidor MCP que conecta Claude con Actual Budget (finanzas familiares del usuario).
Permite analizar gastos, seguir el presupuesto, ver el patrimonio y —en la v2 en
diseño— escribir: categorizar movimientos, separar transacciones (splits reales),
registrar repetitivos y preparar el presupuesto mensual.

## Tipo de proyecto
Tipo D (Servidor MCP) — ver skill `Claude-Code-Proyectos-Personales` en Obsidian-Personal.

## Stack
- **v1 actual**: JavaScript ES Modules, `@actual-app/api` 26.3, MCP SDK 1.27, stdio.
- **v2 (en diseño)**: TypeScript 6.x + Zod 4.x único + MCP SDK 1.29.x + `@actual-app/api` 26.7+.
  Arquitectura `src/core/` + `src/tools/`, transporte agnóstico (stdio por defecto, HTTP opcional).

## Fuente de datos
- Actual Budget self-hosted, vía `@actual-app/api` (descarga copia local del presupuesto y sincroniza).
- Regla v2: `api.sync()` antes de consultar — la v1 solo descargaba al arrancar y servía datos obsoletos.

## Variables de entorno relevantes
- `ACTUAL_SERVER_URL` — URL del servidor Actual
- `ACTUAL_SERVER_PASSWORD` — contraseña del servidor
- `ACTUAL_SYNC_ID` — Sync ID del presupuesto (Settings → Advanced → Sync ID)

## Convenciones específicas de este proyecto
- **stdout es sagrado**: el canal MCP va por stdout; todo log a stderr (ver redirección en `src/index.js`).
- **Importes**: Actual trabaja en céntimos; las tools devuelven SIEMPRE unidades ya convertidas (÷100). Nunca delegar la conversión al LLM.
- **Semántica financiera**: excluir transferencias (`transfer_id`) de los resúmenes de gasto; el patrimonio incluye cuentas off-budget (pensiones, fondos, hipoteca).
- **Vocación de publicación**: si se publica en GitHub → README bilingüe (EN + `README.es.md`), idioma/moneda configurables, instalable con `npx`, sin credenciales en el historial.
- Nombres de tools con `guion_bajo` (exigencia Anthropic: `^[a-zA-Z0-9_-]{1,64}$`).

## Metodología de desarrollo — Superpowers
Proceso completo (brainstorm → plan → verificación → review) si la tarea toca ≥2 tools
nuevas, cambia el esquema de datos, añade una integración externa nueva o crea una feature
nueva. TDD obligatorio (Tipo D). Specs en `docs/superpowers/specs/` de este repo; digest
humano y decisiones en el vault personal (`Proyectos/Actual-MCP/`).
Detalle: nota `Integracion-Superpowers-Personal` en Obsidian-Personal.

## Estado y próximos pasos
- **Plan 1 completado y mergeado a main (2026-07-22)**: core TypeScript + 8 tools de lectura,
  45 tests, smoke validado contra el servidor real. Claude Desktop apunta ya a `dist/index.js`.
- Aprendizajes clave del Plan 1 (no repetir): los imports estáticos ESM se izan — la redirección
  de stdout vive en `src/core/log-redirect.ts` como PRIMER import; `balance_current` es null en
  cuentas manuales — los saldos se calculan con AQL agrupado en `src/core/balances.ts`;
  en agregados AQL los campos llevan `$` (`{$sum: '$amount'}`).
- **Plan 2 completado (2026-07-22)**: 16 tools (8 lectura + 8 escritura tras `ENABLE_WRITE`).
  Las de escritura: `update_transaction`, `categorize_transactions`, `split_transaction`,
  `create_transaction`, `create_schedule`, `set_budget`, `transfer_budget`, `update_category_note`.
- Siguiente: prueba manual de escritura de Marco en Claude Desktop (activar `ENABLE_WRITE=true`),
  escritura validada con prueba real (12/12) y `actual-budget-test` retirado.
- **Plan 3 — endurecimiento de seguridad completado (2026-07-22)**: auditoría en cuatro frentes
  (secretos, entradas/AQL, escritura, dependencias) y sus correcciones. Lo importante:
  los ids se validan como UUID porque el compilador AQL de Actual interpola los valores de
  tipo `id` en el SQL sin escaparlos; la categoría se valida antes de escribir (la API no lo
  hace y un id inventado descategoriza en silencio); `transfer_budget` compensa si falla el
  abono; `split_transaction` conserva `imported_id`/`schedule`/`reconciled` y protege
  conciliaciones; la fila creada se localiza por diferencia de conjuntos, no por orden.
  Modelo de seguridad documentado en `SECURITY.md`.
- **Publicación**: la primera publicación (2026-07-22) se retiró al detectar que `.env.example`
  y los README llevaban la URL y el Sync ID reales, y que el historial conservaba cifras reales
  en el commit de anonimización. Historial reescrito con `git filter-repo` y verificado limpio.
  Pendiente: volver a publicar como `marcoaperez/actual-budget-mcp-es` (público, MIT).
