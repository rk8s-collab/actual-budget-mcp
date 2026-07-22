[English](README.md) | **Español**

# Actual Budget MCP Server

> Esta es la versión en español del README. For the English version, see [README.md](README.md).

Servidor MCP (Model Context Protocol) que conecta Claude Desktop / Claude.ai con una instancia self-hosted de [Actual Budget](https://actualbudget.org/). Permite consultar cuentas, transacciones, presupuestos y más directamente desde Claude usando lenguaje natural.

## Requisitos

- Node.js >= 22
- **Actual Budget** self-hosted y accesible por red
- **Claude Desktop** o **Claude.ai** con soporte MCP

## Instalación

El proyecto está escrito en TypeScript (v2), así que hay que compilarlo antes de usarlo:

```bash
cd ~/GITs/Actual-MCP
npm install
cp .env.example .env
# Editar .env con tu contraseña de Actual Budget
npm run build          # compila TypeScript a dist/
```

Esto genera `dist/index.js`, el punto de entrada que ejecuta Claude Desktop.

## Cómo encontrar el Sync ID

1. Abre Actual Budget en el navegador
2. Ve a **Settings** → **Advanced Settings**
3. Busca la sección **IDs**
4. Copia el valor de **Sync ID**

## Configuración en Claude Desktop

Añade esta configuración al archivo `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Apunta `command` a `node` y `args` al `dist/index.js` compilado (usa una ruta absoluta):

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/Users/TU_USUARIO/GITs/Actual-MCP/dist/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "https://actual.example.org/",
        "ACTUAL_SERVER_PASSWORD": "tu-password",
        "ACTUAL_SYNC_ID": "00000000-0000-0000-0000-000000000000",
        "LOCALE": "es-ES",
        "CURRENCY": "EUR"
      }
    }
  }
}
```

> Sustituye `TU_USUARIO` por tu nombre de usuario de macOS y `tu-password` por la contraseña real.
> Recuerda ejecutar `npm run build` antes (y tras cada cambio) para regenerar `dist/`.

Durante el desarrollo puedes evitar la compilación usando `tsx` directamente:
`"command": "npx"`, `"args": ["tsx", "/ruta/absoluta/Actual-MCP/src/index.ts"]`.

Tras guardar, reinicia Claude Desktop para que detecte el nuevo servidor MCP.

## Variables de entorno

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

## Desarrollo

### Ejecutar manualmente

```bash
npm run dev     # ejecuta src/index.ts con tsx (sin compilar)
npm start       # ejecuta dist/index.js (requiere npm run build antes)
```

El servidor se comunica por stdio (stdin/stdout), así que al ejecutarlo manualmente no verás output interactivo — los logs van a stderr.

### Tests y smoke

```bash
npm test        # suite completa con Vitest (87 tests)
npm run smoke   # comprobación manual contra el servidor Actual real (requiere .env)
```

El smoke imprime el número de cuentas y el patrimonio neto para contrastarlos con la UI de Actual. No forma parte de CI.

### Añadir una nueva herramienta

1. Crea un archivo en `src/tools/mi_nueva_herramienta.ts`
2. Exporta una `ToolDef` (`name`, `description`, `readOnly`, `inputSchema` con Zod, `handler`)
3. Importa y registra la tool en el array `allTools` de `src/tools/index.ts`

El `handler(input, ctx)` recibe el contexto `{ api, config }` ya inicializado; usa `moneyFields`/`toUnits` de `src/core/money.js` para devolver siempre importes en unidades (nunca céntimos).

## Seguridad

- **NUNCA** commitear el archivo `.env` al repositorio
- La contraseña de Actual Budget va solo en `.env` local o en la config de Claude Desktop
- El `.gitignore` ya excluye `.env`, `node_modules/` y datos locales
- No hay tools de borrado; las tools de escritura no se registran sin `ENABLE_WRITE`; hay guardas contra editar partes/padres de un split

Tres cosas que conviene saber antes de activar la escritura:

- `data/` guarda una **copia sin cifrar** de todo tu presupuesto (se crea con permisos `0700`, solo para ti).
- Los nombres de pagador y las notas vienen del banco o de importaciones CSV: son **texto no confiable**, no instrucciones. Mantén la aprobación por llamada activada en tu cliente MCP.
- `split_transaction` **reemplaza** la transacción, así que obtiene un id nuevo.

El modelo de seguridad completo — frontera de confianza, credenciales, operaciones destructivas, validación de entrada y cómo reportar una vulnerabilidad — está en [SECURITY.md](SECURITY.md) (en inglés).

## Notas técnicas

- Los importes de Actual están en céntimos; las tools los devuelven SIEMPRE convertidos a unidades de la moneda configurada (÷ 100 en el servidor, campos amount y amount_formatted).
- Las transferencias entre cuentas se identifican por `transfer_id` y se excluyen de los resúmenes para no doblar importes.
- La primera conexión a Actual Budget puede tardar unos segundos mientras descarga el presupuesto.

## Licencia

MIT — ver [LICENSE](LICENSE).
