# ERP Marketplace — Guia para o Claude Code

> Renomeie o projeto quando definir o nome. Este arquivo é lido pelo Claude Code a cada sessão: mantenha-o curto e atualizado.

## O que é este projeto

ERP para gerenciar anúncios, estoque e pedidos em marketplaces.
- **Hoje:** uso pessoal do dono, sem limite de contas por marketplace.
- **Futuro:** SaaS multi-tenant, com planos e limites definidos depois.
- **Primeiro marketplace:** Mercado Livre Brasil (MLB). Depois Shopee e outros.
- **Prioridade nº 1:** produtividade na gestão de anúncios (criar, copiar, replicar, migrar, editar em massa). É ~50% do trabalho do usuário.
- **Dono do projeto é iniciante em programação:** explique o que for fazer antes de alterar arquivos, em português simples, e prefira soluções simples e prontas a soluções sofisticadas.

## Stack

- Next.js (App Router) + TypeScript em modo `strict`
- Supabase: Auth (e-mail + senha, confirmação por e-mail) e PostgreSQL
- Prisma como ORM e para migrations
- Validação de entrada com Zod
- Testes: Vitest (unidade) e Playwright (fluxos principais, mais tarde)
- Tarefas em segundo plano: por enquanto tabela `sync_jobs` + `after()` do Next (rodadas com limite de tempo, retomada por `pendingIds`, uma rodada por vez). Fila definitiva (pg-boss + servidor, ou serviço hospedado) a decidir na 2D

## Idioma

- Conversa comigo e textos de interface: **português do Brasil**.
- Código, nomes de variáveis, tabelas e commits: **inglês**.

## Regras de trabalho

1. Uma tarefa pequena por vez. Para mudanças grandes, comece propondo um plano e espere minha aprovação.
2. Commits pequenos, um por tarefa concluída, no padrão Conventional Commits (`feat:`, `fix:`, `chore:`...).
3. Antes de dar uma tarefa como concluída: rodar lint, typecheck e testes.
4. **Nunca** colocar chaves, tokens ou senhas no código. Segredos ficam em `.env` (que está no `.gitignore`). Manter `.env.example` atualizado, sem valores reais.
5. Mudanças no banco **somente** por migration. Nunca alterar o banco "na mão".
6. **Não inventar endpoints ou campos da API do Mercado Livre.** Consultar a documentação oficial (developers.mercadolivre.com.br) e deixar o link num comentário perto do código. Se não conseguir confirmar, avisar.
7. Não instalar dependências novas sem explicar por que são necessárias.

## Regras de arquitetura (não quebrar)

- **Multi-tenant desde o início.** Toda tabela de negócio tem `organization_id`. Todo acesso a dados passa por uma camada no servidor que filtra pela organização do usuário logado. O navegador nunca acessa o banco diretamente. (Avaliar RLS do Supabase como camada extra de proteção.)
- **Conectores de marketplace.** Existe uma interface `MarketplaceConnector`. Tudo que é específico do Mercado Livre fica dentro de `src/connectors/mercadolivre/`. Nada de lógica do ML espalhada pelo sistema, para a Shopee entrar depois sem reescrever.
- **Modelo canônico de anúncio.** O anúncio é convertido para um formato neutro (título, descrição, fotos, preço, atributos, variações, categoria) e deste para o formato de cada marketplace. É a base de copiar, replicar e migrar.
- **Contas de marketplace ilimitadas e independentes**, cada uma com suas credenciais e seu estado de sincronização.
- **Estoque é do ERP, por SKU.** Os anúncios refletem o estoque. Anúncios ficam vinculados a SKUs pela tela de Mapeamento.
- **As telas leem do banco local**, sincronizado com os marketplaces. Não chamar a API do marketplace a cada busca ou listagem.
- **Operações em lote** (replicar, publicar, atualizar estoque) rodam em segundo plano, com fila, progresso, repetição automática em erro, relatório de sucesso/falha e **idempotência** (rodar duas vezes não duplica).
- **Webhooks/notificações idempotentes:** o mesmo evento chegando duas vezes não pode baixar estoque duas vezes.
- **Tokens do ML** expiram: renovação automática (refresh) é obrigatória. Tokens ficam criptografados no banco e nunca aparecem em logs.
- **Concorrência no estoque:** duas vendas simultâneas do mesmo SKU devem ser tratadas com transação ou bloqueio no banco.
- **Fiscal:** camada única `FiscalProvider` com implementações `MercadoLivreInvoicer` (Faturador do ML via API), `XmlImport` (plano B manual) e, no futuro, emissor próprio. O resto do sistema só conversa com a camada. Notas ficam numa tabela própria, independente de quem emitiu.
- **Cadastro de produto já inclui campos fiscais** (NCM, CEST, origem, unidade, CFOP padrão), mesmo que o Faturador do ML não use todos.

## Regras de negócio importantes

