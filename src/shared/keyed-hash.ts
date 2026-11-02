import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/** The label keeps two uses of a secret from sharing a key when their text is the same. */
export const keyedHash = (label: string, text: string, secret: string) =>
  bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${label}\0${text}`)));
