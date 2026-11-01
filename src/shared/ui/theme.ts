const palettes = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
  },
} as const;

export function colorsFor(scheme: string | null | undefined) {
  return palettes[scheme === 'dark' ? 'dark' : 'light'];
}
