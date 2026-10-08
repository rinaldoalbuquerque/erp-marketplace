# Plano do ERP Marketplace

Documento vivo: atualize conforme o projeto evolui. Regras para o Claude Code ficam no `CLAUDE.md`.

## 1. Visão

ERP para gerenciar marketplaces, começando pelo Mercado Livre, com foco em **produtividade na gestão de anúncios**. Uso pessoal agora (sem limite de contas); evolução para SaaS depois, com planos e limites definidos quando chegar a hora.

## 2. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Stack | Next.js + TypeScript, Supabase (Auth + PostgreSQL), Prisma |
| Primeiro marketplace | Mercado Livre Brasil; arquitetura de conectores para os próximos |
| Contas | Ilimitadas por marketplace no uso pessoal |
| Multi-tenant | Desde o início (organização dona de todos os dados) |
| Anúncio copiado/migrado | Entra como rascunho; depois é independente do original |
| NF-e | Faturador do ML via API; XML manual como plano B; emissor próprio só quando o SaaS estiver rendendo |
| Cadastro de usuários | Fechado em produção por enquanto (convite/criação manual) |
| Autenticação | Supabase Auth: nome, e-mail, celular, confirmação por e-mail, senha forte |
| Módulos do sistema atual que NÃO serão usados agora | Compras, SAC, Análises, Financeiro |

## 3. Funcionalidades por área

### 3.1 Acesso e conta
- Cadastro: nome, e-mail, celular (formato +55), senha. Aceite de termos e privacidade (guardar data).
- Confirmação por e-mail obrigatória antes do primeiro login; opção de reenviar.
- Senha: mínimo de 10–12 caracteres, medidor de força, bloqueio de senhas vazadas/comuns, sem regras artificiais de símbolo obrigatório.
- Login com limite de tentativas e mensagens genéricas de erro. "Esqueci minha senha" por e-mail. Sessão em cookie seguro; sair de todos os dispositivos.
- Perfis: owner, admin, operator. Convite de funcionário por e-mail. 2FA em seguida.
- Verificação do celular por SMS/WhatsApp: fica para depois (tem custo).

### 3.2 Anúncios (prioridade máxima)
- **Lista de anúncios** única, para todos os marketplaces e contas:
  - Filtros em cascata: marketplace → conta (seleção múltipla); status: ativo, inativo/pausado, sem estoque, com erro/em revisão.
  - Busca única por título, SKU, EAN e ID. Sem marketplace selecionado busca em tudo; só marketplace, em todas as contas dele; marketplace + conta, só naquela conta.
  - Atalhos no menu lateral por marketplace; filtros guardados na URL e lembrados.
  - Etiqueta discreta do tipo (tradicional ou User Product); variações agrupadas por família, recolhidas.
  - Mostrar "última sincronização" por conta. Paginação no servidor.
- **Mapeamento** SKU ↔ anúncio (tela própria, mostra anúncios ainda sem vínculo).
- **Rascunhos** como estado do anúncio.
- **Criar anúncio dentro do ERP**, espelhando o formulário do ML:
  - Sugestão de categoria a partir do título (preditor de categorias; até 3 opções).
  - Formulário dinâmico montado a partir dos atributos da categoria (ficha técnica, obrigatórios, valores permitidos).
  - Preço, SKU, EAN, fotos, tipo de anúncio.
  - Simulador de preço: tarifa de venda + frete + custo + imposto + margem; e o inverso (margem desejada → preço sugerido).
  - Validação antes de publicar, exibindo erros no formulário; publicação direta pelo ERP; acompanhamento do status depois (o ML ainda pode moderar/pausar).
  - Comportamento diferente conforme a conta seja tradicional ou User Product.
