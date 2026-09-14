-- As aliquotas fiscais sao persistidas como percentuais inteiros (por exemplo,
-- 20 para 20%). numeric(5,4) aceita no maximo 9,9999 e causava overflow ao
-- criar o item da NFC-e para aliquotas brasileiras perfeitamente validas.

alter table public.nfce_items
  alter column aliquota_icms type numeric(7,4)
    using aliquota_icms::numeric(7,4),
  alter column aliquota_pis type numeric(7,4)
    using aliquota_pis::numeric(7,4),
  alter column aliquota_cofins type numeric(7,4)
    using aliquota_cofins::numeric(7,4);

comment on column public.nfce_items.aliquota_icms is
  'Aliquota percentual de ICMS do item, com suporte a valores de 0 a 100.';
comment on column public.nfce_items.aliquota_pis is
  'Aliquota percentual de PIS do item, com suporte a valores de 0 a 100.';
comment on column public.nfce_items.aliquota_cofins is
  'Aliquota percentual de COFINS do item, com suporte a valores de 0 a 100.';
