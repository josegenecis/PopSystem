export type SystemColorScheme = 'green' | 'blue' | 'red' | 'purple';

export type SystemColorPalette = {
  id: SystemColorScheme;
  name: string;
  description: string;
  primary: string;
  primaryDark: string;
  primaryDeep: string;
  soft: string;
  surface: string;
  border: string;
  primaryHsl: string;
  primaryDarkHsl: string;
  primaryForegroundHsl: string;
  backgroundHsl: string;
  borderHsl: string;
  primaryRgb: string;
};

export const SYSTEM_COLOR_PALETTES: readonly SystemColorPalette[] = [
  {
    id: 'green',
    name: 'Verde PopSystem',
    description: 'A identidade original do PopSystem.',
    primary: '#85C441',
    primaryDark: '#0B5137',
    primaryDeep: '#063D2E',
    soft: '#F2F9EA',
    surface: '#F8FBF6',
    border: '#D8E7D4',
    primaryHsl: '85 55% 51%',
    primaryDarkHsl: '159 76% 18%',
    primaryForegroundHsl: '164 83% 14%',
    backgroundHsl: '100 27% 98%',
    borderHsl: '108 25% 87%',
    primaryRgb: '133, 196, 65',
  },
  {
    id: 'blue',
    name: 'Azul intenso',
    description: 'Azul vivo e profissional, inspirado na referência.',
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    primaryDeep: '#17358F',
    soft: '#EFF6FF',
    surface: '#F8FAFF',
    border: '#D7E3FF',
    primaryHsl: '221 83% 53%',
    primaryDarkHsl: '224 76% 48%',
    primaryForegroundHsl: '0 0% 100%',
    backgroundHsl: '220 100% 99%',
    borderHsl: '222 100% 92%',
    primaryRgb: '37, 99, 235',
  },
  {
    id: 'red',
    name: 'Vermelho iFood',
    description: 'Vermelho forte, comercial e reconhecível.',
    primary: '#EA1D2C',
    primaryDark: '#C51624',
    primaryDeep: '#8E101B',
    soft: '#FFF1F2',
    surface: '#FFFAFA',
    border: '#FFD8DC',
    primaryHsl: '356 83% 52%',
    primaryDarkHsl: '356 81% 43%',
    primaryForegroundHsl: '0 0% 100%',
    backgroundHsl: '0 100% 99%',
    borderHsl: '355 100% 92%',
    primaryRgb: '234, 29, 44',
  },
  {
    id: 'purple',
    name: 'Roxo vibrante',
    description: 'Roxo marcante, moderno e elegante.',
    primary: '#7C3AED',
    primaryDark: '#6D28D9',
    primaryDeep: '#4C1D95',
    soft: '#F5F3FF',
    surface: '#FBFAFF',
    border: '#E7DEFF',
    primaryHsl: '262 83% 58%',
    primaryDarkHsl: '263 70% 50%',
    primaryForegroundHsl: '0 0% 100%',
    backgroundHsl: '260 100% 99%',
    borderHsl: '258 100% 94%',
    primaryRgb: '124, 58, 237',
  },
] as const;

export const DEFAULT_SYSTEM_COLOR_SCHEME: SystemColorScheme = 'green';

export const normalizeSystemColorScheme = (value?: string | null): SystemColorScheme => {
  return SYSTEM_COLOR_PALETTES.some((palette) => palette.id === value)
    ? value as SystemColorScheme
    : DEFAULT_SYSTEM_COLOR_SCHEME;
};

export const getSystemColorPalette = (scheme?: string | null) => {
  const normalized = normalizeSystemColorScheme(scheme);
  return SYSTEM_COLOR_PALETTES.find((palette) => palette.id === normalized) || SYSTEM_COLOR_PALETTES[0];
};

export const applySystemColorScheme = (scheme?: string | null) => {
  if (typeof document === 'undefined') return;

  const palette = getSystemColorPalette(scheme);
  const root = document.documentElement;

  root.dataset.systemColor = palette.id;
  root.style.setProperty('--app-primary', palette.primary);
  root.style.setProperty('--app-primary-dark', palette.primaryDark);
  root.style.setProperty('--app-primary-deep', palette.primaryDeep);
  root.style.setProperty('--app-primary-soft', palette.soft);
  root.style.setProperty('--app-surface', palette.surface);
  root.style.setProperty('--app-primary-border', palette.border);
  root.style.setProperty('--app-primary-rgb', palette.primaryRgb);

  root.style.setProperty('--primary', palette.primaryHsl);
  root.style.setProperty('--primary-foreground', palette.primaryForegroundHsl);
  root.style.setProperty('--secondary', palette.primaryDarkHsl);
  root.style.setProperty('--secondary-foreground', '0 0% 100%');
  root.style.setProperty('--accent', palette.primaryHsl);
  root.style.setProperty('--accent-foreground', palette.primaryForegroundHsl);
  root.style.setProperty('--ring', palette.primaryHsl);
  root.style.setProperty('--background', palette.backgroundHsl);
  root.style.setProperty('--border', palette.borderHsl);
  root.style.setProperty('--input', palette.borderHsl);
};
