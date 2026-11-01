import { err, ok, type Result } from '@/shared/result';

import { ledgerError, type LedgerError } from './ledger-error';

export type CategoryKind = 'income' | 'expense';

export type Category = {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly parentId: string | null;
  readonly archived: boolean;
};

export function validateCategoryFields(
  input: { readonly name: string; readonly kind: CategoryKind },
  parent: Category | null,
): Result<{ name: string }, LedgerError> {
  const name = input.name.trim();
  if (!name) return err(ledgerError('invalid-category', 'Enter a category name.'));
  if (parent && parent.kind !== input.kind) {
    return err(ledgerError('invalid-category', 'A parent must be of the same kind.'));
  }
  return ok({ name });
}

export function findsCycle(
  categories: readonly Category[],
  categoryId: string,
  parentId: string,
): boolean {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]));
  const visited = new Set<string>();
  let current: string | null | undefined = parentId;
  while (current && !visited.has(current)) {
    if (current === categoryId) return true;
    visited.add(current);
    current = parents.get(current);
  }
  return false;
}
