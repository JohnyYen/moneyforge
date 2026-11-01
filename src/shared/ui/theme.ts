const palettes = {
  light: {
    text: '#11181C',
    textMuted: '#60666C',
    background: '#FFFFFF',
    backgroundElement: '#F0F0F3',
    border: '#D9D9E0',
    accent: '#208AEF',
    onAccent: '#FFFFFF',
    positive: '#1B7F4B',
    negative: '#C62F2F',
    warningBackground: '#FFF4D6',
    warningText: '#6B4E00',
  },
  dark: {
    text: '#FFFFFF',
    textMuted: '#A0A7AE',
    background: '#000000',
    backgroundElement: '#212225',
    border: '#3A3B40',
    accent: '#4BA3F5',
    onAccent: '#00131F',
    positive: '#4CC38A',
    negative: '#FF7B72',
    warningBackground: '#3A2E0A',
    warningText: '#F5D90A',
  },
} as const;

export type ThemeColors = (typeof palettes)[keyof typeof palettes];

export function colorsFor(scheme: string | null | undefined): ThemeColors {
  return palettes[scheme === 'dark' ? 'dark' : 'light'];
}
