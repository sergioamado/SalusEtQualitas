import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F8F8',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F2',
  border: '#DCE3E3',
  text: '#13201F',
  textMuted: '#5B6B6A',
  primary: '#0E7C74',
  primaryText: '#FFFFFF',
  primarySoft: '#E1F2F0',
  secondary: '#13201F',
  secondaryText: '#FFFFFF',
  danger: '#B3261E',
  dangerSoft: '#FCE8E6',
  success: '#1E7B34',
  successSoft: '#E3F4E7',
  warning: '#8A5A00',
  warningSoft: '#FFF3D6',
};

const dark: typeof light = {
  background: '#0D1413',
  surface: '#16201F',
  surfaceMuted: '#1E2A29',
  border: '#2B3A39',
  text: '#E8EFEE',
  textMuted: '#9AABA9',
  primary: '#4FC2B6',
  primaryText: '#062421',
  primarySoft: '#173634',
  secondary: '#1E2A29',
  secondaryText: '#E8EFEE',
  danger: '#F2B8B5',
  dangerSoft: '#3B1B19',
  success: '#8FD8A0',
  successSoft: '#17301D',
  warning: '#F5C66B',
  warningSoft: '#3A2D10',
};

export type Palette = typeof light;

// ---------------------------------------------------------------------
// Identidade visual da clínica (cores e fonte), aplicada via contexto.
// ---------------------------------------------------------------------
export type BrandFonts = { regular: string; bold: string };
export type BrandValue = {
  primary?: string | null;
  secondary?: string | null;
  fonts?: BrandFonts | null;
};
export const BrandContext = createContext<BrandValue>({});

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mistura duas cores; amount = quanto da cor b (0..1). */
export function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => ca[i] + (cb[i] - ca[i]) * amount) as [number, number, number]);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto preto ou branco, o que tiver mais contraste sobre a cor. */
export const readableOn = (hex: string) => (luminance(hex) > 0.4 ? '#111111' : '#FFFFFF');

export const isHexColor = (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value);

export function usePalette(): Palette {
  const isDark = useColorScheme() === 'dark';
  const base = isDark ? dark : light;
  const brand = useContext(BrandContext);
  if (!brand.primary && !brand.secondary) return base;

  const out = { ...base };
  if (brand.primary && isHexColor(brand.primary)) {
    // No modo escuro, cores muito escuras são clareadas para continuar legíveis.
    const primary =
      isDark && luminance(brand.primary) < 0.12 ? mix(brand.primary, '#FFFFFF', 0.45) : brand.primary;
    out.primary = primary;
    out.primaryText = readableOn(primary);
    out.primarySoft = mix(base.surface, primary, isDark ? 0.25 : 0.12);
  }
  if (brand.secondary && isHexColor(brand.secondary)) {
    out.secondary = brand.secondary;
    out.secondaryText = readableOn(brand.secondary);
  }
  return out;
}

export function useBrandFonts(): BrandFonts | null {
  return useContext(BrandContext).fonts ?? null;
}

export const Space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Largura máxima do conteúdo no navegador do computador. */
export const MaxContentWidth = 560;
export const MaxPanelWidth = 1040;
