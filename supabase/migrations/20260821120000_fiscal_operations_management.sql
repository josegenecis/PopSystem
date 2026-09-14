-- Cadastro central de operacoes fiscais.
-- O produto conserva somente a classificacao (NCM, CEST, origem e unidade).
-- CFOP, ICMS, PIS, COFINS, IPI e RTC pertencem exclusivamente a uma regra
-- operacional versionada e aprovada.

comment on column public.fiscal_tax_rules.product_id is
  'Campo legado. Regras operacionais aprovadas devem ser globais e usar somente classificadores (NCM/CEST/origem), nunca o id do produto.';

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

  if auth.role() = 'authenticated' and not approval_flow then
    if tg_op = 'INSERT' and (
      new.accountant_approved_at is not null or new.accountant_approved_by is not null
    ) then
      raise exception 'A aprovacao fiscal deve ser registrada pelo fluxo autorizado';
    end if;
    if tg_op = 'UPDATE' and (
      new.accountant_approved_at is distinct from old.accountant_approved_at or
      new.accountant_approved_by is distinct from old.accountant_approved_by
    ) then
      raise exception 'A aprovacao fiscal deve ser registrada pelo fluxo autorizado';
    end if;
    if tg_op = 'UPDATE' and old.accountant_approved_at is not null and material_change then
      raise exception 'Operacao fiscal aprovada e imutavel; clone a regra para criar uma nova versao';
    end if;
  elsif tg_op = 'UPDATE' and old.accountant_approved_at is not null and material_change and not approval_flow then
    new.accountant_approved_at := null;
    new.accountant_approved_by := null;
    new.active := false;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.approve_fiscal_tax_rule_homologation(
  p_rule_id uuid,
  p_responsible text
) returns public.fiscal_tax_rules
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.fiscal_tax_rules;
  v_environment text;
  v_rtc_mode text;
  v_is_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  select * into v_rule
  from public.fiscal_tax_rules
  where id = p_rule_id
  for update;

  if not found or not public.can_access_store(v_rule.user_id) then
    raise exception 'Operacao fiscal nao encontrada ou sem permissao';
  end if;

  select ambiente into v_environment
  from public.fiscal_settings
  where user_id = v_rule.user_id;

  if coalesce(v_environment, '') <> 'homologacao' then
    raise exception 'Este fluxo de aprovacao e exclusivo do ambiente de homologacao';
  end if;
  if v_rule.product_id is not null then
    raise exception 'Remova o produto da regra: a tributacao deve pertencer a operacao';
  end if;
  if v_rule.operation_type is distinct from 'sale' then
    raise exception 'Nesta versao, somente operacoes de venda podem ser aprovadas e emitidas';
  end if;
  if v_rule.operation_destination not in (1, 2, 3) then
    raise exception 'Informe se a operacao e interna, interestadual ou exterior';
  end if;
  if length(trim(coalesce(p_responsible, ''))) < 3 then
    raise exception 'Informe o responsavel pela validacao fiscal';
  end if;
  if v_rule.cfop !~ '^[567][0-9]{3}$' then
    raise exception 'CFOP invalido para operacao de saida';
  end if;
  if (v_rule.operation_destination = 1 and left(v_rule.cfop, 1) <> '5')
    or (v_rule.operation_destination = 2 and left(v_rule.cfop, 1) <> '6')
    or (v_rule.operation_destination = 3 and left(v_rule.cfop, 1) <> '7') then
    raise exception 'CFOP incompatível com o destino da operação';
  end if;
  if nullif(trim(v_rule.legal_basis), '') is null then
    raise exception 'Informe a fundamentacao legal da operacao';
  end if;
  if v_rule.pis_cst is null or v_rule.cofins_cst is null then
    raise exception 'PIS e COFINS devem estar definidos na operacao';
  end if;
  if 1 = any(v_rule.issuer_crt) and v_rule.icms_code !~ '^[0-9]{3}$' then
    raise exception 'Operacao do Simples Nacional exige CSOSN';
  end if;
  if (2 = any(v_rule.issuer_crt) or 3 = any(v_rule.issuer_crt)) and v_rule.icms_code !~ '^[0-9]{2}$' then
    raise exception 'Operacao do regime normal/excesso de sublimite exige CST ICMS';
  end if;

  v_rtc_mode := coalesce(v_rule.ibs_cbs_config->>'mode', 'none');
  if v_rtc_mode <> 'none' and (
    v_rule.ibs_cbs_cst is null or v_rule.cclass_trib is null or
    v_rule.rtc_source_version is null or v_rule.rtc_table_version is null
  ) then
    raise exception 'IBS/CBS exige CST, cClassTrib e versoes oficiais da regra';
  end if;

  v_is_enabled := lower(coalesce(v_rule.is_config->>'enabled', 'false')) in ('true', '1', 'yes', 'on');
  if v_is_enabled and (v_rule.is_cst is null or v_rule.is_cclass_trib is null) then
    raise exception 'Imposto Seletivo exige CST e cClassTrib na operacao';
  end if;

  perform set_config('app.fiscal_approval_flow', 'authorized', true);
  update public.fiscal_tax_rules
  set accountant_approved_at = now(),
      accountant_approved_by = trim(p_responsible),
      active = true,
      updated_at = now()
  where id = p_rule_id
  returning * into v_rule;

  update public.fiscal_settings
  set require_approved_fiscal_rules = true,
      updated_at = now()
  where user_id = v_rule.user_id;

  return v_rule;
