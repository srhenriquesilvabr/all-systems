import { formatMoney } from '@all/module-sdk/web';
import { useEffect, useRef, useState } from 'react';
import { monthLabel } from './shared';

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 64 };
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Receitas × despesas realizadas por mês (barras agrupadas, um eixo só).
 * Cores: slots 1 e 2 da paleta categórica, validados sobre a superfície branca do card.
 */
export function MonthlyChart({ data }: { data: MonthPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);

  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.income, d.expense])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(4, Math.min(28, (band - 16) / 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  return (
    <div>
      <div className="mb-3 flex gap-4 text-sm text-fg-muted" aria-hidden>
        <Legend color="var(--color-series-1)" label="Receitas" />
        <Legend color="var(--color-series-2)" label="Despesas" />
      </div>
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label="Receitas e despesas realizadas por mês. Os valores estão na tabela abaixo.">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--color-chart-axis)' : 'var(--color-chart-grid)'} strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[11px] tabular-nums">
                  {t === 0 ? '0' : compact.format(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              return (
                <g key={d.month}>
                  {hover === i && <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} className="fill-muted" />}
                  <Bar x={cx - barW - 1} w={barW} top={y(d.income)} base={y(0)} color="var(--color-series-1)" />
                  <Bar x={cx + 1} w={barW} top={y(d.expense)} base={y(0)} color="var(--color-series-2)" />
                  <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-fg-muted text-[11px]">
                    {monthLabel(d.month)}
                  </text>
                  {/* Alvo de hover do mês inteiro: maior que as barras. */}
                  <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-2 z-10 w-48 rounded-md border border-line bg-surface p-3 text-sm shadow-lg"
            style={{ left: Math.min(PAD.left + band * hover + band / 2 + 12, width - 200) }}
          >
            <p className="mb-1 font-medium capitalize">{monthLabel(data[hover].month)}</p>
            <Row color="var(--color-series-1)" label="Receitas" value={data[hover].income} />
            <Row color="var(--color-series-2)" label="Despesas" value={data[hover].expense} />
            <div className="mt-1 flex justify-between border-t border-line pt-1">
              <span className="text-fg-muted">Resultado</span>
              <span className="font-medium tabular-nums">{formatMoney(data[hover].income - data[hover].expense)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Barra com o topo arredondado (4px) e a base reta no eixo. */
function Bar({ x, w, top, base, color }: { x: number; w: number; top: number; base: number; color: string }) {
  const h = base - top;
  if (h <= 0) return null;
  const r = Math.min(4, w / 2, h);
  return <path d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`} fill={color} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-fg-muted">
        <span className="size-2 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className="tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

function niceMax(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value)!;
  return step * magnitude;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
