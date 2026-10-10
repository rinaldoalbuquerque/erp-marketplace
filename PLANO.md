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
  - Testado na conta real em 07/10/2026 (cadastro, confirmação, organização automática, login, sair, redefinir senha). Links de e-mail precisam ser abertos no mesmo navegador do cadastro/pedido (fluxo PKCE do modelo de e-mail padrão).
  - Pendente: textos definitivos de Termos de Uso e Política de Privacidade (hoje provisórios); SMTP próprio (o e-mail padrão do Supabase só entrega para a equipe do projeto, e os modelos de e-mail só podem ser editados/traduzidos com SMTP próprio; hoje os e-mails chegam em inglês).
  - Ficou para depois: sair de todos os dispositivos, convite de funcionário, 2FA.
- [x] Perfis de acesso e camada de dados filtrando por organização
  - Tabela de permissões owner/admin/operator (`src/domain/auth/permissions.ts`); operador não vê financeiro nem tokens e não apaga anúncios; admin gerencia só operadores; configurações da empresa só o owner.
  - `requirePermission()` + página `/sem-permissao`.
  - `tenantDb()` / `getTenantContext()`: acesso ao banco que acrescenta o `organization_id` sozinho e recusa outra organização. Testado também contra o banco real (`npm run test:db`).
  - Decisão: RLS do Supabase **não** é usado para separar organizações por enquanto (o app acessa o banco pelo servidor com um usuário que ignora RLS; exigiria configurar o banco a cada requisição). O RLS segue ligado, sem regras, só para bloquear acesso direto do navegador. Revisar na fase SaaS.
- [x] Layout base e menu lateral
  - Menu filtrado por perfil (módulos futuros aparecem como "em breve"), menu ☰ no celular, topo com empresa, usuário, perfil e Sair.
  - Tema "Expedição" (verde-petróleo + âmbar, fontes IBM Plex) com botão claro/escuro/sistema, salvo no navegador.
- [x] Produtos e SKUs (com campos fiscais) e estoque com movimentações
  - Produto → SKUs (variações) com EAN, NCM, CEST, origem, unidade, CFOP, peso/medidas, localização e custo (custo só para quem vê o financeiro). Produtos são arquivados, nunca apagados.
  - Estoque por SKU com histórico (entrada, saída, contagem; venda e devolução prontas para a Fase 3). Ajuste atômico no banco: saldo nunca negativo em ajustes manuais, vendas podem negativar. Chave de idempotência por movimentação.
  - Chaves compostas (organização + id) impedem, no próprio banco, ligar SKU/movimentação a dados de outra empresa.
  - Testado: concorrência e idempotência contra o banco (`npm run test:db`, em empresa temporária) e teste manual em 08/10/2026.

### Fase 2 — Conexão com o ML e anúncios
- [x] **2.0** Conectar contas do ML (OAuth, refresh automático, tokens criptografados), contas ilimitadas; detectar tipo de modelo (tradicional/UP)
  - Aplicação "ERPMarketplace" no DevCenter (PKCE, Authorization Code + Refresh Token). Redirect: `https://erp-marketplace-ivory.vercel.app/contas/mercadolivre/retorno`.
  - Conexão feita pela Vercel (ML exige HTTPS). Tokens AES-256-GCM; renovação com trava por conta (refresh token do ML é de uso único).
  - Testado em 08/10/2026 com a conta BELA.UTILIDADES (User Products detectado pela tag `user_product_seller`).
  - Hospedagem: Vercel Hobby enquanto for desenvolvimento/testes; avaliar Pro (ou outra) antes do uso real, junto com a fila de tarefas.
  - Pendente: criar usuários de teste do ML antes de qualquer função que publique/altere anúncios; renovação preventiva de contas paradas (com a fila).
