# Sistema Mesa

Plataforma para publicação de eventos, reserva de mesas, checkout Pix ou cartão, emissão de ingressos com QR Code e check-in. A administração cobre eventos, setores, mesas, planta e ocupação em tempo real.

## Arquitetura

| Camada | Responsabilidade |
| --- | --- |
| Frontend | SPA em React, TypeScript e Vite. Consome a API JSON e usa `EventSource` para atualizar a disponibilidade. |
| Backend | API Fastify em TypeScript. Aplica validação, autenticação e autorização e integra SMTP, Google OAuth e o gateway de pagamento. |
| PostgreSQL | Persiste usuários, catálogo, imagens, reservas, pagamentos, auditoria, controle de tentativas e alterações de disponibilidade. O Prisma 7 acessa o banco com o adaptador PostgreSQL. |
| SSE | `GET /events/:eventId/stream` entrega um `snapshot` e eventos `table.locked`, `table.released` e `table.sold`. O cursor `Last-Event-ID` permite retomar a transmissão entre réplicas. A API consulta as alterações persistidas a cada segundo e envia heartbeat após 15 segundos sem eventos. |

O PostgreSQL é compartilhado pelas réplicas da API e também coordena bloqueios, cotas e SSE. Redis é dispensável. Consulte os [contratos da API](docs/api-contracts.md), o [schema Prisma](prisma/schema.prisma) e o [modelo relacional](docs/banco.md).

## Instalação local

Use Node.js 22.18+, 24.11+ ou 26.x, com npm, conforme `engines` na raiz. Use PostgreSQL 15+ ou o PostgreSQL embarcado fornecido pelo projeto para desenvolvimento. Para o E2E, instale o Chromium do Playwright.

Na raiz do projeto, instale as dependências e gere o `.env` inicial.

```sh
npm ci
npm --prefix frontend ci
npm run local:env
```

`local:env` usa o [modelo da API](.env.example), gera segredos locais e preserva um `.env` existente. Se o arquivo já existia, confira também `APP_ORIGIN=http://localhost:3000` e `FRONTEND_ORIGIN=http://localhost:5173`. Copie o [modelo do frontend](frontend/.env.example) para `frontend/.env`.

```powershell
Copy-Item frontend/.env.example frontend/.env
```

Inicie o PostgreSQL embarcado em um terminal e mantenha-o aberto. Ele escuta em `127.0.0.1:55432` e usa `.local/postgres/`. Se já tiver um PostgreSQL, crie um banco dedicado e aponte `DATABASE_URL` para ele.

```sh
npm run db:local
```

Em outro terminal, gere o cliente Prisma, aplique as migrations versionadas e execute o seed.

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
```

O seed cria o administrador de `SEED_ADMIN_EMAIL` com a senha de `SEED_ADMIN_PASSWORD` e publica o evento de demonstração **Noite Aurora**, com dois setores e cinco mesas. Reexecutar o seed preserva a senha e os dados do evento existente. Para criar somente a conta, use `npm run db:seed -- --admin-only`. Para criar novas migrations a partir de alterações no schema, use `npm run db:migrate:dev -- --name nome_da_alteracao` em banco de desenvolvimento.

Abra um terminal para cada processo, a partir da raiz.

| Comando | Resultado |
| --- | --- |
| `npm run dev` | API em `http://localhost:3000`, com recarga de código |
| `npm run dev:frontend` | SPA em `http://localhost:5173` |
| `npm run build` | Gera o Prisma Client e compila a API em `dist/` |
| `npm run start` | Inicia a API compilada |
| `npm run build:frontend` | Compila a SPA em `frontend/dist/` |
| `npm run preview:frontend` | Serve o build local da SPA em `http://localhost:4173` |

