import type { Currency } from '../domain/currency';
import { amountPreview, ratePreview, receivedPreview } from './amount-preview';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const kwd: Currency = { code: 'KWD', name: 'Dinar', decimals: 3, symbol: 'KD', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' };

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

  it.each(['0', '0.00', '-5'])('rejects %p for an amount that must be positive', (text) => {
    expect(amountPreview(text, usd)).toBe('The amount must be greater than zero.');
  });

  it('accepts zero but not a negative where an amount may be empty, such as a fee', () => {
    expect(amountPreview('0', usd, 'non-negative')).toBe('Saved as $0.00');
    expect(amountPreview('-5', usd, 'non-negative')).toBe('The amount cannot be negative.');
  });

  it('accepts any sign for a balance', () => {
    expect(amountPreview('0', usd, 'any')).toBe('Saved as $0.00');
    expect(amountPreview('-5', usd, 'any')).toBe('Saved as -$5.00');
  });
});

describe('receivedPreview', () => {
  const preview = (received: string, sent: string, rate: string) =>
    receivedPreview({ received, sent, rate, source: usd, target: eur });

  it('shows the amount the rate will store while the field is blank', () => {
    expect(preview('', '10', '0.92')).toBe('Saved as €9.20');
  });

  it('previews what was typed once there is something', () => {
    expect(preview('9.18', '10', '0.92')).toBe('Saved as €9.18');
    expect(preview('-1', '10', '0.92')).toBe('The amount must be greater than zero.');
  });

  it('warns when the amount rounds to nothing at the target precision', () => {
    expect(preview('', '0.01', '0.1')).toBe('The amount must be greater than zero.');
  });

  it('stays silent until the calculation is possible', () => {
    expect(preview('', '', '0.92')).toBeNull();
    expect(preview('', '10', '')).toBeNull();
    expect(preview('', '10', 'abc')).toBeNull();
    expect(preview('', '-10', '0.92')).toBeNull();
    expect(
      receivedPreview({ received: '', sent: '10', rate: '1', source: usd, target: undefined }),
    ).toBeNull();
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
