import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { apiBlob } from './api';

/** Imagem servida por rota autenticada (`/files/:id`): baixa com o token e mostra via object URL. */
export function AuthImage({ fileId, ...props }: { fileId: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    apiBlob(`/files/${fileId}`)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => setSrc(undefined));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);
  return src ? <img src={src} {...props} /> : <span className={`inline-block animate-pulse bg-muted ${props.className ?? ''}`} />;
}
