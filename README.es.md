[English](README.md) | **Español**

# Actual Budget MCP Server

> Esta es la versión en español del README. For the English version, see [README.md](README.md).

Servidor MCP (Model Context Protocol) que conecta Claude Desktop / Claude.ai con una instancia self-hosted de [Actual Budget](https://actualbudget.org/). Permite consultar cuentas, transacciones, presupuestos y más directamente desde Claude usando lenguaje natural.

## Instalación en Claude Desktop (recomendado)

**Requisitos:** un Mac con Apple Silicon (M1 o posterior), Claude Desktop y un servidor de
Actual Budget self-hosted al que puedas acceder. En Macs Intel, Windows o Linux, usa la
[instalación manual](#instalación-manual) en su lugar.

1. **Descarga** la última versión de `actual-budget-mcp-es.mcpb` desde la
   [página de Releases](https://github.com/marcoaperez/actual-budget-mcp-es/releases/latest).
2. **Encuentra tu Sync ID** — abre Actual Budget en el navegador, ve a **Settings** →
   **Advanced Settings** → **IDs**, y copia el **Sync ID**.
3. **Instala** — en Claude Desktop, abre **Settings → Extensions**, arrastra el archivo
   `.mcpb` descargado a la página, revisa lo que declara y pulsa **Install**. Claude Desktop
   avisará de que la extensión no está firmada — es lo esperado en un bundle autodistribuido.
4. **Rellena el formulario** que muestra Claude Desktop:
   - **Actual server URL** — p. ej. `https://actual.example.org/`
   - **Server password** — la misma que usas para abrir Actual en el navegador (se guarda
     en el almacenamiento seguro de Claude Desktop, no en un archivo de configuración)
   - **Budget Sync ID** — el del paso 2
   - **Locale** y **Currency** — p. ej. `es-ES` y `EUR`; los valores por defecto son `en-US` y `USD`
   - **Enable write tools** — déjalo **desactivado** por ahora (ver más abajo)
   - **Message language** — `es` o `en`; por defecto `es`
5. **Comprueba que funciona** — empieza una conversación nueva y pregunta *"¿qué cuentas tengo?"*.
   Deberías obtener tu lista de cuentas con sus saldos.

### Activar el acceso de escritura

Con la casilla desactivada tienes las 8 tools de solo lectura. Actívala (Settings →
Extensions → esta extensión → configurar) para añadir las 8 tools de escritura: editar y
categorizar movimientos, splits reales, repetitivos, asignación de presupuesto y notas de
categoría. Claude Desktop pide tu aprobación antes de cada llamada salvo que le concedas
permiso permanente, y no hay tools de borrado.

### Actualizar

Descarga el `.mcpb` más reciente y vuelve a arrastrarlo — tu configuración se conserva.

### Si todas las tools fallan tras actualizar Claude Desktop

El bundle lleva un módulo nativo de SQLite (`better-sqlite3`) compilado para un ABI de Node
concreto. Claude Desktop no ejecuta las extensiones con el Node del sistema: las arranca
dentro de su propio Electron, así que el módulo tiene que corresponder a *ese* runtime.
Cuando una actualización de Claude Desktop lo cambia, el módulo deja de cargar, Actual
cierra el presupuesto y todas las tools responden que el presupuesto está cerrado y no se
pudo volver a abrir.

No hay nada que puedas hacer desde tu lado: hay que reempaquetar el bundle para el nuevo
runtime. Descarga una versión más reciente, o constrúyela tú con `npm run bundle` en un
equipo que tenga instalado el Claude Desktop actualizado.

Solo afecta al bundle `.mcpb`. La [instalación manual](#instalación-manual) corre bajo tu
propio Node y es inmune.

## Instalación manual

Para otros clientes MCP, Macs Intel, Windows y Linux. Requiere Node.js >= 22 y un servidor
de Actual Budget self-hosted accesible por red.

El proyecto está escrito en TypeScript, así que hay que compilarlo antes de usarlo:

```bash
git clone https://github.com/marcoaperez/actual-budget-mcp-es.git
cd actual-budget-mcp-es
npm install
cp .env.example .env
# Editar .env con tu contraseña de Actual Budget
npm run build          # compila TypeScript a dist/
```

Esto genera `dist/index.js`, el punto de entrada que ejecuta tu cliente MCP.

¿Necesitas tu Sync ID? Consulta el paso 2 de
[Instalación en Claude Desktop](#instalación-en-claude-desktop-recomendado), más arriba.

### Configuración del cliente

Añade esta configuración al archivo `claude_desktop_config.json` (o el equivalente de tu
cliente MCP):

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Apunta `command` a `node` y `args` al `dist/index.js` compilado (usa una ruta absoluta):

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/ruta/absoluta/actual-budget-mcp-es/dist/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "https://actual.example.org/",
        "ACTUAL_SERVER_PASSWORD": "tu-password",
        "ACTUAL_SYNC_ID": "00000000-0000-0000-0000-000000000000",
        "LOCALE": "es-ES",
        "CURRENCY": "EUR",
        "ENABLE_WRITE": "false"
      }
    }
  }
}
```

> Sustituye la ruta por la ruta absoluta real en tu equipo, y `tu-password` por la contraseña real.
> Recuerda ejecutar `npm run build` antes (y tras cada cambio) para regenerar `dist/`.

Durante el desarrollo puedes evitar la compilación usando `tsx` directamente:
`"command": "npx"`, `"args": ["tsx", "/ruta/absoluta/actual-budget-mcp-es/src/index.ts"]`.

Tras guardar, reinicia Claude Desktop (o tu cliente) para que detecte el nuevo servidor MCP.

### Variables de entorno

Las tres primeras son obligatorias; el resto tienen valores por defecto.

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `ACTUAL_SERVER_URL` | Sí | — | URL del servidor Actual self-hosted |
| `ACTUAL_SERVER_PASSWORD` | Sí | — | Contraseña del servidor Actual |
| `ACTUAL_SYNC_ID` | Sí | — | Sync ID del presupuesto (Settings → Advanced → Sync ID) |
| `ACTUAL_DATA_DIR` | No | `./data` | Carpeta donde se descarga la copia local del presupuesto |
| `LOCALE` | No | `en-US` | Locale para formatear importes y fechas (ej. `es-ES`) |
| `CURRENCY` | No | `USD` | Código ISO de moneda de 3 letras (ej. `EUR`) |
| `SYNC_TTL_SECONDS` | No | `60` | Segundos que se cachea el sync antes de volver a sincronizar |
| `ENABLE_WRITE` | No | `false` | Habilita las 8 tools de escritura (categorizar, splits, schedules, presupuesto, notas) |
| `MESSAGES_LANG` | No | `es` | Idioma de los mensajes de error del servidor: `es` o `en` |

## Herramientas disponibles

El servidor expone 8 herramientas de solo lectura (v2):

| Herramienta | Descripción |
|---|---|
| `get_accounts` | Cuentas con balance actual. Incluye off-budget (pensiones, fondos, hipoteca) por defecto |
| `get_net_worth` | Patrimonio neto completo: on-budget + off-budget con desglose por cuenta |
| `get_categories` | Grupos y categorías con sus IDs (los IDs son necesarios para las tools de escritura) |
| `get_transactions` | Transacciones por rango de fechas con filtros opcionales (cuenta, categoría, texto, importe, sin categorizar). Excluye transferencias. Paginado (máx. 200) |
| `get_spending_summary` | Gasto agregado por categoría, beneficiario o mes. Excluye transferencias siempre |
| `get_budget_month` | Estado del presupuesto de un mes: to-budget, ingresos, totales y asignado/gastado/balance por categoría |
| `get_budget_averages` | Media, mediana y máximo de gasto por categoría en los últimos N meses completos — insumo para preparar el presupuesto |
| `get_schedules` | Repetitivos configurados en Actual (nombre, próxima fecha, importe) |

## Herramientas de escritura

Con `ENABLE_WRITE=true` el servidor expone además estas 8 herramientas de escritura:

| Herramienta | Descripción |
|---|---|
| `update_transaction` | Corregir un movimiento (importe, categoría, beneficiario, notas, fecha) |
| `categorize_transactions` | Categorizar en lote (máx. 50), con resultado por elemento |
| `split_transaction` | Dividir un movimiento en partes reales — reemplaza la transacción (nuevo id) |
| `create_transaction` | Apuntar un gasto/ingreso, con splits opcionales en la creación |
| `create_schedule` | Crear un repetitivo (schedule) |
| `set_budget` | Asignar presupuesto en lote a varias categorías de un mes |
| `transfer_budget` | Mover presupuesto asignado entre categorías |
| `update_category_note` | Notas de categoría y plantillas de objetivos (templates) |

> **Escritura desactivada por defecto.** Las tools de escritura solo aparecen si defines `ENABLE_WRITE=true` en el bloque `env` de `claude_desktop_config.json` (y reinicias Claude Desktop).
>
> - Los **importes se dan en unidades** de la moneda configurada (euros, no céntimos); el servidor hace la conversión.
> - `split_transaction` **reemplaza** la transacción original por una nueva con subtransacciones, así que el movimiento resultante tiene un **id nuevo**.

## Ejemplos de uso con Claude

Una vez configurado, puedes preguntar cosas como:

- "¿Cuánto he gastado este mes en restaurantes?"
- "¿Cuál es mi patrimonio neto actual?"
- "Muéstrame las transacciones de la última semana"
- "¿Cómo van mis presupuestos de enero y febrero?"
- "¿Cuáles son mis mayores gastos del último trimestre?"

Claude usará automáticamente las herramientas MCP para consultar tus datos reales de Actual Budget.

## Seguridad

- **NUNCA** commitear el archivo `.env` al repositorio
- La contraseña de Actual Budget va solo en `.env` local o en la config de Claude Desktop
- El `.gitignore` ya excluye `.env`, `node_modules/` y datos locales
- No hay tools de borrado; las tools de escritura no se registran sin `ENABLE_WRITE`; hay guardas contra editar partes/padres de un split

Tres cosas que conviene saber antes de activar la escritura:

- `data/` guarda una **copia sin cifrar** de todo tu presupuesto (se crea con permisos `0700`, solo para ti).
- Los nombres de pagador y las notas vienen del banco o de importaciones CSV: son **texto no confiable**, no instrucciones. Mantén la aprobación por llamada activada en tu cliente MCP.
- `split_transaction` **reemplaza** la transacción, así que obtiene un id nuevo.
- Cada cliente MCP que conectes arranca su propio proceso del servidor. Actual solo permite
  que un proceso abra el presupuesto a la vez, así que las instancias extra usan
  automáticamente su propia copia local (`<data dir>-instance-<pid>`). En una instalación
  manual puedes dar a cada cliente su propio `ACTUAL_DATA_DIR` si prefieres controlarlo (el
  bundle de Claude Desktop no expone esta opción).

El modelo de seguridad completo — frontera de confianza, credenciales, operaciones destructivas, validación de entrada y cómo reportar una vulnerabilidad — está en [SECURITY.md](SECURITY.md) (en inglés).

## Desarrollo

### Ejecutar manualmente

```bash
npm run dev     # ejecuta src/index.ts con tsx (sin compilar)
npm start       # ejecuta dist/index.js (requiere npm run build antes)
```

El servidor se comunica por stdio (stdin/stdout), así que al ejecutarlo manualmente no verás output interactivo — los logs van a stderr.

### Tests y smoke

```bash
npm test        # suite completa con Vitest (127 tests)
npm run smoke   # comprobación manual contra el servidor Actual real (requiere .env)
```

El smoke imprime el número de cuentas y el patrimonio neto para contrastarlos con la UI de Actual. No forma parte de CI.

### Añadir una nueva herramienta

1. Crea un archivo en `src/tools/mi_nueva_herramienta.ts`
2. Exporta una `ToolDef` (`name`, `description`, `readOnly`, `inputSchema` con Zod, `handler`)
3. Importa y registra la tool en el array `allTools` de `src/tools/index.ts`

El `handler(input, ctx)` recibe el contexto `{ api, config }` ya inicializado; usa `moneyFields`/`toUnits` de `src/core/money.js` para devolver siempre importes en unidades (nunca céntimos).

### Publicar un bundle

> **El bundle queda atado al ABI de Electron de Claude Desktop.** Las extensiones corren
> dentro del Electron de Claude, no bajo el Node del sistema, así que `better-sqlite3` tiene
> que estar compilado para ese runtime. `npm run bundle` lee la versión de Electron del
> `Claude.app` instalado, reinstala el prebuild para ella y verifica el binario que
> realmente viaja haciéndole `dlopen` con el Node que empaqueta — que *debe* fallar
> declarando el ABI de Electron. Si carga, es que se coló el binario de Node y el
> empaquetado se detiene.
>
> Por tanto: **empaqueta en un equipo con el Claude Desktop al que apuntas**, o pasa
> `ELECTRON_TARGET=x.y.z npm run bundle`. Vuelve a publicar cada vez que Claude Desktop
> suba de Electron mayor — el bundle anterior deja de funcionar para todo el que actualice.

1. Actualiza la `version` en `package.json` **y** en `manifest.json` (un test obliga a que coincidan).
2. `npm test && npm run build && npm run bundle` — la última línea indica para qué versión
   de Electron y qué ABI se construyó. Anótalo en la descripción de la release.
3. Verifica el bundle:
   ```bash
   npx mcpb validate manifest.json
   unzip -l build/actual-budget-mcp-es.mcpb | grep -E 'tests/|docs/|\.env' | grep -v 'node_modules/'  # sin salida
   unzip -l build/actual-budget-mcp-es.mcpb | grep -c 'better_sqlite3.node'  # al menos 1
   ```
   `npx mcpb info <archivo>` (CLI 2.1.2) solo imprime nombre, tamaño y estado de firma —
   no valida el manifiesto, así que no sustituye a `validate`. La exclusión de
   `node_modules/` en el grep está ahí porque los archivos de dependencias empaquetadas
   no son código propio del proyecto y contienen legítimamente rutas como `tests/` — no la
   quites pensando que es un error.
4. Instala `build/actual-budget-mcp-es.mcpb` en local y comprueba que funciona.
5. `gh release create vX.Y.Z build/actual-budget-mcp-es.mcpb`, indicando en la descripción
   de la release que el bundle está dirigido a macOS en Apple Silicon.

## Notas técnicas

- Los importes de Actual están en céntimos; las tools los devuelven SIEMPRE convertidos a unidades de la moneda configurada (÷ 100 en el servidor, campos amount y amount_formatted).
- Las transferencias entre cuentas se identifican por `transfer_id` y se excluyen de los resúmenes para no doblar importes.
- La primera conexión a Actual Budget puede tardar unos segundos mientras descarga el presupuesto.

## Licencia

MIT — ver [LICENSE](LICENSE).
