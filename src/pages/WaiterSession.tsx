import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import Logo from '@/components/Logo';
import PixCheckoutModal from '@/components/payment/PixCheckoutModal';
import { useToast } from '@/hooks/use-toast';
import {
  addWaiterItem,
  cancelWaiterDraftItem,
  createWaiterAccount,
  formatMoney,
  getWaiterSessionDetails,
  listWaiterCatalog,
  loadWaiterCatalogCache,
  loadWaiterSessionCache,
  loadWaiterWebSession,
  logoutWaiterWeb,
  mergeWaiterAccounts,
  moveWaiterItem,
  PaymentMethod,
  Product,
  ProductCategory,
  ProductOption,
  recordWaiterPayments,
  releaseWaiterTable,
  removeWaiterAccount,
  renameWaiterAccount,
  requestWaiterCheck,
  sendAllWaiterSessionItems,
  sendWaiterAccountItems,
  getWaiterPaymentSettings,
  startWaiterPixCheckout,
  TableAccount,
  TableSession,
  transferWaiterAccount,
  transferWaiterTable,
  updateWaiterDraftItem,
  WaiterPixCheckout,
  WaiterPaymentInput,
} from '@/services/waiterWebClient';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { WaiterBottomNav } from '@/components/waiter-web/WaiterBottomNav';
import { WaiterEmptyState } from '@/components/waiter-web/WaiterEmptyState';
import { WaiterStatusBadge } from '@/components/waiter-web/WaiterStatusBadge';
import { StoneIntegrationPanel } from '@/components/waiter-web/StoneIntegrationPanel';
import { stoneProvider } from '@/services/payments/stoneProvider';
import { enqueueOfflinePayment, syncOfflinePayments } from '@/services/payments/offlinePaymentQueue';
import { formatElapsedSince } from '@/utils/elapsedTime';
import { formatSaleQuantity } from '@/utils/saleQuantity';
import { useWaiterViewportLock } from '@/hooks/useWaiterViewportLock';
import {
  ArrowLeft,
  Check,
  ChefHat,
  CircleDollarSign,
  Clock3,
  MoveRight,
  NotebookPen,
  PackageOpen,
  Plus,
  PlusCircle,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings,
  Scale,
  Split,
  Users,
} from 'lucide-react';

type PaymentLine = {
  id: string;
  accountId: string;
  method: PaymentMethod;
  amount: string;
  cashReceived?: string;
};

type WaiterPixCheckoutState = WaiterPixCheckout & {
  accountId: string;
  amount: number;
};

