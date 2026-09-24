import React, { useState } from 'react';
import { Loader2, Minus, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface TableQrCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  cart: any[];
  total: number;
  tableNumber: number | string;
  onUpdateQuantity: (uniqueId: string, quantity: number) => void;
  onRemoveItem: (uniqueId: string) => void;
  onPlaceOrder: (customer: { name: string; phone: string; notes: string }) => Promise<void>;
}

const formatMoney = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const TableQrCartModal: React.FC<TableQrCartModalProps> = ({
  isOpen,
  onClose,
  cart,
  total,
  tableNumber,
  onUpdateQuantity,
  onRemoveItem,
  onPlaceOrder,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const submit = async () => {
    if (!name.trim() || cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onPlaceOrder({ name: name.trim(), phone: phone.trim(), notes: notes.trim() });
      setNotes('');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Não foi possível enviar o pedido. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-3xl p-0">
        <DialogHeader className="border-b bg-emerald-950 px-5 py-5 text-left text-white">
          <DialogTitle className="flex items-center gap-3 text-white">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15"><UtensilsCrossed className="h-5 w-5" /></span>
            Pedido da Mesa {tableNumber}
          </DialogTitle>
          <p className="text-sm text-emerald-100">O pagamento será realizado no fechamento da mesa.</p>
        </DialogHeader>

        <div className="space-y-5 p-5">
          <div className="space-y-3">
            {cart.map((item) => (
              <div key={item.uniqueId} className="rounded-2xl border bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">{item.product.name}</p>
                    {item.variations?.length > 0 && <p className="mt-1 text-xs text-slate-500">{item.variations.join(' • ')}</p>}
                    {item.notes && <p className="mt-1 text-xs text-slate-500">Obs.: {item.notes}</p>}
                  </div>
                  <p className="whitespace-nowrap font-black text-emerald-900">{formatMoney(item.totalPrice)}</p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-1">
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-white" onClick={() => onUpdateQuantity(item.uniqueId, Math.max(1, item.quantity - 1))}><Minus className="h-4 w-4" /></button>
                    <span className="w-6 text-center font-bold">{item.quantity}</span>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-white" onClick={() => onUpdateQuantity(item.uniqueId, item.quantity + 1)}><Plus className="h-4 w-4" /></button>
                  </div>
                  <button type="button" className="grid h-9 w-9 place-items-center rounded-xl text-red-500 hover:bg-red-50" onClick={() => onRemoveItem(item.uniqueId)} aria-label={`Remover ${item.product.name}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-emerald-50 p-4">
            <div className="flex items-center justify-between text-lg font-black text-emerald-950"><span>Total</span><span>{formatMoney(total)}</span></div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="table-customer-name">Seu nome *</Label>
              <Input id="table-customer-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Para identificar seu pedido" maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-customer-phone">Celular (opcional)</Label>
              <Input id="table-customer-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" inputMode="tel" maxLength={20} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-order-notes">Observação geral (opcional)</Label>
              <Textarea id="table-order-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: entregar os pratos juntos" maxLength={300} />
            </div>
          </div>

          {submitError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{submitError}</p>}
          <Button className="h-12 w-full rounded-2xl bg-emerald-700 text-base font-black hover:bg-emerald-800" disabled={!name.trim() || cart.length === 0 || submitting} onClick={submit}>
            {submitting ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Enviando pedido...</> : `Enviar para a Mesa ${tableNumber}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
