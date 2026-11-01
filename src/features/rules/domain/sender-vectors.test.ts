import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import vectors from '../../../../modules/message-capture/fixtures/sender-vectors.json';
import { MAX_MESSAGE_LENGTH, normalizeSender } from './message';

const KOTLIN_ROOT = join(
  __dirname,
  '../../../../modules/message-capture/android/src/main/java/app/moneyforge/messagecapture',
);

const kotlinSource = (file: string) => readFileSync(join(KOTLIN_ROOT, file), 'utf8');

/** Kotlin cannot run here, so its own pattern runs through the steps of its normalizer. */
function kotlinNormalize(sender: string): string {
  const pattern = /Regex\("""(.+)"""\)/.exec(kotlinSource('SenderNormalizer.kt'))?.[1];
  if (!pattern) throw new Error('Pattern not found in SenderNormalizer.kt');
  return sender.toLowerCase().replace(new RegExp(pattern, 'g'), '');
}

describe('shared sender vectors', () => {
  it.each(vectors)('normalizes $raw in JavaScript', ({ raw, normalized }) => {
    expect(normalizeSender(raw)).toBe(normalized);
  });

  it.each(vectors)('normalizes $raw with the Kotlin pattern', ({ raw, normalized }) => {
    expect(kotlinNormalize(raw)).toBe(normalized);
  });
});

describe('queue body cap', () => {
  it('keeps one character past the limit, so ingest still sees the message as too long', () => {
    expect(kotlinSource('MessageQueue.kt')).toContain(
      `MAX_BODY_CHARS = ${MAX_MESSAGE_LENGTH + 1}`,
    );
  });
});