- **Copiar de fora e migrar entre contas:** o anúncio entra como **rascunho** para revisão. Depois de criado, é **independente** do original (guardar o vínculo de origem apenas como referência, sem sincronizar alterações).
- **Mercado Livre tem dois formatos de anúncio** convivendo: o tradicional (com variações) e o **User Product (UP)**. O conector deve detectar qual a conta usa (vendedor com a tag `user_product_seller`; item com `user_product_id`). No modelo UP, cada variação é um User Product, agrupado em "família"; o título não é enviado na publicação (o ML usa `family_name` e atributos); o estoque é gerenciado por `user_product_id`.
- **Pedidos e etiquetas (ML):** em várias logísticas a etiqueta só é liberada depois que a NF entra (envio em `invoice_pending` → `ready_to_ship` / `ready_to_print`). Depois de impressa a etiqueta, a nota não pode mais ser alterada: avisar antes de imprimir. Pedidos Full não têm etiqueta para imprimir.
- **Perfis de acesso:** `owner`, `admin`, `operator`. O operador (ex.: separação) não vê financeiro, tokens de marketplace nem apaga anúncios.
- **Cadastro aberto de usuários fica desativado em produção** enquanto for uso pessoal (acesso por convite ou criação manual).

## Pontos a confirmar (não assumir como verdade)

