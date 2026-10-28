import { Button } from '@all/ui';
import { useEffect, useRef, type PointerEvent } from 'react';

const W = 480;
const H = 150;

/**
 * Assinatura desenhada na tela (dedo, caneta ou mouse). Devolve um PNG pequeno (fundo branco,
 * traço escuro) em data URL a cada traço, ou null depois de limpar.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  useEffect(() => clear(), []);

  function ctx() {
    const c = canvas.current!.getContext('2d')!;
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = '#111827';
    return c;
  }

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * W, y: ((e.clientY - box.top) / box.height) * H };
  }

  function clear() {
    const c = canvas.current?.getContext('2d');
    if (!c) return;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    drawn.current = false;
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={W}
        height={H}
        aria-label="Área para assinar"
        className="w-full max-w-lg touch-none rounded-xl border border-line bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const p = point(e);
          const c = ctx();
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x + 0.1, p.y + 0.1);
          c.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = point(e);
          const c = ctx();
          c.lineTo(p.x, p.y);
          c.stroke();
          drawn.current = true;
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          if (drawn.current) onChange(canvas.current!.toDataURL('image/png'));
        }}
      />
      <Button size="sm" variant="ghost" onClick={clear}>
        Limpar assinatura
      </Button>
    </div>
  );
}
