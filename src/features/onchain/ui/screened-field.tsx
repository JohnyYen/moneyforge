import { useState } from 'react';

import { Notice, TextField } from '@/shared/ui/primitives';

import { looksLikeSecret, SECRET_REFUSED_MESSAGE } from '../domain/secret-guard';

/**
 * A field for pasted text. A key or a seed phrase never reaches form state, so it cannot linger
 * on screen or reach a save. Keyboards learn nothing from it either.
 */
export function ScreenedField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  const [refused, setRefused] = useState(false);
  return (
    <>
      <TextField
        label={label}
        value={value}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        spellCheck={false}
        onChangeText={(text) => {
          const secret = looksLikeSecret(text);
          setRefused(secret);
          onChangeText(secret ? '' : text);
        }}
      />
      {refused ? <Notice>{SECRET_REFUSED_MESSAGE}</Notice> : null}
    </>
  );
}
