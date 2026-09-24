import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Minus, PackagePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ProductSelectionModal from '@/components/pdv/ProductSelectionModal';
import {
  fetchTableOrderFlowSettings,
  filterItemsForTableManagerOrder,
  getTableManagerOrderStatus,
  shouldCreateTableManagerOrder,
} from '@/utils/tableOrderFlow';
import { PrinterService } from '@/utils/printerService';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url?: string;
  available: boolean;
  category: string;
  description?: string;
  weight_based?: boolean;
  send_to_kds?: boolean;
  fiscal_ncm?: string | null;
  fiscal_cfop?: string | null;
  fiscal_csosn?: string | null;
  fiscal_cst_pis?: string | null;
  fiscal_cst_cofins?: string | null;
  fiscal_origem?: string | null;
  fiscal_cest?: string | null;
  fiscal_beneficio?: string | null;
}

interface CartItem extends Product {
  quantity: number;
  options?: string[];
  variations?: string[];
  notes?: string;
}

interface Table {
  id: string;
  table_number: number;
  capacity: number;
  status: string;
  location?: string;
}

interface AddProductToTableModalProps {
  table: Table | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddProductToTableModal: React.FC<AddProductToTableModalProps> = ({
  table,
  isOpen,
  onClose,
  onSuccess
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (isOpen) {
      fetchProducts();
      setCartItems([]);
      setCustomerName('');
      setCustomerPhone('');
    }
  }, [isOpen]);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', user?.id)
        .eq('available', true)
        .eq('available_pdv', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      toast({
        title: "Erro",
        description: "Erro ao carregar produtos.",
        variant: "destructive"
      });
    }
  };

  const unpackSelectedVariations = (value: any) => {
    if (!value) return { options: [] as string[], variationLines: [] as string[] };
    if (Array.isArray(value)) return { options: value.map((v) => String(v || '').trim()).filter(Boolean), variationLines: [] as string[] };
    const options = Array.isArray(value.options) ? value.options.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
    const variationLines = Array.isArray(value.variationLines) ? value.variationLines.map((v: any) => String(v || '').trim()).filter(Boolean) : [];
    return { options, variationLines };
  };

  const addToCart = (product: Product, quantity: number = 1, selected: any = [], notes: string = '', variationPrice: number = 0) => {
    const { options, variationLines } = unpackSelectedVariations(selected);
    setCartItems(prev => {
      const existing = prev.find(item => 
        item.id === product.id && 
        JSON.stringify(item.options) === JSON.stringify(options) &&
        item.notes === notes
      );
      
      if (existing) {
        return prev.map(item =>
          item === existing
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      
      return [...prev, {
        ...product,
        price: Math.max(0, Number(product.price || 0) + Number(variationPrice || 0)),
        quantity, 
        options: options.length > 0 ? options : undefined,
        variations: variationLines.length > 0 ? variationLines : undefined,
        notes: notes || undefined
      }];
    });
  };

  const updateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCartItems(prev => prev.filter(item => item.id !== productId));
      return;
    }
    setCartItems(prev =>
      prev.map(item =>
        item.id === productId ? { ...item, quantity: newQuantity } : item
      )
    );
  };

  const getTotalValue = () => {
    return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const handleAddToTable = async () => {
    if (!table || !user || cartItems.length === 0) {
      toast({
        title: "Erro",
        description: "Selecione produtos antes de adicionar à mesa.",
        variant: "destructive"
      });
      return;
    }

    /*
    try {
        toast({
          title: 'Caixa fechado',
          description: 'Abra o caixa antes de lanÃ§ar itens em mesas.',
          variant: 'destructive'
        });
        return;
      }
    } catch (error) {
      console.error('Erro ao validar caixa para mesas:', error);
      toast({
        title: 'Erro no caixa',
        description: 'NÃ£o foi possÃ­vel validar a abertura do caixa.',
        variant: 'destructive'
      });
      return;
    }

    */

    try {
      setLoading(true);

      const { data: existingAccount, error: checkError } = await supabase
        .from('table_accounts')
        .select('*')
        .eq('table_id', table.id)
        .eq('user_id', user.id)
        .in('status', ['open', 'payment_pending'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (checkError) throw checkError;

      const orderItems = cartItems.map(item => ({
        product_id: item.id,
        product_name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
        options: item.options || [],
        variations: item.variations || [],
        notes: item.notes || '',
        send_to_kds: item.send_to_kds === true,
        fiscal_ncm: item.fiscal_ncm || null,
        fiscal_cfop: item.fiscal_cfop || null,
        fiscal_csosn: item.fiscal_csosn || null,
        fiscal_cst_pis: item.fiscal_cst_pis || null,
        fiscal_cst_cofins: item.fiscal_cst_cofins || null,
        fiscal_origem: item.fiscal_origem || null,
        fiscal_cest: item.fiscal_cest || null,
        fiscal_beneficio: item.fiscal_beneficio || null,
      }));

      const tableFlow = await fetchTableOrderFlowSettings(user.id);
      const itemsForKitchen = filterItemsForTableManagerOrder(orderItems, tableFlow);
      const canCreateKitchenOrder = shouldCreateTableManagerOrder(tableFlow) && itemsForKitchen.length > 0;
      let kitchenPrintWarning = '';
      let kitchenDispatchStatus: 'not_created' | 'pending_acceptance' | 'printed' = 'not_created';

      const createKitchenOrder = async () => {
        if (!canCreateKitchenOrder) return;

        const orderStatus = getTableManagerOrderStatus(tableFlow);
        const orderTotal = itemsForKitchen.reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0);
        const orderNumber = `MESA-${table.table_number}-${Date.now().toString().slice(-5)}`;
        const { data: createdOrder, error: orderError } = await supabase
          .from('orders')
          .insert({
            user_id: user.id,
            order_number: orderNumber,
            customer_name: customerName.trim() || `Mesa ${table.table_number}`,
            customer_phone: customerPhone.trim() || '',
            items: itemsForKitchen,
            total: orderTotal,
            payment_method: 'pendente',
            order_type: 'dine_in',
            table_id: table.id,
            status: orderStatus.status,
            acceptance_status: orderStatus.acceptance_status,
            variations: {
              source: 'TABLES_MODAL',
              table_order_flow: tableFlow.mode,
              show_in_manager: tableFlow.showInManager,
              auto_accept: tableFlow.autoAccept,
            },
          })
          .select('*')
          .single();

        if (orderError) throw orderError;

        // No fluxo manual, aceitar o pedido continua sendo o gatilho da
        // impressão. No automático, o lançamento da mesa precisa imprimir já.
        if (orderStatus.status !== 'preparing') {
          kitchenDispatchStatus = 'pending_acceptance';
          return;
        }

        const printResult = await PrinterService.printKitchenTicket({
          ...createdOrder,
          user_id: user.id,
          order_number: orderNumber,
          table_number: table.table_number,
          customer_name: customerName.trim() || `Mesa ${table.table_number}`,
          order_type: 'dine_in',
          items: itemsForKitchen,
          total: orderTotal,
          created_at: createdOrder?.created_at || new Date().toISOString(),
          __kitchen_print_job_id: `table:${createdOrder?.id || orderNumber}`,
        });

        if (!printResult?.success) {
          kitchenPrintWarning = printResult?.error || 'A via da cozinha não foi impressa.';
          return;
        }

        kitchenDispatchStatus = 'printed';
      };

      const kitchenSuccessDescription = () => {
        if (kitchenDispatchStatus === 'printed') {
          return `Novos itens da Mesa ${table.table_number} enviados para a cozinha.`;
        }
        if (kitchenDispatchStatus === 'pending_acceptance') {
          return `Pedido da Mesa ${table.table_number} aguardando aceite antes de seguir para a cozinha.`;
        }
        return `Produtos adicionados ao pedido da Mesa ${table.table_number}.`;
      };

      if (existingAccount) {
        let currentItems = [];
        try {
          if (typeof existingAccount.items === 'string') {
            currentItems = JSON.parse(existingAccount.items);
          } else if (Array.isArray(existingAccount.items)) {
            currentItems = existingAccount.items;
          }
        } catch (e) {
          console.error('Error parsing existing items:', e);
          currentItems = [];
        }
        
        const updatedItems = [...currentItems, ...orderItems];
        const newTotal = Number(existingAccount.total || 0) + getTotalValue();

        const { error: updateError } = await supabase
          .from('table_accounts')
          .update({
            items: updatedItems,
            total: newTotal,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAccount.id);

        if (updateError) throw updateError;

        await createKitchenOrder();

        toast({
          title: kitchenPrintWarning ? 'Itens salvos; confira a cozinha' : 'Produtos adicionados!',
          description: kitchenPrintWarning || kitchenSuccessDescription(),
          variant: kitchenPrintWarning ? 'destructive' : 'default',
        });
      } else {
        const accountData = {
          user_id: user.id,
          table_id: table.id,
          items: orderItems,
          total: getTotalValue(),
          status: 'open'
        };

        const { error: createError } = await supabase
          .from('table_accounts')
          .insert([accountData])
          .select('id')
          .single();

        if (createError) throw createError;

        await supabase
          .from('tables')
          .update({ status: 'occupied' })
          .eq('id', table.id);

        await createKitchenOrder();

        toast({
          title: kitchenPrintWarning ? 'Mesa lançada; confira a cozinha' : 'Mesa lançada!',
          description: kitchenPrintWarning || kitchenSuccessDescription(),
          variant: kitchenPrintWarning ? 'destructive' : 'default',
        });
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Erro ao adicionar produtos à mesa:', error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar os produtos.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  if (!table) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[calc(100vh-1rem)] overflow-y-auto p-4 sm:p-5">
          <DialogHeader>
            <DialogTitle>
              Adicionar Produtos - Mesa {table.table_number}
              {table.location && ` (${table.location})`}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6">
            <div className="space-y-4">
              <Button 
                onClick={() => setShowProductModal(true)}
                className="h-14 w-full text-base"
              >
                <PackagePlus size={18} className="mr-2" />
                ADD PRODUTO
              </Button>

              <Card>
                <CardContent className="p-4">
                  <details className="group">
                    <summary className="cursor-pointer list-none text-sm font-semibold text-slate-700">
                      Cliente opcional
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label htmlFor="customerName">Nome</Label>
                        <Input
                          id="customerName"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder={`Mesa ${table.table_number}`}
                        />
                      </div>
                      <div>
                        <Label htmlFor="customerPhone">Telefone</Label>
                        <Input
                          id="customerPhone"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="(11) 99999-9999"
                        />
                      </div>
                    </div>
                  </details>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <h3 className="font-medium mb-3">Itens Selecionados</h3>
                  
                  {cartItems.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-4">
                      Nenhum item selecionado
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-40 overflow-y-auto">
                      {cartItems.map((item, index) => (
                        <div key={`${item.id}-${index}`} className="border-b pb-3 last:border-b-0">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{item.name}</p>
                              {item.options && item.options.length > 0 && (
                                <div className="ml-2 text-xs text-gray-600">
                                  {item.options.map((option, optIndex) => (
                                    <div key={optIndex}>• {option}</div>
                                  ))}
                                </div>
                              )}
                              {item.notes && (
                                <p className="text-xs text-gray-600 italic ml-2">
                                  Obs: {item.notes}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              >
                                <Minus size={12} />
                              </Button>
                              <span className="w-8 text-center text-sm">{item.quantity}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              >
                                <Plus size={12} />
                              </Button>
                            </div>
                          </div>
                          <div className="text-right text-sm font-medium mt-1">
                            {formatCurrency(item.price * item.quantity)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {cartItems.length > 0 && (
                    <div className="border-t pt-3 mt-3">
                      <div className="flex justify-between items-center font-bold">
                        <span>Total:</span>
                        <span>{formatCurrency(getTotalValue())}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button
                  onClick={handleAddToTable}
                  disabled={loading || cartItems.length === 0}
                  className="flex-1"
                >
                  {loading ? 'Adicionando...' : 'Adicionar à Mesa'}
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProductSelectionModal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        onAddToCart={addToCart}
        layout="list"
      />
    </>
  );
};

export default AddProductToTableModal;
