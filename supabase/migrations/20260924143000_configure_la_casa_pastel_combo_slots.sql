-- Organiza exclusivamente os tres combos da conta gildeonerochas@gmail.com
-- em etapas independentes. O formato usa product_variations porque ele ja e
-- consumido pelo cardapio, PDV, mesas, totem, app garcom e impressao.
do $$
declare
  target_user_id uuid;
  combo_individual_id uuid;
  combo_casal_id uuid;
  combo_familia_id uuid;
  premium_options jsonb;
  special_options jsonb;
  sweet_options jsonb;
  addon_options jsonb;
  can_options jsonb;
  liter_options jsonb;
  special_dough_options jsonb;
begin
  select id
    into target_user_id
  from auth.users
  where lower(email) = 'gildeonerochas@gmail.com'
  limit 1;

  if target_user_id is null then
    raise exception 'Conta gildeonerochas@gmail.com nao encontrada; nenhuma alteracao aplicada.';
  end if;

  select id into combo_individual_id
  from public.products
  where user_id = target_user_id and lower(trim(name)) = 'combo individual'
  limit 1;

  select id into combo_casal_id
  from public.products
  where user_id = target_user_id and lower(trim(name)) = 'combo casal'
  limit 1;

  select id into combo_familia_id
  from public.products
  where user_id = target_user_id and lower(trim(name)) in ('combo família', 'combo familia')
  limit 1;

  if combo_individual_id is null or combo_casal_id is null or combo_familia_id is null then
    raise exception 'Os tres combos da La Casa de Pastel nao foram encontrados; nenhuma alteracao aplicada.';
  end if;

  -- Os sabores sao derivados dos produtos reais. Assim, os nomes ficam com a
  -- mesma ortografia do cardapio e nao e criada nenhuma categoria duplicada.
  select coalesce(
    jsonb_agg(jsonb_build_object('name', p.name, 'price', 0) order by p.name),
    '[]'::jsonb
  ) into premium_options
  from public.products p
  where p.user_id = target_user_id
    and p.available is not false
    and p.category_id = '3e1f966d-1263-41e9-a279-e2dd0d6584c8'::uuid;

  select coalesce(
    jsonb_agg(jsonb_build_object('name', p.name, 'price', 0) order by p.name),
    '[]'::jsonb
  ) into special_options
  from public.products p
  where p.user_id = target_user_id
    and p.available is not false
    and p.category_id = 'e0da1101-ab2e-4f68-8f47-14af3d79448b'::uuid;

  select coalesce(
    jsonb_agg(jsonb_build_object('name', p.name, 'price', 0) order by p.name),
    '[]'::jsonb
  ) into sweet_options
  from public.products p
  where p.user_id = target_user_id
    and p.available is not false
    and p.category_id = 'd3af6c4c-4a03-450b-9384-2a8653a99186'::uuid;

  select case jsonb_typeof(options)
    when 'array' then options
    when 'string' then (options #>> '{}')::jsonb
    else '[]'::jsonb
  end into addon_options
  from public.global_variations
  where user_id = target_user_id and lower(trim(name)) = 'adicionais' and active is not false
  order by updated_at desc
  limit 1;

  select case jsonb_typeof(options)
    when 'array' then options
    when 'string' then (options #>> '{}')::jsonb
    else '[]'::jsonb
  end into can_options
  from public.global_variations
  where user_id = target_user_id and id = '47418955-0c54-4510-b285-e1f964504abe'::uuid
  limit 1;

  select case jsonb_typeof(options)
    when 'array' then options
    when 'string' then (options #>> '{}')::jsonb
    else '[]'::jsonb
  end into liter_options
  from public.global_variations
  where user_id = target_user_id and id = '7672beb7-2995-4602-abee-4344380272d6'::uuid
  limit 1;

  select case jsonb_typeof(options)
    when 'array' then options
    when 'string' then (options #>> '{}')::jsonb
    else '[]'::jsonb
  end into special_dough_options
  from public.global_variations
  where user_id = target_user_id and id = '01fd650f-74d5-4cac-b835-8074250ea36a'::uuid
  limit 1;

  if jsonb_array_length(premium_options) = 0
    or jsonb_array_length(special_options) = 0
    or jsonb_array_length(sweet_options) = 0
    or jsonb_array_length(coalesce(addon_options, '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(can_options, '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(liter_options, '[]'::jsonb)) = 0
    or jsonb_array_length(coalesce(special_dough_options, '[]'::jsonb)) = 0 then
    raise exception 'Uma ou mais fontes dos combos estao vazias; nenhuma alteracao aplicada.';
  end if;

  -- Remove somente os vinculos antigos dos tres combos. Nenhum outro produto,
  -- grupo global ou categoria da loja e alterado.
  delete from public.product_global_variation_links
  where product_id in (combo_individual_id, combo_casal_id, combo_familia_id);

  delete from public.product_variations
  where product_id in (combo_individual_id, combo_casal_id, combo_familia_id);

  -- Combo Individual: 1 pastel Premium, adicionais proprios e 1 lata.
  insert into public.product_variations
    (product_id, user_id, name, customer_label, receipt_label, required, max_selections,
     free_selections_limit, allow_paid_excess, paid_max_selections, active, options, price, display_order)
  values
    (combo_individual_id, target_user_id, 'Sabor do Pastel 1', 'Escolha o sabor do Pastel 1', 'Pastel 1', true, 1,
     0, false, null, true, premium_options, 0, 0),
    (combo_individual_id, target_user_id, 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 1),
    (combo_individual_id, target_user_id, 'Refrigerante do combo', 'Escolha o refrigerante em lata', 'Refrigerante', true, 1,
     0, false, null, true, can_options, 0, 2);

  -- Combo Casal: cada pastel possui seu proprio sabor e seus adicionais.
  insert into public.product_variations
    (product_id, user_id, name, customer_label, receipt_label, required, max_selections,
     free_selections_limit, allow_paid_excess, paid_max_selections, active, options, price, display_order)
  values
    (combo_casal_id, target_user_id, 'Sabor do Pastel 1', 'Escolha o sabor do Pastel 1', 'Pastel 1', true, 1,
     0, false, null, true, premium_options, 0, 0),
    (combo_casal_id, target_user_id, 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 1),
    (combo_casal_id, target_user_id, 'Sabor do Pastel 2', 'Escolha o sabor do Pastel 2', 'Pastel 2', true, 1,
     0, false, null, true, premium_options, 0, 2),
    (combo_casal_id, target_user_id, 'Adicionais do Pastel 2', 'Adicionais do Pastel 2', 'Adicionais do Pastel 2', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 3),
    (combo_casal_id, target_user_id, 'Refrigerante do combo', 'Escolha o refrigerante de 1 L', 'Refrigerante', true, 1,
     0, false, null, true, liter_options, 0, 4);

  -- Combo Familia: massa comum aos especiais, tres pasteis independentes,
  -- pastel doce e refrigerante de 1 L, conforme a descricao atual do produto.
  insert into public.product_variations
    (product_id, user_id, name, customer_label, receipt_label, required, max_selections,
     free_selections_limit, allow_paid_excess, paid_max_selections, active, options, price, display_order)
  values
    (combo_familia_id, target_user_id, 'Massa dos Pastéis Especiais', 'Escolha a massa dos Pastéis Especiais', 'Massa dos Pastéis Especiais', true, 1,
     0, false, null, true, special_dough_options, 0, 0),
    (combo_familia_id, target_user_id, 'Sabor do Pastel 1', 'Escolha o sabor do Pastel 1', 'Pastel 1', true, 1,
     0, false, null, true, special_options, 0, 1),
    (combo_familia_id, target_user_id, 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', 'Adicionais do Pastel 1', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 2),
    (combo_familia_id, target_user_id, 'Sabor do Pastel 2', 'Escolha o sabor do Pastel 2', 'Pastel 2', true, 1,
     0, false, null, true, special_options, 0, 3),
    (combo_familia_id, target_user_id, 'Adicionais do Pastel 2', 'Adicionais do Pastel 2', 'Adicionais do Pastel 2', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 4),
    (combo_familia_id, target_user_id, 'Sabor do Pastel 3', 'Escolha o sabor do Pastel 3', 'Pastel 3', true, 1,
     0, false, null, true, special_options, 0, 5),
    (combo_familia_id, target_user_id, 'Adicionais do Pastel 3', 'Adicionais do Pastel 3', 'Adicionais do Pastel 3', false, jsonb_array_length(addon_options),
     0, false, null, true, addon_options, 0, 6),
    (combo_familia_id, target_user_id, 'Pastel doce', 'Escolha o pastel doce', 'Pastel doce', true, 1,
     0, false, null, true, sweet_options, 0, 7),
    (combo_familia_id, target_user_id, 'Refrigerante do combo', 'Escolha o refrigerante de 1 L', 'Refrigerante', true, 1,
     0, false, null, true, liter_options, 0, 8);

  raise notice 'Combos da La Casa de Pastel configurados: Individual %, Casal %, Familia %.',
    combo_individual_id, combo_casal_id, combo_familia_id;
end
$$;
