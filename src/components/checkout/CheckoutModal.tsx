import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Building2, CheckCircle2, ChevronDown, Clock3, CreditCard, Loader2, QrCode, Split, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { parseBRL } from '@/lib/currency';

export type CheckoutPaymentMethod =
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'cartao_voucher'
  | 'cartao_outros'
  | 'dinheiro'
  | 'pagar_depois';

export type CheckoutPaymentAmounts = Partial<Record<CheckoutPaymentMethod, string>>;

export type FiscalValidationState = {
  status: 'idle' | 'checking' | 'valid' | 'invalid';
  message?: string;
};

const PAYMENT_OPTIONS: Array<{ value: CheckoutPaymentMethod; label: string }> = [
  { value: 'pix', label: 'PIX' },
  { value: 'cartao_credito', label: 'Crédito' },
  { value: 'cartao_debito', label: 'Débito' },
  { value: 'cartao_voucher', label: 'Voucher' },
  { value: 'cartao_outros', label: 'Outros' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pagar_depois', label: 'Contas a receber' },
];

const SPLIT_PAYMENT_OPTIONS = PAYMENT_OPTIONS.filter((option) => option.value !== 'pagar_depois');

const CARD_OPTIONS: Array<{ value: CheckoutPaymentMethod; label: string }> = [
  { value: 'cartao_credito', label: 'Crédito' },
  { value: 'cartao_debito', label: 'Débito' },
  { value: 'cartao_voucher', label: 'Voucher' },
  { value: 'cartao_outros', label: 'Outros' },
];

const DEFAULT_SPLIT_METHODS: CheckoutPaymentMethod[] = ['pix', 'dinheiro'];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const parsePaymentValue = (value: string | number | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const rawValue = String(value || '').trim();

  if (!rawValue) return 0;

  if (/^\d{3,}$/.test(rawValue) && !/[R$,.]/.test(rawValue)) {
    return Number(rawValue) / 100;
  }

  return parseBRL(rawValue);
};

const resolveNumericShortcut = (event: KeyboardEvent) => {
  if (/^\d$/.test(event.key)) return event.key;
  return event.code.match(/^(?:Digit|Numpad)(\d)$/)?.[1] || '';
};

const normalizeSplitMethods = (methods: CheckoutPaymentMethod[]) => {
  const unique = methods.filter((method, index, list) => list.indexOf(method) === index);

  for (const option of SPLIT_PAYMENT_OPTIONS) {
    if (unique.length >= 2) break;
    if (!unique.includes(option.value)) unique.push(option.value);
  }

  return unique.length > 0 ? unique : DEFAULT_SPLIT_METHODS;
};

interface CheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  total: number;
  subtotal?: number;
  deliveryFee?: number;
  discountValue?: string;
  surchargeValue?: string;
  onDiscountChange?: (value: string) => void;
  onSurchargeChange?: (value: string) => void;
  paymentMethod: CheckoutPaymentMethod;
  paymentAmounts: CheckoutPaymentAmounts;
  cashReceived?: string;
  onPaymentMethodChange: (method: CheckoutPaymentMethod) => void;
  onPaymentAmountChange: (method: CheckoutPaymentMethod, value: string) => void;
  onCashReceivedChange?: (value: string) => void;
  onClearSplit: () => void;
  onConfirm: () => void;
  processing?: boolean;
  keyboardShortcutsEnabled?: boolean;
  confirmLabel?: string;
  pixStatus?: 'idle' | 'waiting' | 'paid';
  cpfValue?: string;
  onCpfChange?: (value: string) => void;
  fiscalRecipient?: { name: string; document: string } | null;
  fiscalModel?: '55' | '65';
  fiscalValidation?: FiscalValidationState;
  onFiscalModelChange?: (model: '55' | '65') => void;
  onFiscalRecipientClick?: () => void;
  onFiscalRecipientClear?: () => void;
  modeVariant?: 'express' | 'complete';
  inlineContent?: React.ReactNode;
  extraFields?: React.ReactNode;
  advancedContent?: React.ReactNode;
}

