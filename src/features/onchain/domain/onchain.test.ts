import { hostOf, validateChain, validateToken, type Chain, type Token } from './onchain';

const chain: Chain = {
  id: 'c1',
  name: 'Ethereum',
  family: 'evm',
  endpoint: 'https://rpc.example.com/v1',
  evmChainId: '1',
};

const token: Token = {
  id: 't1',
  chainId: 'c1',
  symbol: 'USDT',
  contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  decimals: 6,
};

describe('validateChain', () => {
  it('accepts an https endpoint and trims it', () => {
    expect(validateChain({ ...chain, name: ' Ethereum ', endpoint: ' https://rpc.example.com/ ' }))
      .toMatchObject({ ok: true, value: { name: 'Ethereum', endpoint: 'https://rpc.example.com' } });
  });

  it.each([
    ['plain http', 'http://rpc.example.com'],
    ['credentials', 'https://user:secret@rpc.example.com'],
    ['no host', 'https://'],
    ['spaces', 'https://rpc example.com'],
    ['another scheme', 'ftp://rpc.example.com'],
    ['too long', `https://rpc.example.com/${'a'.repeat(600)}`],
  ])('refuses %s in an endpoint', (_, endpoint) => {
    expect(validateChain({ ...chain, endpoint })).toMatchObject({
      ok: false,
      error: { code: 'invalid-chain' },
    });
  });

  it('needs a number for an EVM chain and none for Tron', () => {
    expect(validateChain({ ...chain, evmChainId: null }).ok).toBe(false);
    expect(validateChain({ ...chain, evmChainId: 'one' }).ok).toBe(false);
    expect(validateChain({ ...chain, family: 'tron', evmChainId: '1' })).toMatchObject({
      ok: true,
      value: { evmChainId: null },
    });
  });

  it('needs a name', () => {
    expect(validateChain({ ...chain, name: ' ' }).ok).toBe(false);
  });
});

describe('validateToken', () => {
  it('stores the checksummed contract', () => {
    expect(validateToken(token, 'evm')).toMatchObject({
      ok: true,
      value: { contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    });
  });

  it('refuses a contract of another family', () => {
    expect(validateToken(token, 'tron').ok).toBe(false);
  });

  it.each([-1, 19, 1.5])('refuses %d decimals', (decimals) => {
    expect(validateToken({ ...token, decimals }, 'evm').ok).toBe(false);
  });

  it('needs a symbol', () => {
    expect(validateToken({ ...token, symbol: '' }, 'evm').ok).toBe(false);
  });
});

describe('hostOf', () => {
  it('leaves out a path, which may hold an API key', () => {
    expect(hostOf('https://rpc.example.com:8545/v3/secret-key?x=1')).toBe('rpc.example.com:8545');
  });
});
