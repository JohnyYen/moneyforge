import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

import { err, ok, type Result } from '@/shared/result';

import type { ChainFamily } from './onchain';
import { onChainError, type OnChainError } from './onchain-error';

type AddressResult = Result<string, OnChainError>;

const invalid = (message: string) => err(onChainError('invalid-address', message));

const EVM_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55: a letter is uppercase when its nibble of the lowercase text's hash is 8 or more. */
function checksummed(lowercaseBody: string): string {
  const hash = bytesToHex(keccak_256(utf8ToBytes(lowercaseBody)));
  const body = [...lowercaseBody]
    .map((character, index) =>
      Number.parseInt(hash[index], 16) >= 8 ? character.toUpperCase() : character,
    )
    .join('');
  return `0x${body}`;
}

function normalizeEvm(text: string): AddressResult {
  if (!EVM_PATTERN.test(text)) return invalid('Enter an address: 0x and 40 hex characters.');
  const body = text.slice(2);
  const expected = checksummed(body.toLowerCase());
  const singleCase = body === body.toLowerCase() || body === body.toUpperCase();
  if (!singleCase && text !== expected) {
    return invalid('The checksum of this address is wrong. Copy it again.');
  }
  return ok(expected);
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TRON_LENGTH_BYTES = 25;
const TRON_PREFIX = '41';

/** The 25 bytes of a Tron address as hex, or null when the text cannot hold them. */
function base58ToHex(text: string): string | null {
  let value = 0n;
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16).padStart(TRON_LENGTH_BYTES * 2, '0');
  return hex.length === TRON_LENGTH_BYTES * 2 ? hex : null;
}

function normalizeTron(text: string): AddressResult {
  const hex = text.startsWith('T') && text.length === 34 ? base58ToHex(text) : null;
  if (!hex?.startsWith(TRON_PREFIX)) {
    return invalid('Enter a Tron address: 34 characters starting with T.');
  }
  const payload = hexToBytes(hex.slice(0, 42));
  const checksum = bytesToHex(sha256(sha256(payload))).slice(0, 8);
  if (checksum !== hex.slice(42)) {
    return invalid('The checksum of this address is wrong. Copy it again.');
  }
  return ok(text);
}

/** One canonical spelling, so the same address typed twice is the same row. */
export function normalizeAddress(family: ChainFamily, text: string): AddressResult {
  const trimmed = text.trim();
  return family === 'evm' ? normalizeEvm(trimmed) : normalizeTron(trimmed);
}

/** A canonical address as the 32 byte argument a contract call takes. */
export function addressWord(family: ChainFamily, address: string): string {
  const body = family === 'evm' ? address.slice(2).toLowerCase() : base58ToHex(address)?.slice(2, 42);
  return (body ?? '').padStart(64, '0');
}