- [x] **2A** Importar anúncios; lista com filtros e busca; tela de Mapeamento
  - Importação em segundo plano (tabela `sync_jobs` + `after()`), com progresso, relatório, retomada e idempotência. Busca `search_type=scan` + `/items/bulk` (o `/items?ids=` será desligado em 25/10/2026).
  - Testado em 08/10/2026: 868 anúncios da BELA.UTILIDADES em 37 s, sem erros (845 UP, 23 tradicionais, 44 variações). Estoque confere com o painel do ML.
  - Mapeamento SKU ↔ anúncio/variação, com vinculação automática por código igual (com desfazer).
  - Fila "de verdade" (pg-boss com servidor próprio, ou serviço hospedado) decidida na 2D, junto com a hospedagem.
  - Ainda não: agrupar a lista por família (abrir/fechar), sincronização periódica automática.
- [x] **2A+** Criar produtos e SKUs do ERP a partir dos anúncios importados (com revisão antes)
  - Produtos > "Criar a partir dos anúncios": um SKU por código do ML, produto = família UP, EAN/marca/peso/medidas dos atributos, estoque inicial opcional (maior valor), vinculação automática no fim. Testado em 08/10/2026.
  - Anúncios sem SKU no ML (75 + 20 com variações sem SKU) não viram produto: listados na revisão.
- [x] Preencher dados fiscais em massa (NCM, origem, CFOP para vários SKUs de uma vez): os produtos criados dos anúncios nascem sem fiscal
  - Produtos > "Dados fiscais em massa" (`/produtos/fiscal`): só os campos preenchidos são aplicados; seleção por SKU, produto, página ou "todos do filtro" (refeito no servidor). Testado em 08/10/2026.
- [x] **2B** Renderizador de formulário por categoria + edição de anúncios (valida o motor do formulário)
  - Formulário montado da ficha técnica da categoria (cache de 24 h): lista, sim/não, número+unidade, texto com sugestões, "não se aplica", atributos ocultos em "Avançado", somente-leitura exibidos.
  - Edita título (tradicional sem vendas), preço, status (finalizar exige permissão de apagar), descrição (texto simples) e atributos; envia só o que mudou; confere o que o ML aplicou; avisa conflito; histórico em `listing_edits`.
  - Chave por conta "Permitir alterações pelo ERP" (desligada por padrão). Testado em 09/10/2026 na conta de teste (TESTUSER…): preço, descrição, atributos e status OK.
  - Usuários de teste do ML criados (vendedor e comprador); vendedor conectado ao ERP.
  - Aprendido na prática: `family_name` via `PUT /items` é recusado em User Products (usar o endpoint de famílias); o ML manda avisos gerais (ex.: ME1, frete grátis) em toda alteração; o campo `cause` dos erros nem sempre é lista.
  - Ainda não: editar nome da família (endpoint de famílias), fotos, variações, edição em massa.
- [x] Enviar o estoque do ERP para o Mercado Livre (sincronização de estoque)
  - Fila `stock_pushes` (um registro por anúncio/variação, sempre com o saldo mais recente): ajuste de estoque, vínculo novo, vinculação automática e "Criar a partir dos anúncios" enfileiram; o envio roda em segundo plano (`after()`) e também ao abrir Contas/Estoque.
  - `PUT /items/{id}` com `available_quantity`; um envio por User Product (o ML replica para os anúncios do mesmo UP); estoque negativo vai como 0. Novas tentativas em 1, 5, 15 e 60 min; recusa do ML vira erro com o motivo.
  - Ignorados (com motivo): Full, variações de anúncio tradicional e contas com multi origem (`warehouse_management`, outro endpoint, ainda não feito).
  - Chave por conta "Estoque do ERP no Mercado Livre" (exige alterações liberadas; bloquear alterações desliga). Ligar passa por uma prévia (ML hoje × vai ficar, destaca os que vão zerar e pausar). Contas mostra enviados/fila/ignorados/erros com "Enviar todos agora" e "Reenviar os com erro"; Estoque > SKU mostra a situação por anúncio.
  - Testado em 09/10/2026 na conta de teste: ligar, envio inicial e ajuste refletidos no ML.
  - Ainda não: multi origem, variações tradicionais, ligar na BELA.UTILIDADES (decisão do dono).
