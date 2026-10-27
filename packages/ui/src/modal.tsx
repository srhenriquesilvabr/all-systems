import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const PanelHostContext = createContext<HTMLElement | null>(null);

/**
 * Área do admin onde cadastros e detalhes abrem "como página": no lugar do conteúdo, não
 * por cima dele. A tela de origem só fica escondida (não desmonta), então nada se perde ao
 * voltar. Na impressão é o contrário: o painel some e a página volta, porque os comprovantes
 * (holerite, cupom) ficam na página.
 */
export function PanelHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <PanelHostContext.Provider value={host}>
      <div ref={setHost} data-panel-host className="empty:hidden print:hidden [&>*:not(:last-child)]:hidden" />
      <div className="[[data-panel-host]:not(:empty)+&]:hidden print:block!">{children}</div>
    </PanelHostContext.Provider>
  );
}

/**
 * Dentro do admin (com PanelHost), abre na própria página, com "Voltar" e as ações no rodapé.
 * Fora dele (ex.: agendamento público), usa o <dialog> nativo.
 */
export function Modal(props: ModalProps) {
  const host = useContext(PanelHostContext);
  if (host) return props.open ? createPortal(<PagePanel {...props} />, host) : null;
  return <DialogModal {...props} />;
}

function PagePanel({ title, onClose, children, footer }: ModalProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // Abre no topo, como uma página nova, e devolve a rolagem de onde o usuário estava ao fechar.
  useLayoutEffect(() => {
    const scrollY = window.scrollY;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
    return () => window.scrollTo(0, scrollY);
  }, []);

  return (
    <section aria-labelledby={headingId} className="max-w-3xl">
      <button type="button" onClick={onClose} className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m12 19-7-7 7-7M19 12H5" />
        </svg>
        Voltar
      </button>
      <h1 id={headingId} ref={heading} tabIndex={-1} className="mb-6 font-display text-[28px] font-medium leading-tight tracking-tight text-fg outline-none">
        {title}
      </h1>
      <div className="rounded-2xl border border-line bg-surface p-5">{children}</div>
      {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
    </section>
  );
}

/** Usa o <dialog> nativo: foco preso, Esc para fechar e fundo inerte sem biblioteca. */
function DialogModal({ open, title, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-ink/60 print:hidden"
    >
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}
