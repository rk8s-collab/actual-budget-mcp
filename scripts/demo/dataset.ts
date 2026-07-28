/**
 * Pure, deterministic demo dataset for the Actual Budget demo instance.
 *
 * This module does NO I/O — it only describes the shape of the demo budget
 * (accounts, categories, payees, transactions, budgets, rules). Applying it
 * to a real Actual server via @actual-app/api is a separate concern (Phase 2).
 *
 * All monetary amounts are integer cents (Actual's native unit). Dates are
 * 'YYYY-MM-DD'; budget months are 'YYYY-MM'.
 */

export interface DemoDataset {
  accounts: { name: string; offBudget: boolean }[];
  groups: { name: string; isIncome: boolean }[];
  categories: { name: string; group: string; isIncome: boolean }[];
  payees: { name: string; transferAccount?: string }[];
  // amounts in integer cents; date is 'YYYY-MM-DD'
  transactions: {
    account: string;
    date: string;
    amount: number;
    payee?: string;
    category?: string | null;
    transferAccount?: string;
    splits?: { amount: number; category: string | null }[];
  }[];
  budgets: { month: string; category: string; amount: number }[]; // 'YYYY-MM'
  rules: {
    stage: 'pre' | 'post' | null;
    conditionsOp: 'and' | 'or';
    conditions: { field: string; op: string; value: unknown }[];
    actions: { field: string; op: 'set'; value: unknown }[];
  }[];
}

export function buildDemoDataset(): DemoDataset {
  return {
    accounts: [
      { name: 'Checking', offBudget: false },
      { name: 'Savings', offBudget: false },
      { name: 'Pension', offBudget: true },
    ],

    groups: [
      { name: 'Income', isIncome: true },
      { name: 'Housing', isIncome: false },
      { name: 'Savings & Investment', isIncome: false },
      { name: 'Taxes', isIncome: false },
    ],

    categories: [
      { name: 'Salary', group: 'Income', isIncome: true },
      { name: 'Rent', group: 'Housing', isIncome: false },
      { name: 'Utilities', group: 'Housing', isIncome: false },
      { name: 'Groceries', group: 'Housing', isIncome: false },
      { name: 'Emergency Fund', group: 'Savings & Investment', isIncome: false },
      { name: 'VAT', group: 'Taxes', isIncome: false },
    ],

    payees: [
      { name: 'Employer Inc.' },
      { name: 'Landlord Properties' },
      { name: 'City Power & Water' },
      { name: 'Corner Market' },
      { name: 'Unknown Merchant' },
      { name: 'Transfer: Savings', transferAccount: 'Savings' },
    ],

    transactions: [
      // Salary deposit, categorized.
      {
        account: 'Checking',
        date: '2026-05-01',
        amount: 320000,
        payee: 'Employer Inc.',
        category: 'Salary',
      },
      // Rent, categorized.
      {
        account: 'Checking',
        date: '2026-05-03',
        amount: -150000,
        payee: 'Landlord Properties',
        category: 'Rent',
      },
      // Utilities, categorized.
      {
        account: 'Checking',
        date: '2026-05-05',
        amount: -8500,
        payee: 'City Power & Water',
        category: 'Utilities',
      },
      // Split transaction: groceries + household VAT, sums to parent amount.
      {
        account: 'Checking',
        date: '2026-05-10',
        amount: -12000,
        payee: 'Corner Market',
        category: null,
        splits: [
          { amount: -10500, category: 'Groceries' },
          { amount: -1500, category: 'VAT' },
        ],
      },
      // Uncategorized transaction.
      {
        account: 'Checking',
        date: '2026-05-12',
        amount: -3000,
        payee: 'Unknown Merchant',
        category: null,
      },
      // Transfer from Checking to Savings.
      {
        account: 'Checking',
        date: '2026-05-15',
        amount: -50000,
        payee: 'Transfer: Savings',
        transferAccount: 'Savings',
      },
      // Following month: salary again.
      {
        account: 'Checking',
        date: '2026-06-01',
        amount: 320000,
        payee: 'Employer Inc.',
        category: 'Salary',
      },
      // Following month: rent again.
      {
        account: 'Checking',
        date: '2026-06-03',
        amount: -150000,
        payee: 'Landlord Properties',
        category: 'Rent',
      },
    ],

    budgets: [
      { month: '2026-05', category: 'Rent', amount: 150000 },
      { month: '2026-06', category: 'Rent', amount: 150000 },
      { month: '2026-05', category: 'Groceries', amount: 40000 },
      { month: '2026-05', category: 'Emergency Fund', amount: 20000 },
    ],

    rules: [
      {
        stage: null,
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'contains', value: 'Landlord' }],
        actions: [{ field: 'category', op: 'set', value: 'Rent' }],
      },
    ],
  };
}