- [x] **2C** Criar anúncio: sugestão de categoria, simulador de preço, validação, publicação, rascunhos
  - Modelo canônico do anúncio (`src/domain/listings/canonical.ts`) e rascunhos (`listing_drafts`), base da 2D.
  - Anúncios → Novo anúncio: começa por um SKU (nome, marca, EAN, estoque) ou em branco; categoria sugerida pelo ML (`domain_discovery`), ficha técnica da categoria (mesmo componente da edição), fotos enviadas direto ao ML (reduzidas no navegador), descrição, garantia, Clássico/Premium.
  - Simulador: tarifa do ML (`listing_prices`) nos dois tipos, quanto recebe e margem sobre o custo do SKU (sem frete/impostos).
  - Validar no ML (`/items/validate`) e Publicar (`POST /items`; User Products com `family_name` e sem título). Publica uma vez só (trava + sem nova tentativa automática); depois envia a descrição, importa, vincula ao SKU e enfileira o estoque.
  - Testado em 09/10/2026 na conta de teste: anúncio MLB7778987736 (User Products, 3 fotos, 31 atributos) publicado e importado.
  - Ainda não: várias variações de uma vez (nova variação na família), frete por anúncio, copiar anúncio existente (2D).
- [x] **2D** Replicação, cópia de fora e migração entre contas (reaproveita formulário e rascunhos), com fila em segundo plano
  - Qualquer anúncio (seu ou de outro vendedor) vira rascunho no modelo canônico (`copy-service.ts`); anúncio seu leva o vínculo com o SKU; fotos por endereço para outras contas (ids só na mesma conta); atributos filtrados pela ficha da categoria de destino. Origem guardada só como referência.
  - Anúncios → "Copiar para…" (lote em segundo plano: conta, ajuste de preço %, arredondar para ,90, Clássico/Premium) e "Copiar anúncio de fora" (link ou MLB…, com aviso de direitos autorais).
  - Rascunhos → "Publicar selecionados" (lote em segundo plano; cada rascunho uma vez; recusas no relatório).
  - Lotes = `sync_jobs` (`replicate_listings`, `publish_drafts`) com rodadas em `after()`, progresso, retomada e relatório; um rascunho por origem em cada lote (índice único).
  - Testado em 09/10/2026: 2 anúncios da BELA copiados para a conta de teste (SKU herdado, preço +10% arredondado para ,90) e publicados em lote (MLB5360907969, MLB5360919029).
  - Ainda não: anúncios com variações (tradicionais), criar várias variações de uma família de uma vez.
- [ ] **2E** IA: ficha técnica e descrição
- [x] Edição em massa (preço e status)
  - Anúncios → "Editar em massa": ajustar preço em %, somar/subtrair R$, definir preço (arredondar para ,90), pausar, reativar; nos marcados ou em todos do filtro (até 500).
  - Prévia (atual → novo, mudanças > 30% em destaque, motivos dos pulados) e lote em segundo plano (`sync_jobs` `bulk_edit_listings`).
  - Valores finais calculados antes (retomar não aplica de novo); conferência no ML antes de enviar (mudou desde a prévia → não sobrescreve); histórico em `listing_edits`; "Desfazer" cria um lote com os valores anteriores.
  - Testado em 10/10/2026 na conta de teste: %, R$, pausar e reativar.
  - Ainda não: atributos/descrição em massa (cada categoria tem sua ficha); estoque fica com a sincronização do ERP; finalizar em massa (irreversível).

### Fase 3 — Pedidos
- [x] **3A** Receber pedidos e envios por notificação (webhook), com consulta periódica de reforço
  - Avisos do ML (`orders_v2` e `shipments`) em `/api/notificacoes/mercadolivre`: grava na caixa `marketplace_notifications` e responde 200 na hora (o ML exige < 500 ms); o pedido é lido depois, com o nosso token. Uma linha por recurso: aviso repetido não duplica.
  - Reforço: ao abrir Pedidos (a cada 5 min por conta), botão "Buscar vendas agora" e rotina diária da Vercel (`/api/cron/pedidos`, protegida por `CRON_SECRET`). Busca `/orders/search` por data de alteração (primeira vez: últimos 2 dias).
  - Confirmado em 09/10/2026 com a BELA: 41 vendas reais lidas certas (Full, normal, cancelada, carrinho) e avisos chegando em produção.
