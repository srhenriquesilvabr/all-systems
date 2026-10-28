import { cn } from '@all/ui';
import { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';

type Shape = 'loading' | 'square' | 'wide' | 'error';

/**
 * Formato do logo (quadrado ou largo), para decidir o que cabe no menu recolhido. SVG só com
 * viewBox pode não informar tamanho: conta como largo.
 */
function useLogoShape(url: string | null): Shape | null {
  const [shape, setShape] = useState<Shape>('loading');
  useEffect(() => {
    if (!url) return;
    setShape('loading');
    const img = new Image();
    img.onload = () => setShape(img.naturalWidth && img.naturalHeight && img.naturalWidth / img.naturalHeight <= 1.4 ? 'square' : 'wide');
    img.onerror = () => setShape('error');
    img.src = url;
    return () => {
      img.onload = img.onerror = null;
    };
  }, [url]);
  return url && shape !== 'error' ? shape : null;
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/**
 * Topo do menu lateral: o logo da empresa (num fundo branco, porque a maioria dos logos é feita
 * para papel) ou, sem logo, a marca Palmer. Recolhido: o logo se for quadrado, senão a inicial.
 */
export function CompanyBrand({ name, logoUrl, collapsed }: { name: string; logoUrl: string | null; collapsed: boolean }) {
  const shape = useLogoShape(logoUrl);
  if (!logoUrl || !shape) {
    return collapsed ? (
      <img src="/brand/palmer-simbolo-white.svg" alt="Palmer Tech" width={30} height={30} className="size-[1.875rem]" />
    ) : (
      <BrandLogo tone="dark" className="px-2" />
    );
  }
  if (collapsed) {
    return shape === 'square' ? (
      <span className="flex size-10 items-center justify-center rounded-lg bg-white p-1" title={name}>
        <img src={logoUrl} alt={name} className="max-h-full max-w-full object-contain" />
      </span>
    ) : (
      <span className="flex size-10 items-center justify-center rounded-lg bg-brand-600 font-display text-lg font-semibold text-white" title={name} role="img" aria-label={name}>
        {initial(name)}
      </span>
    );
  }
  return <CompanyLogo name={name} logoUrl={logoUrl} className="h-14 min-w-0 flex-1" />;
}

/** Logo da empresa sobre fundo branco (menu lateral, cabeçalho do celular, prévia). */
export function CompanyLogo({ name, logoUrl, className }: { name: string; logoUrl: string; className?: string }) {
  return (
    <span className={cn('flex items-center justify-center rounded-xl bg-white px-3 py-2', className)}>
      <img src={logoUrl} alt={name} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
