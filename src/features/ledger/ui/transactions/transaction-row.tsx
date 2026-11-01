import { ListRow, useColors } from '@/shared/ui/primitives';

import type { TransactionRowModel } from '../transaction-row-model';

export function TransactionRow({ row }: { row: TransactionRowModel }) {
  const colors = useColors();
  const amountColors = { in: colors.positive, out: colors.negative, neutral: colors.text };
  return (
    <ListRow
      title={row.title}
      subtitle={row.subtitle}
      trailing={row.amount}
      trailingColor={amountColors[row.direction]}
    />
  );
}
