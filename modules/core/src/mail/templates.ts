import type { MailMessage } from './mail.service';

export const passwordResetMail = (to: string, link: string): MailMessage => ({
  to,
  subject: 'Redefinição de senha',
  text: [
    'Recebemos um pedido para redefinir a sua senha.',
    '',
    `Para criar uma nova senha, acesse: ${link}`,
    '',
    'O link vale por 30 minutos e só pode ser usado uma vez.',
    'Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n'),
});

export const passwordChangedMail = (to: string): MailMessage => ({
  to,
  subject: 'Sua senha foi alterada',
  text: [
    'A senha da sua conta foi alterada e todas as sessões abertas foram encerradas.',
    '',
    'Se não foi você, redefina a senha imediatamente e avise o administrador da sua empresa.',
  ].join('\n'),
});

export const inviteMail = (to: string, tenantName: string, link: string): MailMessage => ({
  to,
  subject: `Você foi convidado para ${tenantName}`,
  text: [
    `Você foi convidado para acessar o sistema de ${tenantName}.`,
    '',
    `Para criar sua senha e entrar, acesse: ${link}`,
    '',
    'O convite vale por 7 dias.',
  ].join('\n'),
});

export const addedToTenantMail = (to: string, tenantName: string, loginUrl: string): MailMessage => ({
  to,
  subject: `Você agora tem acesso a ${tenantName}`,
  text: [`Sua conta foi adicionada a ${tenantName}.`, '', `Entre com a sua senha de sempre em: ${loginUrl}`].join('\n'),
});
