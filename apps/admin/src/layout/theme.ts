import { applyBrand, brandPalette, isHexColor } from '@all/ui';
import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const BRAND_KEY = 'palmer:brand';

/**
 * Cor da empresa no painel: aplica a escala calculada e guarda a última no navegador, para o
 * index.html aplicá-la antes da primeira pintura (sem piscar o azul Palmer). `null` volta ao padrão.
 * O formato guardado ({ color, light, dark }) é o que o script do index.html lê.
 */
export function syncCompanyBrand(color: string | null) {
  const palette = color && isHexColor(color) ? brandPalette(color) : null;
  applyBrand(palette);
  try {
    if (palette) localStorage.setItem(BRAND_KEY, JSON.stringify(palette));
    else localStorage.removeItem(BRAND_KEY);
  } catch {
    // segue sem lembrar: no próximo carregamento a cor chega um instante depois
  }
}

/** Aplica a cor da empresa da sessão e troca junto quando a empresa muda. */
export function useCompanyBrand(color: string | null) {
  useEffect(() => syncCompanyBrand(color), [color]);
}

const KEY = 'palmer:theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Aplica o tema no <html> (data-theme), que troca os tokens de cor em styles.css. */
function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/**
 * Preferência de tema do usuário neste navegador. "Automático" segue o sistema e muda junto
 * com ele. O index.html aplica o tema antes do React subir, para a tela não piscar.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    apply(preference);
    if (preference !== 'system') return;
    const mq = media();
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const change = (next: ThemePreference) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // segue sem lembrar a preferência
    }
  };

  return { preference, change };
}
