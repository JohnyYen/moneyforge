import { err, ok, type Result } from '@/shared/result';

import {
  findsCycle,
  validateCategoryFields,
  type Category,
  type CategoryKind,
} from '../domain/category';
import { ledgerError, type LedgerError } from '../domain/ledger-error';
import type { LedgerDeps } from './ledger-deps';
import type { CategoryRepository } from './ports';

async function resolveParent(
  categories: CategoryRepository,
  parentId: string | null,
): Promise<Result<Category | null, LedgerError>> {
  if (parentId === null) return ok(null);
  const parent = await categories.get(parentId);
  return parent ? ok(parent) : err(ledgerError('not-found', 'Parent category not found.'));
}

export function createCategoryUseCases({ store, generateId }: LedgerDeps) {
  return {
    listCategories: () => store.categories.list(),

    createCategory: (input: {
      name: string;
      kind: CategoryKind;
      parentId: string | null;
    }): Promise<Result<Category, LedgerError>> =>
      store.atomic(async ({ categories }) => {
        const parent = await resolveParent(categories, input.parentId);
        if (!parent.ok) return parent;
        const fields = validateCategoryFields(input, parent.value);
        if (!fields.ok) return fields;
        const category: Category = {
          id: generateId(),
          name: fields.value.name,
          kind: input.kind,
          parentId: input.parentId,
          archived: false,
        };
        await categories.save(category);
        return ok(category);
      }),

    updateCategory: (input: {
      id: string;
      name: string;
      parentId: string | null;
      archived: boolean;
    }): Promise<Result<Category, LedgerError>> =>
      store.atomic(async ({ categories }) => {
        const existing = await categories.get(input.id);
        if (!existing) return err(ledgerError('not-found', 'Category not found.'));
        const parent = await resolveParent(categories, input.parentId);
        if (!parent.ok) return parent;
        const fields = validateCategoryFields({ ...input, kind: existing.kind }, parent.value);
        if (!fields.ok) return fields;
        if (input.parentId && findsCycle(await categories.list(), input.id, input.parentId)) {
          return err(ledgerError('invalid-category', 'A category cannot be its own parent.'));
        }
        const category: Category = {
          ...existing,
          name: fields.value.name,
          parentId: input.parentId,
          archived: input.archived,
        };
        await categories.save(category);
        return ok(category);
      }),
  };
}
