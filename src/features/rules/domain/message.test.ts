import {
  acceptsChannel,
  hashBody,
  looksLikeOneTimeCode,
  normalizeBody,
  normalizeReference,
  normalizeSender,
} from './message';

describe('normalizeSender', () => {
  it.each([
    ['  BankCo ', 'bankco'],
    ['+57 (300) 123-4567', '+573001234567'],
    ['BANK.CO', 'bankco'],
    ['   ', ''],
  ])('reads %j as %j', (raw, expected) => {
    expect(normalizeSender(raw)).toBe(expected);
  });

  it('does not treat a longer sender as the same one', () => {
    expect(normalizeSender('Bank')).not.toBe(normalizeSender('Bank2'));
  });
});

describe('normalizeBody', () => {
  it('collapses whitespace, including line breaks and non-breaking spaces', () => {
    expect(normalizeBody('  Paid\n\n 10 USD\t now ')).toBe('Paid 10 USD now');
  });

  it('removes zero-width characters', () => {
    expect(normalizeBody('Pa​id')).toBe('Paid');
  });
});

describe('normalizeReference', () => {
  it('ignores case and surrounding space', () => {
    expect(normalizeReference(' ab-77 ')).toBe('AB-77');
  });

  it('returns null with nothing to key on', () => {
    expect(normalizeReference(null)).toBeNull();
    expect(normalizeReference('  ')).toBeNull();
  });
});

describe('hashBody', () => {
  it('is stable across case and spacing, and never contains the text', () => {
    const hash = hashBody('Paid 10 USD at Shop');
    expect(hashBody('paid   10 usd AT shop')).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashBody('Paid 11 USD at Shop')).not.toBe(hash);
  });
});

describe('acceptsChannel', () => {
  it('lets a paste reach any source but an SMS only an SMS source', () => {
    expect(acceptsChannel({ channel: 'sms' }, 'sms')).toBe(true);
    expect(acceptsChannel({ channel: 'sms' }, 'paste')).toBe(true);
    expect(acceptsChannel({ channel: 'paste' }, 'paste')).toBe(true);
    expect(acceptsChannel({ channel: 'paste' }, 'sms')).toBe(false);
  });
});

describe('looksLikeOneTimeCode', () => {
  it.each([
    'Your OTP is 482913',
    'Your one-time password is AB12CD',
    '482913 is your verification code',
    'Use security code 8841 to sign in',
    'Tu código de verificación es 482913',
    'Tu clave dinámica es 123456',
    'Your code: 4829',
    'Your PIN is 1234',
    'Codigo 123456 valido por 5 minutos',
    '482913',
    'G-482913',
    'passcode: 991122',
  ])('catches %j', (body) => {
    expect(looksLikeOneTimeCode(body)).toBe(true);
  });

  it.each([
    'You received 1,500.25 USD from Acme',
    'Payment of 2500 approved at Shop',
    'Your statement is ready',
    'Promo code SAVE at checkout',
    'Card ending 1234 charged 20 USD',
  ])('lets %j through', (body) => {
    expect(looksLikeOneTimeCode(body)).toBe(false);
  });
});
