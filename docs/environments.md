# Ambientes do PopSystem

## Regra operacional

- `homologacao`: toda alteracao de aplicacao, banco e funcoes fiscais nasce e e validada aqui.
- `main`: representa producao. Nao recebe desenvolvimento direto.
- producao so pode ser publicada depois da aprovacao formal da homologacao.

## Isolamento

| Camada | Homologacao | Producao |
| --- | --- | --- |
| Git | branch `homologacao` | branch `main` |
| Vercel | Preview Deployment | Production Deployment |
| Supabase | branch `homologacao` (`gzixvxculmzemecatupt`) | projeto principal (`gcfyrcpugmducptktjic`) |
| Dados | sinteticos e anonimizados | clientes reais |
| Fiscal | ambiente/autorizador de homologacao | producao, somente apos aceite |
| Integracoes externas | desativadas por padrao | configuradas por loja |

O frontend e as APIs nao possuem mais fallback para o Supabase de producao. Cada ambiente precisa declarar explicitamente `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` e as demais credenciais apropriadas.

## Fluxo de entrega

1. Criar a alteracao na branch `homologacao`.
2. Aplicar migrations somente na branch Supabase de homologacao.
3. Publicar como Vercel Preview, sem `--prod`.
4. Executar build, validacao fiscal e testes funcionais.
5. Registrar o aceite da homologacao.
6. Abrir PR de `homologacao` para `main`.
7. Publicar producao manualmente pelo workflow `vercel-deploy`, que exige confirmacao.

O comando `npm run deploy` agora publica preview. O comando `npm run deploy:production` exige branch `main`, arvore limpa e `HOMOLOGATION_APPROVED=YES`.

## Cuidados fiscais

- NFC-e/NF-e de teste deve usar certificado e credenciais do ambiente de homologacao do provedor/SEFAZ.
- Nunca copiar tokens de iFood, WhatsApp, Meta, Asaas ou Mercado Pago da producao para homologacao.
- O poller do iFood fica desativado em ambientes novos, a menos que `app.settings.ifood_poller_url` seja configurada explicitamente para o proprio ambiente.
