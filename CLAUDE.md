# Contexto del proyecto: Actual-MCP

## Descripción
Servidor MCP que conecta Claude con Actual Budget (finanzas familiares de Marco).
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
- Brainstorming y análisis del estado del arte cerrados (2026-07-21): decisión de evolucionar
  este MCP en vez de adoptar uno de comunidad. Porqués en el vault:
  `Proyectos/Actual-MCP/01-Decisiones-Arquitectura.md`.
- Instalado en paralelo `actual-budget-test` (agigante80) en Claude Desktop para comparar.
- Siguiente: diseño del catálogo de tools (~12-15) → SPEC → plan → implementación TDD.
