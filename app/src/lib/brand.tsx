import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Lora_400Regular } from '@expo-google-fonts/lora/400Regular';
import { Lora_700Bold } from '@expo-google-fonts/lora/700Bold';
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
import { PlayfairDisplay_400Regular } from '@expo-google-fonts/playfair-display/400Regular';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import * as Font from 'expo-font';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { BrandContext, type BrandFonts } from '@/constants/theme';

export type FontKey = 'system' | 'inter' | 'poppins' | 'montserrat' | 'lora' | 'playfair';

type FontOption = {
  label: string;
  description: string;
  faces?: { regular: [string, number]; bold: [string, number] };
};

export const FONT_OPTIONS: Record<FontKey, FontOption> = {
  system: { label: 'Padrão do aparelho', description: 'Mais leve e rápida' },
  inter: {
    label: 'Inter',
    description: 'Moderna e neutra',
    faces: { regular: ['Inter_400Regular', Inter_400Regular], bold: ['Inter_700Bold', Inter_700Bold] },
  },
  poppins: {
    label: 'Poppins',
    description: 'Arredondada e amigável',
    faces: { regular: ['Poppins_400Regular', Poppins_400Regular], bold: ['Poppins_700Bold', Poppins_700Bold] },
  },
  montserrat: {
    label: 'Montserrat',
    description: 'Geométrica e marcante',
    faces: {
      regular: ['Montserrat_400Regular', Montserrat_400Regular],
      bold: ['Montserrat_700Bold', Montserrat_700Bold],
    },
  },
  lora: {
    label: 'Lora',
    description: 'Serifada e acolhedora',
    faces: { regular: ['Lora_400Regular', Lora_400Regular], bold: ['Lora_700Bold', Lora_700Bold] },
  },
  playfair: {
    label: 'Playfair Display',
    description: 'Elegante, estilo estética',
    faces: {
      regular: ['PlayfairDisplay_400Regular', PlayfairDisplay_400Regular],
      bold: ['PlayfairDisplay_700Bold', PlayfairDisplay_700Bold],
    },
  },
};

export const FONT_KEYS = Object.keys(FONT_OPTIONS) as FontKey[];

/** Carrega a fonte sob demanda (só a escolhida é baixada no portal). */
export function useBrandFont(key: FontKey | null | undefined): BrandFonts | null {
  const option = key ? FONT_OPTIONS[key] : undefined;
  const faces = option?.faces;
  const alreadyLoaded =
    !!faces && Font.isLoaded(faces.regular[0]) && Font.isLoaded(faces.bold[0]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!faces || alreadyLoaded) return;
    let active = true;
    Font.loadAsync({ [faces.regular[0]]: faces.regular[1], [faces.bold[0]]: faces.bold[1] })
      .then(() => active && setLoadedKey(faces.regular[0]))
      .catch(() => {
        // Sem a fonte, o texto continua com a fonte do aparelho.
      });
    return () => {
      active = false;
    };
  }, [faces, alreadyLoaded]);

  if (!faces) return null;
  if (alreadyLoaded || loadedKey === faces.regular[0]) {
    return { regular: faces.regular[0], bold: faces.bold[0] };
  }
  return null;
}

export function BrandProvider({
  primary,
  secondary,
  font,
  children,
}: {
  primary?: string | null;
  secondary?: string | null;
  font?: FontKey | string | null;
  children: ReactNode;
}) {
  const key = font && font in FONT_OPTIONS ? (font as FontKey) : 'system';
  const fonts = useBrandFont(key);
  const value = useMemo(() => ({ primary, secondary, fonts }), [primary, secondary, fonts?.regular, fonts?.bold]); // eslint-disable-line react-hooks/exhaustive-deps
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}