end;
$$;

revoke all on function public.approve_fiscal_tax_rule_homologation(uuid, text) from public;
grant execute on function public.approve_fiscal_tax_rule_homologation(uuid, text) to authenticated, service_role;

-- Mantem p_product_id na assinatura por compatibilidade com clientes antigos,
-- mas o valor nao participa da resolucao: a operacao nunca e por produto.
create or replace function public.resolve_fiscal_tax_rule(
  p_user_id uuid,
  p_model_code text,
  p_issuer_crt smallint,
  p_operation_type text,
  p_operation_destination smallint,
  p_origin_uf text,
  p_destination_uf text,
  p_recipient_ie_indicator smallint,
  p_final_consumer boolean,
  p_presence_indicator smallint,
  p_product_id uuid,
  p_ncm text,
  p_cest text,
  p_product_origin smallint,
  p_operation_date date default current_date
) returns setof public.fiscal_tax_rules
language sql stable security definer
set search_path = public
as $$
  select rule.*
  from public.fiscal_tax_rules rule
  where rule.user_id = p_user_id
    and public.can_access_store(p_user_id)
    and rule.product_id is null
    and rule.active
    and rule.accountant_approved_at is not null
    and p_model_code = any(rule.model_codes)
    and p_issuer_crt = any(rule.issuer_crt)
    and rule.operation_type = p_operation_type
    and (rule.operation_destination is null or rule.operation_destination = p_operation_destination)
    and (rule.origin_uf is null or rule.origin_uf = p_origin_uf)
    and (rule.destination_uf is null or rule.destination_uf = p_destination_uf)
    and (rule.recipient_ie_indicator is null or rule.recipient_ie_indicator = p_recipient_ie_indicator)
    and (rule.final_consumer is null or rule.final_consumer = p_final_consumer)
    and (rule.presence_indicator is null or rule.presence_indicator = p_presence_indicator)
    and (rule.ncm_prefix is null or coalesce(p_ncm, '') like rule.ncm_prefix || '%')
    and (rule.cest is null or rule.cest = p_cest)
    and (rule.product_origin is null or rule.product_origin = p_product_origin)
    and rule.valid_from <= p_operation_date
    and (rule.valid_until is null or rule.valid_until >= p_operation_date)
  order by
    length(coalesce(rule.ncm_prefix, '')) desc,
    (rule.cest is not null) desc,
    (rule.destination_uf is not null) desc,
    (rule.operation_destination is not null) desc,
    (rule.recipient_ie_indicator is not null) desc,
    (rule.presence_indicator is not null) desc,
    rule.priority asc,
    rule.id asc
  limit 2;
$$;

revoke all on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) from public;
grant execute on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) to authenticated, service_role;

notify pgrst, 'reload schema';
