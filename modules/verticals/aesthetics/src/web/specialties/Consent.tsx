import { api, ApiError, formatDate, today } from '@all/module-sdk/web';
import { Alert, Button, Field, Input, Modal, Select } from '@all/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { fillConsent, specialtyLabel, type AesCase, type SpecialtyKey } from '../../contracts';
import { specialtiesKey, useConsentTemplates, useCredentials } from './hooks';
import { SignaturePad } from './SignaturePad';

/**
 * Aceite do termo: o texto da versão atual do modelo, com paciente, procedimento, profissional e
 * data preenchidos, vai para o prontuário junto com a assinatura desenhada na tela.
 */
export function ConsentForm({
  customerId,
  customerName,
  specialty,
  cases,
  caseId: initialCase,
  onClose,
}: {
  customerId: string;
  customerName: string;
  specialty: SpecialtyKey;
  cases: AesCase[];
  caseId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const templates = useConsentTemplates(specialty);
  const credentials = useCredentials();
  const active = templates.data?.filter((t) => t.active) ?? [];
  const [templateId, setTemplateId] = useState('');
  const [procedure, setProcedure] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [caseId, setCaseId] = useState(initialCase ?? '');
  const [signedBy, setSignedBy] = useState(customerName);
  const [occurredOn, setOccurredOn] = useState(today());
  const [signature, setSignature] = useState<string | null>(null);
  const openCases = cases.filter((c) => c.specialty === specialty && c.status === 'active');
  const template = active.find((t) => t.id === templateId) ?? active.find((t) => t.specialty === specialty) ?? active[0];
  const pro = credentials.data?.find((p) => p.resourceId === professionalId);
  const caseTitle = openCases.find((c) => c.id === caseId)?.title;

  const save = useMutation({
    mutationFn: () =>
      api('/aesthetics/consents', {
        method: 'POST',
        body: { customerId, templateId: template?.id, specialty, procedure: procedure || caseTitle || template?.title, professionalId, caseId: caseId || null, signedBy, signature, occurredOn },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: specialtiesKey });
      queryClient.invalidateQueries({ queryKey: ['medical-records'] });
      onClose();
    },
  });

  const preview = template
    ? fillConsent(template.body, {
        paciente: customerName,
        procedimento: procedure || caseTitle || '…',
        profissional: pro ? `${pro.name}${pro.credential ? ` — ${pro.credential.label}` : ''}` : '…',
        data: formatDate(occurredOn),
      })
    : '';

  return (
    <Modal
      open
      title={`Termo de consentimento — ${specialtyLabel[specialty]}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={!template || !professionalId || signedBy.trim().length < 3} onClick={() => save.mutate()}>
            Registrar aceite
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{save.error instanceof ApiError ? save.error.message : 'Erro ao registrar o termo'}</Alert>}
        {templates.isSuccess && !active.length && <Alert tone="info">Nenhum modelo de termo ativo. Cadastre em Configurações › Especialidades da clínica.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modelo">
            {(id) => (
              <Select id={id} value={template?.id ?? ''} onChange={(e) => setTemplateId(e.target.value)}>
                {active.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} (v{t.version})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Procedimento">{(id) => <Input id={id} value={procedure} placeholder={caseTitle ?? 'Ex.: toxina botulínica no terço superior'} onChange={(e) => setProcedure(e.target.value)} />}</Field>
          <Field label="Profissional">
            {(id) => (
              <Select id={id} required value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">—</option>
                {credentials.data
                  ?.filter((p) => p.active)
                  .map((p) => (
                    <option key={p.resourceId} value={p.resourceId}>
                      {p.name}
                      {p.credential ? ` — ${p.credential.label}` : ''}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {openCases.length > 0 && (
            <Field label="Tratamento">
              {(id) => (
                <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  <option value="">—</option>
                  {openCases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Assinado por" hint="O paciente ou o responsável legal">
            {(id) => <Input id={id} value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />}
          </Field>
          <Field label="Data">{(id) => <Input id={id} type="date" max={today()} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />}</Field>
        </div>
        {template && <div className="max-h-72 overflow-y-auto whitespace-pre-line rounded-lg bg-muted p-3 text-sm">{preview}</div>}
        <div>
          <p className="mb-2 text-sm font-medium">Assinatura do paciente</p>
          <SignaturePad onChange={setSignature} />
          {!signature && <p className="mt-1 text-xs text-fg-muted">Sem assinatura na tela, o aceite fica registrado com o nome de quem assinou (anexe o termo em papel, se houver).</p>}
        </div>
      </div>
    </Modal>
  );
}
