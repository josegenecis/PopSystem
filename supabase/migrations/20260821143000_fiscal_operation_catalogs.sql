-- Catalogos e validacoes das operacoes fiscais (homologacao).
-- A origem da operacao sempre vem do emitente. NCM e CEST continuam no produto.

create table if not exists public.fiscal_cfop_catalog (
  code text primary key check (code ~ '^[567][0-9]{3}$'),
  description text not null,
  operation_destination smallint not null check (operation_destination in (1, 2, 3)),
  active boolean not null default true,
  legal_source text not null,
  effective_from date not null
);

comment on table public.fiscal_cfop_catalog is
  'Catalogo versionavel de CFOPs de saida usados nas operacoes fiscais.';

alter table public.fiscal_cfop_catalog enable row level security;
drop policy if exists fiscal_cfop_catalog_read on public.fiscal_cfop_catalog;
create policy fiscal_cfop_catalog_read on public.fiscal_cfop_catalog
  for select to authenticated using (active);

insert into public.fiscal_cfop_catalog
  (code, description, operation_destination, legal_source, effective_from)
values
  ('5101', 'Venda de producao do estabelecimento', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5102', 'Venda de mercadoria adquirida ou recebida de terceiros', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5103', 'Venda de producao do estabelecimento efetuada fora do estabelecimento', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5104', 'Venda de mercadoria adquirida ou recebida de terceiros efetuada fora do estabelecimento', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5105', 'Venda de producao do estabelecimento que nao deva por ele transitar', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5106', 'Venda de mercadoria adquirida ou recebida de terceiros que nao deva por ele transitar', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5109', 'Venda de producao destinada a Zona Franca de Manaus ou Areas de Livre Comercio', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5110', 'Venda de mercadoria de terceiros destinada a Zona Franca de Manaus ou Areas de Livre Comercio', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5116', 'Venda de producao originada de encomenda para entrega futura', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5117', 'Venda de mercadoria de terceiros originada de encomenda para entrega futura', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5151', 'Transferencia de producao do estabelecimento', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5152', 'Transferencia de mercadoria adquirida ou recebida de terceiros', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5201', 'Devolucao de compra para industrializacao ou producao rural', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5202', 'Devolucao de compra para comercializacao', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5401', 'Venda de producao sujeita a substituicao tributaria', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5402', 'Venda de producao sujeita a substituicao tributaria como substituto', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5403', 'Venda de mercadoria de terceiros sujeita a substituicao tributaria como substituto', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5405', 'Venda de mercadoria sujeita a substituicao tributaria como substituido', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5551', 'Venda de bem do ativo imobilizado', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5901', 'Remessa para industrializacao por encomenda', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5902', 'Retorno de mercadoria utilizada na industrializacao por encomenda', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5904', 'Remessa para venda fora do estabelecimento', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5905', 'Remessa para deposito fechado ou armazem geral', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5910', 'Remessa em bonificacao, doacao ou brinde', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5911', 'Remessa de amostra gratis', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5912', 'Remessa para demonstracao ou mostruario', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5922', 'Lancamento a titulo de simples faturamento decorrente de venda para entrega futura', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5929', 'Lancamento relativo a operacao registrada em equipamento emissor de cupom fiscal', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('5949', 'Outra saida de mercadoria ou prestacao de servico nao especificada', 1, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6101', 'Venda de producao do estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6102', 'Venda de mercadoria adquirida ou recebida de terceiros', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6103', 'Venda de producao efetuada fora do estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6104', 'Venda de mercadoria de terceiros efetuada fora do estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6105', 'Venda de producao que nao deva transitar pelo estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6106', 'Venda de mercadoria de terceiros que nao deva transitar pelo estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6107', 'Venda de producao a nao contribuinte', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6108', 'Venda de mercadoria de terceiros a nao contribuinte', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6109', 'Venda de producao destinada a Zona Franca de Manaus ou Areas de Livre Comercio', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6110', 'Venda de mercadoria de terceiros destinada a Zona Franca de Manaus ou Areas de Livre Comercio', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6116', 'Venda de producao originada de encomenda para entrega futura', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6117', 'Venda de mercadoria de terceiros originada de encomenda para entrega futura', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6151', 'Transferencia de producao do estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6152', 'Transferencia de mercadoria adquirida ou recebida de terceiros', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6201', 'Devolucao de compra para industrializacao ou producao rural', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6202', 'Devolucao de compra para comercializacao', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6401', 'Venda de producao sujeita a substituicao tributaria como substituto', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6402', 'Venda de producao sujeita a substituicao tributaria como substituto', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6403', 'Venda de mercadoria de terceiros sujeita a substituicao tributaria como substituto', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6404', 'Venda de mercadoria sujeita a substituicao tributaria como substituido', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6551', 'Venda de bem do ativo imobilizado', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6901', 'Remessa para industrializacao por encomenda', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6902', 'Retorno de mercadoria utilizada na industrializacao por encomenda', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6904', 'Remessa para venda fora do estabelecimento', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6905', 'Remessa para deposito fechado ou armazem geral', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6910', 'Remessa em bonificacao, doacao ou brinde', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6911', 'Remessa de amostra gratis', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6912', 'Remessa para demonstracao ou mostruario', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6922', 'Lancamento a titulo de simples faturamento decorrente de venda para entrega futura', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6929', 'Lancamento relativo a operacao registrada em equipamento emissor de cupom fiscal', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('6949', 'Outra saida de mercadoria ou prestacao de servico nao especificada', 2, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7101', 'Venda de producao do estabelecimento', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7102', 'Venda de mercadoria adquirida ou recebida de terceiros', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7105', 'Venda de producao que nao deva transitar pelo estabelecimento', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7106', 'Venda de mercadoria de terceiros que nao deva transitar pelo estabelecimento', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7127', 'Venda de producao sob regime de drawback', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7151', 'Transferencia de producao do estabelecimento', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7152', 'Transferencia de mercadoria adquirida ou recebida de terceiros', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7201', 'Devolucao de compra para industrializacao ou producao rural', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7202', 'Devolucao de compra para comercializacao', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7501', 'Exportacao de mercadoria recebida com fim especifico de exportacao', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7551', 'Venda de bem do ativo imobilizado', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7901', 'Remessa para industrializacao por encomenda', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24'),
  ('7949', 'Outra saida de mercadoria ou prestacao de servico nao especificada', 3, 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=/NJarYc9nus=', '2023-04-24')
on conflict (code) do update set
  description = excluded.description,
  operation_destination = excluded.operation_destination,
  active = true,
  legal_source = excluded.legal_source,
  effective_from = excluded.effective_from;

alter table public.fiscal_tax_rules
  drop constraint if exists fiscal_tax_rules_origin_uf_catalog,
  add constraint fiscal_tax_rules_origin_uf_catalog check (
    origin_uf is null or origin_uf = any(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
  ) not valid,
  drop constraint if exists fiscal_tax_rules_destination_uf_catalog,
  add constraint fiscal_tax_rules_destination_uf_catalog check (
    destination_uf is null or destination_uf = 'EX' or destination_uf = any(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
  ) not valid,
  drop constraint if exists fiscal_tax_rules_presence_catalog,
  add constraint fiscal_tax_rules_presence_catalog check (
    presence_indicator is null or presence_indicator in (0, 1, 2, 3, 4, 5, 9)
  ) not valid,
  drop constraint if exists fiscal_tax_rules_operation_classification_only,
  add constraint fiscal_tax_rules_operation_classification_only check (
    product_id is null and ncm_prefix is null and cest is null
  ) not valid,
  drop constraint if exists fiscal_tax_rules_pis_cst_catalog,
  add constraint fiscal_tax_rules_pis_cst_catalog check (
    pis_cst is null or pis_cst = any(array['01','02','03','04','05','06','07','08','09','49','50','51','52','53','54','55','56','60','61','62','63','64','65','66','67','70','71','72','73','74','75','98','99'])
  ) not valid,
  drop constraint if exists fiscal_tax_rules_cofins_cst_catalog,
  add constraint fiscal_tax_rules_cofins_cst_catalog check (
    cofins_cst is null or cofins_cst = any(array['01','02','03','04','05','06','07','08','09','49','50','51','52','53','54','55','56','60','61','62','63','64','65','66','67','70','71','72','73','74','75','98','99'])
  ) not valid,
  drop constraint if exists fiscal_tax_rules_ipi_cst_catalog,
  add constraint fiscal_tax_rules_ipi_cst_catalog check (
    ipi_cst is null or ipi_cst = any(array['00','01','02','03','04','05','49','50','51','52','53','54','55','99'])
  ) not valid;

alter table public.fiscal_tax_rules
  drop constraint if exists fiscal_tax_rules_cfop_catalog_fk,
  add constraint fiscal_tax_rules_cfop_catalog_fk foreign key (cfop)
    references public.fiscal_cfop_catalog(code) not valid;

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
  v_issuer_uf text;
  v_rate_text text;
  v_rate numeric;
  v_rtc_mode text;
  v_is_enabled boolean;
  v_rtc_nt_version text;
  v_rtc_table_version text;
begin
  if auth.uid() is null then raise exception 'Usuario nao autenticado'; end if;

  select * into v_rule from public.fiscal_tax_rules where id = p_rule_id for update;
  if not found or not public.can_access_store(v_rule.user_id) then
    raise exception 'Operacao fiscal nao encontrada ou sem permissao';
  end if;

  select ambiente, upper(trim(endereco_uf)) into v_environment, v_issuer_uf
  from public.fiscal_settings where user_id = v_rule.user_id;
  if coalesce(v_environment, '') <> 'homologacao' then
    raise exception 'Este fluxo de aprovacao e exclusivo do ambiente de homologacao';
  end if;
  if v_issuer_uf is null or not (v_issuer_uf = any(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])) then
    raise exception 'Cadastre uma UF valida no emitente antes de aprovar a operacao';
  end if;
  if v_rule.product_id is not null or v_rule.ncm_prefix is not null or v_rule.cest is not null then
    raise exception 'Produto, NCM e CEST nao pertencem a operacao fiscal';
  end if;
  if v_rule.operation_type is distinct from 'sale' then
    raise exception 'Nesta versao, somente operacoes de venda podem ser aprovadas';
  end if;
  if v_rule.operation_destination not in (1, 2, 3) then
    raise exception 'Informe se a operacao e interna, interestadual ou exterior';
  end if;
  if v_rule.operation_destination = 1 and v_rule.destination_uf is distinct from v_issuer_uf then
    raise exception 'Operacao interna deve usar a UF do emitente como destino';
  elsif v_rule.operation_destination = 2 and (
    v_rule.destination_uf is null or v_rule.destination_uf = v_issuer_uf or
    not (v_rule.destination_uf = any(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']))
  ) then
    raise exception 'Operacao interestadual exige uma UF de destino valida e diferente da origem';
  elsif v_rule.operation_destination = 3 and v_rule.destination_uf is distinct from 'EX' then
    raise exception 'Operacao exterior deve usar EX como destino';
  end if;
  if v_rule.presence_indicator is null
    or v_rule.presence_indicator not in (0, 1, 2, 3, 4, 5, 9) then
    raise exception 'Indicador de presenca invalido';
  end if;
  if v_rule.product_origin is null
    or v_rule.product_origin not between 0 and 8 then
    raise exception 'Origem do produto invalida';
  end if;
  if length(trim(coalesce(p_responsible, ''))) < 3 then
    raise exception 'Informe o responsavel pela validacao fiscal';
  end if;
  if not exists (
    select 1 from public.fiscal_cfop_catalog c
    where c.code = v_rule.cfop and c.active and c.operation_destination = v_rule.operation_destination
  ) then
    raise exception 'CFOP inexistente ou incompatível com o destino da operacao';
  end if;
  if nullif(trim(v_rule.legal_basis), '') is null then
    raise exception 'Informe a fundamentacao legal da operacao';
  end if;
  if cardinality(v_rule.issuer_crt) <> 1 then
    raise exception 'A operacao deve pertencer a um unico regime tributario';
  end if;
  if v_rule.issuer_crt[1] = 1 and not (v_rule.icms_code = any(array['101','102','103','201','202','203','300','400','500','900'])) then
    raise exception 'CSOSN invalido para o Simples Nacional';
  end if;
  if v_rule.issuer_crt[1] in (2, 3) and not (v_rule.icms_code = any(array['00','10','20','30','40','41','50','51','60','70','90'])) then
    raise exception 'CST ICMS invalido para o regime informado';
  end if;
  if v_rule.pis_cst is null or not (v_rule.pis_cst = any(array['01','02','03','04','05','06','07','08','09','49','50','51','52','53','54','55','56','60','61','62','63','64','65','66','67','70','71','72','73','74','75','98','99'])) then
    raise exception 'CST PIS invalido';
  end if;
  if v_rule.cofins_cst is null or not (v_rule.cofins_cst = any(array['01','02','03','04','05','06','07','08','09','49','50','51','52','53','54','55','56','60','61','62','63','64','65','66','67','70','71','72','73','74','75','98','99'])) then
    raise exception 'CST COFINS invalido';
  end if;
  if v_rule.ipi_cst is not null and not (v_rule.ipi_cst = any(array['00','01','02','03','04','05','49','50','51','52','53','54','55','99'])) then
    raise exception 'CST IPI invalido';
  end if;

  if v_rule.operation_destination = 2 then
    v_rate_text := v_rule.icms_config #>> '{difal,internalRate}';
    if coalesce(v_rate_text, '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Informe a aliquota interna do ICMS da UF de destino';
    end if;
    v_rate := v_rate_text::numeric;
    if v_rate <= 0 or v_rate > 100 then raise exception 'Aliquota interna da UF de destino invalida'; end if;
  end if;

  v_rtc_mode := coalesce(v_rule.ibs_cbs_config->>'mode', 'none');
  if v_rtc_mode <> 'none' then
    if v_rule.ibs_cbs_cst is null or v_rule.cclass_trib is null then
      raise exception 'IBS/CBS exige CST e cClassTrib';
    end if;
    select c.nt_version, c.table_version into v_rtc_nt_version, v_rtc_table_version
    from public.fiscal_rtc_classifications c
    where c.tax_kind = 'IBS_CBS' and c.cst = v_rule.ibs_cbs_cst
      and c.cclass_trib = v_rule.cclass_trib and c.active
      and c.valid_from <= current_date and (c.valid_until is null or c.valid_until >= current_date)
    order by c.valid_from desc, c.imported_at desc limit 1;
    if not found then raise exception 'CST/cClassTrib de IBS/CBS nao consta na tabela oficial vigente'; end if;
  end if;

  v_is_enabled := lower(coalesce(v_rule.is_config->>'enabled', 'false')) in ('true', '1', 'yes', 'on');
  if v_is_enabled then
    if v_rule.is_cst is null or v_rule.is_cclass_trib is null then
      raise exception 'Imposto Seletivo exige CST e cClassTrib';
    end if;
    if not exists (
      select 1 from public.fiscal_rtc_classifications c
      where c.tax_kind = 'IS' and c.cst = v_rule.is_cst and c.cclass_trib = v_rule.is_cclass_trib
        and c.active and c.valid_from <= current_date and (c.valid_until is null or c.valid_until >= current_date)
    ) then raise exception 'CST/cClassTrib do Imposto Seletivo nao consta na tabela oficial vigente'; end if;
  end if;

  perform set_config('app.fiscal_approval_flow', 'authorized', true);
  update public.fiscal_tax_rules
  set origin_uf = v_issuer_uf,
      rtc_source_version = case when v_rtc_mode <> 'none' then v_rtc_nt_version else null end,
      rtc_table_version = case when v_rtc_mode <> 'none' then v_rtc_table_version else null end,
      accountant_approved_at = now(), accountant_approved_by = trim(p_responsible),
      active = true, updated_at = now()
  where id = p_rule_id returning * into v_rule;

  update public.fiscal_settings set require_approved_fiscal_rules = true, updated_at = now()
  where user_id = v_rule.user_id;
  return v_rule;
end;
$$;

revoke all on function public.approve_fiscal_tax_rule_homologation(uuid, text) from public;
grant execute on function public.approve_fiscal_tax_rule_homologation(uuid, text) to authenticated, service_role;

-- A assinatura antiga e mantida para compatibilidade, mas produto, NCM e CEST
-- nao participam da resolucao da operacao.
create or replace function public.resolve_fiscal_tax_rule(
  p_user_id uuid, p_model_code text, p_issuer_crt smallint, p_operation_type text,
  p_operation_destination smallint, p_origin_uf text, p_destination_uf text,
  p_recipient_ie_indicator smallint, p_final_consumer boolean,
  p_presence_indicator smallint, p_product_id uuid, p_ncm text, p_cest text,
  p_product_origin smallint, p_operation_date date default current_date
) returns setof public.fiscal_tax_rules
language sql stable security definer set search_path = public
as $$
  select rule.* from public.fiscal_tax_rules rule
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
  order by (rule.recipient_ie_indicator is not null) desc,
    (rule.presence_indicator is not null) desc, rule.priority asc, rule.id asc
  limit 2;
$$;

revoke all on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) from public;
grant execute on function public.resolve_fiscal_tax_rule(uuid, text, smallint, text, smallint, text, text, smallint, boolean, smallint, uuid, text, text, smallint, date) to authenticated, service_role;

notify pgrst, 'reload schema';
