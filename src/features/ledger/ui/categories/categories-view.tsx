import { useState } from 'react';

import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  ListRow,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';

import type { Category, CategoryKind } from '../../domain/category';

export type CategoryValues = {
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  archived: boolean;
};

const KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
] as const;

const NO_PARENT = 'none';

function CategoryForm({
  editing,
  categories,
  error,
  submitting,
  onSubmit,
  onCancel,
}: {
  editing: Category | null;
  categories: readonly Category[];
  error: string | null;
  submitting: boolean;
  onSubmit: (values: CategoryValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<CategoryKind>(editing?.kind ?? 'expense');
  const [parentId, setParentId] = useState(editing?.parentId ?? NO_PARENT);

  const parents = categories.filter(
    (category) => category.kind === kind && !category.archived && category.id !== editing?.id,
  );
  const submit = (archived: boolean) =>
    onSubmit({ name, kind, archived, parentId: parentId === NO_PARENT ? null : parentId });

  return (
    <>
      <TextField label="Name" value={name} onChangeText={setName} />
      {editing ? null : (
        <ChoiceChips
          label="Kind"
          options={KIND_OPTIONS}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setParentId(NO_PARENT);
          }}
        />
      )}
      <ChoiceChips
        label="Parent (optional)"
        options={[
          { value: NO_PARENT, label: 'None' },
          ...parents.map((category) => ({ value: category.id, label: category.name })),
        ]}
        value={parentId}
        onChange={setParentId}
      />
      <ErrorBanner message={error} />
      <Button
        label="Save category"
        disabled={submitting}
        onPress={() => submit(editing?.archived ?? false)}
      />
      {editing ? (
        <>
          <Button
            label={editing.archived ? 'Restore category' : 'Archive category'}
            variant="secondary"
            disabled={submitting}
            onPress={() => submit(!editing.archived)}
          />
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        </>
      ) : null}
    </>
  );
}

export function CategoriesView({
  categories,
  editing,
  formKey,
  error,
  submitting,
  onEdit,
  onCancel,
  onSubmit,
}: {
  categories: readonly Category[];
  editing: Category | null;
  formKey: number;
  error: string | null;
  submitting: boolean;
  onEdit: (category: Category) => void;
  onCancel: () => void;
  onSubmit: (values: CategoryValues) => void;
}) {
  const nameOf = (id: string | null) => categories.find((category) => category.id === id)?.name;
  const section = (kind: CategoryKind, title: string) => {
    const items = categories.filter((category) => category.kind === kind);
    return (
      <>
        <SectionLabel>{title}</SectionLabel>
        {items.length === 0 ? <EmptyState title="No categories yet" /> : null}
        {items.map((category) => {
          const parent = nameOf(category.parentId);
          const details = [parent && `In ${parent}`, category.archived && 'Archived'];
          return (
            <ListRow
              key={category.id}
              title={category.name}
              subtitle={details.filter(Boolean).join(' · ') || undefined}
              onPress={() => onEdit(category)}
            />
          );
        })}
      </>
    );
  };

  return (
    <Screen>
      <SectionLabel>{editing ? `Edit ${editing.name}` : 'New category'}</SectionLabel>
      <CategoryForm
        key={`${editing?.id ?? 'new'}-${formKey}`}
        editing={editing}
        categories={categories}
        error={error}
        submitting={submitting}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
      {section('expense', 'Expense')}
      {section('income', 'Income')}
    </Screen>
  );
}
