import type { Currency } from '../domain/currency';
import { amountPreview, ratePreview } from './amount-preview';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const kwd: Currency = { code: 'KWD', name: 'Dinar', decimals: 3, symbol: 'KD', kind: 'fiat' };

describe('amountPreview', () => {
  it('shows what will be stored', () => {
    expect(amountPreview('1500', usd)).toBe('Saved as $1,500.00');
  });

  it('exposes the ambiguous case of a three decimal currency', () => {
    expect(amountPreview('1.500', kwd)).toBe('Saved as KD 1.50');
  });

  it('explains a rejected amount as it is typed', () => {
    expect(amountPreview('1.500', usd)).toMatch(/thousands separators/);
  });

  it('stays silent with nothing to preview', () => {
    expect(amountPreview('', usd)).toBeNull();
    expect(amountPreview(' ', usd)).toBeNull();
    expect(amountPreview('5', undefined)).toBeNull();
  });
});

describe('ratePreview', () => {
  it('shows the pair and the value', () => {
    expect(ratePreview('1500', 'USD', 'COP')).toBe('Saved as 1 USD = 1,500 COP');
    expect(ratePreview('1.500', 'USD', 'COP')).toBe('Saved as 1 USD = 1.5 COP');
  });

  it('shows the value alone until the pair is chosen', () => {
    expect(ratePreview('1.5', null, 'COP')).toBe('Saved as 1.5');
  });

  it('explains an invalid rate and stays silent when empty', () => {
    expect(ratePreview('0', 'USD', 'COP')).toBe('Enter a rate greater than zero.');
    expect(ratePreview('', 'USD', 'COP')).toBeNull();
  });
});
