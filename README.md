# Actual Budget MCP Server

Servidor MCP (Model Context Protocol) que conecta Claude Desktop / Claude.ai con una instancia self-hosted de [Actual Budget](https://actualbudget.org/). Permite consultar cuentas, transacciones, presupuestos y más directamente desde Claude usando lenguaje natural.

## Requisitos

- **Node.js** >= 18.0.0
- **Actual Budget** self-hosted y accesible por red
- **Claude Desktop** o **Claude.ai** con soporte MCP

## Instalación

```bash
cd ~/Documents/GITs/Actual-MCP
npm install
cp .env.example .env
# Editar .env con tu contraseña de Actual Budget
```

## Cómo encontrar el Sync ID

1. Abre Actual Budget en el navegador
2. Ve a **Settings** → **Advanced Settings**
3. Busca la sección **IDs**
4. Copia el valor de **Sync ID**

## Configuración en Claude Desktop

Añade esta configuración al archivo `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "actual-budget": {
      "command": "node",
      "args": ["/Users/TU_USUARIO/Documents/GITs/Actual-MCP/src/index.js"],
      "env": {
        "ACTUAL_SERVER_URL": "https://actual.example.org/",
        "ACTUAL_SERVER_PASSWORD": "tu-password",
        "ACTUAL_SYNC_ID": "00000000-0000-0000-0000-000000000000"
      }
    }
  }
}
```

> Sustituye `TU_USUARIO` por tu nombre de usuario de macOS y `tu-password` por la contraseña real.

Tras guardar, reinicia Claude Desktop para que detecte el nuevo servidor MCP.

## Herramientas disponibles

| Herramienta | Descripción | Parámetros |
|---|---|---|
| `get_accounts` | Lista todas las cuentas con balance actual | Ninguno |
| `get_categories` | Lista categorías organizadas por grupo | Ninguno |
| `get_transactions` | Transacciones en un rango de fechas | `start_date`, `end_date`, `account_id`?, `category_id`? |
| `get_summary_by_category` | Resumen de gastos agrupado por categoría | `start_date`, `end_date`, `include_income`? |
| `get_budget_months` | Presupuesto mensual: asignado vs gastado | `months` (array de YYYY-MM) |
| `get_net_worth` | Patrimonio neto actual | Ninguno |

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
npm start
```

El servidor se comunica por stdio (stdin/stdout), así que al ejecutarlo manualmente no verás output interactivo — los logs van a stderr.

### Añadir una nueva herramienta

1. Crea un archivo en `src/tools/miNuevaHerramienta.js`
2. Exporta `definition` (esquema de la herramienta) y `handler` (función)
3. Importa y registra en `src/index.js` en el array `tools`

Estructura de cada herramienta:

```javascript
import { api } from '../actualClient.js';

export const definition = {
  name: 'mi_herramienta',
  description: 'Descripción clara de lo que hace',
  inputSchema: {
    type: 'object',
    properties: {
      // Parámetros...
    },
    required: [],
  },
};

export async function handler(params) {
  // Lógica usando api de Actual Budget
  return { /* resultado */ };
}
```

## Seguridad

- **NUNCA** commitear el archivo `.env` al repositorio
- La contraseña de Actual Budget va solo en `.env` local o en la config de Claude Desktop
- El `.gitignore` ya excluye `.env`, `node_modules/` y datos locales

## Notas técnicas

- Los importes en Actual Budget se almacenan como enteros en céntimos. Este servidor los convierte a euros (dividi entre 100) en todas las respuestas.
- Las transferencias entre cuentas se identifican por `transfer_id` y se excluyen de los resúmenes para no doblar importes.
- La primera conexión a Actual Budget puede tardar unos segundos mientras descarga el presupuesto.
