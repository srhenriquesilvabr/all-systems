// Cor principal da empresa → escala brand-50…900 para os temas claro e escuro.
// As contas são em OKLCH (luminosidade percebida), para os tons ficarem uniformes em qualquer
// matiz; o contraste é conferido pela fórmula do WCAG 2. Sem React: usado pelo admin, pelo
// script do index.html (formato guardado) e pelas páginas públicas.

export const BRAND_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandShade = (typeof BRAND_SHADES)[number];
export type BrandScale = Record<BrandShade, string>;

export interface BrandPalette {
  /** Cor escolhida (#rrggbb): é o brand-600 do tema claro, sem ajuste. */
  color: string;
  light: BrandScale;
  dark: BrandScale;
}

/** Azul Palmer: a cor padrão quando a empresa não escolheu nenhuma. */
export const PALMER_BLUE = '#2d4bff';

/** A escala Palmer feita à mão (mesmos valores de apps/admin/src/styles.css), para prévias. */
export const PALMER_PALETTE: BrandPalette = {
  color: PALMER_BLUE,
  light: { 50: '#eef1ff', 100: '#dce2ff', 200: '#c7d0ff', 300: '#9aacff', 400: '#748eff', 500: '#4c6cff', 600: '#2d4bff', 700: '#1f35d1', 800: '#1522ad', 900: '#0d0e8a' },
  dark: { 50: '#1b2766', 100: '#27368a', 200: '#3a4fc4', 300: '#4259db', 400: '#475fea', 500: '#4c64f6', 600: '#4f68ff', 700: '#a8b5ff', 800: '#c0cbff', 900: '#d5dcff' },
};

/** Sugestões da tela "Dados da empresa": todas passam na conferência de contraste nos dois temas. */
export const BRAND_SUGGESTIONS: { name: string; color: string }[] = [
  { name: 'Azul', color: '#1d4ed8' },
  { name: 'Índigo', color: '#4338ca' },
  { name: 'Violeta', color: '#6d28d9' },
  { name: 'Fúcsia', color: '#a21caf' },
  { name: 'Rosa', color: '#be185d' },
  { name: 'Vermelho', color: '#b91c1c' },
  { name: 'Vinho', color: '#7f1d1d' },
  { name: 'Laranja', color: '#c2410c' },
  { name: 'Âmbar', color: '#a16207' },
  { name: 'Marrom', color: '#7c4a2d' },
  { name: 'Verde', color: '#15803d' },
  { name: 'Petróleo', color: '#0f766e' },
  { name: 'Ciano', color: '#0e7490' },
  { name: 'Grafite', color: '#334155' },
];

/** Neutros de styles.css que entram nas contas de contraste e na prévia. */
export const THEME_NEUTRALS = {
  light: { canvas: '#f6f7fb', surface: '#ffffff', muted: '#eef1ff', line: '#dde1ec', fg: '#0e1330', 'fg-muted': '#5b6178', ink: '#0e1330', 'ink-soft': '#1b2250', 'ink-fg-muted': '#9aa0b4' },
  dark: { canvas: '#0a0e22', surface: '#121836', muted: '#1a2147', line: '#273061', fg: '#e9ebf7', 'fg-muted': '#a6acc6', ink: '#060918', 'ink-soft': '#151c42', 'ink-fg-muted': '#9aa0b4' },
} as const;

/** Contraste mínimo do texto branco sobre o botão (WCAG AA, texto normal). O servidor confere o mesmo. */
export const MIN_BUTTON_CONTRAST = 4.5;

// ---------------------------------------------------------------------------
// Conversões: sRGB ↔ OKLab ↔ OKLCH (Björn Ottosson, 2020).
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

function hexToRgb(hex: string): Rgb {
  return [0, 1, 2].map((i) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) as Rgb;
}

function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function toOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

