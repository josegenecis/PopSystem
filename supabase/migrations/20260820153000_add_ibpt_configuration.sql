alter table public.fiscal_settings
  add column if not exists ibpt_enabled boolean not null default false,
  add column if not exists ibpt_token text;

comment on column public.fiscal_settings.ibpt_enabled is
  'Habilita a consulta oficial da API De Olho no Imposto/IBPT para a Lei 12.741/2012.';
comment on column public.fiscal_settings.ibpt_token is
  'Token da empresa emitente na API De Olho no Imposto/IBPT. Não é exposto no XML.';

-- Fotografia imutável da consulta usada em cada item. Além de permitir a
-- reimpressão fiel, evita que uma atualização posterior da tabela IBPT altere
-- os valores de um documento já emitido.
alter table public.nfce_items
  add column if not exists valor_tributos_aproximados numeric(13,2) not null default 0,
  add column if not exists ibpt_data jsonb not null default '{}'::jsonb;

alter table public.nfce_items
  drop constraint if exists nfce_items_ibpt_data_object,
  add constraint nfce_items_ibpt_data_object check (
    jsonb_typeof(ibpt_data) = 'object'
  );

comment on column public.nfce_items.valor_tributos_aproximados is
  'Total aproximado de tributos do item calculado com a tabela IBPT vigente na emissão.';
comment on column public.nfce_items.ibpt_data is
  'Snapshot da resposta IBPT: percentuais, valores, fonte, versão, chave e vigência.';

notify pgrst, 'reload schema';