export function CheckoutModal({
  open,
  onOpenChange,
  title = 'Fechar pedido',
  subtitle,
  total,
  subtotal,
  deliveryFee = 0,
  discountValue = '',
  surchargeValue = '',
  onDiscountChange,
  onSurchargeChange,
  paymentMethod,
  paymentAmounts,
  cashReceived = '',
  onPaymentMethodChange,
  onPaymentAmountChange,
  onCashReceivedChange,
  onClearSplit,
  onConfirm,
  processing = false,
  keyboardShortcutsEnabled = true,
  confirmLabel,
  pixStatus = 'idle',
  cpfValue = '',
  onCpfChange,
  fiscalRecipient,
  fiscalModel = '65',
  fiscalValidation = { status: 'idle' },
  onFiscalModelChange,
  onFiscalRecipientClick,
  onFiscalRecipientClear,
  modeVariant = 'complete',
  inlineContent,
  extraFields,
  advancedContent,
}: CheckoutModalProps) {
  const [mode, setMode] = useState<'main' | 'pix' | 'cash' | 'split'>('main');
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cpfOpen, setCpfOpen] = useState(false);
  const [splitMethods, setSplitMethods] = useState<CheckoutPaymentMethod[]>(DEFAULT_SPLIT_METHODS);

  const manualTotal = useMemo(
    () => PAYMENT_OPTIONS.reduce((sum, option) => sum + parsePaymentValue(paymentAmounts[option.value] || ''), 0),
    [paymentAmounts],
  );
  const hasManualSplit = manualTotal > 0.009;
  const paidTotal = hasManualSplit ? manualTotal : total;
  const remaining = Math.max(0, total - paidTotal);
  const cashPortion = hasManualSplit ? parsePaymentValue(paymentAmounts.dinheiro || '') : paymentMethod === 'dinheiro' ? total : 0;
  const cashReceivedValue = parsePaymentValue(cashReceived);
  const changeAmount = cashPortion > 0 ? Math.max(0, cashReceivedValue - cashPortion) : 0;
  const fiscalReady = fiscalModel !== '55'
    || Boolean(fiscalRecipient && fiscalValidation.status === 'valid');
  const canConfirm = !processing && fiscalReady && total > 0 && (!hasManualSplit || remaining <= 0.009);
  const activePaymentCount = PAYMENT_OPTIONS.filter((option) => parsePaymentValue(paymentAmounts[option.value] || '') > 0.009).length;
  const shouldShowSummary = advancedOpen || mode === 'cash' || (mode === 'split' && (activePaymentCount > 1 || remaining > 0.009 || paidTotal - total > 0.009));

  function selectSinglePayment(method: CheckoutPaymentMethod, nextMode: 'main' | 'pix' | 'cash') {
    onClearSplit();
    onPaymentMethodChange(method);
    setMode(nextMode);
  }

  function selectCardPayment(method: CheckoutPaymentMethod) {
    selectSinglePayment(method, 'main');
    setCardDialogOpen(false);
  }

  function openSplitMode() {
    const activeMethods = SPLIT_PAYMENT_OPTIONS
      .filter((option) => parsePaymentValue(paymentAmounts[option.value] || '') > 0.009)
      .map((option) => option.value);

    setSplitMethods(normalizeSplitMethods(activeMethods.length > 0 ? activeMethods : DEFAULT_SPLIT_METHODS));
    setMode('split');
  }

  function goBack() {
    if (mode !== 'main') {
      setMode('main');
      return;
    }

    onOpenChange(false);
  }

  useEffect(() => {
    if (!open) return;
    setMode('main');
    setAdvancedOpen(false);
    setCpfOpen(false);
    setCardDialogOpen(false);
    setSplitMethods(DEFAULT_SPLIT_METHODS);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (!keyboardShortcutsEnabled) return;
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      const numericShortcut = resolveNumericShortcut(event);

      if (cardDialogOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setCardDialogOpen(false);
          return;
        }
        if (isEditing) return;

        const cardShortcuts: Record<string, CheckoutPaymentMethod> = {
          '1': 'cartao_credito',
          '2': 'cartao_debito',
          '3': 'cartao_voucher',
          '4': 'cartao_outros',
        };
        const cardMethod = cardShortcuts[numericShortcut];
        if (cardMethod) {
          event.preventDefault();
          selectCardPayment(cardMethod);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.key === 'Enter' && canConfirm) {
        event.preventDefault();
        onConfirm();
        return;
      }
      if (!isEditing && mode === 'main') {
        const numericPayments: Record<string, () => void> = {
          '1': () => selectSinglePayment('dinheiro', 'cash'),
          '2': () => selectSinglePayment('pix', 'pix'),
          '3': () => setCardDialogOpen(true),
          '4': openSplitMode,
          '6': () => selectSinglePayment('pagar_depois', 'main'),
          '8': openSplitMode,
        };
        const shortcut = numericPayments[numericShortcut];
        if (shortcut) {
          event.preventDefault();
          shortcut();
          return;
        }
      }
      if (event.key === 'F2') {
        event.preventDefault();
        openSplitMode();
      }
      if (event.key === 'F3') {
        event.preventDefault();
        if (modeVariant === 'complete') setCpfOpen(true);
      }
      if (event.key === 'F4') {
        event.preventDefault();
        if (modeVariant === 'complete') setAdvancedOpen((value) => !value);
      }
      if (event.key === 'F5') {
        event.preventDefault();
        selectSinglePayment('pix', 'pix');
      }
      if (event.key === 'F6') {
        event.preventDefault();
        setCardDialogOpen(true);
      }
      if (event.key === 'F7') {
        event.preventDefault();
        selectSinglePayment('dinheiro', 'cash');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canConfirm, cardDialogOpen, keyboardShortcutsEnabled, mode, modeVariant, onConfirm, onOpenChange, open, paymentAmounts]);

  const updateSplitAmount = (method: CheckoutPaymentMethod, value: string) => {
    onPaymentAmountChange(method, value);

    const currentMethods = normalizeSplitMethods(splitMethods);
    const firstMethod = currentMethods[0];
    const secondMethod = currentMethods[1];

    if (mode === 'split' && method === firstMethod && secondMethod) {
      const firstAmount = parsePaymentValue(value);
      const otherLockedAmount = currentMethods.slice(2).reduce((sum, currentMethod) => {
        return sum + parsePaymentValue(paymentAmounts[currentMethod] || '');
      }, 0);
      const nextRemaining = Math.max(0, total - firstAmount - otherLockedAmount);
      const formattedRemaining = nextRemaining > 0.009 ? formatCurrency(nextRemaining) : '';

      onPaymentAmountChange(secondMethod, formattedRemaining);
      if (secondMethod === 'dinheiro' && onCashReceivedChange) {
        onCashReceivedChange(formattedRemaining);
      }
    }

    if (method === 'dinheiro' && onCashReceivedChange) {
      const received = parsePaymentValue(cashReceived);
      const amount = parsePaymentValue(value);
      if (!cashReceived || received + 0.009 < amount) onCashReceivedChange(value);
    }
  };

  const addSplitMethod = () => {
    const currentMethods = normalizeSplitMethods(splitMethods);
    const next = SPLIT_PAYMENT_OPTIONS.find((option) => !currentMethods.includes(option.value));
    if (!next) return;
    setSplitMethods([...currentMethods, next.value]);
    onPaymentAmountChange(next.value, remaining > 0.009 ? formatCurrency(remaining) : '');
  };

  const changeSplitMethod = (from: CheckoutPaymentMethod, to: CheckoutPaymentMethod) => {
    if (from === to || splitMethods.includes(to)) return;

    const currentAmount = paymentAmounts[from] || '';
    setSplitMethods((methods) => normalizeSplitMethods(methods.map((method) => (method === from ? to : method))));
    onPaymentAmountChange(from, '');
    onPaymentAmountChange(to, currentAmount);

    if (from === 'dinheiro' && to !== 'dinheiro') onCashReceivedChange?.('');
    if (to === 'dinheiro' && currentAmount && onCashReceivedChange && !cashReceived) onCashReceivedChange(currentAmount);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          hideClose
          className="flex max-h-[98vh] w-[min(98vw,1040px)] max-w-none flex-col overflow-hidden rounded-3xl border-[#FF6400]/10 bg-[#FFFDF9] p-0 shadow-2xl"
        >
          <DialogHeader className="shrink-0 border-b border-[#003223]/10 px-6 py-2.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-2xl font-black text-[#003223]">{title}</DialogTitle>
                {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p> : null}
              </div>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => onOpenChange(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <CheckoutHeader total={total} />
          </DialogHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-3">
            {mode === 'main' && (
              <PaymentSelector
                onPix={() => selectSinglePayment('pix', 'pix')}
                onCard={() => setCardDialogOpen(true)}
                onCash={() => selectSinglePayment('dinheiro', 'cash')}
                onSplit={openSplitMode}
                onDeferred={() => selectSinglePayment('pagar_depois', 'main')}
              />
            )}

            {mode === 'pix' && (
              <PixPayment
                total={total}
                status={pixStatus}
                onBack={() => setMode('main')}
              />
            )}

            {mode === 'cash' && (
              <CashPayment
                total={total}
                cashReceived={cashReceived}
                changeAmount={changeAmount}
                onCashReceivedChange={onCashReceivedChange}
                onBack={() => setMode('main')}
              />
            )}

            {mode === 'split' && (
              <SplitPayment
                paymentAmounts={paymentAmounts}
                remaining={remaining}
                paidTotal={paidTotal}
                total={total}
                cashReceived={cashReceived}
                changeAmount={changeAmount}
                methods={normalizeSplitMethods(splitMethods)}
                onAmountChange={updateSplitAmount}
                onMethodChange={changeSplitMethod}
                onCashReceivedChange={onCashReceivedChange}
                onAddMethod={addSplitMethod}
                onBack={() => setMode('main')}
              />
            )}

            {modeVariant === 'complete' && onCpfChange && (
              <CpfSection
                open={cpfOpen}
                value={cpfValue}
                onOpenChange={setCpfOpen}
                onChange={onCpfChange}
              />
            )}

            {onFiscalRecipientClick && (
              <div className="space-y-3">
                <FiscalRecipientSection
                  recipient={fiscalRecipient}
                  model={fiscalModel}
                  onModelChange={onFiscalModelChange}
                  onSelect={onFiscalRecipientClick}
                  onClear={onFiscalRecipientClear}
                />
                {fiscalModel === '55' && (
                  <FiscalValidationNotice validation={fiscalValidation} hasRecipient={Boolean(fiscalRecipient)} />
                )}
              </div>
            )}

            {inlineContent}

            {modeVariant === 'complete' && (
              <AdvancedOptions
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
                subtotal={subtotal}
                deliveryFee={deliveryFee}
                discountValue={discountValue}
                surchargeValue={surchargeValue}
                onDiscountChange={onDiscountChange}
                onSurchargeChange={onSurchargeChange}
                extraFields={extraFields}
                advancedContent={advancedContent}
              />
            )}

            {shouldShowSummary && (
              <PaymentSummary
                subtotal={subtotal}
                deliveryFee={deliveryFee}
                discount={parseBRL(discountValue)}
                surcharge={parseBRL(surchargeValue)}
                total={total}
                paidTotal={hasManualSplit ? paidTotal : undefined}
                remaining={hasManualSplit ? remaining : undefined}
                changeAmount={cashPortion > 0 ? changeAmount : undefined}
              />
            )}
          </div>

          <FooterActions
            canConfirm={canConfirm}
            processing={processing}
            label={confirmLabel || (
              paymentMethod === 'pix' && mode === 'pix'
                ? 'Gerar QR Code'
                : paymentMethod === 'pagar_depois'
                  ? `Registrar conta de ${formatCurrency(total)}`
                  : `Confirmar ${formatCurrency(total)}`
            )}
            onBack={goBack}
            onConfirm={onConfirm}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={cardDialogOpen} onOpenChange={setCardDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Como foi pago?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {CARD_OPTIONS.map((option, index) => (
              <Button
                key={option.value}
                variant="outline"
                className="h-12 justify-between rounded-xl text-base font-bold"
                onClick={() => selectCardPayment(option.value)}
              >
                <span className="flex items-center">
                  <CreditCard className="mr-2 h-5 w-5" />
                  {option.label}
                </span>
                <kbd className="rounded-md border border-[#003223]/15 bg-[#F8FAF8] px-2 py-0.5 font-mono text-xs text-[#003223]">
                  {index + 1}
                </kbd>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CheckoutHeader({ total }: { total: number }) {
  return (
    <div className="mt-2 rounded-3xl border border-[#003223]/10 bg-white p-2.5 text-center shadow-sm">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Total</div>
      <div className="mt-0.5 text-4xl font-black text-[#003223] sm:text-5xl">{formatCurrency(total)}</div>
    </div>
  );
}

function PaymentSelector({
  onPix,
  onCard,
  onCash,
  onSplit,
  onDeferred,
}: {
  onPix: () => void;
  onCard: () => void;
  onCash: () => void;
  onSplit: () => void;
  onDeferred: () => void;
}) {
  const buttonClass = 'h-16 rounded-2xl text-base font-black shadow-sm';
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button className={`${buttonClass} bg-[#003223] hover:bg-[#064b37]`} onClick={onPix}>
        <QrCode className="mr-2 h-5 w-5" />
        PIX
        <kbd className="ml-2 rounded-md border border-white/25 bg-white/10 px-2 py-0.5 font-mono text-xs">2</kbd>
      </Button>
      <Button className={`${buttonClass} bg-[#FF6400] hover:bg-[#e45a00]`} onClick={onCard}>
        <CreditCard className="mr-2 h-5 w-5" />
        Cartão
        <kbd className="ml-2 rounded-md border border-white/25 bg-white/10 px-2 py-0.5 font-mono text-xs">3</kbd>
      </Button>
      <Button className={`${buttonClass} bg-[#8CC63F] text-[#082F23] hover:bg-[#7db438]`} onClick={onCash}>
        <Banknote className="mr-2 h-5 w-5" />
        Dinheiro
        <kbd className="ml-2 rounded-md border border-[#082F23]/20 bg-white/20 px-2 py-0.5 font-mono text-xs">1</kbd>
      </Button>
      <Button variant="outline" className={`${buttonClass} border-[#003223]/15 bg-white text-[#003223]`} onClick={onSplit}>
        <Split className="mr-2 h-5 w-5" />
        Dividir
        <kbd className="ml-2 rounded-md border border-[#003223]/15 bg-[#F8FAF8] px-2 py-0.5 font-mono text-xs">4</kbd>
      </Button>
      <Button
        variant="outline"
        className={`${buttonClass} col-span-2 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100`}
        onClick={onDeferred}
      >
        <Clock3 className="mr-2 h-5 w-5" />
        Contas a receber
        <kbd className="ml-2 rounded-md border border-amber-900/15 bg-white/50 px-2 py-0.5 font-mono text-xs">6</kbd>
      </Button>
    </div>
  );
}

function PixPayment({ total, status, onBack }: { total: number; status: 'idle' | 'waiting' | 'paid'; onBack: () => void }) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
      <Button variant="ghost" className="mb-2 h-8 px-2 text-xs" onClick={onBack}>Voltar</Button>
      <div className="flex items-center gap-2 text-lg font-black text-[#003223]">
        <QrCode className="h-5 w-5" />
        PIX
      </div>
      <div className="mt-3 rounded-xl bg-white p-4">
        <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Valor</div>
        <div className="text-3xl font-black text-[#003223]">{formatCurrency(total)}</div>
      </div>
      {status === 'paid' && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 font-black text-emerald-700">
          PIX recebido
        </div>
      )}
      {status === 'waiting' && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 font-bold text-amber-700">
          Aguardando confirmação do PIX...
        </div>
      )}
    </div>
  );
}

function CashPayment({
  total,
  cashReceived,
  changeAmount,
  onCashReceivedChange,
  onBack,
}: {
  total: number;
  cashReceived: string;
  changeAmount: number;
  onCashReceivedChange?: (value: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
      <Button variant="ghost" className="mb-2 h-8 px-2 text-xs" onClick={onBack}>Voltar</Button>
      <div className="flex items-center gap-2 text-lg font-black text-[#003223]">
        <Banknote className="h-5 w-5" />
        Dinheiro
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <Label>Valor recebido</Label>
          <CurrencyTextInput
            value={cashReceived}
            onValueChange={(value) => onCashReceivedChange?.(value)}
            placeholder={formatCurrency(total)}
            className="mt-1 h-14 bg-white text-xl font-black"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <div className="rounded-xl bg-white px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Troco</div>
          <div className="text-3xl font-black text-emerald-700">{formatCurrency(changeAmount)}</div>
        </div>
      </div>
    </div>
  );
}

function SplitPayment({
  paymentAmounts,
  remaining,
  paidTotal,
  total,
  cashReceived,
  changeAmount,
  methods,
  onAmountChange,
  onMethodChange,
  onCashReceivedChange,
  onAddMethod,
  onBack,
}: {
  paymentAmounts: CheckoutPaymentAmounts;
  remaining: number;
  paidTotal: number;
  total: number;
  cashReceived: string;
  changeAmount: number;
  methods: CheckoutPaymentMethod[];
  onAmountChange: (method: CheckoutPaymentMethod, value: string) => void;
  onMethodChange: (from: CheckoutPaymentMethod, to: CheckoutPaymentMethod) => void;
  onCashReceivedChange?: (value: string) => void;
  onAddMethod: () => void;
  onBack: () => void;
}) {
  const methodsToRender = normalizeSplitMethods(methods)
    .map((method) => PAYMENT_OPTIONS.find((option) => option.value === method))
    .filter(Boolean) as Array<{ value: CheckoutPaymentMethod; label: string }>;
  const usedMethods = new Set(methodsToRender.map((option) => option.value));

  return (
    <div className="rounded-2xl border border-[#003223]/10 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={onBack}>Voltar</Button>
        <div className="text-right text-xs font-bold text-slate-500">
          {formatCurrency(paidTotal)} de {formatCurrency(total)}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {methodsToRender.map((option) => (
          <div key={option.value} className="rounded-xl border border-slate-200 bg-[#FFFDF9] p-2.5">
            <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
              <Select
                value={option.value}
                onValueChange={(next) => onMethodChange(option.value, next as CheckoutPaymentMethod)}
              >
                <SelectTrigger className="h-11 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPLIT_PAYMENT_OPTIONS.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={usedMethods.has(item.value) && item.value !== option.value}
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CurrencyTextInput
                value={paymentAmounts[option.value] || ''}
                onValueChange={(value) => onAmountChange(option.value, value)}
                placeholder="R$ 0,00"
                className="h-11 bg-white font-bold"
              />
            </div>
            {option.value === 'dinheiro' && (
              <div className="mt-2 grid gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Recebido</Label>
                  <CurrencyTextInput
                    value={cashReceived}
                    onValueChange={(value) => onCashReceivedChange?.(value)}
                    placeholder="R$ 0,00"
                    className="mt-1 h-10 bg-white"
                  />
                </div>
                <div>
                  <Label className="text-xs">Troco</Label>
                  <div className="mt-1 flex h-10 items-center rounded-lg border bg-white px-3 font-black text-emerald-700">
                    {formatCurrency(changeAmount)}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Button variant="outline" className="mt-2 h-11 w-full rounded-xl font-black" onClick={onAddMethod}>
        Adicionar outra forma
      </Button>
      {remaining > 0.009 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          Ainda falta {formatCurrency(remaining)}
        </div>
      )}
    </div>
  );
}

function CpfSection({
  open,
  value,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  value: string;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-[#003223]/10 bg-white p-3 shadow-sm">
      <Button variant="ghost" className="h-9 px-2 font-bold text-[#003223]" onClick={() => onOpenChange(!open)}>
        + CPF na Nota
      </Button>
      {open && (
        <div className="mt-2">
          <Label>CPF</Label>
          <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="000.000.000-00" className="mt-1 h-11" />
        </div>
      )}
    </div>
  );
}

function FiscalRecipientSection({
  recipient,
  model,
  onModelChange,
  onSelect,
  onClear,
}: {
  recipient?: { name: string; document: string } | null;
  model: '55' | '65';
  onModelChange?: (model: '55' | '65') => void;
  onSelect: () => void;
  onClear?: () => void;
}) {
  return (
    <div className={`space-y-3 rounded-2xl border p-4 shadow-sm ${model === '55' ? 'border-blue-200 bg-blue-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={model === '65' ? 'default' : 'outline'} onClick={() => onModelChange?.('65')}>
          NFC-e • Modelo 65
        </Button>
        <Button type="button" variant={model === '55' ? 'default' : 'outline'} onClick={() => onModelChange?.('55')}>
          NF-e • Modelo 55
        </Button>
      </div>
      {model === '55' && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`rounded-xl p-2 ${recipient ? 'bg-emerald-700 text-white' : 'bg-blue-700 text-white'}`}>
            {recipient ? <CheckCircle2 className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="font-black text-[#003223]">Cliente para NF-e • Modelo 55</div>
            {recipient ? (
              <><p className="truncate text-sm font-semibold text-emerald-900">{recipient.name}</p><p className="text-xs text-emerald-700">CPF/CNPJ: {recipient.document}</p></>
            ) : (
              <p className="text-sm text-slate-600">Informe ou cadastre o destinatário da nota fiscal completa.</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {recipient && onClear && <Button type="button" variant="ghost" size="sm" onClick={onClear}>Remover</Button>}
          <Button type="button" size="sm" className={recipient ? 'bg-emerald-800 hover:bg-emerald-900' : 'bg-blue-700 hover:bg-blue-800'} onClick={onSelect}>
            {recipient ? 'Alterar cliente' : 'Informar ou cadastrar cliente'}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

function FiscalValidationNotice({
  validation,
  hasRecipient,
}: {
  validation: FiscalValidationState;
  hasRecipient: boolean;
}) {
  if (!hasRecipient) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-black">Informe o destinatário antes de emitir a NF-e.</p>
          <p className="mt-0.5">O sistema validará automaticamente a tributação dos produtos para esse cliente.</p>
        </div>
      </div>
    );
  }

  if (validation.status === 'checking' || validation.status === 'idle') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
        Validando destinatário, produtos e regras fiscais da NF-e…
      </div>
    );
  }

  if (validation.status === 'valid') {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {validation.message || 'Tributação compatível com o destinatário e com a NF-e modelo 55.'}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-950">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-black">Não é possível concluir esta NF-e com a configuração atual.</p>
        <p className="mt-1 whitespace-pre-line leading-relaxed">
          {validation.message || 'Revise o destinatário ou a regra fiscal dos produtos antes de fechar a venda.'}
        </p>
      </div>
    </div>
  );
}

function AdvancedOptions({
  open,
  onOpenChange,
  subtotal,
  deliveryFee,
  discountValue,
  surchargeValue,
  onDiscountChange,
  onSurchargeChange,
  extraFields,
  advancedContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal?: number;
  deliveryFee: number;
  discountValue: string;
  surchargeValue: string;
  onDiscountChange?: (value: string) => void;
  onSurchargeChange?: (value: string) => void;
  extraFields?: React.ReactNode;
  advancedContent?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#003223]/10 bg-white shadow-sm">
      <Button variant="ghost" className="h-11 w-full justify-between rounded-2xl px-4 font-black text-[#003223]" onClick={() => onOpenChange(!open)}>
        Mais opções
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div className="space-y-3 border-t border-[#003223]/10 p-4">
          {extraFields}
          <div className="grid gap-3 sm:grid-cols-2">
            {onDiscountChange && (
              <div>
                <Label>Desconto</Label>
                <CurrencyTextInput value={discountValue} onValueChange={onDiscountChange} placeholder="R$ 0,00" className="mt-1 h-11" />
              </div>
            )}
            {onSurchargeChange && (
              <div>
                <Label>Acréscimo</Label>
                <CurrencyTextInput value={surchargeValue} onValueChange={onSurchargeChange} placeholder="R$ 0,00" className="mt-1 h-11" />
              </div>
            )}
          </div>
          {advancedContent}
          {(typeof subtotal === 'number' || deliveryFee > 0) && (
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              Opções avançadas ficam recolhidas para manter o fechamento rápido.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentSummary({
  subtotal,
  deliveryFee,
  discount,
  surcharge,
  total,
  paidTotal,
  remaining,
  changeAmount,
}: {
  subtotal?: number;
  deliveryFee: number;
  discount: number;
  surcharge: number;
  total: number;
  paidTotal?: number;
  remaining?: number;
  changeAmount?: number;
}) {
  return (
    <div className="rounded-2xl border border-[#003223]/10 bg-white p-3 text-sm shadow-sm">
      {typeof subtotal === 'number' && (
        <div className="flex justify-between text-slate-500">
          <span>Subtotal</span>
          <span>{formatCurrency(subtotal)}</span>
        </div>
      )}
      {deliveryFee > 0 && (
        <div className="mt-1 flex justify-between text-slate-500">
          <span>Entrega</span>
          <span>{formatCurrency(deliveryFee)}</span>
        </div>
      )}
      {discount > 0 && (
        <div className="mt-1 flex justify-between text-red-600">
          <span>Desconto</span>
          <span>-{formatCurrency(discount)}</span>
        </div>
      )}
      {surcharge > 0 && (
        <div className="mt-1 flex justify-between text-emerald-700">
          <span>Acréscimo</span>
          <span>{formatCurrency(surcharge)}</span>
        </div>
      )}
      {typeof paidTotal === 'number' && (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2">
          <div className="flex justify-between font-bold text-[#003223]">
            <span>Informado</span>
            <span>{formatCurrency(paidTotal)}</span>
          </div>
          {typeof remaining === 'number' && remaining > 0.009 && (
            <div className="mt-1 flex justify-between font-black text-amber-700">
              <span>Falta</span>
              <span>{formatCurrency(remaining)}</span>
            </div>
          )}
          {typeof changeAmount === 'number' && (
            <div className="mt-1 flex justify-between font-black text-emerald-700">
              <span>Troco</span>
              <span>{formatCurrency(changeAmount)}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex justify-between border-t pt-2 text-xl font-black text-gray-950">
        <span>Total</span>
        <span>{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

function FooterActions({
  canConfirm,
  processing,
  label,
  onBack,
  onConfirm,
}: {
  canConfirm: boolean;
  processing: boolean;
  label: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-[#003223]/10 bg-white px-6 py-3 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onBack} className="h-12 rounded-xl px-8 font-black">
        Voltar
      </Button>
      <Button
        onClick={onConfirm}
        disabled={!canConfirm}
        className="h-12 rounded-xl bg-green-600 px-8 text-base font-black hover:bg-green-700 disabled:opacity-50"
      >
        {processing ? <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white" /> : label}
      </Button>
    </div>
  );
}

export default CheckoutModal;