/** OKLCH → sRGB linear-desfeito; pode sair do intervalo 0–1 (fora do gamut). */
function oklchToRgb({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear) as Rgb;
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Cor em OKLCH; se sair do sRGB, reduz a saturação (mantém luminosidade e matiz). */
function fromOklch(l: number, c: number, h: number): string {
  const L = Math.min(1, Math.max(0, l));
  let rgb = oklchToRgb({ l: L, c, h });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgb({ l: L, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToRgb({ l: L, c: lo, h });
  }
  return rgbToHex(rgb);
}

/** Luminância relativa (WCAG 2). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste entre duas cores (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Primeira luminosidade (andando em `step`) que satisfaz `ok`; para no limite. */
function searchL(start: number, step: number, limit: number, make: (l: number) => string, ok: (hex: string) => boolean) {
  let l = start;
  while ((step > 0 ? l < limit : l > limit) && !ok(make(l))) l += step;
  return make(step > 0 ? Math.min(l, limit) : Math.max(l, limit));
}

// ---------------------------------------------------------------------------
// Escalas
// ---------------------------------------------------------------------------

/**
 * Escala completa para os dois temas, no mesmo papel dos tokens Palmer de styles.css:
 * - claro: 50/100/200 fundos e bordas suaves, 600 = a cor escolhida (botões), 700 texto sobre 50;
 * - escuro: 50/200 fundos e bordas profundos, 600 ajustado para o botão continuar visível no
 *   fundo escuro sem perder o texto branco, 700 claro para texto sobre a superfície escura.
 */
export function brandPalette(input: string): BrandPalette {
  const color = input.toLowerCase();
  const { l: L, c: C, h: H } = toOklch(color);
  const tint = (l: number, factor: number, max = Infinity) => fromOklch(l, Math.min(C * factor, max), H);

  // Tema claro
  const light50 = tint(0.97, 0.12, 0.035);
  const light700 = searchL(L - 0.06, -0.01, 0.2, (l) => tint(l, 1), (hex) => contrastRatio(hex, light50) >= 7);
  const L700 = toOklch(light700).l;
  const light: BrandScale = {
    50: light50,
    100: tint(0.935, 0.22, 0.06),
    200: tint(0.87, 0.36, 0.1),
    300: tint(0.79, 0.6),
    400: tint(0.71, 0.85),
    500: tint((0.71 + L) / 2, 0.95),
    600: color,
    700: light700,
    800: tint(Math.max(0.16, L700 - 0.07), 0.9),
    900: tint(Math.max(0.13, L700 - 0.14), 0.8),
  };

  // Tema escuro
  const dark600 = darkButton(color, C, H);
  const dark50 = tint(0.3, 0.45, 0.1);
  const darkSurface = THEME_NEUTRALS.dark.surface;
  const dark700 = searchL(0.78, 0.01, 0.97, (l) => tint(l, 0.5, 0.13), (hex) => contrastRatio(hex, darkSurface) >= 7 && contrastRatio(hex, dark50) >= 4.5);
  const D700 = toOklch(dark700).l;
  const D600 = toOklch(dark600).l;
  const dark: BrandScale = {
    50: dark50,
    100: tint(0.35, 0.55, 0.12),
    200: tint(0.46, 0.7, 0.17),
    // Entre a borda (200) e o botão (600).
    300: tint(0.46 + (D600 - 0.46) * 0.4, 0.8),
    400: tint(0.46 + (D600 - 0.46) * 0.65, 0.9),
    500: tint(0.46 + (D600 - 0.46) * 0.85, 0.95),
    600: dark600,
    700: dark700,
    800: tint(Math.min(0.95, D700 + 0.06), 0.4, 0.1),
    900: tint(Math.min(0.97, D700 + 0.11), 0.3, 0.07),
  };

  return { color, light, dark };
}

/** Faixa de luminância do botão no tema escuro: destaca do fundo (≈3:1) e mantém o texto branco (≥4,5:1). */
const DARK_BUTTON_Y = { min: 0.13, max: 0.175 };

/**
 * Botão do tema escuro: a própria cor, se já está na faixa; senão o mesmo matiz e saturação com
 * a luminosidade levada até a borda mais próxima da faixa (cor escura clareia, clara escurece).
 */
function darkButton(color: string, C: number, H: number) {
  const y = luminance(color);
  if (y >= DARK_BUTTON_Y.min && y <= DARK_BUTTON_Y.max) return color;
  const raise = y < DARK_BUTTON_Y.min;
  const target = raise ? DARK_BUTTON_Y.min : DARK_BUTTON_Y.max;
  // Busca binária: `lo` fica abaixo do alvo, `hi` acima (a luminância cresce com L).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(fromOklch(mid, C, H)) < target) lo = mid;
    else hi = mid;
  }
  return fromOklch(raise ? hi : lo, C, H);
}

// ---------------------------------------------------------------------------
// Conferência de contraste
// ---------------------------------------------------------------------------

export interface BrandCheck {
  /** Pode salvar: o texto branco dos botões fica legível nos dois temas. */
  ok: boolean;
  /** Contraste do texto branco sobre o botão em cada tema. */
  light: number;
  dark: number;
  /** Impedem salvar. */
  problems: string[];
  /** Só avisam. */
  warnings: string[];
}

const ratio = (n: number) => `${n.toFixed(1).replace('.', ',')}:1`;

export function checkBrand(palette: BrandPalette): BrandCheck {
  const light = contrastRatio('#ffffff', palette.light[600]);
  const dark = contrastRatio('#ffffff', palette.dark[600]);
  const problems: string[] = [];
  const warnings: string[] = [];
  if (light < MIN_BUTTON_CONTRAST) problems.push(`Tema claro: o texto branco dos botões fica ilegível (contraste ${ratio(light)}, mínimo ${ratio(MIN_BUTTON_CONTRAST)}). Escolha um tom mais escuro.`);
  if (dark < MIN_BUTTON_CONTRAST) problems.push(`Tema escuro: o texto branco dos botões fica ilegível (contraste ${ratio(dark)}, mínimo ${ratio(MIN_BUTTON_CONTRAST)}).`);
  if (contrastRatio(palette.light[600], THEME_NEUTRALS.light.ink) < 1.6) warnings.push('Cor muito escura: o item ativo do menu lateral quase não se destaca do fundo do menu.');
  if (contrastRatio(palette.dark[600], THEME_NEUTRALS.dark.surface) < 2.5) warnings.push('No tema escuro os botões ficam pouco destacados do fundo.');
  return { ok: problems.length === 0, light, dark, problems, warnings };
}

// ---------------------------------------------------------------------------
// Aplicação na página
// ---------------------------------------------------------------------------

const scaleVars = (scale: BrandScale) => BRAND_SHADES.map((s) => `--color-brand-${s}:${scale[s]};`).join('');

/**
 * CSS que sobrepõe os tokens de styles.css. `:root:root` ganha do `@theme` e a regra escura
 * (`:root:root[data-theme='dark']`) ganha do tema escuro padrão, em qualquer ordem no <head>.
 * O index.html monta exatamente este formato a partir do localStorage.
 */
export function brandCss(palette: BrandPalette, root = ':root:root'): string {
  return `${root}{${scaleVars(palette.light)}}${root}[data-theme='dark']{${scaleVars(palette.dark)}}`;
}

/**
 * Aplica (ou remove, com `null`) a paleta num <style> próprio. `id`/`root` diferentes permitem
 * que uma página pública sobreponha a paleta do admin sem mexer nela.
 */
export function applyBrand(palette: BrandPalette | null, opts: { id?: string; root?: string } = {}) {
  const id = opts.id ?? 'brand-palette';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!palette) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = brandCss(palette, opts.root);
}

/** Variáveis de um tema inteiro (neutros + marca) para uma prévia isolada num elemento. */
export function previewVars(scale: BrandScale, theme: 'light' | 'dark'): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(THEME_NEUTRALS[theme])) vars[`--color-${k}`] = v;
  for (const s of BRAND_SHADES) vars[`--color-brand-${s}`] = scale[s];
  vars.colorScheme = theme;
  return vars;
}