Abra o [frontend local](http://localhost:5173) e consulte a [prontidão da API](http://localhost:3000/health). Ela responde `200` quando o banco está acessível ou `503` quando a consulta falha. Use `PAYMENT_PROVIDER=mock` e deixe a chave pública do Mercado Pago vazia para executar o checkout simulado.

## Variáveis de ambiente e integrações

A API carrega o `.env` da raiz. No frontend, o Vite lê `frontend/.env` e incorpora as variáveis `VITE_*` ao bundle público durante o build. Configure somente valores públicos nesse arquivo. Mantenha a senha do banco, os segredos JWT, OAuth e Turnstile, o access token e o segredo do webhook exclusivamente no backend.

### URLs e CORS

`APP_ORIGIN` é a origem pública da API. `FRONTEND_ORIGIN` é a origem da SPA e habilita o retorno do Google à interface. A API inclui as duas origens no CORS e aceita origens adicionais listadas em `CORS_ORIGINS`. Em produção, use apenas origens HTTPS explícitas. Localmente, mantenha `localhost` no navegador e em `VITE_API_BASE_URL` para que a SPA e a API compartilhem o mesmo site para fins de cookie. Para testar o fluxo Google no preview, ajuste temporariamente `FRONTEND_ORIGIN` para `http://localhost:4173` e reinicie a API.

### Google OAuth 2.0

Configure `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` de um cliente do tipo **Aplicativo da Web**. Cadastre `http://localhost:3000/auth/google/callback` localmente e `<APP_ORIGIN>/auth/google/callback` em produção como URIs autorizadas. Após validar código, PKCE S256, `state` de uso único e `nonce`, a API grava o cookie de sessão e redireciona a SPA para `<FRONTEND_ORIGIN>/auth/callback`. Com `FRONTEND_ORIGIN` ausente, o callback termina em `/auth/me` na própria API. A identidade é vinculada pelo `sub` do Google. Quem já tem conta deve autenticar-se com e-mail verificado antes de iniciar o vínculo em `POST /auth/google/link`. [Documentação do Google](https://developers.google.com/identity/openid-connect/openid-connect)

### SMTP

Configure `SMTP_URL` e `MAIL_FROM` para enviar os códigos de verificação e recuperação. Em desenvolvimento, com SMTP vazio, a API grava as mensagens em `.local/mail/`. Copie o código da mensagem no formulário correspondente. Em produção com Mercado Pago, `SMTP_URL` é obrigatório. Na demonstração online com `PAYMENT_PROVIDER=mock` e sem SMTP, novos cadastros com senha já podem reservar e a recuperação por e-mail fica desativada.

### Mercado Pago

Para integração real, use `PAYMENT_PROVIDER=mercado_pago`. Configure `MERCADO_PAGO_ACCESS_TOKEN`, `PAYMENT_WEBHOOK_SECRET` e `VITE_MERCADO_PAGO_PUBLIC_KEY` para a mesma aplicação e ambiente. Cadastre `<APP_ORIGIN>/webhooks/payment` para o tópico **Pagamentos** da Payments API. O checkout usa BRL, exige CPF ou CNPJ no Pix e tokeniza o cartão no navegador. [Webhooks do Mercado Pago](https://www.mercadopago.com.br/developers/en/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks)

Uma aprovação processada após o vencimento ou cancelamento da reserva, ou após outra cobrança confirmá-la, recebe `REFUND_REQUIRED`. O Pix do provedor pode continuar válido após os 10 minutos da reserva. Concilie essas cobranças pelo ID do provedor e faça o reembolso pelo Mercado Pago. [Validade do Pix no Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix)

### Cloudflare Turnstile

A API aceita `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAME` e `CAPTCHA_LOGIN_AFTER_FAILURES`. Quando o segredo está configurado, o cliente deve gerar e enviar `captchaToken` no cadastro (`register`), no reenvio de verificação (`email_resend`), na recuperação (`password_forgot`) e no login (`login`) após o limiar de falhas, que começa em duas por padrão. A API valida o token, a ação e o hostname com Siteverify. A SPA atual ainda precisa do widget para gerar esses tokens. Para servir a SPA desta entrega, mantenha `TURNSTILE_SECRET_KEY` vazio. [Validação no servidor do Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## Segurança da API

- **Erros e CORS.** Respostas de erro retornam código e mensagem controlados, sem stack trace. Exceções inesperadas retornam `500 INTERNAL_ERROR`. A API aplica Helmet, usa uma lista de origens CORS sem curingas e envia `Vary: Origin`. Alterações com cookie exigem a origem da API ou da SPA configurada.
- **Sessão e RBAC.** O JWT expira em 15 minutos e a API consulta perfil e versão da sessão no banco. O catálogo publicado e o SSE são públicos. Rotas administrativas e check-in exigem `ADMIN`. Reservas e pagamentos são restritos a `CUSTOMER` e ao titular, com e-mail verificado para criar a reserva. O fluxo Google usa cookie `HttpOnly`, `SameSite=Lax` e `Secure` em HTTPS.
- **Concorrência.** A criação de reserva bloqueia a linha da mesa, fixa preço e capacidade e usa um índice único parcial para impedir duas reservas ativas. O bloqueio dura 10 minutos. O worker usa `FOR UPDATE SKIP LOCKED` para expirar reservas em lotes a cada 5 segundos. Checkout e aprovação são coordenados por transações e pela chave de idempotência do gateway. O check-in usa atualização condicional para aceitar uma única entrada por reserva.
- **Webhooks.** A assinatura HMAC-SHA256 do mock cobre o JSON bruto. O Mercado Pago assina os campos da notificação, e a API consulta o próprio provedor para validar referência, valor, moeda, método e status. A persistência de eventos e as transições em transação tornam as reentregas idempotentes.
- **Limites e auditoria.** Senhas usam bcrypt e devem ter no mínimo 15 caracteres e no máximo 72 bytes UTF-8. Cinco falhas consecutivas de login bloqueiam novas tentativas na conta por 15 minutos. Cotas por IP e conta, compartilhadas pelo PostgreSQL, protegem rotas sensíveis. Os logs de auditoria registram mudanças de perfil, operações administrativas, check-in e transições de pagamento.

## Testes de integração e E2E

Use um banco PostgreSQL local dedicado a testes, com migrations e seed aplicados. Aponte `DATABASE_URL` para esse banco, use `NODE_ENV=development` e `PAYMENT_PROVIDER=mock`, e deixe SMTP, a chave pública do Mercado Pago e o segredo Turnstile vazios. A suíte E2E cria e remove registros de teste e limpa as tabelas de controle de tentativas e cotas.

```sh
npx playwright install chromium
npm run typecheck
npm run typecheck:frontend
npm run test:integration
npm run test:e2e
```

`npm test` executa integração e E2E em sequência. A primeira suíte usa PostgreSQL real e exercita autenticação, RBAC, CORS, bloqueios concorrentes, checkout, assinaturas e reentrega de webhooks, SSE entre instâncias e check-in. O Playwright sobe servidores próprios nas portas `3001` e `5174` e testa no navegador o catálogo, a gestão de eventos, a expiração em tempo real e a compra até a portaria.

Em caso de conflito de portas, ajuste `E2E_API_PORT` e `E2E_FRONTEND_PORT`. Para usar um navegador já instalado, configure, por exemplo, `E2E_BROWSER_CHANNEL=chrome`. O relatório HTML pode ser aberto com `npx playwright show-report`.

## Demonstração online com GitHub, Netlify e Render ou Railway

1. **Publique o código no GitHub.** Em uma cópia sem Git, execute `git init -b main` na raiz. Antes de fazer commit, confira `git status --short --untracked-files=all`. Versione código, lockfiles, migrations, manifestos e arquivos `.env.example`. Os arquivos de ambiente locais, dependências, dados de desenvolvimento, builds e relatórios de teste ficam fora do repositório. Adicione o remoto do GitHub e envie a branch `main`.
2. **Prepare os endereços e o banco.** Conecte o repositório ao Netlify para obter a URL da SPA. Use um banco PostgreSQL dedicado à demonstração e informe ao backend a URL de conexão direta, com TLS conforme o provedor, em `DATABASE_URL`. Migrations e seed precisam de um usuário com permissão para alterar o schema.
3. **Publique a API.** No Render, importe o repositório como Blueprint usando [render.yaml](render.yaml). O modelo usa o plano gratuito, compila o backend e roda migrations e o seed de demonstração antes de abrir a porta. `APP_ORIGIN` pode ser omitida no Render para usar `RENDER_EXTERNAL_URL`. Com domínio próprio, informe `APP_ORIGIN` explicitamente. [Blueprints do Render](https://render.com/docs/blueprint-spec) · [Variáveis do Render](https://render.com/docs/environment-variables)
4. **Se usar Railway,** crie o serviço a partir da raiz do repositório e gere um domínio público. Use `RAILPACK_NODE_VERSION=24` e `RAILPACK_PRUNE_DEPS=false` para manter Prisma e tsx disponíveis ao comando de pré-deploy. O build é `npm run build`. Configure `npm run db:migrate && npm run db:seed -- --demo` no pré-deploy, `npm start` no start e `/health` no healthcheck. Defina `APP_ORIGIN` com a URL HTTPS pública desse serviço. [Configuração do Railpack para Node.js](https://railpack.com/languages/node/) · [Pré-deploy no Railway](https://docs.railway.com/deployments/pre-deploy-command)
5. **Publique a SPA.** Configure `VITE_API_BASE_URL` com a origem HTTPS da API no ambiente de build do Netlify e deixe `VITE_MERCADO_PAGO_PUBLIC_KEY` vazia para a demonstração. O [netlify.toml](netlify.toml) executa o build em `frontend` e publica `dist` relativo a esse diretório. A regra de fallback também é copiada de `frontend/public/_redirects` para o build. Ela permite recarregar `/admin`, `/minhas-reservas` e `/eventos/noite-aurora` e preserva os controles de acesso do app. Redeploy após alterar variáveis `VITE_*`. [Configuração de build do Netlify](https://docs.netlify.com/build/configure-builds/file-based-configuration/)

| Variáveis do backend | Valores para a demonstração |
| --- | --- |
| `NODE_ENV`, `HOST`, `PORT` | `production`, `0.0.0.0` e a porta fornecida pela plataforma |
| `DATABASE_URL` | URL PostgreSQL do ambiente de demonstração |
| `APP_ORIGIN`, `FRONTEND_ORIGIN` | Origens HTTPS da API e da SPA, como `https://nome-do-site.netlify.app` para a SPA |
| `CORS_ORIGINS` | Origens HTTPS adicionais em CSV, quando necessário |
| `JWT_SECRET`, `TICKET_ENCRYPTION_KEY` | Segredos independentes gerados conforme a seção de produção |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Credenciais exclusivas da demonstração, definidas no painel do backend |
| `PAYMENT_PROVIDER`, `SMTP_URL` | `mock` e vazio |

O seed `--demo` cria o administrador e publica **Noite Aurora** em um banco novo. Reexecutá-lo preserva estoque, reservas e credenciais existentes. A API registra no startup que o modo demonstração está ativo. Use cadastro e login por e-mail e senha. O botão **Simular pagamento** confirma a cobrança do titular, atualiza a disponibilidade e libera o ingresso para check-in sem transacionar dinheiro. Mantenha o catálogo e as contas de demonstração no banco dedicado.

### CORS, proxy e apresentação

- **CORS.** Use a origem exata do site no Netlify em `FRONTEND_ORIGIN`. Para adicionar um preview autorizado, inclua a URL HTTPS específica em `CORS_ORIGINS`. Um curinga como `https://*.netlify.app` inclui sites de outras contas e é rejeitado pela API.
- **Proxy reverso.** O navegador chama a API diretamente, inclusive para SSE. Configure `TRUSTED_PROXIES` com os IPs ou CIDRs confirmados dos proxies imediatamente à frente da API que controlam `X-Forwarded-For`. A API usa o primeiro endereço não confiável da direita para a esquerda e armazena as cotas no PostgreSQL. Sem uma lista confiável, deixe a variável vazia. Nesse caso, usuários que chegarem pelo mesmo IP de proxy compartilham a cota. Confirme no deploy com duas redes distintas se as cotas de login são independentes. [IP do cliente no Render](https://render.com/articles/how-render-handles-ddos-attacks)
- **Teste antes da apresentação.** Consulte `/health`, recarregue as rotas da SPA, cadastre um cliente, reserve uma mesa, simule o Pix e abra o QR Code em **Minhas Reservas**. Com outra sessão, entre como administrador e teste o check-in. Reabra a API antes da apresentação se usar Render gratuito, que suspende o serviço quando inativo. Use e-mail e senha com os domínios padrão de hospedagem. Para habilitar login Google, use domínios do mesmo site para a SPA e a API. [Limitações do Render gratuito](https://render.com/docs/free)

## Deploy com pagamentos reais

1. **Configure o PostgreSQL e o ambiente.** Defina `NODE_ENV=production`, `PAYMENT_PROVIDER=mercado_pago`, `DATABASE_URL`, `JWT_SECRET`, `TICKET_ENCRYPTION_KEY`, `SMTP_URL` e `MAIL_FROM` no backend. Use TLS para a conexão remota com o PostgreSQL conforme o provedor. Gere segredos independentes e mantenha a mesma chave de ingressos em todas as réplicas e releases para preservar os QR Codes emitidos. Para gerar um JWT secret e uma chave de ingresso, execute `node -e "const {randomBytes} = require('node:crypto'); console.log(randomBytes(48).toString('base64url')); console.log(randomBytes(32).toString('base64url'))"` em uma sessão segura e guarde os valores no gerenciador de segredos.
2. **Configure as origens públicas.** Use, por exemplo, `APP_ORIGIN=https://api.mesas.example.com`, `FRONTEND_ORIGIN=https://mesas.example.com` e `VITE_API_BASE_URL=https://api.mesas.example.com`. Para o Google, use HTTPS e origens do mesmo site para os cookies de sessão. Defina `HOST=127.0.0.1` para um proxy na mesma máquina ou ajuste o bind à rede privada do serviço. Preencha `TRUSTED_PROXIES` apenas com IPs ou CIDRs dos proxies que controlam `X-Forwarded-For`.
3. **Configure os provedores.** Use o Mercado Pago e as credenciais de produção da mesma aplicação. Registre o webhook público mantendo `data.id`, `X-Signature` e `X-Request-Id` no encaminhamento. Se usar Google, configure a URI de callback da API no console do provedor. Configure os valores públicos no ambiente de build do frontend antes de gerar seus assets.
4. **Gere os builds e aplique as migrations.** Execute os comandos abaixo a partir da raiz no ambiente de build/release. Faça backup do banco antes da atualização e rode a migration uma vez por release, antes de iniciar a API nova. Mantenha as dependências de desenvolvimento na etapa de build e migration. O processo de runtime precisa de `dist/` e das dependências de produção da raiz.

   ```sh
   npm ci --include=dev
   npm --prefix frontend ci --include=dev
   npm run build
   npm run build:frontend
   npm run db:migrate
   ```

5. **Prepare o primeiro acesso.** Se precisar criar o primeiro administrador, preencha `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` e execute `npm run db:seed -- --admin-only` uma vez. Com `NODE_ENV=production`, o seed também cria somente a conta por padrão. Retire as credenciais do seed do ambiente de runtime após o bootstrap.
6. **Publique a API e a SPA.** Execute `npm start` sob um supervisor e sirva `frontend/dist/` por HTTPS. Configure fallback para `index.html` nas rotas da SPA, incluindo `/auth/callback`. No proxy da API, desative cache, compressão e buffering para `/events/*/stream` e use timeout de leitura superior ao intervalo de heartbeat, por exemplo 60 s. Preserve `Last-Event-ID` e dimensione o limite do corpo para os uploads administrativos de até 2 MiB.
7. **Verifique o release.** Cheque `GET /health`, abra a SPA, valide o login e a conexão SSE de um evento publicado. Confirme em homologação o envio de e-mail, o callback OAuth, a entrega de webhook e o check-in. Monitore respostas 5xx, saúde do banco e pagamentos `REFUND_REQUIRED` após liberar o tráfego.