- **Copiar de fora** (por link) e **migrar entre contas**: sempre como rascunho.
- **Replicar** de qualquer conta para quaisquer contas escolhidas (origem A → destinos B, C, D...), inclusive "selecionar todos os resultados da busca"; processo em segundo plano com progresso e relatório.
- **Edição em massa** (preço, estoque, status).
- **IA** (por último): preencher ficha técnica a partir do título (só o que for seguro inferir; campos marcados como "preenchido por IA"; o restante em destaque para preencher) e gerar descrição a partir de título + ficha técnica (botão gerar/regerar).
- **Futuro:** migrar entre marketplaces (ML → Shopee), via modelo canônico.

### 3.3 Pedidos
- Lista única de todas as contas, com busca por nome do comprador, número do pedido, ID, rastreio, SKU e título; filtros por marketplace, conta, status, logística (Coleta, Flex, Places, Full) e prazo de despacho.
- Abas por etapa, com contador: Emitir NF · Imprimir etiqueta · Separar · Pronto para envio · Todos.
- Ações em lote: emitir NF, imprimir etiquetas (PDF/ZPL), marcar como separado.
- Destaque de pedidos perto do prazo de despacho.
- **Separar produtos:** campo grande de busca (nome, SKU, EAN, ID ou rastreio; funciona com leitor de código de barras); mostra foto grande, variação, quantidade e localização; confirmação item a item; lista de separação consolidada por SKU.
- Status interno próprio, mapeado a partir do status/substatus de cada marketplace.
- Pedidos Full: sem ação de etiqueta.

### 3.4 NF e etiquetas
- Botão "Emitir NF" que aciona o Faturador do ML, acompanha o resultado e importa os dados da nota automaticamente.
- Plano B: subir o XML manualmente (validar: nota autorizada pela Sefaz e chave fiscal única).
- Etiqueta só após a NF nas logísticas que exigem; aviso antes de imprimir (a nota não muda depois).

### 3.5 Estoque
- Estoque por SKU no ERP, com histórico de movimentações.
- Sincronização para os anúncios (por `user_product_id` nos anúncios UP).
- Baixa automática por pedido.

## 4. Modelo de dados inicial (rascunho)

- `organizations`, `memberships` (papel do usuário), perfis de usuário
- `products`, `skus` (com NCM, CEST, origem, unidade, CFOP padrão), `stock_movements`
- `marketplace_accounts` (marketplace, credenciais criptografadas, tipo de modelo de anúncio, última sincronização)
- `listings` (campos canônicos + IDs externos, status, tipo tradicional/UP, `user_product_id`, `family_id`, conta), incluindo status `draft`
- `listing_origins` (vínculo de origem de cópia/replicação, apenas referência)
- `sku_listing_mappings`
- `orders`, `order_items`, `shipments`, `invoices`
- `batch_operations` e `batch_operation_items` (replicação, publicação, etc.)
- `sync_logs`, `webhook_events`

## 5. Fases

### Fase 0 — Preparação
- [x] Instalar Node.js (LTS), Git, VS Code e a extensão do Claude Code
- [x] Criar repositório no GitHub
- [x] Criar projeto no Supabase
- [ ] Criar conta de desenvolvedor no Mercado Livre e registrar uma aplicação; criar usuários de teste
- [ ] Definir provedor de e-mail com domínio próprio (necessário antes de uso real da confirmação por e-mail)

### Fase 1 — Fundação
- [x] Projeto Next.js + TypeScript, lint, typecheck, testes
- [x] Prisma + migrations; schema inicial
- [x] Autenticação (seção 3.1) e organização automática no cadastro
  - Feito: cadastro (nome, e-mail, celular, senha ≥ 10 com medidor e checagem de senhas vazadas, aceite dos termos), confirmação por e-mail, criação automática de perfil + organização + owner, login, esqueci/redefinir senha, sair, páginas internas protegidas, `ALLOW_PUBLIC_SIGNUP`.
  - Pendente: teste manual ponta a ponta na conta real; textos definitivos de Termos de Uso e Política de Privacidade (hoje provisórios); SMTP próprio (o e-mail padrão do Supabase só entrega para a equipe do projeto, e os modelos de e-mail só podem ser editados/traduzidos com SMTP próprio; hoje os e-mails chegam em inglês).
  - Ficou para depois: sair de todos os dispositivos, convite de funcionário, 2FA.
