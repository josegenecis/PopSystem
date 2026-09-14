-- Preserva os parâmetros efetivamente usados no cálculo do PIS/COFINS.
-- O snapshot impede que uma alteração futura na regra fiscal modifique a
-- explicação/auditoria de um documento já emitido.

alter table public.nfce_items
  add column if not exists pis_config jsonb not null default '{}'::jsonb,
  add column if not exists cofins_config jsonb not null default '{}'::jsonb;

alter table public.nfce_items
  drop constraint if exists nfce_items_pis_config_object,
  add constraint nfce_items_pis_config_object
    check (jsonb_typeof(pis_config) = 'object'),
  drop constraint if exists nfce_items_cofins_config_object,
  add constraint nfce_items_cofins_config_object
    check (jsonb_typeof(cofins_config) = 'object');

comment on column public.nfce_items.pis_config is
  'Snapshot imutável da base, alíquota e modalidade de cálculo do PIS usados no XML.';
comment on column public.nfce_items.cofins_config is
  'Snapshot imutável da base, alíquota e modalidade de cálculo da COFINS usados no XML.';
