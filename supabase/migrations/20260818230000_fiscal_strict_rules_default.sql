-- Novas configuracoes fiscais nascem em modo estrito. Em producao a Edge
-- Function tambem forca esta regra, mesmo para lojas antigas que ainda tenham
-- o valor false: tributacao de fallback nunca deve ser transmitida a SEFAZ.

alter table public.fiscal_settings
  alter column require_approved_fiscal_rules set default true;

comment on column public.fiscal_settings.require_approved_fiscal_rules is
  'Bloqueia a emissao quando algum item nao encontra exatamente uma regra fiscal vigente e aprovada. Em producao esta protecao e obrigatoria independentemente do valor armazenado.';
