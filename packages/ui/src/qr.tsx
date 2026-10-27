import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** QR Code em SVG (nítido na tela e na impressão). */
export function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => !cancelled && setSvg(s));
    return () => {
      cancelled = true;
    };
  }, [value]);
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block shrink-0 bg-white [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
