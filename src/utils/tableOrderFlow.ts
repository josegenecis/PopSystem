import { supabase } from '@/integrations/supabase/client';

export type TableOrderMode = 'marked_items' | 'all_items' | 'account_only';

export interface TableOrderFlowSettings {
  mode: TableOrderMode;
  showInManager: boolean;
  autoAccept: boolean;
}

export interface TableOrderProductRef {
  id?: string | null;
  product_id?: string | null;
  send_to_kds?: boolean | null;
  preparation_route?: 'kitchen' | 'bar' | 'none' | null;
}

const DEFAULT_TABLE_ORDER_FLOW: TableOrderFlowSettings = {
  mode: 'all_items',
  showInManager: true,
  autoAccept: true,
};

export const fetchTableOrderFlowSettings = async (restaurantId?: string | null): Promise<TableOrderFlowSettings> => {
  if (!restaurantId) return DEFAULT_TABLE_ORDER_FLOW;

  const { data, error } = await (supabase as any)
    .from('table_order_flow_settings')
    .select('table_order_mode, show_table_orders_in_manager, auto_accept_table_orders')
    .eq('user_id', restaurantId)
    .maybeSingle();

  if (error) {
    console.warn('Nao foi possivel carregar fluxo de mesas, usando padrao:', error);
    return DEFAULT_TABLE_ORDER_FLOW;
  }

  const mode = String(data?.table_order_mode || DEFAULT_TABLE_ORDER_FLOW.mode);

  return {
    mode: ['marked_items', 'all_items', 'account_only'].includes(mode) ? mode as TableOrderMode : DEFAULT_TABLE_ORDER_FLOW.mode,
    showInManager: data?.show_table_orders_in_manager !== false,
    autoAccept: Boolean(data?.auto_accept_table_orders),
  };
};

export const shouldCreateTableManagerOrder = (settings: TableOrderFlowSettings) =>
  settings.mode !== 'account_only' && settings.showInManager;

export const filterItemsForTableManagerOrder = <T extends TableOrderProductRef>(
  items: T[],
  settings: TableOrderFlowSettings,
): T[] => {
  if (!shouldCreateTableManagerOrder(settings)) return [];
  if (settings.mode === 'all_items') return items;
  return items.filter((item) => item.preparation_route
    ? item.preparation_route !== 'none'
    : item.send_to_kds === true);
};

export const getTableManagerOrderStatus = (settings: TableOrderFlowSettings) => ({
  status: settings.autoAccept ? 'preparing' : 'pending',
  acceptance_status: settings.autoAccept ? 'accepted' : 'pending_acceptance',
});
