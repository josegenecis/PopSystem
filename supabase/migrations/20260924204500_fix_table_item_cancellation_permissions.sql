-- O cancelamento autorizado precisa registrar a auditoria antes de retirar o
-- item da conta. A tabela de auditoria permite somente leitura via RLS, então
-- essas duas funções devem executar a gravação com os privilégios do owner.
-- Ambas continuam validando auth.uid(), a conta da loja e um garçom admin.

alter function public.cancel_table_order_item_authorized(uuid, uuid, text, uuid)
  security definer;

alter function public.cancel_table_account_item_authorized(uuid, integer, text, uuid)
  security definer;

revoke all on function public.cancel_table_order_item_authorized(uuid, uuid, text, uuid)
  from public, anon;
revoke all on function public.cancel_table_account_item_authorized(uuid, integer, text, uuid)
  from public, anon;

grant execute on function public.cancel_table_order_item_authorized(uuid, uuid, text, uuid)
  to authenticated;
grant execute on function public.cancel_table_account_item_authorized(uuid, integer, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
