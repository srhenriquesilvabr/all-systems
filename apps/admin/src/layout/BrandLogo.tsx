import { cn } from '@all/ui';

/**
 * Logo Palmer Tech: símbolo + palavra "palmer" (Outfit 600) "tech" (Outfit 300).
 * Em fundo claro, "tech" em azul; em fundo escuro (tinta), símbolo branco e "tech" em ciano, como no site.
 */
export function BrandLogo({ tone = 'light', size = 'md', className }: { tone?: 'light' | 'dark'; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = { sm: { icon: 28, text: 'text-xl' }, md: { icon: 34, text: 'text-[22px]' }, lg: { icon: 44, text: 'text-3xl' } }[size];
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} role="img" aria-label="Palmer Tech">
      <img
        src={tone === 'dark' ? '/brand/palmer-simbolo-white.svg' : '/brand/palmer-simbolo-blue.svg'}
        alt=""
        width={dims.icon}
        height={dims.icon}
      />
      <span className={cn('flex gap-[5px] font-display leading-none tracking-[-0.03em]', dims.text)} aria-hidden>
        <b className={cn('font-semibold', tone === 'dark' ? 'text-white' : 'text-ink')}>palmer</b>
        <span className={cn('font-light', tone === 'dark' ? 'text-cyan' : 'text-brand-600')}>tech</span>
      </span>
    </span>
  );
}
