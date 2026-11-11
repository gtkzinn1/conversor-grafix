import { readPreference, writePreference } from './storage';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
/** Cor da barra da janela do app instalado, por tema (igual ao fundo da página). */
const THEME_COLORS: Record<Theme, string> = {
  dark: '#141418',
  light: '#f6f6f8',
};

/** Tema escuro é o padrão; o claro só se o usuário tiver escolhido. */
export function getSavedTheme(): Theme {
  return readPreference(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function saveTheme(theme: Theme): void {
  writePreference(STORAGE_KEY, theme);
  applyTheme(theme);
}
