-- Reconcilia o schema e os valores usados pelo checkout de assinaturas.
-- Esta migração é idempotente para permitir correção segura de ambientes que
-- receberam apenas parte das migrações comerciais anteriores.
alter table public.subscriptions
  add column if not exists payment_method text;

alter table public.subscriptions
  drop constraint if exists subscriptions_payment_method_check;

alter table public.subscriptions
  add constraint subscriptions_payment_method_check
  check (payment_method is null or payment_method in ('PIX', 'CREDIT_CARD'));

comment on column public.subscriptions.payment_method is
  'Forma de pagamento da assinatura vigente, registrada no checkout do Asaas.';

update public.subscription_plans
set
  price = case id
    when 1 then 189.00
    when 2 then 289.00
    when 3 then 389.00
    else price
  end,
  included_stores = 1,
  extra_store_price = case
    when id = 3 then 189.00
    else 0.00
  end,
  checkout_note = case id
    when 1 then 'R$189,00 por mês. Trimestral com 5%, semestral com 7% e anual com 10% de desconto.'
    when 2 then 'R$289,00 por mês. Trimestral com 5%, semestral com 7% e anual com 10% de desconto.'
    when 3 then 'R$389,00 por mês com uma loja incluída e R$189,00 por loja adicional. Trimestral com 5%, semestral com 7% e anual com 10% de desconto.'
    else checkout_note
  end
where id in (1, 2, 3);

notify pgrst, 'reload schema';
