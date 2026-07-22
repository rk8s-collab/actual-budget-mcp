// index.ts — catálogo de tools. Cada task de tool añade su import aquí.
import type { ToolDef } from '../core/types.js';
import { tool as getAccounts } from './get_accounts.js';
import { tool as getNetWorth } from './get_net_worth.js';
import { tool as getCategories } from './get_categories.js';
import { tool as getTransactions } from './get_transactions.js';
import { tool as getSpendingSummary } from './get_spending_summary.js';
import { tool as getBudgetMonth } from './get_budget_month.js';

export const allTools: ToolDef[] = [getAccounts, getNetWorth, getCategories, getTransactions, getSpendingSummary, getBudgetMonth];
