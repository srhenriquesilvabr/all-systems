# Manual de uso

Manual para quem usa o sistema no dia a dia (donos, atendentes, produção). A página é `index.html`
com as capturas em `img/`; ela é publicada como página compartilhável (link privado, compartilhado
pelo menu Share da página).

## Atualizar as capturas

Os scripts usam o Microsoft Edge já instalado no Windows (via `playwright-core`, sem baixar navegador)
e o ambiente de dev rodando (`pnpm dev`) com a empresa de demonstração (`pnpm db:seed`).

```bash
cd docs/manual/scripts
npm init -y && npm i playwright-core@1.52.0   # uma vez, fora das dependências do projeto
node seed-demo.mjs                            # clientes, ordens e lançamentos fictícios (rodar uma vez)
node shoot.mjs ../img                         # todas as telas; ou: node shoot.mjs ../img 09-producao
node receipt.mjs ../img/08-comprovante.png    # só o cupom, recortado
```
