// taxonomy.ts — category groups, and the counter behind the delete guards.
//
// Actual has its own "must this category be transferred before deleting?" check
// (must-category-transfer) but it is not exposed through @actual-app/api, so the
// guard is computed here. Deleting a category without a destination leaves its
// transactions pointing at a deleted row, which reads as uncategorized money.

export interface GroupInfo {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  categoryIds: string[];
}

/** Indexes api.getCategoryGroups() by group id. */
export async function getGroupIndex(api: any): Promise<Map<string, GroupInfo>> {
  const groups = await api.getCategoryGroups();
  const idx = new Map<string, GroupInfo>();
  for (const g of groups ?? []) {
    idx.set(g.id, {
      id: g.id,
      name: g.name,
      is_income: !!g.is_income,
      hidden: !!g.hidden,
      categoryIds: (g.categories ?? []).map((c: any) => c.id),
    });
  }
  return idx;
}

/** How many transactions reference any of these categories. */
export async function countTransactionsForCategories(api: any, categoryIds: string[]): Promise<number> {
  if (categoryIds.length === 0) return 0;
  const { data } = await api.runQuery(
    api.q('transactions')
      .filter({ category: { $oneof: categoryIds } })
      // 'all' and not 'grouped': the category of a split lives on its children,
      // and grouped rolls them up into the parent, which has no category.
      .options({ splits: 'all' })
      .select(['id']),
  );
  return (data as any[] | null)?.length ?? 0;
}
