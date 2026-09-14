-- Preserva exatamente o IPI aprovado e enviado em cada item fiscal.
-- O DIFAL permanece dentro de icms_config, que já é um snapshot JSONB.
alter table public.nfce_items
  add column if not exists ipi_cst text,
  add column if not exists ipi_config jsonb not null default '{}'::jsonb,
  add column if not exists valor_ipi numeric(13,2) not null default 0;

alter table public.nfce_items
  drop constraint if exists nfce_items_ipi_cst_format,
  add constraint nfce_items_ipi_cst_format
    check (ipi_cst is null or ipi_cst ~ '^[0-9]{2}$'),
  drop constraint if exists nfce_items_ipi_config_object,
  add constraint nfce_items_ipi_config_object
    check (jsonb_typeof(ipi_config) = 'object'),
  drop constraint if exists nfce_items_valor_ipi_nonnegative,
  add constraint nfce_items_valor_ipi_nonnegative
    check (valor_ipi >= 0);

comment on column public.nfce_items.ipi_cst is
  'CST do IPI efetivamente usado no XML autorizado.';
comment on column public.nfce_items.ipi_config is
  'Snapshot dos parâmetros do IPI da regra fiscal aprovada.';
comment on column public.nfce_items.valor_ipi is
  'Valor do IPI calculado para o item e totalizado no documento.';
