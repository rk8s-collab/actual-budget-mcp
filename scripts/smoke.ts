// Uso: npm run smoke  (requiere .env con credenciales reales)
import 'dotenv/config';
import * as api from '@actual-app/api';
import { loadConfig } from '../src/core/config.js';
import { setMessageLanguage } from '../src/core/messages.js';
import { ActualClient } from '../src/core/actual-client.js';
import { allTools } from '../src/tools/index.js';

const config = loadConfig();
setMessageLanguage(config.messagesLang);
const client = new ActualClient(api, config);
await client.ensureReady();
const ctx = { api, config };

const accounts: any = await allTools.find((t) => t.name === 'get_accounts')!.handler({}, ctx);
console.error(`Cuentas abiertas: ${accounts.total_count}`);
const nw: any = await allTools.find((t) => t.name === 'get_net_worth')!.handler({}, ctx);
console.error(`Patrimonio neto: ${nw.net_worth.amount_formatted} (on ${nw.on_budget.total.amount_formatted} / off ${nw.off_budget.total.amount_formatted})`);
console.error('>> Compara estas cifras con la UI de Actual antes de dar el smoke por bueno.');
await client.shutdown();
