# Acessos e contas da Palmer

Quem é dono de cada serviço usado pela plataforma e onde cada credencial fica. Atualizado em 30/10/2026.

**Este arquivo nunca leva senha, token ou chave.** Segredos ficam só no `.env.production`, fora do Git. O repositório é privado; se um dia ficar público, retire este arquivo antes.

Os campos "a preencher" não podem ser descobertos pelo sistema: só o dono da conta sabe.

## Serviços em uso

| Serviço | Para que serve | Conta (e-mail) | Painel |
|---|---|---|---|
| Cloudflare | Hospeda o sistema (Workers), arquivos (R2) e a conexão com o banco (Hyperdrive) | srhenriquesilvabr@gmail.com | [dash.cloudflare.com](https://dash.cloudflare.com) |
| Supabase | Banco de dados (Postgres) | a preencher | [supabase.com/dashboard](https://supabase.com/dashboard) |
| GitHub | Código-fonte (repositório privado) | conta `srhenriquesilvabr`; e-mail a preencher | [github.com/srhenriquesilvabr/all-systems](https://github.com/srhenriquesilvabr/all-systems) |
| Palmer Systems | Dono da Palmer Tech e das empresas de demonstração `fake-*` | prsergiokent@gmail.com | [palmer-systems.all-systems.workers.dev](https://palmer-systems.all-systems.workers.dev) |

## A preencher

| Pergunta | Cloudflare | Supabase | GitHub |
|---|---|---|---|
| Quem mais tem acesso à conta? | | | |
| Verificação em duas etapas está ligada? | | | |
| Onde ficam os códigos de recuperação? | | | |
| Plano e forma de pagamento | Workers Paid; pagamento a preencher | | |

## Identificadores

Não são segredos, mas ajudam em suporte e configuração.

| Item | Valor |
|---|---|
| Cloudflare: conta | Srhenriquesilvabr@gmail.com's Account (`cd74d56bd7cc2b54eaa5c9f0dd8cf939`) |
| Cloudflare: Worker | `palmer-systems` |
| Cloudflare: bucket de arquivos | `palmer-systems-files` |
| Cloudflare: Hyperdrive | `palmer-systems-db` (`ebd3bfe71f1a413d80fc2295aebfe59b`) |
| Supabase: organização | `ozsnyvidpjkdvdhuhaff` |
| Supabase: projeto em uso | `palmer-systems-sp` (`swephdloeplmgbnwvxoi`), região sa-east-1 (São Paulo), plano Free |
| Supabase: projeto antigo | `palmer-systems` (`rethhluanzblovkiccna`), região us-west-2 (Oregon), somente leitura desde 30/10/2026; guardado para voltar atrás e ocupa uma das 2 vagas do plano Free |
| Git: autor dos commits | `srhenriquesilvabr <114965455+srhenriquesilvabr@users.noreply.github.com>` |

A conta Cloudflare também guarda o bucket `rekrutar-consultoria-media`, que não faz parte deste sistema.

## Onde ficam os segredos

| Onde | O que guarda |
|---|---|
| `.env.production`, na raiz do projeto, só nesta máquina | Token do Supabase, senhas do banco (as de Oregon como `OLD_*`), chaves do sistema, senha do dono e token de leitura dos registros do Cloudflare |
| Segredos do Worker, no painel do Cloudflare | `JWT_SECRET` e `SETTINGS_ENCRYPTION_KEY` |
| Dentro do sistema, cifrados | Credenciais que cada empresa cadastra (ex.: certificado A1, tokens de integração) |

Esses arquivos não vão para o GitHub. **Se esta máquina for perdida, eles somem junto:** guarde uma cópia num cofre de senhas.

A chave `SETTINGS_ENCRYPTION_KEY` merece cuidado especial: sem ela, as credenciais cifradas das empresas não podem mais ser lidas.

## Cuidados nesta máquina

O Git global e o login do Supabase CLI daqui pertencem a outras contas (Sergio Silva / `sergiovinde` / fibo-solution). Neste projeto, commits e pushes saem sempre como `srhenriquesilvabr`, pelo comando `/commit`, e o Supabase é acessado pelo token do `.env.production`.

## Serviços ainda não contratados

Anthropic, Resend, Focus NFe, Gupy, administradoras de consórcio, bureaus de crédito, Meta e Google Ads estão no documento [Pendências](https://claude.ai/artifact/XayKm88dEZxGMpV9f5BfgC). Ao contratar um deles, acrescente a conta na primeira tabela.
