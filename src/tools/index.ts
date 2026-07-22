// index.ts — catálogo de tools. Cada task de tool añade su import aquí.
import type { ToolDef } from '../core/types.js';
import { tool as getAccounts } from './get_accounts.js';
import { tool as getNetWorth } from './get_net_worth.js';
import { tool as getCategories } from './get_categories.js';
import { tool as getTransactions } from './get_transactions.js';
import { tool as getSpendingSummary } from './get_spending_summary.js';
import { tool as getBudgetMonth } from './get_budget_month.js';
import { tool as getBudgetAverages } from './get_budget_averages.js';
import { tool as getSchedules } from './get_schedules.js';
import { tool as updateTransaction } from './update_transaction.js';
import { tool as categorizeTransactions } from './categorize_transactions.js';
import { tool as splitTransaction } from './split_transaction.js';

export const allTools: ToolDef[] = [getAccounts, getNetWorth, getCategories, getTransactions, getSpendingSummary, getBudgetMonth, getBudgetAverages, getSchedules, updateTransaction, categorizeTransactions, splitTransaction];
