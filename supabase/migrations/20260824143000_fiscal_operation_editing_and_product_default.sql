-- Usabilidade da matriz fiscal em homologacao:
-- 1. uma operacao aprovada pode ser reaberta para edicao, sempre perdendo a
--    aprovacao anterior e voltando a rascunho;
-- 2. o produto pode indicar qual operacao fiscal deve ser priorizada no PDV.

alter table public.products
  add column if not exists fiscal_default_operation_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_fiscal_default_operation_fk'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_fiscal_default_operation_fk
      foreign key (fiscal_default_operation_id)
      references public.fiscal_tax_rules(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists products_fiscal_default_operation_idx
  on public.products(user_id, fiscal_default_operation_id)
  where fiscal_default_operation_id is not null;

comment on column public.products.fiscal_default_operation_id is
  'Operacao fiscal aprovada priorizada para o produto no PDV, desde que seja compativel com o contexto da venda.';

create or replace function public.validate_product_default_fiscal_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_store_id uuid;
begin
  if new.fiscal_default_operation_id is null then
    return new;
  end if;

  select user_id into v_operation_store_id
  from public.fiscal_tax_rules
  where id = new.fiscal_default_operation_id;

  if not found then
    raise exception 'Operacao fiscal padrao nao encontrada';
  end if;
  if v_operation_store_id is distinct from new.user_id then
    raise exception 'A operacao fiscal padrao deve pertencer a mesma loja do produto';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_product_default_fiscal_operation_trigger on public.products;
create trigger validate_product_default_fiscal_operation_trigger
before insert or update of user_id, fiscal_default_operation_id on public.products
for each row execute function public.validate_product_default_fiscal_operation();

create or replace function public.protect_fiscal_rule_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  material_change boolean := false;
  approval_flow boolean := coalesce(current_setting('app.fiscal_approval_flow', true), '') = 'authorized';
begin
  if new.accountant_approved_at is not null and new.product_id is not null then
    raise exception 'Uma operacao fiscal aprovada nao pode ser vinculada a um produto especifico';
  end if;

  if tg_op = 'UPDATE' then
    material_change :=
      new.user_id is distinct from old.user_id or
      new.name is distinct from old.name or
      new.active is distinct from old.active or
      new.priority is distinct from old.priority or
      new.valid_from is distinct from old.valid_from or
      new.valid_until is distinct from old.valid_until or
      new.model_codes is distinct from old.model_codes or
      new.issuer_crt is distinct from old.issuer_crt or
      new.operation_type is distinct from old.operation_type or
      new.operation_destination is distinct from old.operation_destination or
      new.origin_uf is distinct from old.origin_uf or
      new.destination_uf is distinct from old.destination_uf or
      new.recipient_ie_indicator is distinct from old.recipient_ie_indicator or
      new.final_consumer is distinct from old.final_consumer or
      new.presence_indicator is distinct from old.presence_indicator or
      new.product_id is distinct from old.product_id or
      new.ncm_prefix is distinct from old.ncm_prefix or
      new.cest is distinct from old.cest or
      new.product_origin is distinct from old.product_origin or
      new.cfop is distinct from old.cfop or
      new.icms_code is distinct from old.icms_code or
      new.icms_config is distinct from old.icms_config or
      new.pis_cst is distinct from old.pis_cst or
      new.pis_config is distinct from old.pis_config or
      new.cofins_cst is distinct from old.cofins_cst or
      new.cofins_config is distinct from old.cofins_config or
      new.ipi_cst is distinct from old.ipi_cst or
      new.ipi_config is distinct from old.ipi_config or
      new.ibs_cbs_cst is distinct from old.ibs_cbs_cst or
      new.cclass_trib is distinct from old.cclass_trib or
      new.ibs_cbs_config is distinct from old.ibs_cbs_config or
      new.is_cst is distinct from old.is_cst or
      new.is_cclass_trib is distinct from old.is_cclass_trib or
      new.is_config is distinct from old.is_config or
      new.benefit_code is distinct from old.benefit_code or
      new.legal_basis is distinct from old.legal_basis or
      new.rtc_source_version is distinct from old.rtc_source_version or
      new.rtc_table_version is distinct from old.rtc_table_version;
  end if;

  if not approval_flow then
    if tg_op = 'INSERT' and (
      new.accountant_approved_at is not null or new.accountant_approved_by is not null
    ) then
      raise exception 'A aprovacao fiscal deve ser registrada pelo fluxo autorizado';
    end if;

    if tg_op = 'UPDATE' and old.accountant_approved_at is not null and material_change then
      new.accountant_approved_at := null;
      new.accountant_approved_by := null;
      new.rtc_source_version := null;
      new.rtc_table_version := null;
      new.active := false;
    elsif tg_op = 'UPDATE' and auth.role() = 'authenticated' and (
      new.accountant_approved_at is distinct from old.accountant_approved_at or
      new.accountant_approved_by is distinct from old.accountant_approved_by
    ) then
      raise exception 'A aprovacao fiscal deve ser registrada pelo fluxo autorizado';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- A assinatura permanece compativel. O vinculo do produto serve somente como
-- criterio de prioridade e nunca ignora destino, modelo, regime ou vigencia.
create or replace function public.resolve_fiscal_tax_rule(
  p_user_id uuid, p_model_code text, p_issuer_crt smallint, p_operation_type text,
  p_operation_destination smallint, p_origin_uf text, p_destination_uf text,
  p_recipient_ie_indicator smallint, p_final_consumer boolean,
  p_presence_indicator smallint, p_product_id uuid, p_ncm text, p_cest text,
  p_product_origin smallint, p_operation_date date default current_date
) returns setof public.fiscal_tax_rules
language sql stable security definer set search_path = public
as $$
  select rule.*
  from public.fiscal_tax_rules rule
  left join public.products product
    on product.id = p_product_id and product.user_id = p_user_id
  where rule.user_id = p_user_id and public.can_access_store(p_user_id)
    and rule.product_id is null and rule.ncm_prefix is null and rule.cest is null
    and rule.active and rule.accountant_approved_at is not null
    and p_model_code = any(rule.model_codes) and p_issuer_crt = any(rule.issuer_crt)
    and rule.operation_type = p_operation_type
    and rule.operation_destination = p_operation_destination
    and rule.origin_uf = p_origin_uf and rule.destination_uf = p_destination_uf
    and (rule.recipient_ie_indicator is null or rule.recipient_ie_indicator = p_recipient_ie_indicator)
    and (rule.final_consumer is null or rule.final_consumer = p_final_consumer)
    and (rule.presence_indicator is null or rule.presence_indicator = p_presence_indicator)
    and (rule.product_origin is null or rule.product_origin = p_product_origin)
    and rule.valid_from <= p_operation_date
    and (rule.valid_until is null or rule.valid_until >= p_operation_date)
  order by (rule.id = product.fiscal_default_operation_id) desc,
    (rule.recipient_ie_indicator is not null) desc,
    (rule.presence_indicator is not null) desc, rule.priority asc, rule.id asc
  limit 2;
$$;

revoke all on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) from public;
grant execute on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) to authenticated, service_role;

notify pgrst, 'reload schema';
