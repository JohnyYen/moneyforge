import { useCallback, useState } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { Category } from '../../domain/category';
import { useLedger } from '../ledger-context';
import { CategoriesView, type CategoryValues } from './categories-view';

export function CategoriesScreen() {
  const ledger = useLedger();
  const [editing, setEditing] = useState<Category | null>(null);
  const [formKey, setFormKey] = useState(0);
  const load = useCallback(() => ledger.listCategories(), [ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    (values: CategoryValues) =>
      editing
        ? ledger.updateCategory({ ...values, id: editing.id })
        : ledger.createCategory(values),
    () => {
      setEditing(null);
      setFormKey((value) => value + 1);
      reload();
    },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(categories) => (
        <CategoriesView
          categories={categories}
          editing={editing}
          formKey={formKey}
          error={error}
          submitting={submitting}
          onEdit={setEditing}
          onCancel={() => setEditing(null)}
          onSubmit={submit}
        />
      )}
    </QueryBoundary>
  );
}
