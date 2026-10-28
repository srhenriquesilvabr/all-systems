import { api, today } from '@all/module-sdk/web';
import { PageHeader } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { FiscalDocument } from '../contracts';
import { DocumentForm } from './DocumentForm';
import { AccountantNotice, docPath, ErrorMessage, fiscalKey } from './shared';

/** Nota avulsa: monta o rascunho; a emissão é na página da nota, depois de conferir. */
export function NewDocumentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<FiscalDocument>('/fiscal/documents', { method: 'POST', body }),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: fiscalKey });
      navigate(docPath(doc.id));
    },
  });
  return (
    <>
      <PageHeader title="Nota avulsa" description="Para vendas e serviços fora do caixa, da agenda e das ordens. Fica como rascunho até você emitir." />
      <div className="space-y-4">
        <AccountantNotice />
        <ErrorMessage error={create.error} />
        <DocumentForm
          initial={{ type: 'nfse', customer: null, recipient: null, items: [], payments: [], nature: '', additionalInfo: '', serviceDate: today() }}
          allowTypeChange
          submitLabel="Salvar rascunho"
          busy={create.isPending}
          onSubmit={(body) => create.mutate(body)}
        />
      </div>
    </>
  );
}
