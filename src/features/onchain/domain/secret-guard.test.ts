import { looksLikeSecret } from './secret-guard';

const SEED_12 =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';
const SEED_24 = `${SEED_12} ${SEED_12}`;

describe('looksLikeSecret', () => {
  it.each([
    ['64 hex characters', '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'],
    ['64 hex characters with a prefix', '0x4C0883A69102937D6231471B5DBB6204FE5129617082792AE468D01A3F362318'],
    ['a key inside other text', 'my key 4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318 here'],
    ['an uncompressed WIF', '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'],
    ['a compressed WIF', 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617'],
    ['an extended private key', `xprv${'9'.repeat(107)}`],
    ['12 words', SEED_12],
    ['24 words', SEED_24],
    ['numbered words on lines', SEED_12.split(' ').map((word, index) => `${index + 1}. ${word}`).join('\n')],
    ['capitalized words split by commas', SEED_12.toUpperCase().split(' ').join(', ')],
  ])('refuses %s', (_, text) => {
    expect(looksLikeSecret(text)).toBe(true);
  });

  it.each([
    ['a Tron address', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    ['an EVM address', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
    ['a short label', 'Savings wallet on Tron'],
    ['a long label with short words', 'my old wallet on the tron network I use to get paid by my main client'],
    ['an empty text', ''],
    ['an endpoint', 'https://ethereum-rpc.publicnode.com'],
  ])('allows %s', (_, text) => {
    expect(looksLikeSecret(text)).toBe(false);
  });
});