- [ ] Perfis de acesso e camada de dados filtrando por organização
  - Já existe `requireMember()` (`src/server/auth/session.ts`), que devolve usuário + organização + papel: ponto de partida da camada de dados.
- [ ] Layout base e menu lateral
- [ ] Produtos e SKUs (com campos fiscais) e estoque com movimentações

### Fase 2 — Conexão com o ML e anúncios
- [ ] **2.0** Conectar contas do ML (OAuth, refresh automático, tokens criptografados), contas ilimitadas; detectar tipo de modelo (tradicional/UP)
- [ ] **2A** Importar anúncios; lista com filtros e busca; tela de Mapeamento
- [ ] **2B** Renderizador de formulário por categoria + edição de anúncios (valida o motor do formulário)
- [ ] **2C** Criar anúncio: sugestão de categoria, simulador de preço, validação, publicação, rascunhos
- [ ] **2D** Replicação, cópia de fora e migração entre contas (reaproveita formulário e rascunhos), com fila em segundo plano
- [ ] **2E** IA: ficha técnica e descrição
- [ ] Edição em massa (pode entrar junto da 2B/2D)

### Fase 3 — Pedidos
- [ ] Receber pedidos e envios por notificação (webhook), com consulta periódica de reforço
- [ ] Lista, busca, abas por etapa, ações em lote
- [ ] Baixa automática de estoque (idempotente)
- [ ] Separar produtos com leitor

### Fase 4 — NF e etiquetas
- [ ] Testar cedo, na conta real, o que o Faturador do ML exige
- [ ] `FiscalProvider` + Faturador do ML + XML manual
- [ ] Impressão de etiquetas em lote (PDF/ZPL), respeitando a regra NF → etiqueta

### Fase 5 — Depois do MVP
- [ ] Shopee e outros conectores; migração entre marketplaces
- [ ] Modelo de precificação por conta; detecção de palavras proibidas; banco de mídias
- [ ] Alertas (anúncio pausado/com erro, estoque baixo, pedido perto do prazo, NF falhou)
- [ ] Relatórios simples (vendas por conta/produto, margem real)
- [ ] Promoções e marketing por marketplace

### Fase SaaS
- [ ] Planos, limites por plano, cobrança, onboarding, cadastro aberto
- [ ] Emissor próprio de NF-e (preferencialmente motor de terceiros por baixo)
- [ ] Revisão de segurança e LGPD

## 6. Riscos e cuidados

- Tokens do ML expiram (refresh obrigatório).
- Notificações duplicadas (processamento idempotente).
- Limite de requisições da API (confirmar valores).
- Concorrência no estoque do mesmo SKU.
- Mapeamento de categorias e atributos entre contas e entre marketplaces.
- O ML pode moderar ou pausar anúncios após a publicação: o ERP precisa mostrar o motivo.
- Emissor próprio de NF-e é um projeto grande e sensível (certificado digital, regras por estado e regime tributário); tratar só na fase SaaS.

## 7. Ideias para avaliar (backlog)

Anotar aqui tudo que for descoberto olhando outros sistemas.

- Links de e-mail (confirmação/redefinição) podem ser "consumidos" por antivírus de e-mail que abrem links automaticamente (ex.: Outlook). Se acontecer, trocar o link por uma página com botão "Confirmar".
- Tela "Minha conta": editar nome/celular, trocar senha, sair de todos os dispositivos.

## 8. Referências

- Documentação do Mercado Livre: https://developers.mercadolivre.com.br
  - User Products, preditor de categorias, categorias e atributos, `listing_prices` (tarifas), custos de envio, Mercado Envios (etiquetas), importar NF, Faturador.
