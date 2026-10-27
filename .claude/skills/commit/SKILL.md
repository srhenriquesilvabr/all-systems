---
name: commit
description: Faz commit (e push) neste repositório sempre como a conta GitHub srhenriquesilvabr. Use quando pedirem para commitar, salvar no git ou subir para o GitHub. Argumento opcional "--local" para commitar sem enviar.
---

# Commit no all-systems

Todo commit deste projeto pertence à conta GitHub **srhenriquesilvabr**. Nunca usar a identidade global da máquina (Sergio Silva / vinde.com.br) nem a credencial `sergiovinde`.

## 1. Garantir a identidade (sempre, antes de commitar)

```bash
git config --local user.name srhenriquesilvabr
git config --local user.email 114965455+srhenriquesilvabr@users.noreply.github.com
git config --local credential.https://github.com.username srhenriquesilvabr
git remote set-url origin https://srhenriquesilvabr@github.com/srhenriquesilvabr/all-systems.git
```

Conferir com `git var GIT_AUTHOR_IDENT` e `git var GIT_COMMITTER_IDENT`. Se não mostrarem `srhenriquesilvabr <114965455+srhenriquesilvabr@users.noreply.github.com>`, parar e corrigir. Pode haver `GIT_AUTHOR_*` ou `GIT_COMMITTER_*` no ambiente sobrepondo a configuração.

## 2. Revisar o que entra

- Rodar `git status` e `git diff`. Commitar só o que foi trabalhado; arquivos sem relação ficam de fora e são mencionados ao usuário.
- **Nunca** commitar `.env`, `.env.*` (exceto `.env.example`), `.dev.vars*` ou `.wrangler/`. Os segredos de produção ficam só no `.env.production`.
- Antes do commit, procurar segredos no que foi adicionado: `git diff --cached | grep -nE "sbp_|postgres(ql)?://[^:]+:[^@]+@|re_[A-Za-z0-9]{20}"`. Achou algo, parar e avisar.
- Mudou código TypeScript: rodar `pnpm typecheck` e `pnpm check:boundaries`. Se falhar, avisar antes de commitar.

## 3. Mensagem

No estilo do histórico (`git log`):
- Título curto em português, sem ponto final, dizendo o que mudou.
- Corpo opcional, em português, com tópicos `- ` explicando o porquê, quebrado em ~72 colunas.
- Terminar com a linha de atribuição exigida pelo ambiente (por exemplo, `Co-Authored-By: Claude ...`).

Usar heredoc para a mensagem. Nunca `--no-verify` nem `--amend` em commit já enviado.

## 4. Enviar

Salvo se o argumento for `--local`: `git push -u origin <branch atual>`.
- Se o Git pedir login, a conta é **srhenriquesilvabr**. Avisar o usuário que vai abrir a janela do GitHub.
- Push recusado (non-fast-forward): não forçar. Fazer `git pull --rebase`, resolver e tentar de novo, ou perguntar.
- Nunca `push --force` sem pedido explícito.

## 5. Conferir e relatar

`git log -1 --format='%h %an <%ae> %s'` e, após o push, `git status -sb` (sem "ahead"). Responder com o hash, o título, a branch e se foi enviado.

Um push na branch de produção dispara o deploy no Cloudflare (Workers Builds), quando estiver ligado. Avisar isso ao commitar nela.
