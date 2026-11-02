import { addressWord, normalizeAddress } from './address';

const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDT_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function value(family: 'evm' | 'tron', text: string) {
  const result = normalizeAddress(family, text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('EVM addresses', () => {
  // The published EIP-55 vectors.
  it.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ])('accepts the checksummed %s', (address) => {
    expect(value('evm', address)).toBe(address);
  });

  it('stores one spelling, whatever the case typed', () => {
    expect(value('evm', USDT_ETHEREUM.toLowerCase())).toBe(USDT_ETHEREUM);
    expect(value('evm', `0x${USDT_ETHEREUM.slice(2).toUpperCase()}`)).toBe(USDT_ETHEREUM);
    expect(value('evm', `  ${USDT_ETHEREUM}\n`)).toBe(USDT_ETHEREUM);
  });

  it('refuses a mixed case address with a wrong checksum', () => {
    const typo = USDT_ETHEREUM.replace('dAC17', 'DAC17');
    const result = normalizeAddress('evm', typo);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-address' } });
    expect(result.ok ? '' : result.error.message).toMatch(/checksum/i);
  });

  it.each(['', 'dAC17F958D2ee523a2206206994597C13D831ec7', '0x12', `${USDT_ETHEREUM}00`, USDT_TRON])(
    'refuses %j',
    (text) => {
      expect(normalizeAddress('evm', text).ok).toBe(false);
    },
  );
});

describe('Tron addresses', () => {
  it.each([USDT_TRON, 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7'])(
    'accepts %s',
    (address) => {
      expect(value('tron', address)).toBe(address);
    },
  );

  it('refuses one changed character', () => {
    const result = normalizeAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u');
    expect(result.ok ? '' : result.error.message).toMatch(/checksum/i);
  });

  it.each([
    ['too short', 'TR7NHqjeKQxGTCi8q8'],
    ['outside the alphabet', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj60'],
    ['an EVM address', USDT_ETHEREUM],
    // A valid base58check payload with the Bitcoin prefix, not 0x41.
    ['another network', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
  ])('refuses %s', (_, text) => {
    expect(normalizeAddress('tron', text).ok).toBe(false);
  });
});

describe('addressWord', () => {
  it('pads the 20 address bytes of either family to an ABI word', () => {
    expect(addressWord('evm', USDT_ETHEREUM)).toBe(
      '000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7',
    );
    expect(addressWord('tron', USDT_TRON)).toBe(
      '000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    );
  });
});