- Endpoints `/categories/{id}/attributes` e `/items/validate`: confirmar formato atual na documentação.
- Descrição de anúncio do ML aceita só texto simples? Confirmar.
- Como o User Product se comporta nas contas reais do Brasil (como a criação responde em cada tipo). Já confirmado: `/users/me` traz `tags` com `user_product_seller` (conta BELA.UTILIDADES).
- Limites de requisições da API do ML.

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | Instala dependências (e gera o cliente do Prisma) |
| `npm run dev` | Roda em desenvolvimento (http://localhost:3000) |
| `npm run check` | **Rodar antes de cada commit:** lint + typecheck + formatação + testes |
| `npm run lint` / `npm run typecheck` / `npm test` | Cada verificação separada |
| `npm run test:db` | Testes contra o banco do `.env` (`*.db.test.ts`, só leitura) |
| `npm run format` | Formata o código com Prettier |
| `npm run db:migrate` | Cria/aplica migration (`npx prisma migrate dev --create-only --name x` para revisar o SQL antes). **Depois, reiniciar o `npm run dev`**: o cliente do Prisma fica em cache no servidor de desenvolvimento e não enxerga tabelas novas |
| `npm run db:generate` | Regenera o cliente do Prisma |
| `npm run db:studio` | Abre o Prisma Studio para ver os dados |

Notas técnicas:
- Versões: Next.js 16 (veja `AGENTS.md`: ler `node_modules/next/dist/docs/` antes de usar APIs do Next), Prisma 7 (config em `prisma.config.ts`, cliente gerado em `src/generated/prisma`, adaptador `@prisma/adapter-pg`), Zod 4, Vitest 5.
- `DATABASE_URL` (pooler, porta 6543) é usado pelo app; `DIRECT_URL` (porta 5432) pelas migrations.
- Toda tabela nova no schema `public` precisa de `ENABLE ROW LEVEL SECURITY` na migration (sem policies), para o navegador não acessar via Data API do Supabase.
- Variáveis de ambiente validadas em `src/server/env.ts`; código só do servidor usa `import "server-only"`.
- Autenticação: toda página interna e toda Server Action começa com `requireMember()` ou `requirePermission("...")` (`src/server/auth/session.ts`). O `src/proxy.ts` é só a primeira camada. Leitura de sessão fica dentro de `<Suspense>` (Cache Components ligado).
- Permissões: tabela única em `src/domain/auth/permissions.ts` (`can(role, permission)`). Esconder botão é só visual; quem protege é `requirePermission` no servidor.
- **Dados de negócio só via `getTenantContext()` / `tenantDb()`** (`src/server/tenant/`), que filtra tudo pela organização. O `db` "livre" (`src/server/db.ts`) fica restrito a rotinas internas (auth, provisionamento, jobs). Toda tabela nova com `organizationId` entra em `TENANT_MODELS` (`src/server/tenant/scope.ts`; um teste falha se esquecer). Com o `tenantDb`: sem nested writes e sem SQL bruto.
- URLs das páginas em português (`/entrar`, `/painel`), listadas em `src/lib/auth/routes.ts`.
- **Estoque só muda por `adjustStock()`** (`src/server/stock/stock-service.ts`), que grava saldo + movimentação na mesma transação. Nunca alterar `stockOnHand` direto. Eventos externos (vendas do ML) sempre com `idempotencyKey`.
- **Chamadas ao marketplace sempre com `getAccessToken()`** (`src/server/marketplaces/token-service.ts`): renova sozinho, com trava por conta (refresh token do ML é de uso único). Nunca ler/decifrar token por conta própria. Conectores recebem config injetada (`src/server/marketplaces/config.ts`) e são testados com `fetch` simulado.
- ML: ler anúncios em lote só com `/items/bulk?ids=` (máx. 20); `/items?ids=` está sendo desligado (25/10/2026). Listar anúncios do vendedor com `search_type=scan`.
- Anúncios importados ficam em `listings` (com `raw` = resposta completa do ML); vínculo com SKU em `sku_listing_mappings` (um SKU por anúncio/variação).
- **Escrever no marketplace só via `saveEdit()`** (`src/server/listings/edit-service.ts`): exige `allowWrites` na conta (desligado por padrão), confere versão (conflito), envia só o que mudou, lê de volta e registra em `listing_edits`. Testar mudanças primeiro na conta de teste do ML.
- **Estoque para o marketplace só pela fila** (`src/server/stock-sync/`): depois de mudar estoque ou vínculo, chamar `queueStockSync(org, () => enqueueForSkus/enqueueForListings(...))`. Só contas com `allowWrites` **e** `stockSyncEnabled` participam; regras (Full, variação, multi origem, negativo → 0) em `src/domain/stock/push-rules.ts`. O envio relê o saldo atual do SKU e só marca "enviado" se ninguém reenfileirou no meio (`claimToken`).
- **Criar anúncio só por rascunho** (`src/server/listings/draft-service.ts`): conteúdo no modelo canônico (`src/domain/listings/canonical.ts`); `publishDraft()` exige `allowWrites`, trava o rascunho em `publishing` e nunca repete o `POST /items` sozinho. Fotos passam por Server Action (limite `serverActions.bodySizeLimit` = 4 MB em `next.config.ts`; a Vercel corta em 4,5 MB) e são reduzidas no navegador antes.
- **Pedidos** (`src/server/orders/`): todo pedido entra por `saveOrder()` (idempotente; baixa/devolução de estoque por `adjustStock` com chave fixa por linha). Regras de baixa em `src/domain/orders/stock-rules.ts`, etapa do envio em `src/domain/orders/stage.ts`. Avisos do ML: `/api/notificacoes/mercadolivre` só grava e responde (limite de 500 ms); processamento em `after()`. Rotas de máquina (`/api/notificacoes`, `/api/cron`) ficam fora do `proxy.ts`.
- ML: `/shipments` exige o cabeçalho `x-format-new: true` e não traz mais `order_id` (o pedido aponta para o envio pelo `shipping.id`). Etiqueta só em `ready_to_ship` + `ready_to_print` (ou `printed` para reimprimir), máx. 50 por chamada, nunca Full.
- **Nota fiscal só pela camada fiscal** (`src/fiscal/types.ts` → `src/server/fiscal/invoice-service.ts`): `issueInvoices()` consulta antes se o pedido já tem nota, emite um carrinho por vez sob trava e nunca repete a chamada de emissão sozinha (NF-e não se desfaz). Testes usam `fakeFiscalProvider()` (`src/test/fake-fiscal.ts`); nenhum teste pode chamar o Faturador de verdade. O ML não aceita nota de homologação: todo teste real emite NF de verdade.
- Comportamento real do ML (confirmado na conta de teste): `cause` de erro pode vir como número/objeto/lista (texto útil em `error`); `warnings` do `PUT /items` são avisos gerais (não "campo ignorado"); `family_name` via `PUT /items` é recusado em UP; atributos `number_unit` são normalizados pelo ML (ex.: 1040 mL → 1.04 L).
- A conexão com o ML (OAuth) só funciona pelo endereço da Vercel (redirect HTTPS cadastrado na aplicação). Local e Vercel compartilham banco e `TOKEN_ENCRYPTION_KEY`.
- Testes: `npm run check` encadeado com `set -o pipefail` (ou checando o código de saída) antes de commitar, para não commitar com teste falhando.
- Tabelas filhas de negócio usam chave estrangeira composta `(organizationId, xId)` → `(organizationId, id)` do pai, para o banco impedir vínculo entre empresas.
- Menu lateral: itens em `src/lib/navigation.ts` (cada um com a permissão exigida; tirar o `comingSoon` quando o módulo existir).
- Tema "Expedição" (claro/escuro): usar **só os tokens de cor** de `src/app/globals.css` (`bg-surface`, `text-ink`, `text-muted`, `bg-brand`, `text-signal`...), nunca cores fixas como `gray-500` ou `blue-600`. Âmbar (`signal`) é reservado para o que pede atenção. Títulos usam a fonte condensada (`font-display`).

## Estrutura de pastas (alvo)

```
src/
  app/                  # páginas e rotas (Next.js)
  connectors/           # um por marketplace (mercadolivre/, shopee/ no futuro)
  domain/               # modelo canônico e regras de negócio
  fiscal/               # FiscalProvider e implementações
  server/               # acesso a dados e serviços (sempre filtrando por organização)
  jobs/                 # tarefas em segundo plano
prisma/                 # schema e migrations
```

Mais detalhes de escopo e fases: veja `PLANO.md`.
