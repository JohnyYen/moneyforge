import { useRouter } from 'expo-router';

import { PasteScreen } from '@/features/rules/ui/paste-screen';
import { Button } from '@/shared/ui/primitives';

import { useTransfer } from './transfer-context';

/** Shared text lands on the paste screen, so that is where a shared file finds its way here. */
export function PasteWithCsv() {
  const transfer = useTransfer();
  const router = useRouter();
  return (
    <PasteScreen
      renderSharedAction={(text) => (
        <Button
          label="Import as CSV instead"
          variant="secondary"
          onPress={() => {
            transfer.holdSharedCsv(text);
            router.replace('/data/csv-import');
          }}
        />
      )}
    />
  );
}
