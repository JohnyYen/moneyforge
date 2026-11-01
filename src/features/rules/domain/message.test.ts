import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  acceptsChannel,
  hashBody,
  looksLikeOneTimeCode,
  normalizeBody,
  normalizeReference,
  normalizeSender,
  referenceKeyFor,
} from './message';

const SECRET = 'per-install-secret';

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
    const hash = hashBody('Paid 10 USD at Shop', SECRET);
    expect(hashBody('paid   10 usd AT shop', SECRET)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBody('Paid 11 USD at Shop', SECRET)).not.toBe(hash);
  });

  it('cannot be compared across installs', () => {
    expect(hashBody('Paid 10', SECRET)).not.toBe(hashBody('Paid 10', 'another'));
  });

  it('is HMAC-SHA256 of the case-folded text under a body label', () => {
    const expected = bytesToHex(hmac(sha256, utf8ToBytes(SECRET), utf8ToBytes('body\0paid 10')));
    expect(hashBody('Paid 10', SECRET)).toBe(expected);
  });
});

describe('referenceKeyFor', () => {
  it('ignores case and space, and hides the reference', () => {
    const key = referenceKeyFor('expense', ' ab-77 ', SECRET);
    expect(referenceKeyFor('expense', 'AB-77', SECRET)).toBe(key);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates kinds, so a reversal keeps the reference of its purchase', () => {
    expect(referenceKeyFor('income', 'A1', SECRET)).not.toBe(referenceKeyFor('expense', 'A1', SECRET));
  });

  it('cannot be compared across installs, or with a body hash', () => {
    const key = referenceKeyFor('income', 'A1', SECRET);
    expect(key).not.toBe(referenceKeyFor('income', 'A1', 'another'));
    expect(key).not.toBe(hashBody('income\0A1', SECRET));
  });

  it('returns null with nothing to key on', () => {
    expect(referenceKeyFor('income', null, SECRET)).toBeNull();
    expect(referenceKeyFor('income', '  ', SECRET)).toBeNull();
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
    'Your OTP 482913 for purchase of 250 USD at Amazon',
    'Authentication code 553311',
    'Your auth code is 482913',
    'Your authorization code is 482913. Do not share it',
    'Approval code 553311',
    'Tu código de autorización es 482913',
    'Authorization code 884211 for your purchase. Do not share it',
    'Your authorization code for this payment is 482913',
    'Authorization code 884211 for your purchase',
    'Compra aprobada. Código de autorización 123456',
  ])('catches %j', (body) => {
    expect(looksLikeOneTimeCode(body)).toBe(true);
  });

  it.each([
    'You received 1,500.25 USD from Acme',
    'Payment of 2500 approved at Shop',
    'Your statement is ready',
    'Promo code SAVE at checkout',
    'Card ending 1234 charged 20 USD',
    'Purchase of 25 USD at Shop, auth code 123456',
    'Approved 50 USD. Authorization code 884211',
    'Compra de 50 USD, codigo de autorizacion 123456',
  ])('lets %j through', (body) => {
    expect(looksLikeOneTimeCode(body)).toBe(false);
  });
});
