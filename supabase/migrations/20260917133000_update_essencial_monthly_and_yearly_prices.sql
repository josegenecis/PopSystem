-- Atualiza o valor mensal do Essencial. O valor anual específico é aplicado
-- pelo catálogo e pelo checkout do Asaas: R$ 1.068,00 por ano (R$ 89/mês).
update public.subscription_plans
set
  price = 129.00,
  checkout_note = 'R$129,00 no plano mensal ou R$1.068,00 no plano anual (equivalente a R$89,00 por mês). Trimestral com 5% e semestral com 7% de desconto.'
where id = 1 or lower(coalesce(slug, name)) in ('essencial', 'basic', 'basico', 'básico');

notify pgrst, 'reload schema';