const createPaymentLine = (accountId: string, amount: number, method: PaymentMethod = 'pix'): PaymentLine => ({
  id: `${accountId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  accountId,
  method,
  amount: amount > 0 ? amount.toFixed(2).replace('.', ',') : '',
  cashReceived: method === 'cash' && amount > 0 ? amount.toFixed(2).replace('.', ',') : '',
});

const parsePaymentAmount = (value: string) => {
  const raw = String(value || '').replace(/[^\d,.-]/g, '').trim();
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  const normalized = hasComma
    ? raw.replace(/\./g, '').replace(',', '.')
    : hasDot
      ? raw.replace(/,/g, '')
      : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildOptionLabel = (groupName: string, optionName: string) => `${groupName}: ${optionName}`;

const parseDecimalInput = (value: string) => {
  const parsed = Number(String(value || '').trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  debit: 'Debito',
  credit: 'Credito',
  card: 'Cartao',
};

const stonePaymentMethods: PaymentMethod[] = ['pix', 'debit', 'credit'];

const shouldAutoApplyServiceCharge = (settings?: TableSession['serviceChargeSettings']) => {
  return Boolean(settings?.enabled && settings?.autoApply && Number(settings?.percentage || 0) > 0);
};

const WaiterSessionPage = () => {
  useWaiterViewportLock();
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [session, setSession] = useState<TableSession | null>(() => loadWaiterSessionCache(sessionId));
  const [catalog, setCatalog] = useState<ProductCategory[]>(() => loadWaiterCatalogCache()?.categories || []);
  const [loading, setLoading] = useState(!loadWaiterSessionCache(sessionId));
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountDialogMode, setAccountDialogMode] = useState<'create' | 'edit'>('create');
  const [editingAccountId, setEditingAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountCommandCode, setAccountCommandCode] = useState('');
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productDialogStep, setProductDialogStep] = useState<'browse' | 'configure'>('browse');
  const [catalogAccountId, setCatalogAccountId] = useState('');
  const [editingItemId, setEditingItemId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Record<string, ProductOption[]>>({});
  const [quantity, setQuantity] = useState('1');
  const [weightInputUnit, setWeightInputUnit] = useState<'g' | 'kg'>('g');
  const [itemNotes, setItemNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [splitPeople, setSplitPeople] = useState('2');
  const [serviceChargeAccepted, setServiceChargeAccepted] = useState(false);
  const [pixCheckout, setPixCheckout] = useState<WaiterPixCheckoutState | null>(null);
  const [waiterMpPixEnabled, setWaiterMpPixEnabled] = useState(false);
  const [stoneSettingsOpen, setStoneSettingsOpen] = useState(false);
  const [moveItemId, setMoveItemId] = useState('');
  const [moveTargetAccountId, setMoveTargetAccountId] = useState('');
  const [moveQuantity, setMoveQuantity] = useState('1');
  const [mergeSourceAccountId, setMergeSourceAccountId] = useState('');
  const [mergeTargetAccountId, setMergeTargetAccountId] = useState('');
  const [transferAccountId, setTransferAccountId] = useState('');
  const [transferAccountTargetId, setTransferAccountTargetId] = useState('');
  const [transferTableOpen, setTransferTableOpen] = useState(false);
  const [transferTableTargetId, setTransferTableTargetId] = useState('');
  const [activeTab, setActiveTab] = useState<'accounts' | 'timeline' | 'payments'>('accounts');
  const [sessionLoadIssue, setSessionLoadIssue] = useState('');
  const [catalogLoadIssue, setCatalogLoadIssue] = useState('');
  const [productDescriptionExpanded, setProductDescriptionExpanded] = useState(false);
  const deferredProductSearch = useDeferredValue(productSearch);

  const applySession = (nextSession: TableSession) => {
    setSession(nextSession);
  };

  const accountMap = useMemo(() => {
    const map = new Map<string, TableAccount>();
    (session?.accounts || []).forEach((account) => map.set(account.id, account));
    return map;
  }, [session]);

  const paymentHistory = useMemo(() => {
    return (session?.accounts || [])
      .flatMap((account) =>
        account.payments.map((payment) => ({
          ...payment,
          accountName: account.name,
        })),
      )
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [session]);

  const hasDraftAccounts = useMemo(() => {
    return (session?.accounts || []).some((account) => account.draftCount > 0);
  }, [session]);

  const catalogProducts = useMemo(() => catalog.flatMap((category) => category.products), [catalog]);
  const activeAccount = catalogAccountId ? accountMap.get(catalogAccountId) || null : null;
  const editingItem = useMemo(() => {
    if (!editingItemId || !session) return null;
    return session.accounts.flatMap((account) => account.items).find((item) => item.id === editingItemId) || null;
  }, [editingItemId, session]);
  const movingItem = useMemo(() => {
    if (!moveItemId || !session) return null;
    return session.accounts.flatMap((account) => account.items).find((item) => item.id === moveItemId) || null;
  }, [moveItemId, session]);
  const selectedProduct = selectedProductId ? catalogProducts.find((product) => product.id === selectedProductId) || null : null;

  const filteredCategories = useMemo(() => {
    const normalizedSearch = deferredProductSearch.trim().toLowerCase();

    return catalog
      .map((category) => ({
        ...category,
        products: category.products.filter((product) => {
          const matchesCategory = selectedCategoryId === 'all' || category.id === selectedCategoryId;
          const matchesSearch =
            !normalizedSearch ||
            product.name.toLowerCase().includes(normalizedSearch) ||
            String(product.description || '').toLowerCase().includes(normalizedSearch);
          return matchesCategory && matchesSearch;
        }),
      }))
      .filter((category) => category.products.length > 0);
  }, [catalog, deferredProductSearch, selectedCategoryId]);

  const transferTableChoices = useMemo(() => {
    return (session?.tableChoices || []).filter(
      (table) => table.canReceiveTableTransfer && table.id !== session?.tableId && table.status !== 'occupied',
    );
  }, [session]);

  const accountTransferChoices = useMemo(() => {
    return (session?.tableChoices || []).filter((table) => table.canReceiveAccountTransfer && table.id !== session?.tableId);
  }, [session]);

  const paymentBaseTotal = useMemo(() => {
    return paymentLines.reduce((total, line) => total + Math.max(0, parsePaymentAmount(line.amount)), 0);
  }, [paymentLines]);

  const serviceChargeSettings = session?.serviceChargeSettings;
  const canUseServiceCharge = Boolean(serviceChargeSettings?.enabled && (serviceChargeSettings.percentage || 0) > 0);
  const serviceChargePercent = Number(serviceChargeSettings?.percentage || 10);
  const serviceChargeAmount = serviceChargeAccepted && canUseServiceCharge
    ? Number(((paymentBaseTotal * serviceChargePercent) / 100).toFixed(2))
    : 0;
  const serviceChargeTax = serviceChargeAccepted && canUseServiceCharge
    ? Number(((serviceChargeAmount * Number(serviceChargeSettings?.taxWithholdPercent || 0)) / 100).toFixed(2))
    : 0;
  const serviceChargeNet = Math.max(0, serviceChargeAmount - serviceChargeTax);
  const paymentFinalTotal = paymentBaseTotal + serviceChargeAmount;
  const cashChangeTotal = useMemo(() => {
    return paymentLines.reduce((total, line) => {
      if (line.method !== 'cash') return total;
      const received = parsePaymentAmount(line.cashReceived || '');
      const amount = parsePaymentAmount(line.amount || '');
      return total + Math.max(0, received - amount);
    }, 0);
  }, [paymentLines]);

  const loadSession = async (silent = false) => {
    if (!sessionId) return;

    if (silent) {
      setSyncing(true);
    } else {
      setLoading((current) => current && !session);
    }

    try {
      const currentWaiterSession = await loadWaiterWebSession();
      if (!currentWaiterSession) {
        navigate('/waiter-login', { replace: true });
        return;
      }

      const response = await getWaiterSessionDetails(sessionId);
      applySession(response.session);
      setSessionLoadIssue('');
    } catch (error: any) {
      const message = String(error?.message || 'Nao foi possivel carregar a mesa.');
      if (!silent || !session) {
        setSessionLoadIssue(message);
      }

      if (message.toLowerCase().includes('sess')) {
        await logoutWaiterWeb();
        navigate('/waiter-login', { replace: true });
        return;
      }

      if (!silent && !session) {
        toast({
          title: 'Erro ao carregar mesa',
          description: message,
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  const loadCatalog = async () => {
    try {
      const response = await listWaiterCatalog();
      setCatalog(response.categories || []);
      setCatalogLoadIssue('');
    } catch (error: any) {
      const message = error?.message || 'Nao foi possivel carregar os produtos do restaurante.';
      if (!catalog.length) {
        setCatalogLoadIssue(String(message));
      }

      if (!catalog.length) {
        toast({
          title: 'Erro ao carregar cardapio',
          description: message,
          variant: 'destructive',
        });
      }
    }
  };

  useEffect(() => {
    void loadSession(false);
    void loadCatalog();
  }, [sessionId]);

  useEffect(() => {
    let mounted = true;
    getWaiterPaymentSettings()
      .then((settings) => {
        if (mounted) setWaiterMpPixEnabled(Boolean(settings.mpWaiterPixEnabled));
      })
      .catch(() => {
        if (mounted) setWaiterMpPixEnabled(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'payments') {
      setActiveTab('payments');
    }
  }, [location.search]);

  useEffect(() => {
    syncOfflinePayments().then(({ synced }) => {
      if (synced > 0) {
        toast({
          title: 'Pagamentos sincronizados',
          description: `${synced} recebimento(s) pendente(s) foram enviados ao PopSystem.`,
        });
        void loadSession(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const interval = window.setInterval(() => {
      if (document.hidden || productDialogOpen || paymentDialogOpen || accountDialogOpen || submitting) return;
      void loadSession(true);
    }, 10000);

    return () => window.clearInterval(interval);
  }, [accountDialogOpen, paymentDialogOpen, productDialogOpen, sessionId, submitting]);

  const openAccountDialog = (mode: 'create' | 'edit', account?: TableAccount) => {
    setAccountDialogMode(mode);
    setEditingAccountId(account?.id || '');
    setAccountName(account?.name || '');
    setAccountCommandCode(account?.commandCode || '');
    setAccountDialogOpen(true);
  };

  const buildSelectedOptionsFromItem = (product: Product, itemOptions: TableAccount['items'][number]['options']) => {
    const nextOptions: Record<string, ProductOption[]> = {};

    product.variations.forEach((group) => {
      const matches = group.options.filter((option) =>
        itemOptions.some((itemOption) => {
          const optionLabel = String(itemOption.optionName || '').trim().toLowerCase();
          return (
            optionLabel === option.name.trim().toLowerCase() ||
            optionLabel === buildOptionLabel(group.name, option.name).toLowerCase()
          );
        }),
      );
      if (matches.length) {
        nextOptions[group.id] = matches.map((option) => ({
          ...option,
          quantity: 1,
          groupName: group.name,
          optionName: buildOptionLabel(group.name, option.name),
        }));
      }
    });

    return nextOptions;
  };

  const openProductDialog = (account: TableAccount, itemId?: string) => {
    const item = itemId ? account.items.find((current) => current.id === itemId) || null : null;
    const product = item ? catalogProducts.find((current) => current.id === item.productId) || null : null;

    setCatalogAccountId(account.id);
    setEditingItemId(item?.id || '');
    setSelectedProductId(product?.id || '');
    setSelectedOptions(product && item ? buildSelectedOptionsFromItem(product, item.options) : {});
    const isWeighted = product?.weightBased || item?.saleUnit === 'kg';
    setWeightInputUnit('g');
    setQuantity(isWeighted && item ? String(Math.round(item.quantity * 1000)) : String(item?.quantity || 1));
    setItemNotes(item?.notes || '');
    setProductSearch('');
    setSelectedCategoryId(product?.categoryId || 'all');
    setProductDialogStep(product ? 'configure' : 'browse');
    setProductDialogOpen(true);
  };

  const selectProductForDialog = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedOptions({});
    setWeightInputUnit('g');
    setQuantity(product.weightBased ? '300' : '1');
    setItemNotes('');
    setProductDescriptionExpanded(false);
    setProductDialogStep('configure');
  };

  const resetProductDialog = () => {
    setProductDialogOpen(false);
    setProductDialogStep('browse');
    setCatalogAccountId('');
    setEditingItemId('');
    setSelectedProductId('');
    setSelectedOptions({});
    setQuantity('1');
    setWeightInputUnit('g');
    setItemNotes('');
    setProductSearch('');
    setSelectedCategoryId('all');
    setProductDescriptionExpanded(false);
  };

  const returnToProductBrowse = () => {
    setEditingItemId('');
    setSelectedProductId('');
    setSelectedOptions({});
    setQuantity('1');
    setWeightInputUnit('g');
    setItemNotes('');
    setProductDialogStep('browse');
    setProductDescriptionExpanded(false);
  };

  const toggleOption = (group: Product['variations'][number], option: ProductOption) => {
    setSelectedOptions((current) => {
      const existing = current[group.id] || [];
      const alreadySelected = existing.some((item) => item.id === option.id);

      if (alreadySelected) {
        return {
          ...current,
          [group.id]: existing.filter((item) => item.id !== option.id),
        };
      }

      if (group.maxSelections > 1 && existing.length >= group.maxSelections) {
        return current;
      }

      const nextOption = {
        ...option,
        quantity: option.quantity || 1,
        groupName: group.name,
        optionName: buildOptionLabel(group.name, option.name),
      };

      const nextOptions = group.maxSelections <= 1 ? [nextOption] : [...existing, nextOption];
      return {
        ...current,
        [group.id]: nextOptions,
      };
    });
  };

  const handleSaveAccount = async () => {
    if (!session || !accountName.trim()) return;

    setSubmitting(true);
    try {
      const response =
        accountDialogMode === 'create'
          ? await createWaiterAccount(session.id, accountName.trim(), '', accountCommandCode.trim())
          : await renameWaiterAccount(editingAccountId, accountName.trim(), '', accountCommandCode.trim());

      applySession(response.session);
      setAccountDialogOpen(false);
      setEditingAccountId('');
      setAccountName('');
      setAccountCommandCode('');
      toast({
        title: accountDialogMode === 'create' ? 'Comanda criada' : 'Comanda atualizada',
        description: 'A configuracao da comanda foi salva com sucesso.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro na comanda',
        description: error?.message || 'Nao foi possivel salvar a comanda.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveAccount = async (account: TableAccount) => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await removeWaiterAccount(account.id);
      applySession(response.session);
      toast({
        title: 'Comanda removida',
        description: `${account.name} saiu da mesa.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao remover comanda',
        description: error?.message || 'Nao foi possivel remover a comanda.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddOrUpdateItem = async () => {
    if (!session || !activeAccount || !selectedProduct) return;

    const missingRequired = selectedProduct.variations.some(
      (group) => group.required && !(selectedOptions[group.id] || []).length,
    );

    if (missingRequired) {
      toast({
        title: 'Complementos obrigatorios',
        description: 'Selecione todos os grupos obrigatorios antes de salvar o item.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const typedQuantity = parseDecimalInput(quantity);
      const normalizedQuantity = selectedProduct.weightBased
        ? weightInputUnit === 'g'
          ? typedQuantity / 1000
          : typedQuantity
        : Math.max(1, Math.floor(typedQuantity));
      if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
        toast({
          title: selectedProduct.weightBased ? 'Informe um peso válido' : 'Informe uma quantidade válida',
          variant: 'destructive',
        });
        return;
      }

      const payload = {
        quantity: selectedProduct.weightBased ? Number(normalizedQuantity.toFixed(3)) : normalizedQuantity,
        notes: itemNotes,
        selectedOptions: Object.values(selectedOptions).flat(),
      };

      const response = editingItem
        ? await updateWaiterDraftItem({
            itemId: editingItem.id,
            ...payload,
          })
        : await addWaiterItem({
            sessionId: session.id,
            accountId: activeAccount.id,
            productId: selectedProduct.id,
            ...payload,
          });

      applySession(response.session);
      if (editingItem) {
        resetProductDialog();
      } else {
        returnToProductBrowse();
      }
      toast({
        title: editingItem ? 'Item atualizado' : 'Item adicionado',
        description: `${selectedProduct.name} foi salvo na comanda.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao salvar item',
        description: error?.message || 'Nao foi possivel salvar o item.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelDraft = async (accountId: string, itemId: string) => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await cancelWaiterDraftItem(itemId, accountId, session.id);
      applySession(response.session);
      toast({
        title: 'Rascunho removido',
        description: 'O item saiu da comanda.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao remover item',
        description: error?.message || 'Nao foi possivel remover o item.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendAccount = async (account: TableAccount) => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await sendWaiterAccountItems(session.id, account.id);
      applySession(response.session);
      const totalSent = Number(response.itemCount || account.draftCount || 0);
      const kitchenSent = Number(response.kitchenItemCount || 0);
      const accountOnly = Math.max(totalSent - kitchenSent, 0);
      toast({
        title: kitchenSent > 0 ? 'Pedido enviado' : 'Itens lançados',
        description:
          kitchenSent > 0
            ? `${account.name}: ${kitchenSent} item(ns) para cozinha${accountOnly > 0 ? ` e ${accountOnly} item(ns) apenas na conta` : ''}.`
            : `${account.name}: itens ficaram apenas na conta da mesa.`,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao enviar pedido',
        description: error?.message || 'Nao foi possivel enviar esta comanda.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendAllAccounts = async () => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await sendAllWaiterSessionItems(session.id);
      applySession(response.session);
      const sentAccounts = Number(response.sentAccounts || 0);
      const totalSent = Number(response.itemCount || 0);
      const kitchenSent = Number(response.kitchenItemCount || 0);
      const accountOnly = Math.max(totalSent - kitchenSent, 0);
      toast({
        title: kitchenSent > 0 ? 'Pedidos enviados' : 'Itens lançados',
        description:
          kitchenSent > 0
            ? `${kitchenSent} item(ns) para cozinha${accountOnly > 0 ? ` e ${accountOnly} item(ns) apenas na conta` : ''} em ${sentAccounts || 1} comanda(s).`
            : 'As comandas pendentes ficaram apenas na conta da mesa.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao enviar pedidos',
        description: error?.message || 'Nao foi possivel enviar as comandas da mesa.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openPaymentDialog = (account?: TableAccount, sourceSession?: TableSession) => {
    const baseSession = sourceSession || session;
    if (!baseSession) return;

    const lines = account
      ? [createPaymentLine(account.id, account.dueAmount || account.total)]
      : baseSession.accounts
          .filter((current) => current.dueAmount > 0)
          .map((current) => createPaymentLine(current.id, current.dueAmount));

    setPaymentLines(lines.length ? lines : [createPaymentLine(baseSession.accounts[0]?.id || '', 0)]);
    setServiceChargeAccepted(shouldAutoApplyServiceCharge(baseSession.serviceChargeSettings));
    setPaymentDialogOpen(true);
  };

  const handlePaymentLineChange = (lineId: string, key: keyof PaymentLine, value: string) => {
    setPaymentLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, [key]: value };
        if (key === 'method') {
          next.cashReceived = value === 'cash' ? line.cashReceived || line.amount : '';
        }
        return next;
      }),
    );
  };

  const splitSelectedAccount = () => {
    if (!session || !paymentLines.length) return;

    const people = Math.max(2, Number(splitPeople || 2));
    const firstLine = paymentLines[0];
    const account = session.accounts.find((current) => current.id === firstLine.accountId) || session.accounts.find((current) => current.dueAmount > 0);
    if (!account || account.dueAmount <= 0) return;

    const baseAmount = Math.floor((account.dueAmount / people) * 100) / 100;
    const lines = Array.from({ length: people }).map((_, index) => {
      const amount = index === people - 1 ? Number((account.dueAmount - baseAmount * (people - 1)).toFixed(2)) : baseAmount;
      return createPaymentLine(account.id, amount, firstLine.method || 'pix');
    });

    setPaymentLines(lines);
  };

  const handleSavePayments = async () => {
    if (!session) return;

    const initialPayload: WaiterPaymentInput[] = paymentLines
      .map((line) => ({
        accountId: line.accountId,
        method: line.method,
        amount: parsePaymentAmount(line.amount),
      }))
      .filter((line) => line.accountId && line.amount > 0);

    if (!initialPayload.length) {
      toast({
        title: 'Pagamento vazio',
        description: 'Informe pelo menos uma linha de pagamento valida.',
        variant: 'destructive',
      });
      return;
    }

    const serviceSettings = session.serviceChargeSettings;
    const serviceEnabled = Boolean(serviceSettings?.enabled && serviceChargeAccepted);
    const servicePercent = Math.max(0, Number(serviceSettings?.percentage || 10));

    setSubmitting(true);
    const payload: WaiterPaymentInput[] = [];

    try {
      const canStartOnlinePix =
        waiterMpPixEnabled &&
        !serviceEnabled &&
        initialPayload.length === 1 &&
        initialPayload[0].method === 'pix';

      if (canStartOnlinePix) {
        const payment = initialPayload[0];
        const targetAccount = session.accounts.find((account) => account.id === payment.accountId);
        if (!targetAccount) throw new Error('Selecione uma comanda valida para receber.');

        const checkout = await startWaiterPixCheckout({
          sessionId: session.id,
          accountId: payment.accountId,
          amount: payment.amount,
          accountName: targetAccount.name,
          tableLabel: session.tableLabel,
        });

        setPixCheckout({
          ...checkout,
          accountId: payment.accountId,
          amount: payment.amount,
        });
        setPaymentDialogOpen(false);
        return;
      }

      let stoneAvailable = false;
      if (initialPayload.some((payment) => stonePaymentMethods.includes(payment.method))) {
        const stoneStatus = await stoneProvider.getStatus?.().catch(() => null);
        stoneAvailable = Boolean(stoneStatus?.available);
      }

      for (const payment of initialPayload) {
        const targetAccount = session.accounts.find((account) => account.id === payment.accountId);
        if (!targetAccount) throw new Error('Selecione uma comanda valida para receber.');

        if (stonePaymentMethods.includes(payment.method) && stoneAvailable) {
          const stoneResult = await stoneProvider.startPayment({
            amount: payment.amount,
            paymentType: payment.method === 'pix' ? 'pix' : payment.method === 'debit' ? 'debit' : 'credit',
            installments: payment.method === 'credit' ? 1 : undefined,
            accountId: payment.accountId,
            sessionId: session.id,
            tableId: session.tableId,
            tableLabel: session.tableLabel,
            accountName: targetAccount.name,
            reference: `${session.tableLabel}-${targetAccount.name}-${Date.now()}`,
          });

          payload.push({
            ...payment,
            amount: stoneResult.amount || payment.amount,
            provider: 'stone',
            transactionId: stoneResult.transaction_id,
            atk: stoneResult.atk,
            nsu: stoneResult.nsu,
            authorizationCode: stoneResult.authorization_code,
            installments: stoneResult.installments,
            status: stoneResult.status,
            date: stoneResult.date,
            deviceId: stoneResult.device_id,
            terminal: stoneResult.terminal,
            stoneCode: stoneResult.stone_code,
            receiptText: stoneResult.receiptText,
            raw: stoneResult.raw,
          });
          continue;
        }

        payload.push({ ...payment, provider: 'manual', status: 'approved', date: new Date().toISOString() });
      }

      const response = await recordWaiterPayments(session.id, payload, {
        enabled: serviceEnabled,
        percentage: servicePercent,
      });
      applySession(response.session);
      const hasRemainingBalance = response.session.accounts.some((account) => account.dueAmount > 0);
      if (hasRemainingBalance) {
        openPaymentDialog(undefined, response.session);
      } else {
        setPaymentDialogOpen(false);
      }
      toast({
        title: 'Pagamento registrado',
        description: hasRemainingBalance
          ? `Recebimento salvo. Saldo restante: ${formatMoney(response.session.dueAmount)}.`
          : 'Conta quitada. Mesa fechada pelo PopSystem.',
      });
    } catch (error: any) {
      const approvedStonePayments = payload.filter((payment) => payment.provider === 'stone' && payment.status === 'approved');
      if (approvedStonePayments.length > 0) {
        enqueueOfflinePayment({
          sessionId: session.id,
          payments: approvedStonePayments,
          serviceCharge: { enabled: serviceEnabled, percentage: servicePercent },
        });
      }

      toast({
        title: approvedStonePayments.length ? 'Stone aprovou, PopSystem vai sincronizar' : 'Erro ao receber pagamento',
        description:
          error?.message ||
          (approvedStonePayments.length
            ? 'O recebimento ficou salvo neste aparelho para sincronizar quando a conexao voltar.'
            : 'Nao foi possivel concluir este recebimento.'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePixCheckoutClosed = () => {
    setPixCheckout(null);
    if (session?.dueAmount && session.dueAmount > 0) {
      openPaymentDialog(undefined, session);
    }
  };

  const handlePixPaymentConfirmed = async () => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await getWaiterSessionDetails(session.id);
      applySession(response.session);
      setPixCheckout(null);

      const hasRemainingBalance = response.session.accounts.some((account) => account.dueAmount > 0);
      if (hasRemainingBalance) {
        openPaymentDialog(undefined, response.session);
        toast({
          title: 'PIX confirmado',
          description: 'Pagamento confirmado. O restante da mesa continua disponivel para recebimento.',
        });
      } else {
        setPaymentDialogOpen(false);
        toast({
          title: 'PIX confirmado',
          description: 'Pagamento confirmado e mesa atualizada com sucesso.',
        });
      }
    } catch (error: any) {
      setPixCheckout(null);
      toast({
        title: 'PIX confirmado, mas faltou sincronizar',
        description: error?.message || 'O pagamento foi confirmado, mas nao conseguimos atualizar a mesa agora.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMoveItem = async () => {
    if (!moveItemId || !moveTargetAccountId) return;

    setSubmitting(true);
    try {
      const response = await moveWaiterItem({
        itemId: moveItemId,
        targetAccountId: moveTargetAccountId,
        quantity: Math.max(0.001, Math.round(parseDecimalInput(moveQuantity) * 1000) / 1000),
      });
      applySession(response.session);
      setMoveItemId('');
      setMoveTargetAccountId('');
      setMoveQuantity('1');
      toast({
        title: 'Divisão concluída',
        description: 'A cobrança foi redistribuída sem reenviar o item para a cozinha.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao mover item',
        description: error?.message || 'Nao foi possivel mover o item.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMergeAccounts = async () => {
    if (!mergeSourceAccountId || !mergeTargetAccountId) return;

    setSubmitting(true);
    try {
      const response = await mergeWaiterAccounts(mergeSourceAccountId, mergeTargetAccountId);
      applySession(response.session);
      setMergeSourceAccountId('');
      setMergeTargetAccountId('');
      toast({
        title: 'Comandas unificadas',
        description: 'Os itens e pagamentos foram consolidados.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao juntar comandas',
        description: error?.message || 'Nao foi possivel juntar estas comandas.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransferAccount = async () => {
    if (!transferAccountId || !transferAccountTargetId) return;

    setSubmitting(true);
    try {
      const response = await transferWaiterAccount(transferAccountId, transferAccountTargetId);
      applySession(response.session);
      setTransferAccountId('');
      setTransferAccountTargetId('');
      toast({
        title: 'Comanda transferida',
        description: 'A comanda foi movida para a nova mesa.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao transferir comanda',
        description: error?.message || 'Nao foi possivel transferir esta comanda.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransferTable = async () => {
    if (!session || !transferTableTargetId) return;

    setSubmitting(true);
    try {
      const response = await transferWaiterTable(session.id, transferTableTargetId);
      applySession(response.session);
      setTransferTableOpen(false);
      setTransferTableTargetId('');
      toast({
        title: 'Mesa transferida',
        description: 'Toda a operacao foi levada para a nova mesa.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao transferir mesa',
        description: error?.message || 'Nao foi possivel transferir a mesa.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestCheck = async () => {
    if (!session) return;

    setSubmitting(true);
    try {
      const response = await requestWaiterCheck(session.id);
      applySession(response.session);
      toast({
        title: 'Conta sinalizada',
        description: 'A mesa entrou em fluxo de fechamento.',
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao solicitar conta',
        description: error?.message || 'Nao foi possivel sinalizar a conta.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReleaseTable = async () => {
    if (!session) return;

    setSubmitting(true);
    try {
      await releaseWaiterTable(session.id);
      toast({
        title: 'Mesa liberada',
        description: 'O atendimento da mesa foi encerrado.',
      });
      navigate('/waiter-dashboard', { replace: true });
    } catch (error: any) {
      toast({
        title: 'Erro ao liberar mesa',
        description: error?.message || 'Nao foi possivel liberar a mesa.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07281e]">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-[#A4D65E]/15 border-t-[#FF6400]" />
      </div>
    );
  }

  if (!session) return null;

  const showProductBrowsePane = productDialogStep === 'browse' || !selectedProduct;
  const showProductConfigurePane = Boolean(selectedProduct) && productDialogStep === 'configure';

  return (
    <div
      data-testid="waiter-session-scroll"
      className="h-[100dvh] w-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[radial-gradient(circle_at_top,#0B5138_0%,#083927_42%,#072C1F_100%)] pb-24 text-slate-900 [-webkit-overflow-scrolling:touch]"
    >
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.08] p-2.5 text-white shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] backdrop-blur-sm sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              className="h-9 rounded-full border-white/15 bg-white/10 px-3 text-xs text-white hover:bg-white/15 hover:text-white"
              onClick={() => navigate('/waiter-dashboard')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Mesas</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                onClick={() => void loadSession(true)}
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                onClick={() => setTransferTableOpen(true)}
              >
                <MoveRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-2.5 flex flex-col items-center text-center">
            <Logo size="sm" theme="dark" className="justify-center" />
            <div className="mt-1.5 inline-flex rounded-full bg-white/10 px-3 py-1 text-[9px] font-medium uppercase tracking-[0.16em] text-white/75">
              App web Garcom
            </div>
            <h1 className="mt-2 text-[1.35rem] font-semibold leading-none text-white sm:mt-3 sm:text-3xl">{session.tableLabel}</h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-white/75 sm:text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5">
                <Clock3 className="h-3 w-3 text-[#A4D65E]" />
                {formatElapsedSince(session.openedAt)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5">
                <Users className="h-3 w-3 text-[#A4D65E]" />
                {session.accountCount} comandas
              </span>
              <WaiterStatusBadge
                status={
                  session.status === 'payment_pending'
                    ? 'check_requested'
                    : session.readyItemsCount > 0
                      ? 'ready'
                      : session.sentItemsCount > 0
                        ? 'preparing'
                        : 'occupied'
                }
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5 sm:gap-2">
            <div className="rounded-[14px] border border-white/10 bg-white/[0.08] px-2 py-1.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/60">Total</span>
                <ReceiptText className="h-3 w-3 text-[#A4D65E]" />
              </div>
              <div className="mt-1 text-sm font-semibold text-white sm:text-lg">{formatMoney(session.total)}</div>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/[0.08] px-2 py-1.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/60">Recebido</span>
                <CircleDollarSign className="h-3 w-3 text-[#A4D65E]" />
              </div>
              <div className="mt-1 text-sm font-semibold text-white sm:text-lg">{formatMoney(session.paidTotal)}</div>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/[0.08] px-2 py-1.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/60">Saldo</span>
                <NotebookPen className="h-3 w-3 text-[#A4D65E]" />
              </div>
              <div className="mt-1 text-sm font-semibold text-white sm:text-lg">{formatMoney(session.dueAmount)}</div>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/[0.08] px-2 py-1.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/60">Cozinha</span>
                <ChefHat className="h-3 w-3 text-[#A4D65E]" />
              </div>
              <div className="mt-1 text-sm font-semibold text-white sm:text-lg">
                {session.sentItemsCount} <span className="text-[11px] text-white/60">/ {session.readyItemsCount} prontos</span>
              </div>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:gap-2">
            <Button className="h-8 rounded-xl bg-[#FF6400] px-2.5 text-[11px] text-white hover:bg-[#E25A00] sm:h-9 sm:px-3 sm:text-sm" onClick={() => openAccountDialog('create')}>
              <PlusCircle className="mr-1.5 h-3 w-3 sm:h-3.5 sm:w-3.5" />
              Nova
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-xl border-white/15 bg-white/10 px-2.5 text-[11px] text-white hover:bg-white/15 hover:text-white sm:h-9 sm:px-3 sm:text-sm"
              onClick={handleSendAllAccounts}
              disabled={submitting || !hasDraftAccounts}
            >
              <Send className="mr-1.5 h-3 w-3 sm:h-3.5 sm:w-3.5" />
              Enviar tudo
            </Button>
            <Button variant="outline" className="h-8 rounded-xl border-white/15 bg-white/10 px-2.5 text-[11px] text-white hover:bg-white/15 hover:text-white sm:h-9 sm:px-3 sm:text-sm" onClick={handleRequestCheck} disabled={submitting || session.dueAmount <= 0}>
              Solicitar conta
            </Button>
            <Button className="h-8 rounded-xl bg-[#082F23] px-2.5 text-[11px] text-white hover:bg-[#0B4A36] sm:h-9 sm:px-3 sm:text-sm" onClick={() => openPaymentDialog()} disabled={submitting || session.dueAmount <= 0}>
              Receber
            </Button>
            <Button variant="outline" className="h-8 rounded-xl border-white/15 bg-white/10 px-2.5 text-[11px] text-white hover:bg-white/15 hover:text-white sm:h-9 sm:px-3 sm:text-sm" onClick={handleReleaseTable} disabled={submitting || session.dueAmount > 0}>
              Liberar
            </Button>
          </div>

          {sessionLoadIssue || catalogLoadIssue ? (
            <div className="mt-3 rounded-[18px] border border-amber-200/40 bg-amber-100/10 px-3 py-2 text-left text-xs leading-5 text-white/80">
              Sincronizacao instavel. O app continua com os ultimos dados salvos enquanto tenta reconectar.
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          <Card className="rounded-[22px] border border-[#DCE6D8] bg-white shadow-sm">
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div>
                <h2 className="text-base font-semibold text-[#082F23] sm:text-xl">Pedido</h2>
              </div>

              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'accounts' | 'timeline' | 'payments')} className="w-full">
                <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl bg-[#F1F5EF] p-1">
                  <TabsTrigger value="accounts" className="rounded-xl px-2 py-1.5 text-[11px] sm:text-sm">
                    Comandas
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="rounded-xl px-2 py-1.5 text-[11px] sm:text-sm">
                    Historico
                  </TabsTrigger>
                  <TabsTrigger value="payments" className="rounded-xl px-2 py-1.5 text-[11px] sm:text-sm">
                    Pagamentos
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="accounts" className="mt-4">
                  {session.accounts.length === 0 ? (
                    <WaiterEmptyState
                      icon={<PackageOpen className="h-7 w-7" />}
                      title="Nenhuma comanda aberta"
                      description="Crie uma nova comanda para comecar a operar esta mesa."
                      action={
                        <Button className="rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={() => openAccountDialog('create')}>
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Criar comanda
                        </Button>
                      }
                    />
                  ) : (
                    <div className="grid gap-2.5 xl:grid-cols-2">
                      {session.accounts.map((account) => (
                        <Card key={account.id} className="rounded-[20px] border border-[#DCE6D8] bg-[#FBFCFA] shadow-sm">
                          <CardContent className="space-y-2.5 p-2.5 sm:p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-[15px] font-semibold text-[#082F23] sm:text-base">{account.name}</h3>
                                  {account.commandCode ? (
                                    <Badge variant="outline" className="font-mono text-[10px]">
                                      Comanda {account.commandCode}
                                    </Badge>
                                  ) : null}
                                  <WaiterStatusBadge status={account.status} />
                                  {account.kitchenStatus !== 'idle' ? <WaiterStatusBadge status={account.kitchenStatus} /> : null}
                                </div>
                                <p className="text-[11px] leading-[1.125rem] text-slate-500 sm:text-xs sm:leading-5">
                                  {account.itemCount} itens, {account.draftCount} em rascunho e {account.readyCount} prontos.
                                </p>
                              </div>

                              <div className="grid min-w-[190px] grid-cols-3 gap-1.5 sm:min-w-[210px] sm:gap-2">
                                <div className="rounded-[16px] bg-white p-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Subtotal</div>
                                  <div className="mt-1 text-[12px] font-semibold text-[#082F23] sm:text-sm">{formatMoney(account.total)}</div>
                                </div>
                                <div className="rounded-[16px] bg-white p-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Recebido</div>
                                  <div className="mt-1 text-[12px] font-semibold text-[#082F23] sm:text-sm">{formatMoney(account.paidTotal)}</div>
                                </div>
                                <div className="rounded-[16px] bg-white p-2">
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Pendente</div>
                                  <div className="mt-1 text-[12px] font-semibold text-[#082F23] sm:text-sm">{formatMoney(account.dueAmount)}</div>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <Button className="h-9 rounded-2xl bg-[#082F23] text-[11px] hover:bg-[#0B4A36] sm:h-10 sm:text-sm" onClick={() => openProductDialog(account)}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Produto
                              </Button>
                              <Button
                                variant="outline"
                                className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm"
                                onClick={() => handleSendAccount(account)}
                                disabled={submitting || account.draftCount === 0}
                              >
                                <Send className="mr-2 h-4 w-4" />
                                Enviar
                              </Button>
                              <Button variant="outline" className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm" onClick={() => openPaymentDialog(account)} disabled={account.dueAmount <= 0}>
                                Receber
                              </Button>
                              <Button variant="outline" className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm" onClick={() => openAccountDialog('edit', account)}>
                                Editar
                              </Button>
                              <Button
                                variant="outline"
                                className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm"
                                onClick={() => {
                                  setMergeSourceAccountId(account.id);
                                  setMergeTargetAccountId('');
                                }}
                                disabled={session.accounts.length < 2}
                              >
                                Juntar
                              </Button>
                              <Button
                                variant="outline"
                                className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm"
                                onClick={() => {
                                  setTransferAccountId(account.id);
                                  setTransferAccountTargetId('');
                                }}
                              >
                                Transferir
                              </Button>
                              <Button
                                variant="outline"
                                className="h-9 rounded-2xl text-[11px] sm:h-10 sm:text-sm"
                                onClick={() => void handleRemoveAccount(account)}
                                disabled={submitting || account.itemCount > 0 || account.paidTotal > 0}
                              >
                                Excluir
                              </Button>
                            </div>

                            <div className="space-y-3">
                              {account.items.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-[#D7E2D3] bg-white px-4 py-3 text-[13px] text-slate-500 sm:text-sm">
                                  Esta comanda ainda nao possui itens.
                                </div>
                              ) : (
                                account.items.map((item) => (
                                  <div key={item.id} className="rounded-[18px] border border-[#E7ECE4] bg-white p-2.5 sm:p-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                      <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-[13px] font-semibold text-[#082F23] sm:text-sm">
                                            {formatSaleQuantity(item.quantity, item.saleUnit)} {item.productName}
                                          </span>
                                          <WaiterStatusBadge status={item.status} />
                                        </div>
                                        <div className="text-[12px] text-slate-500 sm:text-sm">
                                          {item.options.length ? item.options.map((option) => option.optionName).join(', ') : 'Sem complementos'}
                                        </div>
                                        {item.notes ? <div className="text-[12px] text-slate-400 sm:text-sm">Obs: {item.notes}</div> : null}
                                      </div>
                                      <div className="text-right">
                                        <div className="text-sm font-semibold text-[#082F23] sm:text-base">{formatMoney(item.totalPrice)}</div>
                                        {item.sentAt ? (
                                          <div className="text-[11px] text-slate-400 sm:text-xs">
                                            {new Date(item.sentAt).toLocaleTimeString('pt-BR', {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                            })}
                                          </div>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {item.status === 'draft' ? (
                                        <>
                                        <Button variant="outline" className="h-8 rounded-2xl text-[11px] sm:h-9 sm:text-sm" onClick={() => openProductDialog(account, item.id)}>
                                          Editar item
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          className="h-8 rounded-2xl text-[11px] text-[#FF6400] hover:bg-[#FFF3EB] hover:text-[#E25A00] sm:h-9 sm:text-sm"
                                          onClick={() => void handleCancelDraft(account.id, item.id)}
                                        >
                                          Remover
                                        </Button>
                                        </>
                                      ) : null}
                                      <Button
                                        variant="outline"
                                        className="h-8 rounded-2xl text-[11px] sm:h-9 sm:text-sm"
                                        onClick={() => {
                                          setMoveItemId(item.id);
                                          setMoveTargetAccountId('');
                                          setMoveQuantity(String(Math.max(0.001, item.quantity / 2)).replace('.', ','));
                                        }}
                                        disabled={session.accounts.length < 2}
                                      >
                                        <Split className="mr-1.5 h-3.5 w-3.5" />
                                        Dividir / mover
                                      </Button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            {account.tickets.length ? (
                              <div className="rounded-2xl bg-[#F4F8F2] p-2.5 sm:p-3">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Envios para cozinha</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {account.tickets.map((ticket) => (
                                    <div key={ticket.id} className="rounded-full border border-[#D7E2D3] bg-white px-2.5 py-1 text-[11px] text-slate-600 sm:text-xs">
                                      {ticket.orderNumber || 'Pedido'} - {ticket.status}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="timeline" className="mt-4">
                  {session.history.length === 0 ? (
                    <WaiterEmptyState
                      icon={<Clock3 className="h-7 w-7" />}
                      title="Sem movimentacoes ainda"
                      description="Assim que itens forem enviados ou pagamentos forem registrados, o historico aparecera aqui."
                    />
                  ) : (
                    <ScrollArea className="h-[360px] pr-3 sm:h-[520px]">
                      <div className="space-y-3">
                        {session.history.map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-[#E7ECE4] bg-[#FBFCFA] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="font-semibold text-[#082F23]">{entry.label}</div>
                                <div className="text-sm text-slate-500">
                                  {new Date(entry.timestamp).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </div>
                              </div>
                              {entry.amount ? <div className="font-semibold text-[#082F23]">{formatMoney(entry.amount)}</div> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>

                <TabsContent value="payments" className="mt-4">
                  <div className="grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
                    <div className="space-y-3">
                      {session.accounts.map((account) => (
                        <div key={account.id} className="rounded-2xl border border-[#E7ECE4] bg-[#FBFCFA] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-[#082F23]">{account.name}</div>
                              <div className="mt-1 text-sm text-slate-500">
                                Recebido {formatMoney(account.paidTotal)} de {formatMoney(account.total)}
                              </div>
                            </div>
                            <WaiterStatusBadge status={account.status} />
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-2xl bg-white p-3">
                              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Recebido</div>
                              <div className="mt-1 text-base font-semibold text-[#082F23]">{formatMoney(account.paidTotal)}</div>
                            </div>
                            <div className="rounded-2xl bg-white p-3">
                              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Saldo</div>
                              <div className="mt-1 text-base font-semibold text-[#082F23]">{formatMoney(account.dueAmount)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-[#082F23]">Historico de pagamentos</h3>
                          <p className="text-sm text-slate-500">Tudo o que ja entrou no caixa desta mesa.</p>
                        </div>
                        <Button className="rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={() => openPaymentDialog()} disabled={session.dueAmount <= 0}>
                          Registrar
                        </Button>
                      </div>

                      {paymentHistory.length === 0 ? (
                        <WaiterEmptyState
                          icon={<CircleDollarSign className="h-7 w-7" />}
                          title="Nenhum pagamento lancado"
                          description="Quando algum recebimento entrar, ele aparecera com comanda, valor e forma de pagamento."
                        />
                      ) : (
                        <div className="space-y-3">
                          {paymentHistory.map((payment) => (
                            <div key={payment.id} className="rounded-2xl border border-[#E7ECE4] bg-[#FBFCFA] p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="font-semibold text-[#082F23]">{payment.accountName}</div>
                                  <div className="mt-1 text-sm uppercase tracking-[0.14em] text-slate-400">
                                    {paymentMethodLabel[payment.method] || payment.method}
                                  </div>
                                  <div className="mt-1 text-sm text-slate-500">
                                    {new Date(payment.createdAt).toLocaleString('pt-BR', {
                                      day: '2-digit',
                                      month: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </div>
                                  {payment.nsu || payment.atk || payment.authorizationCode ? (
                                    <div className="mt-2 grid gap-1 text-xs text-slate-500">
                                      {payment.nsu ? <span>NSU: {payment.nsu}</span> : null}
                                      {payment.atk ? <span>ATK: {payment.atk}</span> : null}
                                      {payment.authorizationCode ? <span>Autorizacao: {payment.authorizationCode}</span> : null}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="text-right">
                                  <div className="font-semibold text-[#082F23]">{formatMoney(payment.amount)}</div>
                                  {payment.transactionId ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="mt-2 h-8 rounded-xl text-xs"
                                      onClick={async () => {
                                        try {
                                          await stoneProvider.reprintReceipt?.(payment.transactionId || '');
                                          toast({ title: 'Reimpressao enviada', description: 'Comprovante solicitado na Stone.' });
                                        } catch (error: any) {
                                          toast({
                                            title: 'Reimpressao indisponivel',
                                            description: error?.message || 'Use essa opcao no POS Android com Stone.',
                                            variant: 'destructive',
                                          });
                                        }
                                      }}
                                    >
                                      Reimprimir
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      <WaiterBottomNav
        items={[
          {
            key: 'accounts',
            label: 'Comandas',
            icon: <ReceiptText className="h-4 w-4" />,
            active: activeTab === 'accounts',
            onClick: () => setActiveTab('accounts'),
          },
          {
            key: 'payments',
            label: 'Pagamentos',
            icon: <CircleDollarSign className="h-4 w-4" />,
            active: activeTab === 'payments',
            onClick: () => setActiveTab('payments'),
          },
          {
            key: 'timeline',
            label: 'Historico',
            icon: <Clock3 className="h-4 w-4" />,
            active: activeTab === 'timeline',
            onClick: () => setActiveTab('timeline'),
          },
          {
            key: 'tables',
            label: 'Mesas',
            icon: <ArrowLeft className="h-4 w-4" />,
            onClick: () => navigate('/waiter-dashboard'),
          },
        ]}
      />

      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="rounded-[28px] border-0 sm:max-w-md">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">
            {accountDialogMode === 'create' ? 'Nova comanda' : 'Editar comanda'}
          </DialogTitle>
          <DialogDescription>
            Nomeie a comanda para separar familias, casais ou pagantes independentes dentro da mesa.
          </DialogDescription>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accountName">Nome da comanda</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                className="h-12 rounded-2xl"
                placeholder="Ex: Joao, Familia, Criancas"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountCommandCode">Comanda eletrônica (código de barras)</Label>
              <Input
                id="accountCommandCode"
                value={accountCommandCode}
                onChange={(event) => setAccountCommandCode(event.target.value.toUpperCase())}
                className="h-12 rounded-2xl font-mono"
                placeholder="Leia ou digite o código"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Opcional. A mesma comanda física poderá ser reutilizada após o fechamento desta conta.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-3 sm:justify-between">
            <Button variant="outline" className="rounded-2xl" onClick={() => setAccountDialogOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={handleSaveAccount} disabled={submitting || !accountName.trim()}>
              Salvar comanda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pixCheckout ? (
        <PixCheckoutModal
          isOpen={!!pixCheckout}
          onClose={handlePixCheckoutClosed}
          correlationID={pixCheckout.correlationID}
          brCode={pixCheckout.brCode}
          qrCodeImage={pixCheckout.qrCodeImage}
          paymentLinkUrl={pixCheckout.paymentLinkUrl}
          paymentId={pixCheckout.paymentId}
          onPaymentConfirmed={() => {
            void handlePixPaymentConfirmed();
          }}
        />
      ) : null}

      <Dialog open={productDialogOpen} onOpenChange={(open) => (open ? setProductDialogOpen(true) : resetProductDialog())}>
        <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 grid-rows-none flex-col overflow-x-hidden overflow-y-hidden rounded-none border-0 p-0 sm:left-[50%] sm:top-[50%] sm:h-[92dvh] sm:max-h-[92dvh] sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-[28px]">
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[0.95fr,1.05fr]">
            <div className={`${showProductBrowsePane ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col border-b border-slate-100 p-4 lg:flex lg:border-b-0 lg:border-r lg:p-5`}>
              <DialogTitle className="text-xl font-semibold text-[#082F23]">
                {editingItem ? 'Editar item' : 'Adicionar produto'}
              </DialogTitle>

              {catalogLoadIssue ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                  Cardapio offline no momento. Exibindo os ultimos produtos carregados.
                </div>
              ) : null}

              <div className="mt-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    className="h-10 rounded-2xl pl-10"
                    placeholder="Buscar produto"
                  />
                </div>

                <ScrollArea className="w-full whitespace-nowrap">
                  <div className="flex gap-1.5 pb-2">
                    <Button
                      type="button"
                      variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                      className={selectedCategoryId === 'all' ? 'h-8 rounded-full bg-[#082F23] px-3 text-xs hover:bg-[#0B4A36]' : 'h-8 rounded-full px-3 text-xs'}
                      onClick={() => setSelectedCategoryId('all')}
                    >
                      Todas
                    </Button>
                    {catalog.map((category) => (
                      <Button
                        key={category.id}
                        type="button"
                        variant={selectedCategoryId === category.id ? 'default' : 'outline'}
                        className={selectedCategoryId === category.id ? 'h-8 rounded-full bg-[#082F23] px-3 text-xs hover:bg-[#0B4A36]' : 'h-8 rounded-full px-3 text-xs'}
                        onClick={() => setSelectedCategoryId(category.id)}
                      >
                        {category.name}
                      </Button>
                    ))}
                  </div>
                </ScrollArea>

                <ScrollArea className="h-[calc(100dvh-12.5rem)] min-h-0 w-full max-w-full sm:h-[calc(92dvh-12.5rem)] lg:h-[calc(92dvh-10rem)]">
                  <div className="space-y-4 pr-1.5">
                    {filteredCategories.map((category) => (
                      <div key={category.id}>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{category.name}</div>
                        <div className="space-y-2">
                          {category.products.map((product) => {
                            const imageUrl = normalizeImageUrlForDisplay(product.imageUrl);
                            const isSelected = selectedProductId === product.id;

                            return (
                              <div
                                key={product.id}
                                className={`flex min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-[18px] border px-2.5 py-2 transition ${
                                  isSelected ? 'border-[#082F23] bg-[#EEF4E9]' : 'border-[#DCE6D8] bg-white'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectProductForDialog(product)}
                                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                >
                                  <div className="h-10 w-10 flex-none overflow-hidden rounded-xl bg-[#EEF4E9]">
                                    {imageUrl ? (
                                      <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-[#0B4A36]">
                                        Sem foto
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-semibold text-[#082F23]">{product.name}</div>
                                    <div className="mt-0.5 text-[11px] font-medium text-slate-500">
                                      {formatMoney(product.price)}{product.weightBased ? '/kg' : ''}
                                    </div>
                                  </div>
                                </button>

                                <Button
                                  type="button"
                                  size="icon"
                                  className="h-8 w-8 flex-none rounded-full bg-[#FF6400] text-white hover:bg-[#E25A00]"
                                  onClick={() => selectProductForDialog(product)}
                                >
                                  <PlusCircle className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className={`${showProductConfigurePane ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col overflow-hidden bg-[#F4F8F2] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:flex lg:p-5`}>
              {selectedProduct ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between gap-3 lg:hidden">
                    <Button variant="outline" className="h-9 rounded-2xl" onClick={() => setProductDialogStep('browse')}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Produtos
                    </Button>
                    <div className="text-xs font-medium text-slate-500">{activeAccount?.name || 'Comanda'}</div>
                  </div>

                  <div className="mt-3 rounded-[24px] bg-white p-4 shadow-sm lg:mt-0">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-xl font-semibold text-[#082F23]">{selectedProduct.name}</div>
                        {selectedProduct.description ? (
                          <div className="mt-1">
                            <div className={`${productDescriptionExpanded ? '' : 'line-clamp-2'} break-words text-sm leading-5 text-slate-500`}>
                              {selectedProduct.description}
                            </div>
                            {selectedProduct.description.length > 90 ? (
                              <button
                                type="button"
                                className="mt-1 text-xs font-semibold text-[#0B6B4B]"
                                onClick={() => setProductDescriptionExpanded((current) => !current)}
                              >
                                {productDescriptionExpanded ? 'Recolher descrição' : 'Ver descrição completa'}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex-none whitespace-nowrap text-lg font-semibold text-[#082F23]">
                        {formatMoney(selectedProduct.price)}{selectedProduct.weightBased ? '/kg' : ''}
                      </div>
                    </div>
                  </div>

                  <ScrollArea className="mt-3 min-h-0 flex-1 pr-2">
                    <div className="space-y-3">
                      {selectedProduct.variations.map((group) => (
                        <div key={group.id} className="rounded-[20px] bg-white p-3 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[13px] font-semibold text-[#082F23]">{group.name}</div>
                            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              {group.required ? 'Obrigatorio' : `Ate ${group.maxSelections}`}
                            </div>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {group.options.map((option) => {
                              const selected = (selectedOptions[group.id] || []).some((item) => item.id === option.id);
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => toggleOption(group, option)}
                                  className={`flex w-full items-center justify-between rounded-[16px] border px-3 py-2 text-left transition ${
                                    selected ? 'border-[#082F23] bg-[#EEF4E9]' : 'border-[#DCE6D8] bg-white'
                                  }`}
                                >
                                  <div className="min-w-0 pr-3">
                                    <div className="truncate text-[13px] font-medium text-slate-700">{option.name}</div>
                                    <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                                      {option.price ? `+ ${formatMoney(option.price)}` : 'Incluso'}
                                    </div>
                                  </div>
                                  <span
                                    className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border transition ${
                                      selected
                                        ? 'border-[#082F23] bg-[#082F23] text-white'
                                        : 'border-[#DCE6D8] bg-white text-[#0B4A36]'
                                    }`}
                                  >
                                    {selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {selectedProduct.variations.length === 0 ? (
                        <div className="rounded-[22px] bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">Sem complementos para este produto.</div>
                      ) : null}

                      <div className="rounded-[22px] bg-white p-3 shadow-sm">
                        {selectedProduct.weightBased ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <Label htmlFor="itemQuantity" className="flex items-center gap-2">
                                <Scale className="h-4 w-4 text-[#FF6400]" />
                                Peso
                              </Label>
                              <div className="flex rounded-xl border border-[#DCE6D8] bg-[#F7FAF5] p-1">
                                {(['g', 'kg'] as const).map((unit) => (
                                  <button
                                    key={unit}
                                    type="button"
                                    aria-pressed={weightInputUnit === unit}
                                    onClick={() => {
                                      const current = parseDecimalInput(quantity);
                                      setQuantity(unit === 'kg' && weightInputUnit === 'g'
                                        ? (current / 1000).toString().replace('.', ',')
                                        : unit === 'g' && weightInputUnit === 'kg'
                                          ? String(Math.round(current * 1000))
                                          : quantity);
                                      setWeightInputUnit(unit);
                                    }}
                                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${weightInputUnit === unit ? 'bg-[#082F23] text-white' : 'text-slate-500'}`}
                                  >
                                    {unit}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <Input
                              id="itemQuantity"
                              inputMode="decimal"
                              value={quantity}
                              onChange={(event) => setQuantity(event.target.value.replace(/[^\d,.]/g, '').slice(0, 8))}
                              className="h-10 rounded-2xl"
                              placeholder={weightInputUnit === 'g' ? 'Ex.: 300' : 'Ex.: 1,000'}
                            />
                            <div className="grid grid-cols-5 gap-1.5">
                              {[100, 200, 300, 500, 1000].map((grams) => (
                                <Button
                                  key={grams}
                                  type="button"
                                  variant="outline"
                                  className="h-8 rounded-xl px-1 text-[10px]"
                                  onClick={() => {
                                    setWeightInputUnit(grams === 1000 ? 'kg' : 'g');
                                    setQuantity(grams === 1000 ? '1' : String(grams));
                                  }}
                                >
                                  {grams === 1000 ? '1 kg' : `${grams} g`}
                                </Button>
                              ))}
                            </div>
                            <div className="rounded-xl bg-[#F5FBED] px-3 py-2 text-xs font-medium text-[#245B2B]">
                              {(() => {
                                const typed = parseDecimalInput(quantity);
                                const kg = weightInputUnit === 'g' ? typed / 1000 : typed;
                                return kg > 0
                                  ? `${formatSaleQuantity(kg, 'kg')} × ${formatMoney(selectedProduct.price)}/kg = ${formatMoney(kg * selectedProduct.price)}`
                                  : 'Informe o peso para calcular o valor.';
                              })()}
                            </div>
                          </div>
                        ) : (
                          <>
                            <Label htmlFor="itemQuantity">Quantidade</Label>
                            <Input
                              id="itemQuantity"
                              inputMode="numeric"
                              value={quantity}
                              onChange={(event) => setQuantity(event.target.value.replace(/\D/g, '').slice(0, 2))}
                              className="mt-2 h-10 rounded-2xl"
                            />
                          </>
                        )}
                      </div>

                      <div className="rounded-[22px] bg-white p-3 shadow-sm">
                        <Label htmlFor="itemNotes">Observacoes</Label>
                        <Textarea
                          id="itemNotes"
                          value={itemNotes}
                          onChange={(event) => setItemNotes(event.target.value)}
                          className="mt-2 min-h-[96px] rounded-2xl"
                          placeholder="Ex: sem cebola, molho separado..."
                        />
                      </div>
                    </div>
                  </ScrollArea>

                  <div className="mt-3 grid flex-none grid-cols-2 gap-2 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
                    <Button variant="outline" className="h-11 rounded-2xl" onClick={() => resetProductDialog()} disabled={submitting}>
                      Cancelar
                    </Button>
                    <Button className="h-11 rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={handleAddOrUpdateItem} disabled={submitting}>
                      {editingItem ? 'Salvar' : 'Adicionar'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="hidden h-full lg:flex lg:items-center lg:justify-center">
                  <WaiterEmptyState
                    icon={<PackageOpen className="h-7 w-7" />}
                    title="Selecione um produto"
                    description="Toque em um item da lista para abrir complementos e observacoes."
                  />
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] grid-rows-none flex-col overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100dvw-2rem)] sm:max-w-2xl sm:rounded-[28px]">
          <div className="border-b border-[#E7E1D8] bg-white px-4 pb-3 pt-5 sm:px-6">
            <DialogTitle className="pr-8 text-xl font-semibold leading-tight text-[#082F23] sm:text-2xl">Receber Pagamento</DialogTitle>
            <DialogDescription className="mt-1 text-sm leading-5">
              {waiterMpPixEnabled
                ? 'Receba por QR Code PIX, Stone no POS ou registre pagamentos manuais sem sair do app.'
                : 'No celular e web, o pagamento é registrado manualmente. No POS Android, Stone recebe débito, crédito e PIX.'}
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-2xl bg-[#F4F8F2] p-3 sm:p-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-xs">Conta</div>
                  <div className="mt-2 text-sm font-semibold leading-tight text-[#082F23] sm:text-xl">{formatMoney(session.total)}</div>
                </div>
                <div className="rounded-2xl bg-[#F4F8F2] p-3 sm:p-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-xs">Pago</div>
                  <div className="mt-2 text-sm font-semibold leading-tight text-[#082F23] sm:text-xl">{formatMoney(session.paidTotal)}</div>
                </div>
                <div className="rounded-2xl bg-[#F4F8F2] p-3 sm:p-4">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-xs">Saldo</div>
                  <div className="mt-2 text-sm font-semibold leading-tight text-[#082F23] sm:text-xl">{formatMoney(session.dueAmount)}</div>
                </div>
              </div>

              <div className="space-y-3">
                {paymentLines.map((line) => (
                  <div key={line.id} className="grid gap-3 rounded-2xl border border-[#DCE6D8] bg-[#FBFCFA] p-3 sm:grid-cols-[1.15fr,0.85fr,0.7fr,auto] sm:p-4">
                    <div className="space-y-2">
                      <Label>Comanda</Label>
                      <Select value={line.accountId} onValueChange={(value) => handlePaymentLineChange(line.id, 'accountId', value)}>
                        <SelectTrigger className="h-11 rounded-2xl sm:h-12">
                          <SelectValue placeholder="Selecione a comanda" />
                        </SelectTrigger>
                        <SelectContent>
                          {session.accounts
                            .filter((account) => account.dueAmount > 0)
                            .map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name} - {formatMoney(account.dueAmount)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-[1fr,0.9fr] gap-3 sm:contents">
                      <div className="space-y-2">
                        <Label>Forma</Label>
                        <Select value={line.method} onValueChange={(value: PaymentMethod) => handlePaymentLineChange(line.id, 'method', value)}>
                          <SelectTrigger className="h-11 rounded-2xl sm:h-12">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pix">PIX</SelectItem>
                            <SelectItem value="debit">Debito</SelectItem>
                            <SelectItem value="credit">Credito</SelectItem>
                            <SelectItem value="cash">Dinheiro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Valor</Label>
                        <Input
                          value={line.amount}
                          inputMode="decimal"
                          onChange={(event) => handlePaymentLineChange(line.id, 'amount', event.target.value)}
                          className="h-11 rounded-2xl text-base sm:h-12"
                        />
                      </div>
                    </div>

                    {line.method === 'cash' ? (
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3 sm:col-span-4">
                        <div className="grid gap-3 sm:grid-cols-[1fr,1fr] sm:items-end">
                          <div className="space-y-2">
                            <Label>Valor recebido em espécie</Label>
                            <Input
                              value={line.cashReceived || ''}
                              inputMode="decimal"
                              onChange={(event) => handlePaymentLineChange(line.id, 'cashReceived', event.target.value)}
                              className="h-11 rounded-2xl bg-white text-base"
                              placeholder="Ex: 100,00"
                            />
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.14em] text-emerald-700/70">Troco</div>
                            <div className="mt-1 text-lg font-semibold text-emerald-800">
                              {formatMoney(Math.max(0, parsePaymentAmount(line.cashReceived || '') - parsePaymentAmount(line.amount || '')))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-end">
                      <Button
                        variant="outline"
                        className="h-11 w-full rounded-2xl sm:h-12 sm:w-auto"
                        onClick={() => setPaymentLines((current) => current.filter((entry) => entry.id !== line.id))}
                        disabled={paymentLines.length === 1}
                      >
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {canUseServiceCharge ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-[#082F23]">
                        Cliente autorizou adicionar {serviceChargePercent}% do garçom?
                      </div>
                      <div className="mt-1 text-xs leading-5 text-amber-800">
                        {serviceChargeSettings?.autoApply
                          ? 'A regra da mesa deixou a taxa marcada automaticamente. Desmarque se o cliente nao aceitar.'
                          : 'Marque somente se o cliente autorizar a taxa neste fechamento.'}{' '}
                        Retenção configurada: {Number(serviceChargeSettings?.taxWithholdPercent || 0)}%.
                      </div>
                    </div>
                    <Switch checked={serviceChargeAccepted} onCheckedChange={setServiceChargeAccepted} />
                  </div>
                  {serviceChargeAccepted ? (
                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-xl bg-white/80 p-3">
                        <div className="text-xs text-slate-500">Taxa</div>
                        <div className="font-semibold text-[#082F23]">{formatMoney(serviceChargeAmount)}</div>
                      </div>
                      <div className="rounded-xl bg-white/80 p-3">
                        <div className="text-xs text-slate-500">Retenção</div>
                        <div className="font-semibold text-red-700">{formatMoney(serviceChargeTax)}</div>
                      </div>
                      <div className="rounded-xl bg-white/80 p-3">
                        <div className="text-xs text-slate-500">Líquido garçom</div>
                        <div className="font-semibold text-emerald-700">{formatMoney(serviceChargeNet)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#082F23] px-4 py-3 text-white">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/65">Total a receber</div>
                  <div className="text-sm text-white/80">
                    Pagamento {formatMoney(paymentBaseTotal)}
                    {serviceChargeAmount > 0 ? ` + taxa ${formatMoney(serviceChargeAmount)}` : ''}
                    {cashChangeTotal > 0 ? ` • troco ${formatMoney(cashChangeTotal)}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-lg font-semibold sm:text-xl">{formatMoney(paymentFinalTotal)}</div>
              </div>

              <div className="flex justify-start pb-2">
                <div className="grid w-full gap-2 sm:grid-cols-[1fr,1fr,auto]">
                  <Button
                    variant="outline"
                    className="h-11 rounded-2xl"
                    onClick={() => {
                      const nextAccount = session.accounts.find((account) => account.dueAmount > 0);
                      setPaymentLines((current) => [...current, createPaymentLine(nextAccount?.id || '', 0, 'pix')]);
                    }}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Multipla forma
                  </Button>
                  <div className="flex gap-2">
                    <Input
                      value={splitPeople}
                      inputMode="numeric"
                      onChange={(event) => setSplitPeople(event.target.value.replace(/\D/g, '').slice(0, 2))}
                      className="h-11 rounded-2xl"
                      aria-label="Quantidade de pessoas"
                    />
                    <Button variant="outline" className="h-11 rounded-2xl" onClick={splitSelectedAccount}>
                      <Split className="mr-2 h-4 w-4" />
                      Dividir
                    </Button>
                  </div>
                  <Button variant="outline" className="h-11 rounded-2xl" onClick={() => setStoneSettingsOpen(true)}>
                    <Settings className="mr-2 h-4 w-4" />
                    Stone
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="grid grid-cols-2 gap-2 border-t border-[#E7E1D8] bg-white p-4 sm:flex sm:justify-between sm:px-6">
            <Button variant="outline" className="h-11 rounded-2xl" onClick={() => setPaymentDialogOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="h-11 rounded-2xl bg-[#FF6400] hover:bg-[#E25A00]" onClick={handleSavePayments} disabled={submitting}>
              {submitting ? 'Recebendo...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stoneSettingsOpen} onOpenChange={setStoneSettingsOpen}>
        <DialogContent className="rounded-[28px] border-0 p-4 sm:max-w-xl">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">Configurações Stone</DialogTitle>
          <DialogDescription>Confira o POS antes de receber PIX, débito ou crédito pela Stone.</DialogDescription>
          <StoneIntegrationPanel />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(moveItemId)} onOpenChange={(open) => !open && setMoveItemId('')}>
        <DialogContent className="rounded-[28px] border-0 sm:max-w-lg">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">Dividir entre comandas</DialogTitle>
          <DialogDescription>
            Escolha quanto desta cobrança vai para outra comanda. O pedido da cozinha não será duplicado.
          </DialogDescription>
          {movingItem ? (
            <div className="rounded-2xl bg-[#F4F8F2] px-4 py-3">
              <div className="font-semibold text-[#082F23]">{movingItem.productName}</div>
              <div className="mt-1 text-sm text-slate-500">
                Atual: {formatSaleQuantity(movingItem.quantity, movingItem.saleUnit)} · {formatMoney(movingItem.totalPrice)}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Comanda de destino</Label>
              <Select value={moveTargetAccountId} onValueChange={setMoveTargetAccountId}>
                <SelectTrigger className="h-12 rounded-2xl">
                  <SelectValue placeholder="Selecione a comanda" />
                </SelectTrigger>
                <SelectContent>
                  {(session.accounts || [])
                    .filter((account) => account.id !== session.accounts.flatMap((account) => account.items).find((item) => item.id === moveItemId)?.accountId)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{movingItem?.saleUnit === 'kg' ? 'Peso para a outra comanda (kg)' : 'Parte para a outra comanda'}</Label>
              <Input
                inputMode="decimal"
                value={moveQuantity}
                onChange={(event) => setMoveQuantity(event.target.value.replace(/[^\d,.]/g, '').slice(0, 8))}
                className="h-12 rounded-2xl"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl text-xs"
                  onClick={() => movingItem && setMoveQuantity(String(Math.max(0.001, movingItem.quantity / 2)).replace('.', ','))}
                >
                  Metade
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl text-xs"
                  onClick={() => movingItem && setMoveQuantity(String(movingItem.quantity).replace('.', ','))}
                >
                  Tudo
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-3 sm:justify-between">
            <Button variant="outline" className="rounded-2xl" onClick={() => setMoveItemId('')} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="rounded-2xl bg-[#082F23] hover:bg-[#0B4A36]" onClick={handleMoveItem} disabled={submitting || !moveTargetAccountId || parseDecimalInput(moveQuantity) <= 0 || parseDecimalInput(moveQuantity) > Number(movingItem?.quantity || 0)}>
              Confirmar divisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(mergeSourceAccountId)} onOpenChange={(open) => !open && setMergeSourceAccountId('')}>
        <DialogContent className="rounded-[28px] border-0 sm:max-w-lg">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">Juntar comandas</DialogTitle>
          <DialogDescription>
            Todos os itens e pagamentos da comanda escolhida vao para a comanda de destino.
          </DialogDescription>
          <div className="space-y-2">
            <Label>Comanda de destino</Label>
            <Select value={mergeTargetAccountId} onValueChange={setMergeTargetAccountId}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder="Selecione a comanda" />
              </SelectTrigger>
              <SelectContent>
                {(session.accounts || [])
                  .filter((account) => account.id !== mergeSourceAccountId)
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-3 sm:justify-between">
            <Button variant="outline" className="rounded-2xl" onClick={() => setMergeSourceAccountId('')} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="rounded-2xl bg-[#082F23] hover:bg-[#0B4A36]" onClick={handleMergeAccounts} disabled={submitting || !mergeTargetAccountId}>
              Confirmar juncao
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(transferAccountId)} onOpenChange={(open) => !open && setTransferAccountId('')}>
        <DialogContent className="rounded-[28px] border-0 sm:max-w-lg">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">Transferir comanda</DialogTitle>
          <DialogDescription>
            Mova uma comanda inteira para outra mesa, mantendo itens, historico e pagamentos.
          </DialogDescription>
          <div className="space-y-2">
            <Label>Mesa de destino</Label>
            <Select value={transferAccountTargetId} onValueChange={setTransferAccountTargetId}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder="Selecione a mesa" />
              </SelectTrigger>
              <SelectContent>
                {accountTransferChoices.map((table) => (
                  <SelectItem key={table.id} value={table.id}>
                    Mesa {table.number} {table.location ? `- ${table.location}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-3 sm:justify-between">
            <Button variant="outline" className="rounded-2xl" onClick={() => setTransferAccountId('')} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="rounded-2xl bg-[#082F23] hover:bg-[#0B4A36]" onClick={handleTransferAccount} disabled={submitting || !transferAccountTargetId}>
              Confirmar transferencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferTableOpen} onOpenChange={setTransferTableOpen}>
        <DialogContent className="rounded-[28px] border-0 sm:max-w-lg">
          <DialogTitle className="text-2xl font-semibold text-[#082F23]">Transferir mesa inteira</DialogTitle>
          <DialogDescription>
            Toda a sessao, com comandas e pedidos, sera movida para outra mesa livre.
          </DialogDescription>
          <div className="space-y-2">
            <Label>Mesa de destino</Label>
            <Select value={transferTableTargetId} onValueChange={setTransferTableTargetId}>
              <SelectTrigger className="h-12 rounded-2xl">
                <SelectValue placeholder="Selecione a mesa" />
              </SelectTrigger>
              <SelectContent>
                {transferTableChoices.map((table) => (
                  <SelectItem key={table.id} value={table.id}>
                    Mesa {table.number} {table.location ? `- ${table.location}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-3 sm:justify-between">
            <Button variant="outline" className="rounded-2xl" onClick={() => setTransferTableOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button className="rounded-2xl bg-[#082F23] hover:bg-[#0B4A36]" onClick={handleTransferTable} disabled={submitting || !transferTableTargetId}>
              Confirmar transferencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WaiterSessionPage;