- [x] Baixa automática de estoque (idempotente)
  - Chave por conta "Vendas baixam o estoque do ERP" (desligada por padrão); só vendas confirmadas (`date_closed`) depois de ligar. Full não baixa; cancelado devolve; devolução parcial/reclamação não devolve sozinho (entrada manual). Anúncio sem SKU fica marcado "Sem SKU vinculado".
  - Chave de idempotência por linha do pedido (`order:{conta}:{pedido}:{item}:{variação}:sale|return`); depois da baixa, o novo saldo vai para os outros anúncios (fila de estoque).
  - Ligada na BELA em 09/10/2026 (estoque só no ERP: alterações e sincronização da BELA continuam desligadas). Confirmado em 09/10/2026: venda real de anúncio vinculado baixou o saldo no ERP.
- [x] Lista, busca, abas por etapa do envio
  - Envio de cada pedido (`/shipments/{id}` com `x-format-new`, prazo em `/shipments/{id}/sla`) copiado no pedido; etapa calculada: Para imprimir, Aguardando NF, Impressos, Em preparo, Enviados, Entregues, Full, Cancelados, Outros. Prazo de despacho em destaque; filtro por conta; busca por pedido, comprador, anúncio e rastreio.
  - Etiquetas em lote (PDF ou Zebra, até 50, uma conta por vez; carrinho = uma etiqueta), com aviso de NF antes de imprimir. Testado em 09/10/2026 com pedido real da BELA: etiqueta baixou normalmente.
- [ ] Separar produtos com leitor (3D)
- [ ] Ações em lote além das etiquetas

### Fase 4 — NF e etiquetas
- [x] Testar cedo, na conta real, o que o Faturador do ML exige
  - BELA (Simples Nacional) já usa o Faturador; a aplicação lê e emite notas sem permissão extra. Dados fiscais dos anúncios já estão no ML (`can_invoice` = true nos testados).
- [x] **4A** `FiscalProvider` + Faturador do ML (emitir pelo ERP)
  - Camada `src/fiscal/` (interface) + `MercadoLivreInvoicer` (`src/connectors/mercadolivre/invoices.ts`); notas na tabela `invoices`, ligadas aos pedidos (carrinho = uma nota).
  - Pedidos → "Aguardando NF" → "Emitir NF": confere dados fiscais dos anúncios (`can_invoice`), pede confirmação, emite (`POST /users/{id}/invoices/orders`), mostra o resultado por carrinho; erros em português (`/users/invoices/errors/MLB/{código}`). Coluna NF com número, série, DANFE e XML.
  - Contra nota duplicada: consulta a nota do pedido antes de emitir; uma emissão por carrinho (trava + linha "requesting"); a chamada de emissão nunca é repetida sozinha (resposta perdida → pergunta de novo ao ML).
  - Notas emitidas pelo painel do ML também entram no ERP (quando o envio passa da etapa de NF). Nota "pending_authorization" (número 0 no ML) é relida até autorizar.
  - Testado em 09/10/2026: NF real emitida pelo ERP para um pedido da BELA; número, DANFE e XML chegaram ao ERP e a etiqueta foi liberada.
- [x] Impressão de etiquetas em lote (PDF/ZPL), respeitando a regra NF → etiqueta (ver 3A/3B)
- [ ] **4B** Mandar dados fiscais dos SKUs do ERP para o ML (`/items/fiscal_information`, CSOSN já no SKU) e vincular SKU ↔ anúncio; importar XML de outro emissor (`/shipments/{id}/invoice_data`, plano B); DANFE + etiqueta juntas

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
- Kits (SKU composto por outros SKUs, ex.: "kit 3 camisetas"), baixando o estoque dos componentes.
- Importar produtos/SKUs por planilha.
- Estoque por depósito (mais de um local) e alerta de estoque baixo.
- Validar NCM/CEST contra as tabelas oficiais.

## 8. Referências

- Documentação do Mercado Livre: https://developers.mercadolivre.com.br
  - User Products, preditor de categorias, categorias e atributos, `listing_prices` (tarifas), custos de envio, Mercado Envios (etiquetas), importar NF, Faturador.
