import { Share } from 'react-native';

import { ok, type Result } from '@/shared/result';

/** `Share` carries text, with no file: nothing that writes or shares files is installed. */
export async function shareText(
  title: string,
  message: string,
): Promise<Result<void, { message: string }>> {
  await Share.share({ title, message });
  return ok(undefined);
}
