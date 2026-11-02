const HEX_KEY = /\b(?:0x)?[0-9a-fA-F]{64,}\b/;
const WIF_UNCOMPRESSED = /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/;
const WIF_COMPRESSED = /\b[KL][1-9A-HJ-NP-Za-km-z]{51}\b/;
const EXTENDED_KEY = /\b[xyz]prv[1-9A-HJ-NP-Za-km-z]{50,}\b/;

const MIN_SEED_WORDS = 12;
const WORD_SEPARATORS = /[\s,.;:()\-\d]+/;
/** Every word of the BIP-39 English list has 3 to 8 letters. */
const isSeedWord = (word: string) => word.length >= 3 && word.length <= 8;

function isSeedPhrase(text: string): boolean {
  const words = text.split(WORD_SEPARATORS).filter(Boolean);
  return words.length >= MIN_SEED_WORDS && words.every(isSeedWord);
}

/**
 * Whether text may be a private key or a seed phrase. Runs on every field a person types here,
 * before anything else reads it. Errs towards refusing, since a stored key cannot be unseen, and
 * has no word list, so 12 ordinary words of that length also read as a phrase.
 */
export function looksLikeSecret(text: string): boolean {
  return (
    HEX_KEY.test(text) ||
    WIF_UNCOMPRESSED.test(text) ||
    WIF_COMPRESSED.test(text) ||
    EXTENDED_KEY.test(text) ||
    isSeedPhrase(text)
  );
}

export const SECRET_REFUSED_MESSAGE =
  'This looks like a private key or a seed phrase, so it was not saved. MoneyForge only needs a ' +
  'public address, and never asks for keys.';
