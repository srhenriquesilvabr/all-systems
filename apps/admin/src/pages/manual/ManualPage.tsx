import { useSession, type ManualBlock, type ManualGuide, type ManualTopic } from '@all/module-sdk/web';
import { Alert, Card, PageHeader, Spinner, cn } from '@all/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Lightbulb, MessageCircle, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useWebModules } from '../../modules';

const COMMON = 'comum';
const loadCommon = () => import('./common').then((m) => m.commonGuide);

/**
 * Manual dentro do sistema: um guia para cada ramo contratado e um com o que é comum a todos.
 * Cada assunto aparece nas duas linguagens, lado a lado.
 */
export function ManualPage() {
  const session = useSession();
  const { guide: guideKey, topic: topicId } = useParams();
  const webModules = useWebModules();

  // Só os ramos da empresa, como no resto do sistema.
  const branches = session.modules.filter((m) => m.layer === 'vertical').flatMap((m) => {
    const load = webModules.data?.find((w) => w.key === m.key)?.manual;
    return load ? [{ key: m.key, name: m.name, load }] : [];
  });
  const guides = [...branches, { key: COMMON, name: 'Recursos comuns', load: loadCommon }];
  const current = guides.find((g) => g.key === guideKey);

  const guide = useQuery({ queryKey: ['manual', current?.key], queryFn: () => current!.load(), enabled: !!current, staleTime: Infinity });

  if (!webModules.data) return <Spinner />;
  if (!guideKey || !current) return <Navigate to={`/manual/${guides[0]!.key}`} replace />;

  return (
    <>
      <PageHeader title="Manual" description={guide.data?.summary ?? 'Como usar o sistema, passo a passo.'} />
      {guides.length > 1 && (
        <nav aria-label="Guias do manual" className="mb-5 flex flex-wrap gap-2">
          {guides.map((g) => (
            <Link
              key={g.key}
              to={`/manual/${g.key}`}
              aria-current={g.key === current.key ? 'page' : undefined}
              className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition', g.key === current.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-fg hover:border-brand-200')}
            >
              {g.name}
            </Link>
          ))}
        </nav>
      )}
      {guide.isPending ? <Spinner /> : guide.isError ? <Alert>Não foi possível abrir o manual. Verifique sua conexão.</Alert> : <Guide guideKey={current.key} guide={guide.data} topicId={topicId} />}
    </>
  );
}

function Guide({ guideKey, guide, topicId }: { guideKey: string; guide: ManualGuide; topicId?: string }) {
  const session = useSession();
  const index = Math.max(0, guide.topics.findIndex((t) => t.id === topicId));
  const topic = guide.topics[index]!;
  const previous = guide.topics[index - 1];
  const next = guide.topics[index + 1];
  const canOpen = topic.path && session.menu.some((m) => m.path === topic.path);
  const href = (t: ManualTopic) => `/manual/${guideKey}/${t.id}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Assuntos" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <ol className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
          {guide.topics.map((t, i) => (
            <li key={t.id} className="shrink-0">
              <Link to={href(t)} aria-current={i === index ? 'page' : undefined} className={cn('block rounded-lg px-3 py-2 text-sm transition', i === index ? 'bg-brand-50 font-medium text-brand-700' : 'text-fg-muted hover:bg-muted hover:text-fg')}>
                {t.title}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <article className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-medium">{topic.title}</h2>
          {canOpen && (
            <Link to={topic.path!} className="text-sm font-medium text-brand-700 hover:underline">
              Abrir esta tela
            </Link>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-2">
          <Side icon={MessageCircle} title="Em palavras simples" blocks={topic.simple} />
          <Side icon={Wrench} title="Detalhes técnicos" blocks={topic.technical} />
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-3">
          {previous ? <Pager to={href(previous)} label={previous.title} icon={<ArrowLeft className="size-4" aria-hidden />} /> : <span />}
          {next && <Pager to={href(next)} label={next.title} icon={<ArrowRight className="size-4" aria-hidden />} trailing />}
        </div>
      </article>
    </div>
  );
}

function Side({ icon: Icon, title, blocks }: { icon: LucideIcon; title: string; blocks: ManualBlock[] }) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-muted">
        <Icon className="size-4 text-brand-600" aria-hidden />
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed">
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </Card>
  );
}

function Block({ block }: { block: ManualBlock }) {
  if ('text' in block) return <p>{block.text}</p>;
  if ('steps' in block) {
    return (
      <ol className="list-decimal space-y-1.5 pl-5">
        {block.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    );
  }
  if ('list' in block) {
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {block.list.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
    );
  }
  const warn = 'warn' in block;
  const Icon = warn ? TriangleAlert : Lightbulb;
  return (
    <p className={cn('flex gap-2 rounded-lg p-3', warn ? 'bg-danger-50 text-danger-700' : 'bg-brand-50 text-brand-700')}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{warn ? block.warn : block.tip}</span>
    </p>
  );
}

function Pager({ to, label, icon, trailing }: { to: string; label: string; icon: ReactNode; trailing?: boolean }) {
  return (
    <Link to={to} className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-fg transition-colors hover:border-fg">
      {!trailing && icon}
      {label}
      {trailing && icon}
    </Link>
  );
}
