-- Preserva o rateio de frete usado para montar e reconstruir o XML fiscal.
-- O motor inclui valor_frete no snapshot de cada item; sem esta coluna o
-- PostgREST rejeita todo o lote antes da transmissao para a SEFAZ.
alter table public.nfce_items
  add column if not exists valor_frete numeric(15, 2) not null default 0;

alter table public.nfce_items
  drop constraint if exists nfce_items_valor_frete_nonnegative,
  add constraint nfce_items_valor_frete_nonnegative
    check (valor_frete >= 0);

comment on column public.nfce_items.valor_frete is
  'Parcela do frete rateada para o item e preservada no snapshot da NF-e/NFC-e.';

notify pgrst, 'reload schema';
