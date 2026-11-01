import { bytesToHex } from '@noble/hashes/utils';
import { getRandomBytesAsync } from 'expo-crypto';

const SECRET_BYTES = 32;

/** A value that must stay unguessable, from the platform's secure random source. */
export async function generateSecret(): Promise<string> {
  return bytesToHex(await getRandomBytesAsync(SECRET_BYTES));
}
