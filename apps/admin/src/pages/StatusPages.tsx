import { EmptyState } from '@all/ui';
import { Link } from 'react-router';

const home = (
  <Link to="/" className="text-sm text-brand-700 hover:underline">
    Ir para o início
  </Link>
);

export function NotFound() {
  return <EmptyState title="Página não encontrada" description="O endereço não existe ou o módulo não está contratado." action={home} />;
}

export function Forbidden() {
  return <EmptyState title="Acesso negado" description="Seu papel não tem permissão para esta tela. Fale com o administrador." action={home} />;
}
