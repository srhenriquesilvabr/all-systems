import type { MouseEvent } from 'react';

/** Ponto de aplicação no mapa (coordenadas no desenho de 200 × 250). */
export interface FacePoint {
  x: number;
  y: number;
  region: string;
}

/**
 * Regiões de referência. "Direito/esquerdo" é do paciente: o lado direito dele fica à esquerda
 * da tela, como numa foto de frente.
 */
export const FACE_REGIONS: FacePoint[] = [
  { x: 72, y: 52, region: 'Frontal' },
  { x: 100, y: 46, region: 'Frontal' },
  { x: 128, y: 52, region: 'Frontal' },
  { x: 100, y: 80, region: 'Glabela' },
  { x: 40, y: 76, region: 'Têmpora direita' },
  { x: 160, y: 76, region: 'Têmpora esquerda' },
  { x: 66, y: 81, region: 'Sobrancelha direita' },
  { x: 134, y: 81, region: 'Sobrancelha esquerda' },
  { x: 46, y: 101, region: 'Periorbicular direito (pés de galinha)' },
  { x: 154, y: 101, region: 'Periorbicular esquerdo (pés de galinha)' },
  { x: 76, y: 114, region: 'Infraorbital direita (olheira)' },
  { x: 124, y: 114, region: 'Infraorbital esquerda (olheira)' },
  { x: 100, y: 112, region: 'Dorso nasal' },
  { x: 100, y: 138, region: 'Ponta nasal' },
  { x: 57, y: 128, region: 'Malar direito' },
  { x: 143, y: 128, region: 'Malar esquerdo' },
  { x: 50, y: 154, region: 'Masseter direito' },
  { x: 150, y: 154, region: 'Masseter esquerdo' },
  { x: 79, y: 151, region: 'Sulco nasogeniano direito' },
  { x: 121, y: 151, region: 'Sulco nasogeniano esquerdo' },
  { x: 100, y: 162, region: 'Lábio superior' },
  { x: 100, y: 179, region: 'Lábio inferior' },
  { x: 81, y: 172, region: 'Comissura labial direita' },
  { x: 119, y: 172, region: 'Comissura labial esquerda' },
  { x: 58, y: 186, region: 'Linha mandibular direita' },
  { x: 142, y: 186, region: 'Linha mandibular esquerda' },
  { x: 100, y: 207, region: 'Mento' },
];

/** Região de referência mais perto do clique. */
export function nearestRegion(x: number, y: number): string {
  let best = FACE_REGIONS[0]!;
  for (const r of FACE_REGIONS) if ((r.x - x) ** 2 + (r.y - y) ** 2 < (best.x - x) ** 2 + (best.y - y) ** 2) best = r;
  return best.region;
}

/**
 * Rosto de frente, em SVG. Clicar marca um ponto (a região vem da referência mais próxima);
 * clicar num ponto já marcado o seleciona. Só leitura, mostra os pontos numerados.
 */
export function FaceMap({
  points,
  onAdd,
  selected,
  onSelect,
  className,
}: {
  points: FacePoint[];
  onAdd?: (p: FacePoint) => void;
  selected?: number | null;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  function click(e: MouseEvent<SVGSVGElement>) {
    if (!onAdd) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - box.left) / box.width) * 200);
    const y = Math.round(((e.clientY - box.top) / box.height) * 250);
    onAdd({ x, y, region: nearestRegion(x, y) });
  }
  const ink = 'stroke-fg-muted';
  return (
    <svg
      viewBox="0 0 200 250"
      role={onAdd ? 'button' : 'img'}
      aria-label={onAdd ? 'Mapa facial: clique para marcar um ponto de aplicação' : `Mapa facial com ${points.length} ponto(s)`}
      className={`select-none rounded-xl border border-line bg-surface ${onAdd ? 'cursor-crosshair' : ''} ${className ?? ''}`}
      onClick={click}
    >
      <g fill="none" strokeWidth="1.4" strokeLinecap="round" className={ink}>
        {/* contorno, orelhas e cabelo */}
        <path d="M100 22 C 150 22 172 62 170 110 C 168 160 150 205 100 228 C 50 205 32 160 30 110 C 28 62 50 22 100 22 Z" className="fill-muted/40" />
        <path d="M30 104 C 20 100 18 124 24 134 C 27 140 31 141 33 138" />
        <path d="M170 104 C 180 100 182 124 176 134 C 173 140 169 141 167 138" />
        <path d="M36 70 C 52 34 148 34 164 70" strokeDasharray="3 4" />
        {/* sobrancelhas e olhos */}
        <path d="M54 84 C 64 76 78 76 88 82" />
        <path d="M112 82 C 122 76 136 76 146 84" />
        <path d="M60 101 C 68 94 84 94 90 101 C 84 107 68 107 60 101 Z" />
        <path d="M110 101 C 116 94 132 94 140 101 C 132 107 116 107 110 101 Z" />
        <circle cx="75" cy="101" r="3" />
        <circle cx="125" cy="101" r="3" />
        {/* nariz e boca */}
        <path d="M98 96 C 96 112 92 126 90 136 C 94 142 106 142 110 136 C 108 126 104 112 102 96" />
        <path d="M80 170 C 90 162 96 164 100 166 C 104 164 110 162 120 170 C 110 172 90 172 80 170 Z" />
        <path d="M80 170 C 90 184 110 184 120 170" />
      </g>
      {onAdd &&
        FACE_REGIONS.map((r, i) => (
          <circle key={i} cx={r.x} cy={r.y} r="2" className="fill-fg-subtle/40">
            <title>{r.region}</title>
          </circle>
        ))}
      {points.map((p, i) => (
        <g
          key={i}
          className={onSelect ? 'cursor-pointer' : undefined}
          onClick={(e) => {
            if (!onSelect) return;
            e.stopPropagation();
            onSelect(i);
          }}
        >
          <circle cx={p.x} cy={p.y} r="6.5" className={i === selected ? 'fill-brand-700' : 'fill-brand-600'} />
          <text x={p.x} y={p.y + 2.6} textAnchor="middle" fontSize="7.5" className="fill-white font-semibold">
            {i + 1}
          </text>
          <title>{`${i + 1}. ${p.region}`}</title>
        </g>
      ))}
    </svg>
  );
}
