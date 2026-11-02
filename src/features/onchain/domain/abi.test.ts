import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { formatDecimal } from '@/features/ledger/domain/money';

import { BALANCE_OF_SELECTOR, DECIMALS_SELECTOR, parseDecimalsWord, parseUintWord } from './abi';

const selectorOf = (signature: string) => bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8);

describe('parseUintWord', () => {
  it('keeps every digit at 18 decimals, past what a Number holds', () => {
    const minor = 1234567890123456789012345n;
    const word = minor.toString(16).padStart(64, '0');
    expect(parseUintWord(`0x${word}`)).toBe(minor);
    expect(parseUintWord(word)).toBe(minor);
    expect(formatDecimal(parseUintWord(word) ?? 0n, 18)).toBe('1234567.890123456789012345');
  });

  it('reads the largest word', () => {
    expect(parseUintWord('f'.repeat(64))).toBe(2n ** 256n - 1n);
  });

  it.each([
    ['empty', ''],
    ['no data', '0x'],
    ['short', '0x01'],
    ['long', `0x${'0'.repeat(65)}`],
    ['two words', `0x${'0'.repeat(128)}`],
    ['not hex', `0x${'g'.repeat(64)}`],
    ['signed', `-${'0'.repeat(63)}1`],
  ])('refuses %s', (_, text) => {
    expect(parseUintWord(text)).toBeNull();
  });
});

describe('parseDecimalsWord', () => {
  it('reads a small value', () => {
    expect(parseDecimalsWord(`0x${'0'.repeat(62)}12`)).toBe(18);
  });

  it('refuses what no currency can hold', () => {
    expect(parseDecimalsWord(`0x${'0'.repeat(62)}13`)).toBeNull();
    expect(parseDecimalsWord(`0x${'f'.repeat(64)}`)).toBeNull();
  });
});

describe('selectors', () => {
  it('are the signature hashes', () => {
    expect(BALANCE_OF_SELECTOR).toBe(selectorOf('balanceOf(address)'));
    expect(DECIMALS_SELECTOR).toBe(selectorOf('decimals()'));
  });
});
