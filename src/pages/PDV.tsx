import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Plus, Minus, Trash2, Calculator, Search, Store, Wallet, ChevronLeft, ChevronRight, Scale, AlertTriangle, ScanLine, Keyboard } from 'lucide-react';
import OperatorSwitcher from '@/components/OperatorSwitcher';
import { useToast } from '@/hooks/use-toast';
import { normalizeImageUrlForDisplay } from '@/utils/normalizeImageUrl';
import { formatBRL } from '@/lib/currency';
import { normalizeSuggestedProductSearch } from '@/lib/whatsappCentral';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import ProductVariationModal from '@/components/pdv/ProductVariationModal';
import PixCheckoutModal from '@/components/payment/PixCheckoutModal';
import CheckoutModal, { CheckoutPaymentMethod, type FiscalValidationState } from '@/components/checkout/CheckoutModal';
import ReceivableContactSelect, { type ReceivableContact } from '@/components/receivables/ReceivableContactSelect';
import ElectronicCommandDialog, { type ElectronicCommandLookup } from '@/components/pdv/ElectronicCommandDialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import FirstOperatorDialog from '@/components/pdv/FirstOperatorDialog';
import AdminPinDialog from '@/components/security/AdminPinDialog';
import { canCloseCash, canGiveDiscount, canOpenCash, getLocalOperatorSession, isAdminOperator } from '@/services/operatorAuth';
import { verifyAdminPin } from '@/services/adminPin';
import { useTefSettings } from '@/hooks/useTefSettings';
import { PrinterService } from '@/utils/printerService';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { formatElapsedMinutes } from '@/utils/elapsedTime';
import { notifyOrderCreatedById } from '@/utils/orderNotifications';
import { ensureDefaultTables } from '@/utils/tableDefaults';
import { useSidebar } from '@/contexts/SidebarContext';
import { useNavigate } from 'react-router-dom';
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { Checkbox } from '@/components/ui/checkbox';
import { parseBRL } from '@/lib/currency';
import { useCheckoutSettings } from '@/hooks/useCheckoutSettings';
import { prefetchSimpleVariations, type Variation } from '@/hooks/useSimpleVariations';
import type { PizzaCategoryConfig } from '@/lib/pizza-pricing';
import { enrichCategoryWithMetadata } from '@/lib/category-metadata';
import { useCustomerLookup } from '@/hooks/useCustomerLookup';
import {
  fetchTableOrderFlowSettings,
  filterItemsForTableManagerOrder,
  getTableManagerOrderStatus,
  shouldCreateTableManagerOrder,
} from '@/utils/tableOrderFlow';
import { getOpenTableCount } from '@/services/openTables';
import { getCashSessionDeadline } from '@/utils/cashSession';
import FiscalRecipientsManager, { type FiscalCustomer } from '@/components/fiscal/FiscalRecipientsManager';
import { pwaScaleService } from '@/services/ScaleService';
import { bridgeReadScaleWeight } from '@/services/bridgePrinterClient';
import { discoverBridgeWebsocketUrl } from '@/services/bridgeDiscovery';
import BarcodeCameraScanner from '@/components/devices/BarcodeCameraScanner';
import PageContentSkeleton from '@/components/ui/page-content-skeleton';
import { applyEffectivePrices } from '@/services/pricingEngine';
import { warmImageCache } from '@/utils/imageCache';

interface Product {
  id: string;
  name: string;
  barcode?: string | null;
  internal_code?: string | null;
  price: number;
  image_url?: string;
  available: boolean;
  category_id?: string;
  description?: string;
  weight_based?: boolean;
  costing_mode?: 'automatic_recipe' | 'manual';
  manual_unit_cost?: number | null;
  send_to_kds?: boolean;
  fiscal_ncm?: string | null;
  fiscal_cfop?: string | null;
  fiscal_csosn?: string | null;
  fiscal_cst_pis?: string | null;
  fiscal_cst_cofins?: string | null;
  fiscal_origem?: string | null;
  fiscal_cest?: string | null;
  fiscal_beneficio?: string | null;
  base_price?: number;
  effective_price?: number;
  price_table_id?: string | null;
  price_rule_id?: string | null;
  price_table_name?: string | null;
  price_source?: 'base' | 'price_table';
}

const ProductCardImage: React.FC<{ product: Product }> = ({ product }) => {
  const [failed, setFailed] = useState(false);
  const src = normalizeImageUrlForDisplay(product.image_url);

  if (!src || failed) {
    return (
      <div id={`product-img-${product.id}`} className="flex h-full w-full items-center justify-center">
        <Store className="h-5 w-5 text-gray-300" />
      </div>
    );
  }

  return (
    <img
      id={`product-img-${product.id}`}
      src={src}
      alt={product.name}
      className="h-full w-full object-contain object-center transition-transform duration-300 group-hover:scale-105"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
};

interface CategoryConfig extends PizzaCategoryConfig {
  id: string;
  name: string;
}

type PdvCatalogSnapshot = {
  savedAt: number;
  products: Product[];
  categories: CategoryConfig[];
};

const PDV_CATALOG_CACHE_PREFIX = 'popsystem_pdv_catalog_v1';
const PDV_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const pdvCatalogMemory = new Map<string, PdvCatalogSnapshot>();

function getPdvCatalogCacheKey(userId: string) {
  return `${PDV_CATALOG_CACHE_PREFIX}:${userId}`;
}

function readPdvCatalogCache(userId: string): PdvCatalogSnapshot | null {
  const memorySnapshot = pdvCatalogMemory.get(userId);
  if (memorySnapshot && Date.now() - memorySnapshot.savedAt <= PDV_CATALOG_CACHE_TTL_MS) {
    return memorySnapshot;
  }

  try {
    const raw = localStorage.getItem(getPdvCatalogCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PdvCatalogSnapshot;
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.categories)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > PDV_CATALOG_CACHE_TTL_MS) return null;
    pdvCatalogMemory.set(userId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writePdvCatalogCache(userId: string, patch: Partial<Pick<PdvCatalogSnapshot, 'products' | 'categories'>>) {
  if (!userId) return;
  const current = readPdvCatalogCache(userId);
  const snapshot: PdvCatalogSnapshot = {
    savedAt: Date.now(),
    products: patch.products ?? current?.products ?? [],
    categories: patch.categories ?? current?.categories ?? [],
  };
  pdvCatalogMemory.set(userId, snapshot);
  try {
    localStorage.setItem(getPdvCatalogCacheKey(userId), JSON.stringify(snapshot));
  } catch {
    // O cache em memoria ainda evita recarga durante a sessao.
  }
}

interface ProductVariation {
  id: string;
  name: string;
  required: boolean;
  max_selections: number;
  options: Array<{name: string; price: number}>;
}

type SelectedVariationsPayload =
  | string[]
  | {
      options?: string[];
      variationLines?: string[];
    };

interface CartItem extends Product {
  cartItemId: string;
  quantity: number;
  selectedVariations?: SelectedVariationsPayload;
  notes?: string;
}

interface DeliveryZone {
  id: string;
  name: string;
  delivery_fee: number;
  minimum_order: number;
}

interface Table {
  id: string;
  table_number: number;
  status: string;
}

type PdvPaymentMethod = CheckoutPaymentMethod;

type PdvPaymentAmounts = Record<PdvPaymentMethod, string>;

const PDV_PAYMENT_METHODS: Array<{ value: PdvPaymentMethod; label: string }> = [
  { value: 'pix', label: 'PIX' },
  { value: 'cartao_credito', label: 'Crédito' },
  { value: 'cartao_debito', label: 'Débito' },
  { value: 'cartao_voucher', label: 'Voucher' },
  { value: 'cartao_outros', label: 'Outros' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pagar_depois', label: 'Contas a receber' },
];

const emptyPdvPaymentAmounts = (): PdvPaymentAmounts => ({
  pix: '',
  cartao_credito: '',
  cartao_debito: '',
  cartao_voucher: '',
  cartao_outros: '',
  dinheiro: '',
  pagar_depois: '',
});

const getPaymentMethodLabel = (method: PdvPaymentMethod | string) => {
  if (method === 'pix_online') return 'PIX online';
  if (method === 'pix_entrega') return 'PIX na entrega';
  if (method === 'cartao' || method === 'card') return 'Cartão';
  if (method === 'cartao_voucher') return 'Voucher';
  if (method === 'cartao_outros') return 'Outros';
  return PDV_PAYMENT_METHODS.find((option) => option.value === method)?.label || String(method || '-');
};

const normalizeProductLookupCode = (value: unknown) =>
  String(value || '').trim().replace(/\s+/g, '').toLowerCase();

const matchesInternalProductCode = (internalCode: unknown, typedCode: unknown) => {
  const stored = normalizeProductLookupCode(internalCode);
  const typed = normalizeProductLookupCode(typedCode);
  if (!stored || !typed) return false;
  if (stored === typed) return true;

  // O código automático P000017 também pode ser digitado como 17 no caixa.
  if (!/^\d+$/.test(typed)) return false;
  const storedNumber = stored.match(/^(?:p)?0*(\d+)$/)?.[1];
  return storedNumber ? Number(storedNumber) === Number(typed) : false;
};

const resolvePdvFunctionKey = (event: KeyboardEvent) => {
  const candidates = [event.key, event.code].map((value) => String(value || '').toUpperCase());
  return (['F1', 'F2', 'F3', 'F4'] as const).find((key) => candidates.includes(key)) || null;
};

const formatFiscalDocument = (value: unknown) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return digits;
};

interface CashSession {
  id: string;
  opened_at: string;
  closed_at?: string | null;
  initial_amount: number;
  status: string;
}

interface CashCloseSummary {
  expectedCash: number;
  pix: number;
  card: number;
  cash: number;
  receivable: number;
  total: number;
  inAmount: number;
  outAmount: number;
  initial: number;
  grossRevenue: number;
  discounts: number;
  deliveryFee: number;
  netRevenue: number;
  credit: number;
  debit: number;
  voucher: number;
  genericCard: number;
  totalReceived: number;
  ordersCount: number;
  cancelledCount: number;
  customersServed: number;
  deliveryOrders: number;
  counterOrders: number;
  dineInOrders: number;
  avgProductionMinutes: number;
  avgDeliveryMinutes: number;
  openedAt: string;
  closedAt: string;
  operatorName: string;
  companyName: string;
  companyCnpj: string;
  boxLabel: string;
}

const PDV = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [whatsappConversationId, setWhatsappConversationId] = useState<string | null>(null);
  const [customerDocument, setCustomerDocument] = useState('');
  const [selectedFiscalRecipient, setSelectedFiscalRecipient] = useState<FiscalCustomer | null>(null);
  const [selectedFiscalModel, setSelectedFiscalModel] = useState<'55' | '65'>('65');
  const [fiscalValidation, setFiscalValidation] = useState<FiscalValidationState>({ status: 'idle' });
  const [fiscalRecipientOpen, setFiscalRecipientOpen] = useState(false);
  const [deliveryCustomerFound, setDeliveryCustomerFound] = useState('');
  const [orderType, setOrderType] = useState<'delivery' | 'pickup' | 'dine_in' | 'counter'>('counter');
  const [selectedDeliveryZone, setSelectedDeliveryZone] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PdvPaymentMethod>('pix');
  const [paymentAmounts, setPaymentAmounts] = useState<PdvPaymentAmounts>(() => emptyPdvPaymentAmounts());
  const [changeAmount, setChangeAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [surchargeAmount, setSurchargeAmount] = useState('');
  const [receivableContactId, setReceivableContactId] = useState('');
  const [receivableContact, setReceivableContact] = useState<ReceivableContact | null>(null);
  const [receivableDueDate, setReceivableDueDate] = useState('');
  const [receivableNotes, setReceivableNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [productCodeQuery, setProductCodeQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showVariationModal, setShowVariationModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productVariations, setProductVariations] = useState<Variation[]>([]);
  const [categories, setCategories] = useState<CategoryConfig[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [activeTab, setActiveTab] = useState('products');
  const [pixAmount, setPixAmount] = useState(0);
  const [mpPixCheckout, setMpPixCheckout] = useState<null | { correlationID: string; brCode: string; qrCodeImage?: string; paymentLinkUrl?: string; paymentId?: string }>(null);
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [cashSessionDeadline, setCashSessionDeadline] = useState<Date | null>(null);
  const [cashDialogOpen, setCashDialogOpen] = useState(false);
  const [cashDialogMode, setCashDialogMode] = useState<'open' | 'close'>('open');
  const [cashAmountInput, setCashAmountInput] = useState('');
  const [cashCloseLoading, setCashCloseLoading] = useState(false);
  const [cashCloseSummary, setCashCloseSummary] = useState<CashCloseSummary | null>(null);
  const [openTablesCount, setOpenTablesCount] = useState(0);
  const [openTablesConsent, setOpenTablesConsent] = useState(false);
  const [mustCreateOperator, setMustCreateOperator] = useState(false);
  const [cashMoveOpen, setCashMoveOpen] = useState(false);
  const [cashMoveType, setCashMoveType] = useState<'in' | 'out'>('out');
  const [cashMoveAmount, setCashMoveAmount] = useState('');
  const [cashMoveDesc, setCashMoveDesc] = useState('');
  const [adminPinOpen, setAdminPinOpen] = useState(false);
  const [tefOpen, setTefOpen] = useState(false);
  const [tefData, setTefData] = useState<{ nsu: string; auth: string; brand: string; acquirer: string; installments: string } | null>(null);
  const [cardProcessingMode, setCardProcessingMode] = useState<'maquininha' | 'tef'>('maquininha');
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tableLaunchOpen, setTableLaunchOpen] = useState(false);
  const [tableLaunchId, setTableLaunchId] = useState('');
  const [weightDialogOpen, setWeightDialogOpen] = useState(false);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [pendingWeightProduct, setPendingWeightProduct] = useState<Product | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [readingScale, setReadingScale] = useState(false);
  const [commandLookupOpen, setCommandLookupOpen] = useState(false);
  const [commandQueryOpen, setCommandQueryOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandLookup, setCommandLookup] = useState<ElectronicCommandLookup | null>(null);
  const { toast } = useToast();
  const { user, session } = useAuth();
  const { lookupCustomer, isLoading: customerLookupLoading } = useCustomerLookup(user?.id || '');
  const { isMobile } = useSidebar();
  const { settings: tefSettings } = useTefSettings();
  const { settings: checkoutSettings } = useCheckoutSettings();
  const navigate = useNavigate();

  // Refs for animation
  const cartContainerRef = useRef<HTMLDivElement>(null);
  const mobileCartBtnRef = useRef<HTMLDivElement>(null);
  const categoryScrollerRef = useRef<HTMLDivElement>(null);
  const hasLoadedDataRef = useRef(false);
  const draftRestoredUserIdRef = useRef<string | null>(null);
  const scannerBufferRef = useRef('');
  const scannerLastKeyAtRef = useRef(0);
  const scannerClearTimerRef = useRef<number | null>(null);
  const scannerInputTargetRef = useRef<{ element: HTMLInputElement | HTMLTextAreaElement; value: string } | null>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const productCodeInputRef = useRef<HTMLInputElement>(null);

  const getPdvDraftKey = () => `boracume_pdv_draft_v1:${user?.id || 'anonymous'}`;

  const isDefaultPdvDraft = (payload: {
    cart: CartItem[];
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    orderType: string;
    selectedDeliveryZone: string;
    selectedTable: string;
    paymentMethod: string;
    paymentAmounts?: PdvPaymentAmounts;
    changeAmount: string;
  }) => {
    const hasPaymentAmounts = payload.paymentAmounts
      ? Object.values(payload.paymentAmounts).some((value) => parseBRL(value) > 0)
      : false;

    return (
      payload.cart.length === 0 &&
      !payload.customerName &&
      !payload.customerPhone &&
      !payload.customerAddress &&
      payload.orderType === 'counter' &&
      !payload.selectedDeliveryZone &&
      !payload.selectedTable &&
      payload.paymentMethod === 'pix' &&
      !hasPaymentAmounts &&
      !payload.changeAmount
    );
  };

  const clearPdvDraft = () => {
    try {
      localStorage.removeItem(getPdvDraftKey());
    } catch {}
  };

  const scrollCategories = (direction: 'left' | 'right') => {
    const scroller = categoryScrollerRef.current;
    if (!scroller) return;

    scroller.scrollBy({
      left: direction === 'left' ? -Math.round(scroller.clientWidth * 0.75) : Math.round(scroller.clientWidth * 0.75),
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    if (user?.id) {
      const cachedCatalog = readPdvCatalogCache(user.id);
      if (cachedCatalog) {
        setProducts(cachedCatalog.products);
        setCategories(cachedCatalog.categories);
        warmImageCache(cachedCatalog.products.map((product) => product.image_url));
        hasLoadedDataRef.current = true;
        setLoading(false);
        void fetchData({ background: true });
      } else {
        hasLoadedDataRef.current = false;
        setProducts([]);
        setCategories([]);
        void fetchData();
      }
      fetchOpenCashSession();
      checkFirstOperator();
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || draftRestoredUserIdRef.current === user.id) return;
    draftRestoredUserIdRef.current = user.id;

    try {
      const raw = localStorage.getItem(getPdvDraftKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const restoredCart = Array.isArray(parsed?.cart)
        ? parsed.cart
            .filter((item: any) => item?.id && item?.name && Number(item?.quantity) > 0)
            .map((item: any) => {
              const restoredQuantity = Number(item.quantity);

              return {
                ...item,
                cartItemId: item.cartItemId || makeCartItemId(),
                price: Number(item.price || 0),
                // Produtos pesáveis usam quantidades fracionárias. Arredondar para
                // no mínimo 1 alterava tanto o peso quanto o total ao voltar ao PDV.
                quantity: Number.isFinite(restoredQuantity) && restoredQuantity > 0 ? restoredQuantity : 1,
                available: item.available !== false
              };
            })
        : [];

      if (restoredCart.length > 0) setCart(restoredCart);
      if (typeof parsed?.customerName === 'string') setCustomerName(parsed.customerName);
      if (typeof parsed?.customerPhone === 'string') setCustomerPhone(parsed.customerPhone);
      if (typeof parsed?.customerAddress === 'string') setCustomerAddress(parsed.customerAddress);
      if (['delivery', 'pickup', 'dine_in', 'counter'].includes(parsed?.orderType)) setOrderType(parsed.orderType);
      if (typeof parsed?.selectedDeliveryZone === 'string') setSelectedDeliveryZone(parsed.selectedDeliveryZone);
      if (typeof parsed?.selectedTable === 'string') setSelectedTable(parsed.selectedTable);
      if (parsed?.paymentMethod === 'cartao') {
        setPaymentMethod('cartao_credito');
      } else if (PDV_PAYMENT_METHODS.some((method) => method.value === parsed?.paymentMethod)) {
        setPaymentMethod(parsed.paymentMethod);
      }
      if (parsed?.paymentAmounts && typeof parsed.paymentAmounts === 'object') {
        const legacyCardAmount = typeof parsed.paymentAmounts.cartao === 'string' ? parsed.paymentAmounts.cartao : '';
        setPaymentAmounts({
          pix: typeof parsed.paymentAmounts.pix === 'string' ? parsed.paymentAmounts.pix : '',
          cartao_credito: typeof parsed.paymentAmounts.cartao_credito === 'string' ? parsed.paymentAmounts.cartao_credito : legacyCardAmount,
          cartao_debito: typeof parsed.paymentAmounts.cartao_debito === 'string' ? parsed.paymentAmounts.cartao_debito : '',
          cartao_voucher: typeof parsed.paymentAmounts.cartao_voucher === 'string' ? parsed.paymentAmounts.cartao_voucher : '',
          cartao_outros: typeof parsed.paymentAmounts.cartao_outros === 'string' ? parsed.paymentAmounts.cartao_outros : '',
          dinheiro: typeof parsed.paymentAmounts.dinheiro === 'string' ? parsed.paymentAmounts.dinheiro : '',
          pagar_depois: '',
        });
      }
      if (typeof parsed?.changeAmount === 'string') setChangeAmount(parsed.changeAmount);
    } catch {
      clearPdvDraft();
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = sessionStorage.getItem('popsystem_whatsapp_order_handoff');
      if (!raw) return;
      sessionStorage.removeItem('popsystem_whatsapp_order_handoff');
      const handoff = JSON.parse(raw);
      if (!handoff?.createdAt || Date.now() - Number(handoff.createdAt) > 10 * 60_000) return;
      if (typeof handoff.customerName === 'string') setCustomerName(handoff.customerName);
      if (typeof handoff.customerPhone === 'string') setCustomerPhone(handoff.customerPhone);
      if (typeof handoff.customerAddress === 'string') setCustomerAddress(handoff.customerAddress);
      if (typeof handoff.conversationId === 'string') setWhatsappConversationId(handoff.conversationId);
      if (Array.isArray(handoff.suggestedItems) && handoff.suggestedItems.length > 0) {
        setSearchTerm(normalizeSuggestedProductSearch(handoff.suggestedItems[0]));
      }
      setOrderType(handoff.customerAddress ? 'delivery' : 'pickup');
      setActiveTab('products');
      toast({
        title: 'Cliente carregado do WhatsApp',
        description: Array.isArray(handoff.suggestedItems) && handoff.suggestedItems.length > 0
          ? `Sugestão identificada: ${handoff.suggestedItems.join(', ')}. Confirme produtos, variações e preços atuais.`
          : 'Adicione os produtos usando o mesmo fluxo normal do PDV.',
      });
    } catch {
      sessionStorage.removeItem('popsystem_whatsapp_order_handoff');
    }
  }, [toast, user?.id]);

  useEffect(() => {
    if (!user?.id || draftRestoredUserIdRef.current !== user.id) return;

    const payload = {
      cart,
      customerName,
      customerPhone,
      customerAddress,
      orderType,
      selectedDeliveryZone,
      selectedTable,
      paymentMethod,
      paymentAmounts,
      changeAmount,
      updatedAt: new Date().toISOString()
    };

    try {
      if (isDefaultPdvDraft(payload)) {
        localStorage.removeItem(getPdvDraftKey());
      } else {
        localStorage.setItem(getPdvDraftKey(), JSON.stringify(payload));
      }
    } catch {}
  }, [user?.id, cart, customerName, customerPhone, customerAddress, orderType, selectedDeliveryZone, selectedTable, paymentMethod, paymentAmounts, changeAmount]);

  useEffect(() => {
    if (!tefSettings.enabled) {
      setCardProcessingMode('maquininha');
      setTefData(null);
      setTefOpen(false);
    }
  }, [tefSettings.enabled]);

  const checkFirstOperator = async () => {
    try {
      const { data, error } = await supabase
        .from('waiters' as any)
        .select('id')
        .eq('user_id', user?.id)
        .eq('active', true)
        .limit(1);
      if (error) throw error;
      const hasAny = Array.isArray(data) && data.length > 0;
      setMustCreateOperator(!hasAny);
    } catch {
      setMustCreateOperator(false);
    }
  };

  const fetchOpenCashSession = async () => {
    try {
      const [{ data, error }, { data: profile }] = await Promise.all([
        supabase.from('cash_register_sessions' as any).select('id, opened_at, initial_amount, status').eq('user_id', user?.id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('profiles').select('opening_hours').eq('id', user?.id).maybeSingle(),
      ]);
      if (error) throw error;
      setCashSession((data as any) || null);
      setCashSessionDeadline(data?.opened_at ? getCashSessionDeadline(data.opened_at, profile?.opening_hours) : null);
    } catch {
      setCashSession(null);
      setCashSessionDeadline(null);
    }
  };

  const getOperatorSession = () => {
    return getLocalOperatorSession();
  };

  const normalizeCustomerKey = (order: any) => {
    const phone = String(order?.customer_phone || '').replace(/\D/g, '');
    if (phone) return `phone:${phone}`;

    const name = String(order?.customer_name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    if (name) return `name:${name}`;

    return `order:${String(order?.id || order?.order_number || '')}`;
  };

  const normalizePaymentBucket = (order: any) => {
    const raw = String(order?.payment_method || '').trim().toLowerCase();
    if (!raw) return 'other';
    if (raw.includes('pagar_depois') || raw.includes('conta') || raw.includes('receiv')) return 'receivable';
    if (raw.includes('pix')) return 'pix';
    if (raw.includes('dinheiro')) return 'cash';
    if (raw.includes('voucher') || raw.includes('refeicao') || raw.includes('refeição') || raw.includes('aliment')) return 'voucher';
    if (raw.includes('debito') || raw.includes('débito') || raw.includes('debit')) return 'debit';
    if (raw.includes('credito') || raw.includes('crédito') || raw.includes('credit')) return 'credit';
    if (raw === 'cartao' || raw === 'cartão' || raw.includes('cartao') || raw.includes('cartão') || raw.includes('card')) {
      const installments = Number(order?.variations?.tef?.installments || 0);
      return installments > 1 ? 'credit' : 'card';
    }
    return 'other';
  };

  const getOrderPaymentLines = (order: any) => {
    const lines = order?.variations?.payment_split?.lines;
    if (!Array.isArray(lines)) return [];
    return lines
      .map((line: any) => ({
        method: String(line?.method || '').trim().toLowerCase(),
        amount: Number(line?.amount || 0),
      }))
      .filter((line) => line.method && Number.isFinite(line.amount) && line.amount > 0);
  };

  const averageMinutesFromOrders = (orders: any[]) => {
    const validDurations = (Array.isArray(orders) ? orders : [])
      .map((order) => {
        const createdAt = new Date(order?.created_at || '').getTime();
        const updatedAt = new Date(order?.updated_at || '').getTime();
        if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) return null;
        return Math.round((updatedAt - createdAt) / 60000);
      })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);

    if (validDurations.length === 0) return 0;
    return Math.round(validDurations.reduce((sum, value) => sum + value, 0) / validDurations.length);
  };

  const classifyOrderChannel = (order: any) => {
    const orderType = String(order?.order_type || '').trim().toLowerCase();
    const status = String(order?.status || '').trim().toLowerCase();
    const hasTable = Boolean(order?.table_id) || orderType === 'dine_in';
    if (hasTable) return 'dine_in';

    const hasDeliveryInfo =
      orderType === 'delivery' ||
      status === 'in_delivery' ||
      status === 'delivered' ||
      Boolean(order?.delivery_zone_id) ||
      String(order?.customer_address || '').trim().length > 0 ||
      String(order?.customer_neighborhood || '').trim().length > 0 ||
      Number(order?.delivery_fee || 0) > 0;

    if (hasDeliveryInfo) return 'delivery';
    return 'counter';
  };

  const shouldOpenCashDrawerForOrder = (order: any) => {
    const orderType = String(order?.order_type || '').trim().toLowerCase();
    const source = String(order?.variations?.source || '').trim().toUpperCase();
    if (orderType === 'delivery') return false;
    if (source === 'PDV') return true;
    return ['counter', 'pickup', 'dine_in'].includes(orderType);
  };

  const loadCashCloseSummary = async (session: CashSession, informedAmount?: number | null): Promise<CashCloseSummary> => {
    const operatorSession = getOperatorSession();
    const reportClosedAt = session.closed_at || new Date().toISOString();
    const [{ data: orders }, { data: unlinkedOrders }, { data: moves }, { data: profile }] = await Promise.all([
      (supabase as any)
        .from('orders')
        .select('*')
        .eq('user_id', user?.id)
        .eq('cash_register_session_id', session.id),
      (supabase as any)
        .from('orders')
        .select('*')
        .eq('user_id', user?.id)
        .is('cash_register_session_id', null)
        .gte('created_at', session.opened_at)
        .lte('created_at', reportClosedAt),
      (supabase as any)
        .from('cash_movements')
        .select('*')
        .eq('user_id', user?.id)
        .eq('session_id', session.id),
      supabase
        .from('profiles')
        .select('restaurant_name')
        .eq('id', user?.id)
        .maybeSingle(),
    ]);

    const orderMap = new Map<string, any>();
    for (const order of [
      ...(Array.isArray(orders) ? orders : []),
      ...(Array.isArray(unlinkedOrders) ? unlinkedOrders : []),
    ]) {
      const id = String(order?.id || '').trim();
      if (id) orderMap.set(id, order);
    }
    const orderList = Array.from(orderMap.values());
    const movementList = Array.isArray(moves) ? moves : [];
    const sales = orderList.filter((order) => String(order?.status || '').toLowerCase() !== 'cancelled');
    const cancelledCount = orderList.length - sales.length;
    const grossRevenue = sales.reduce((sum, order) => sum + Number(order?.total || 0), 0);
    const discounts = sales.reduce((sum, order) => sum + Number(order?.discount || 0), 0);
    const deliveryFee = sales.reduce((sum, order) => sum + Number(order?.delivery_fee || 0), 0);

    let pix = 0;
    let cash = 0;
    let credit = 0;
    let debit = 0;
    let voucher = 0;
    let genericCard = 0;
    let receivable = 0;

    for (const order of sales) {
      const total = Number(order?.total || 0);
      const splitLines = getOrderPaymentLines(order);
      const lines = splitLines.length > 0 ? splitLines : [{ method: String(order?.payment_method || ''), amount: total }];

      for (const line of lines) {
        const bucket = normalizePaymentBucket({ ...order, payment_method: line.method });
        if (bucket === 'pix') pix += line.amount;
        else if (bucket === 'cash') cash += line.amount;
        else if (bucket === 'credit') credit += line.amount;
        else if (bucket === 'debit') debit += line.amount;
        else if (bucket === 'voucher') voucher += line.amount;
        else if (bucket === 'card') genericCard += line.amount;
        else if (bucket === 'receivable') receivable += line.amount;
      }
    }

    const totalReceived = pix + cash + credit + debit + voucher + genericCard;
    const inAmount = movementList
      .filter((movement) => movement?.type === 'in')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const outAmount = movementList
      .filter((movement) => movement?.type === 'out')
      .reduce((sum, movement) => sum + Number(movement?.amount || 0), 0);
    const initial = Number(session.initial_amount || 0);
    const expectedCash = initial + cash + inAmount - outAmount;
    const netRevenue = grossRevenue - discounts + deliveryFee;
    const customerKeys = new Set(sales.map((order) => normalizeCustomerKey(order)).filter(Boolean));
    const deliveryOrders = sales.filter((order) => classifyOrderChannel(order) === 'delivery');
    const counterOrders = sales.filter((order) => classifyOrderChannel(order) === 'counter');
    const dineInOrders = sales.filter((order) => classifyOrderChannel(order) === 'dine_in');
    const productionOrders = sales.filter((order) => classifyOrderChannel(order) !== 'delivery');

    return {
      expectedCash,
      pix,
      card: credit + debit + genericCard,
      cash,
      receivable,
      total: grossRevenue,
      inAmount,
      outAmount,
      initial,
      grossRevenue,
      discounts,
      deliveryFee,
      netRevenue,
      credit,
      debit,
      voucher,
      genericCard,
      totalReceived,
      ordersCount: sales.length,
      cancelledCount,
      customersServed: customerKeys.size,
      deliveryOrders: deliveryOrders.length,
      counterOrders: counterOrders.length,
      dineInOrders: dineInOrders.length,
      avgProductionMinutes: averageMinutesFromOrders(productionOrders),
      avgDeliveryMinutes: averageMinutesFromOrders(deliveryOrders),
      openedAt: session.opened_at,
      closedAt: new Date().toISOString(),
      operatorName: operatorSession?.name || 'Operador',
      companyName: String((profile as any)?.restaurant_name || 'PopSystem').trim() || 'PopSystem',
      companyCnpj: '--',
      boxLabel: 'CAIXA 01',
    };
  };

  const buildCashCloseReportLines = (summary: CashCloseSummary, informedAmount: number) => {
    const lineWidth = 48;
    const divider = '='.repeat(lineWidth);
    const centerText = (value: string) => {
      const text = String(value || '').trim();
      const leftPadding = Math.max(0, Math.floor((lineWidth - text.length) / 2));
      return `${' '.repeat(leftPadding)}${text}`;
    };
    const row = (label: string, value: string) => {
      const safeLabel = String(label || '').trim();
      const safeValue = String(value || '').trim();
      const spacing = Math.max(1, lineWidth - safeLabel.length - safeValue.length);
      return `${safeLabel}${' '.repeat(spacing)}${safeValue}`;
    };
    const formatMinutes = (value: number) => formatElapsedMinutes(Math.max(0, Math.round(value || 0)));
    const difference = informedAmount - summary.expectedCash;

    const lines = [
      divider,
      centerText('POPSYSTEM PDV'),
      centerText('RELATÓRIO DE FECHAMENTO'),
      divider,
      '',
      `Empresa: ${summary.companyName}`,
      `CNPJ: ${summary.companyCnpj}`,
      `Operador: ${summary.operatorName}`,
      `Caixa: ${summary.boxLabel}`,
      '',
      `Data: ${new Date(summary.closedAt).toLocaleDateString('pt-BR')}`,
      `Hora Abertura: ${new Date(summary.openedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      `Hora Fechamento: ${new Date(summary.closedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      '',
      divider,
      centerText('RESUMO GERAL'),
      divider,
      '',
      row('Pedidos Realizados:', String(summary.ordersCount)),
      row('Pedidos Cancelados:', String(summary.cancelledCount)),
      row('Clientes Atendidos:', String(summary.customersServed)),
      '',
      row('Faturamento Bruto:', formatBRL(summary.grossRevenue)),
      row('Descontos:', formatBRL(summary.discounts)),
      row('Taxa Entrega:', formatBRL(summary.deliveryFee)),
      '',
      row('FATURAMENTO LÍQUIDO:', formatBRL(summary.netRevenue)),
      '',
      divider,
      centerText('FORMAS DE PAGAMENTO'),
      divider,
      '',
      row('PIX:', formatBRL(summary.pix)),
      row('Dinheiro:', formatBRL(summary.cash)),
      row('Crédito:', formatBRL(summary.credit)),
      row('Débito:', formatBRL(summary.debit)),
      row('Voucher/Refeição:', formatBRL(summary.voucher)),
      ...(summary.genericCard > 0 ? [row('Cartão:', formatBRL(summary.genericCard))] : []),
      row('Contas a Receber:', formatBRL(summary.receivable)),
      '',
      row('TOTAL RECEBIDO:', formatBRL(summary.totalReceived)),
      '',
      divider,
      centerText('MOVIMENTO CAIXA'),
      divider,
      '',
      row('Valor Inicial:', formatBRL(summary.initial)),
      '',
      row('Entradas Extras:', formatBRL(summary.inAmount)),
      row('Sangrias/Saídas:', formatBRL(summary.outAmount)),
      '',
      row('Valor Esperado:', formatBRL(summary.expectedCash)),
      row('Valor Informado:', formatBRL(informedAmount)),
      '',
      row('DIFERENÇA:', `${difference < 0 ? '-' : ''}${formatBRL(Math.abs(difference))}`),
      '',
      divider,
      centerText('DELIVERY / LOJA'),
      divider,
      '',
      row('Pedidos Delivery:', String(summary.deliveryOrders)),
      row('Pedidos Balcão:', String(summary.counterOrders)),
      row('Pedidos Mesas:', String(summary.dineInOrders)),
      '',
      row('Tempo Médio Produção:', formatMinutes(summary.avgProductionMinutes)),
      row('Tempo Médio Entrega:', formatMinutes(summary.avgDeliveryMinutes)),
      '',
      divider,
      centerText('OBSERVACOES'),
      divider,
      '',
      'Sistema: PopSystem PDV',
      `Versão: ${import.meta.env.VITE_APP_VERSION || '1.0.107'}`,
      '',
      'Fechamento realizado com sucesso.',
      '',
      divider,
      '',
      'Assinatura Operador:',
      '',
      '____________________________________________',
      '',
      divider,
      centerText('POPSYSTEM PDV'),
      divider,
    ];

    return lines;
  };

  const openCashDialog = async (mode: 'open' | 'close') => {
    const operatorSession = getOperatorSession();
    const allowed = mode === 'open' ? canOpenCash(operatorSession) : canCloseCash(operatorSession);
    if (!allowed) {
      toast({
        title: 'Sem permissão para operar o caixa',
        description: 'O administrador precisa liberar a permissão "Abrir/Fechar Caixa" em Usuários e Equipe.',
        variant: 'destructive',
      });
      return;
    }
    setCashDialogMode(mode);
    setCashCloseSummary(null);
    setCashAmountInput('');
    setOpenTablesConsent(false);
    setOpenTablesCount(0);
    if (mode === 'close' && user?.id && cashSession?.id) {
      try {
        setCashCloseLoading(true);
        const [summary, activeTables] = await Promise.all([
          loadCashCloseSummary(cashSession),
          getOpenTableCount(user.id),
        ]);
        setCashCloseSummary(summary);
        setOpenTablesCount(activeTables);
        setCashAmountInput(formatBRL(summary.expectedCash));
      } catch {}
      setCashCloseLoading(false);
    }
    setCashDialogOpen(true);
  };

  const handleCashSubmit = async () => {
    if (!user?.id) return;
    const operatorSession = getOperatorSession();
    const allowed = cashDialogMode === 'open' ? canOpenCash(operatorSession) : canCloseCash(operatorSession);
    if (!allowed) {
      toast({
        title: 'Sem permissão para operar o caixa',
        description: 'O administrador precisa liberar a permissão "Abrir/Fechar Caixa" em Usuários e Equipe.',
        variant: 'destructive',
      });
      setCashDialogOpen(false);
      return;
    }
    const amount = parseBRL(cashAmountInput);
    if (!Number.isFinite(amount)) {
      toast({ title: 'Valor inválido', description: 'Informe um valor válido', variant: 'destructive' });
      return;
    }
    const waiterId = operatorSession?.id || null;

    try {
      if (cashDialogMode === 'open') {
        if (cashSession?.id) {
          toast({ title: 'Caixa já está aberto' });
          setCashDialogOpen(false);
          return;
        }
        const payload: any = {
          user_id: user.id,
          initial_amount: amount,
          status: 'open',
          opened_at: new Date().toISOString(),
        };
        if (waiterId) payload.opened_by_waiter_id = waiterId;
        let error: any = null;
        const res1 = await supabase.from('cash_register_sessions' as any).insert(payload);
        error = (res1 as any).error;
        if (error && String(error.message || '').includes('opened_by_waiter_id')) {
          const { opened_by_waiter_id, ...fallback } = payload;
          const res2 = await supabase.from('cash_register_sessions' as any).insert(fallback);
          error = (res2 as any).error;
        }
        if (error && (error.code === '23505' || String(error.message || '').toLowerCase().includes('cash_register_sessions_one_open_per_user'))) {
          await fetchOpenCashSession();
          toast({ title: 'Caixa já está aberto' });
          setCashDialogOpen(false);
          return;
        }
        if (error) throw error;
        toast({ title: 'Caixa aberto' });
        await PrinterService.printCashReport({
          title: 'Abertura de Caixa',
          userId: user.id,
          lines: [
            `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
            `Valor inicial: ${formatBRL(amount)}`,
            operatorSession?.name ? `Operador: ${operatorSession.name}` : ''
          ].filter(Boolean) as string[]
        });
      } else {
        if (!cashSession?.id) {
          toast({ title: 'Caixa não encontrado', variant: 'destructive' });
          return;
        }
        const latestOpenTablesCount = await getOpenTableCount(user.id);
        setOpenTablesCount(latestOpenTablesCount);
        if (latestOpenTablesCount > 0 && !openTablesConsent) {
          toast({
            title: 'Existem mesas abertas',
            description: `Confirme que deseja fechar o caixa mesmo com ${latestOpenTablesCount} mesa(s) aberta(s).`,
            variant: 'destructive',
          });
          return;
        }
        const latestSummary = cashCloseSummary || await loadCashCloseSummary(cashSession, amount);
        setCashCloseSummary(latestSummary);
        const updatePayload: any = {
          status: 'closed',
          closed_at: new Date().toISOString(),
          final_amount: amount,
          expected_amount: latestSummary?.expectedCash ?? null,
          notes: latestOpenTablesCount > 0
            ? `Fechamento autorizado com ${latestOpenTablesCount} mesa(s) aberta(s).`
            : null,
        };
        if (waiterId) updatePayload.closed_by_waiter_id = waiterId;
        const { expected_amount, closed_by_waiter_id, ...requiredClosePayload } = updatePayload;
        const candidates = [
          updatePayload,
          { ...requiredClosePayload, ...(closed_by_waiter_id ? { closed_by_waiter_id } : {}) },
          { ...requiredClosePayload, ...(expected_amount != null ? { expected_amount } : {}) },
          requiredClosePayload,
        ];
        let closedRow: any = null;
        let lastCloseError: any = null;
        for (const candidate of candidates) {
          const { data: updated, error } = await supabase
            .from('cash_register_sessions' as any)
            .update(candidate)
            .eq('id', cashSession.id)
            .eq('user_id', user.id)
            .eq('status', 'open')
            .select('id,status,closed_at')
            .maybeSingle();
          if (!error && updated?.status === 'closed') {
            closedRow = updated;
            break;
          }
          lastCloseError = error || new Error('A sessão aberta não foi alterada no banco.');
          const message = String(error?.message || '');
          if (!/expected_amount|closed_by_waiter_id/i.test(message)) break;
        }
        if (!closedRow) throw lastCloseError || new Error('Não foi possível confirmar o fechamento do caixa.');

        setCashSession(null);
        setCashSessionDeadline(null);
        setCashDialogOpen(false);
        window.dispatchEvent(new CustomEvent('cash-session-changed'));
        toast({ title: 'Caixa fechado' });
        await PrinterService.printCashReport({
          title: '',
          userId: user.id,
          hideStoreHeader: true,
          footerText: '',
          lines: buildCashCloseReportLines({
            ...latestSummary,
            closedAt: updatePayload.closed_at,
          }, amount)
        });
      }
      setCashDialogOpen(false);
      await fetchOpenCashSession();
      window.dispatchEvent(new CustomEvent('cash-session-changed'));
    } catch (e: any) {
      toast({ title: 'Erro no caixa', description: e?.message || 'Erro desconhecido', variant: 'destructive' });
      try { alert(e?.message || 'Erro no caixa') } catch {}
    }
  };

  const submitCashMovement = async () => {
    if (!user?.id) return;
    if (!cashSession?.id) {
      toast({ title: 'Caixa fechado', description: 'Abra o caixa primeiro', variant: 'destructive' });
      return;
    }
    const amount = Number(cashMoveAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: 'Valor inválido', description: 'Informe um valor válido', variant: 'destructive' });
      return;
    }
    const session = getLocalOperatorSession();
    if (!session?.id) {
      toast({ title: 'Selecione um operador', variant: 'destructive' });
      return;
    }
    const needsAdmin = cashMoveType === 'out' && !isAdminOperator(session);
    if (needsAdmin) {
      setAdminPinOpen(true);
      return;
    }
    try {
      const { error } = await (supabase as any).from('cash_movements').insert({
        session_id: cashSession.id,
        user_id: user.id,
        type: cashMoveType,
        amount,
        description: cashMoveDesc || null,
      });
      if (error) throw error;
      toast({ title: cashMoveType === 'in' ? 'Suprimento registrado' : 'Sangria registrada' });
      await PrinterService.printCashReport({
        title: cashMoveType === 'in' ? 'Suprimento' : 'Sangria',
        userId: user.id,
        lines: [
          `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
          `Valor: ${formatBRL(amount)}`,
          cashMoveDesc ? `Descrição: ${cashMoveDesc}` : '',
          session?.name ? `Operador: ${session.name}` : ''
        ].filter(Boolean) as string[]
      });
      setCashMoveOpen(false);
      setCashMoveAmount('');
      setCashMoveDesc('');
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Erro ao registrar movimentação', variant: 'destructive' });
    }
  };

  const fetchData = async (options: { background?: boolean } = {}) => {
    const showInitialLoading = !hasLoadedDataRef.current && !options.background;
    try {
      if (showInitialLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      await Promise.all([
        fetchProducts(),
        fetchCategories(),
        fetchDeliveryZones(),
        fetchTables()
      ]);
      hasLoadedDataRef.current = true;
    } catch (error: any) {
      console.error('Erro ao carregar dados:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados.",
        variant: "destructive"
      });
    } finally {
      if (showInitialLoading) setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchProducts = async () => {
    try {
      let data: any = null;
      let error: any = null;

      const res1 = await supabase
        .from('products')
        .select('*')
        .eq('user_id', user?.id)
        .eq('available', true)
        .eq('show_in_pdv', true)
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      data = res1.data;
      error = res1.error;

      if (error && String(error.message || '').includes('display_order')) {
        const res2 = await supabase
          .from('products')
          .select('*')
          .eq('user_id', user?.id)
          .eq('available', true)
          .eq('show_in_pdv', true)
          .order('name', { ascending: true });
        data = res2.data;
        error = res2.error;
      }

      if (error) throw error;
      const pricedProducts = await applyEffectivePrices((data || []) as Product[], user?.id || '', 'pdv');
      setProducts(pricedProducts);
      warmImageCache(pricedProducts.map((product) => product.image_url));
      if (user?.id) writePdvCatalogCache(user.id, { products: pricedProducts });
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      if (!hasLoadedDataRef.current) setProducts([]);
    }
  };

  const fetchDeliveryZones = async () => {
    try {
      const { data: zonesData, error: zonesError } = await supabase
        .from('delivery_zones')
        .select('*')
        .eq('user_id', user?.id)
        .eq('active', true)
        .order('name');

      if (zonesError) {
        console.error('Erro ao carregar delivery_zones:', zonesError);
        if (!hasLoadedDataRef.current) setDeliveryZones([]);
        return;
      }

      const deliveryAreas: DeliveryZone[] = (zonesData || []).map(zone => ({
        id: zone.id,
        name: zone.name,
        delivery_fee: zone.delivery_fee,
        minimum_order: zone.minimum_order || 0
      }));
      
      setDeliveryZones(deliveryAreas);
    } catch (error) {
      console.error('Erro ao carregar bairros de entrega:', error);
      if (!hasLoadedDataRef.current) setDeliveryZones([]);
    }
  };

  const fetchTables = async () => {
    try {
      const data = await ensureDefaultTables(user?.id);
      setTables(data || []);
    } catch (error) {
      console.error('Erro ao carregar mesas:', error);
      if (!hasLoadedDataRef.current) setTables([]);
    }
  };

  const categoryById = useMemo(() => {
    return new Map(categories.map((category) => [category.id, category]));
  }, [categories]);

  const categoryOptions = useMemo(() => {
    const categoriesWithProducts = categories.filter((category) =>
      products.some((product) => product.category_id === category.id)
    );
    const uncategorizedCount = products.filter((product) => !product.category_id || !categoryById.has(product.category_id)).length;
    return {
      categoriesWithProducts,
      hasUncategorized: uncategorizedCount > 0,
    };
  }, [categories, categoryById, products]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const codeQuery = normalizeProductLookupCode(searchQuery);
    return products.filter((product) => {
      const matchesSearch = !query ||
        product.name.toLowerCase().includes(query) ||
        normalizeProductLookupCode(product.barcode).includes(codeQuery) ||
        normalizeProductLookupCode(product.internal_code).includes(codeQuery);
      const matchesCategory =
        activeCategoryId === 'all' ||
        (activeCategoryId === 'uncategorized' && (!product.category_id || !categoryById.has(product.category_id))) ||
        product.category_id === activeCategoryId;
      return matchesSearch && matchesCategory;
    });
  }, [activeCategoryId, categoryById, products, searchQuery]);

  const groupedProducts = useMemo(() => {
    const groups: Array<{ id: string; name: string; products: Product[] }> = [];
    const productsByCategory = new Map<string, Product[]>();
    const uncategorized: Product[] = [];

    for (const product of filteredProducts) {
      if (product.category_id && categoryById.has(product.category_id)) {
        const current = productsByCategory.get(product.category_id) || [];
        current.push(product);
        productsByCategory.set(product.category_id, current);
      } else {
        uncategorized.push(product);
      }
    }

    for (const category of categories) {
      const categoryProducts = productsByCategory.get(category.id);
      if (categoryProducts?.length) {
        groups.push({ id: category.id, name: category.name, products: categoryProducts });
      }
    }

    if (uncategorized.length > 0) {
      groups.push({ id: 'uncategorized', name: 'Sem categoria', products: uncategorized });
    }

    return groups;
  }, [categories, categoryById, filteredProducts]);

  const fetchProductVariations = async (productId: string): Promise<ProductVariation[]> => {
    try {
      // Buscar variações específicas do produto
      let productVariations: any[] | null = null;
      let productError: any = null;
      const res1 = await supabase
        .from('product_variations')
        .select('*')
        .eq('product_id', productId)
        .order('display_order', { ascending: true });
      productVariations = res1.data as any;
      productError = res1.error as any;
      if (productError && String(productError.message || '').includes('display_order')) {
        const res2 = await supabase
          .from('product_variations')
          .select('*')
          .eq('product_id', productId)
          .order('name', { ascending: true });
        productVariations = res2.data as any;
        productError = res2.error as any;
      }

      // Buscar variações globais associadas ao produto
      const { data: globalVariationLinks, error: globalError } = await supabase
        .from('product_global_variation_links')
        .select('global_variation_id,required,min_selections,max_selections,display_order')
        .eq('product_id', productId)
        .order('display_order', { ascending: true });

      // Buscar as variações globais pelos IDs
      let globalVariations: any[] = [];
      if (globalVariationLinks && globalVariationLinks.length > 0) {
        const globalVariationIds = (globalVariationLinks as any[]).map((link: any) => link.global_variation_id);
        
        const { data: globalVars, error: globalVarError } = await supabase
          .from('global_variations')
          .select('*')
          .in('id', globalVariationIds);

        if (globalVars) {
          const linkById = new Map((globalVariationLinks as any[]).map((l: any) => [String(l.global_variation_id), l]));
          globalVariations = globalVars.map((globalVar: any) => {
            const link = linkById.get(String(globalVar.id));
            return {
              ...globalVar,
              required: link?.required !== undefined && link?.required !== null ? Boolean(link.required) : Boolean(globalVar.required),
              min_selections: link?.min_selections ?? 0,
              max_selections: link?.max_selections ?? (globalVar.max_selections ?? 1),
              display_order: link?.display_order
            };
          });
        }
      }

      // Combinar todas as variações
      const allVariations = [...(productVariations || []), ...globalVariations];
      
      const formattedVariations: (ProductVariation & { display_order?: number })[] = allVariations
        .map(item => {
          try {
            let options: Array<{ name: string; price: number; }> = [];

            if (typeof item.options === 'string') {
              try {
                options = JSON.parse(item.options);
              } catch (e) {
                options = [];
              }
            } else if (Array.isArray(item.options)) {
              options = item.options
                .filter((opt: any) => {
                  return opt && 
                         typeof opt === 'object' && 
                         opt.name && 
                         typeof opt.name === 'string' &&
                         opt.price !== undefined && 
                         !isNaN(Number(opt.price));
                })
                .map((opt: any) => ({
                  name: String(opt.name).trim(),
                  price: Number(opt.price)
                }));
            }

            return {
              id: item.id,
              name: item.name || '',
              options,
              max_selections: Math.max(1, Number(item.max_selections) || 1),
              required: Boolean(item.required),
              display_order: item.display_order
            };
          } catch (itemError) {
            return null;
          }
        })
        .filter((variation): variation is ProductVariation => variation !== null);

      const sorted = [...formattedVariations].sort((a: any, b: any) => {
        const ao = a.display_order !== undefined && a.display_order !== null ? Number(a.display_order) : 10_000;
        const bo = b.display_order !== undefined && b.display_order !== null ? Number(b.display_order) : 10_000;
        if (ao !== bo) return ao - bo;
        return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
      });
      
      return sorted as ProductVariation[];
    } catch (error) {
      console.error('Erro geral ao carregar variações:', error);
      return [];
    }
  };

  const normalizeScaleWeightToKg = (weight: number, unit?: string) => {
    const value = Math.max(0, Number(weight || 0));
    const normalizedUnit = String(unit || '').toLowerCase();
    if (normalizedUnit === 'g' || normalizedUnit === 'gram' || normalizedUnit === 'grams') return value / 1000;
    if (value > 30) return value / 1000;
    return value;
  };

  const addWeightedProductToCart = (product: Product, weightKg: number) => {
    const safeWeight = Math.max(0, Number(weightKg || 0));
    if (!safeWeight) {
      toast({ title: 'Peso inválido', description: 'Informe um peso maior que zero.', variant: 'destructive' });
      return false;
    }
    addToCart(product, Number(safeWeight.toFixed(3)));
    return true;
  };

  const openManualWeightDialog = (product: Product) => {
    setPendingWeightProduct(product);
    setManualWeight('');
    setWeightDialogOpen(true);
  };

  const confirmManualWeight = () => {
    if (!pendingWeightProduct) return;
    const weightKg = Number(manualWeight.replace(',', '.'));
    if (!addWeightedProductToCart(pendingWeightProduct, weightKg)) return;
    setWeightDialogOpen(false);
    setPendingWeightProduct(null);
    setManualWeight('');
  };

  const readWeightFromPopConnect = async () => {
    const websocketUrl = await discoverBridgeWebsocketUrl({ timeoutMs: 900 });
    if (!websocketUrl) throw new Error('Pop Connect não encontrado neste computador');

    const result = await bridgeReadScaleWeight({ websocketUrl, timeoutMs: 4500 });
    if (!result.scaleConnected) throw new Error('Conecte a balança no Pop Connect');
    if (!result.reading) throw new Error('A balança não enviou o peso');
    return result.reading;
  };

  const fillWeightFromPopConnect = async () => {
    if (readingScale) return;
    setReadingScale(true);
    try {
      const reading = await readWeightFromPopConnect();
      const weightKg = normalizeScaleWeightToKg(reading.weight, reading.unit);
      if (!weightKg) throw new Error('Coloque o produto na balança e tente novamente');
      setManualWeight(weightKg.toFixed(3).replace('.', ','));
      toast({ title: 'Peso recebido do Pop Connect', description: `${weightKg.toFixed(3).replace('.', ',')} kg` });
    } catch (error: unknown) {
      toast({
        title: 'Leitura da balança indisponível',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setReadingScale(false);
    }
  };

  const handleWeightedProductClick = async (product: Product) => {
    const api = (window as any)?.electronAPI;
    const scalePort = localStorage.getItem('hw.scale.port') || '';
    try {
      let reading: { weight: number; unit?: string };
      if (api?.readWeight && scalePort) {
        const resp = await api.readWeight(scalePort, 1800);
        if (!resp?.success) throw new Error(resp?.error || resp?.message || 'Balança não identificada');
        reading = { weight: Number(resp.weight || 0), unit: resp.unit };
      } else if (pwaScaleService.isConnected()) {
        reading = await pwaScaleService.getReading(1800);
      } else {
        reading = await readWeightFromPopConnect();
      }
      const weightKg = normalizeScaleWeightToKg(reading.weight, reading.unit);
      if (!weightKg) throw new Error('Peso zerado');
      addWeightedProductToCart(product, weightKg);
    } catch (error: any) {
      toast({ title: 'Leitura automática indisponível', description: error?.message || 'Digite o peso manualmente.' });
      openManualWeightDialog(product);
    }
  };

  const handleProductClick = async (product: Product) => {
    if (product.weight_based) {
      await handleWeightedProductClick(product);
      return;
    }

    const variations = await prefetchSimpleVariations(product.id);
    
    if (variations.length > 0) {
      setSelectedProduct(product);
      setProductVariations(variations);
      setShowVariationModal(true);
    } else {
      addToCart(product, 1);
    }
  };

  const restoreScannerInputTarget = () => {
    const target = scannerInputTargetRef.current;
    scannerInputTargetRef.current = null;
    if (!target?.element) return;

    const element = target.element;
    const valueSetter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    valueSetter?.call(element, target.value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const lookupElectronicCommand = async (rawValue: string, options?: { restoreInput?: boolean }) => {
    const rawCode = rawValue.trim();
    if (!rawCode) {
      toast({
        title: 'Informe o código da comanda',
        description: 'Digite o número ou leia o código de barras da comanda.',
      });
      return false;
    }

    const { data, error } = await (supabase as any).rpc('lookup_electronic_command', {
      p_code: rawCode,
    });

    if (error) {
      toast({
        title: 'Não foi possível consultar a comanda',
        description: 'Confira o código e tente novamente.',
        variant: 'destructive',
      });
      return false;
    }

    if (!data?.found) {
      toast({
        title: 'Comanda não cadastrada',
        description: `Não encontramos uma comanda ativa com o código ${rawCode}.`,
        variant: 'destructive',
      });
      return false;
    }

    if (options?.restoreInput) restoreScannerInputTarget();
    setCommandLookup(data as ElectronicCommandLookup);
    setCommandLookupOpen(true);
    setCommandQueryOpen(false);
    setCommandQuery('');
    return true;
  };

  const addProductByScannedCode = async (scannedCode: string) => {
    const rawCode = scannedCode.trim();
    const code = normalizeProductLookupCode(rawCode);
    if (!code) return false;

    const product = products.find((item) =>
      normalizeProductLookupCode(item.barcode) === code ||
      matchesInternalProductCode(item.internal_code, code) ||
      normalizeProductLookupCode(item.id) === code
    );

    if (!product) {
      return lookupElectronicCommand(rawCode, { restoreInput: true });
    }

    restoreScannerInputTarget();
    await handleProductClick(product);
    return true;
  };

  useEffect(() => {
    if (activeTab !== 'products') return;

    const minScanLength = 4;
    const scanKeyGapMs = 95;
    const scanEnterWindowMs = 300;

    const clearScannerBuffer = () => {
      scannerBufferRef.current = '';
      scannerInputTargetRef.current = null;
      if (scannerClearTimerRef.current) {
        window.clearTimeout(scannerClearTimerRef.current);
        scannerClearTimerRef.current = null;
      }
    };

    const captureInputTarget = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        scannerInputTargetRef.current = { element: active, value: active.value };
      } else {
        scannerInputTargetRef.current = null;
      }
    };

    const handleScannerKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (showVariationModal || weightDialogOpen || cashDialogOpen || adminPinOpen || tefOpen || tableLaunchOpen || commandLookupOpen || commandQueryOpen || checkoutOpen || shortcutsOpen) return;

      const now = Date.now();

      if (event.key === 'Enter') {
        const rawCode = scannerBufferRef.current;
        const isLikelyScan = rawCode.length >= minScanLength && now - scannerLastKeyAtRef.current <= scanEnterWindowMs;
        clearScannerBuffer();
        if (isLikelyScan) {
          event.preventDefault();
          event.stopPropagation();
          void addProductByScannedCode(rawCode);
        }
        return;
      }

      if (event.key.length !== 1) return;

      if (now - scannerLastKeyAtRef.current > scanKeyGapMs) {
        scannerBufferRef.current = '';
        captureInputTarget();
      }

      scannerBufferRef.current += event.key;
      scannerLastKeyAtRef.current = now;

      if (scannerClearTimerRef.current) window.clearTimeout(scannerClearTimerRef.current);
      scannerClearTimerRef.current = window.setTimeout(clearScannerBuffer, scanEnterWindowMs);
    };

    window.addEventListener('keydown', handleScannerKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleScannerKeyDown, true);
      clearScannerBuffer();
    };
  }, [activeTab, adminPinOpen, cashDialogOpen, checkoutOpen, commandLookupOpen, commandQueryOpen, products, shortcutsOpen, showVariationModal, tableLaunchOpen, tefOpen, weightDialogOpen]);

  const makeCartItemId = () => {
    try {
      if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    } catch {}
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const unpackSelectedVariations = (value: SelectedVariationsPayload | undefined) => {
    if (!value) return { options: [] as string[], variationLines: [] as string[] };
    if (Array.isArray(value)) return { options: value.map((v) => String(v || '').trim()).filter(Boolean), variationLines: [] as string[] };
    const options = Array.isArray(value.options) ? value.options.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const variationLines = Array.isArray(value.variationLines) ? value.variationLines.map((v) => String(v || '').trim()).filter(Boolean) : [];
    return { options, variationLines };
  };

  const addToCart = (
    product: Product,
    quantity: number = 1,
    selectedVariations: SelectedVariationsPayload = [],
    notes: string = '',
    variationPrice: number = 0
  ) => {
    setCart(prev => {
      const variationKey = JSON.stringify(selectedVariations) + notes;
      const existing = prev.find(item => 
        item.id === product.id && 
        JSON.stringify(item.selectedVariations) === JSON.stringify(selectedVariations) &&
        item.notes === notes
      );
      
      if (existing) {
        return prev.map(item =>
          item.cartItemId === existing.cartItemId
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      }
      
      return [...prev, {
        ...product,
        price: Math.max(0, Number(product.price || 0) + Number(variationPrice || 0)),
        cartItemId: makeCartItemId(),
        quantity, 
        selectedVariations: (() => {
          if (Array.isArray(selectedVariations)) return selectedVariations.length > 0 ? selectedVariations : undefined;
          const { options, variationLines } = unpackSelectedVariations(selectedVariations);
          if (options.length === 0 && variationLines.length === 0) return undefined;
          return { options, variationLines };
        })(),
        notes: notes || undefined
      }];
    });

    toast({
      title: "Produto adicionado",
      description: `${product.name} foi adicionado ao pedido.`,
      duration: 1500,
    });
  };

  // Helper function to format selected variations for display
  const formatSelectedVariations = (selectedVariations?: SelectedVariationsPayload) => {
    const { options, variationLines } = unpackSelectedVariations(selectedVariations);
    if (variationLines.length > 0) return variationLines;
    if (options.length === 0) return [];
    
    try {
      return options;
    } catch (error) {
      console.error('Error formatting variations:', error);
      return [];
    }
  };

  const removeFromCart = (cartItemId: string) => {
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
  };

  const updateQuantity = (cartItemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(cartItemId);
      return;
    }
    setCart(prev =>
      prev.map(item =>
        item.cartItemId === cartItemId ? { ...item, quantity: newQuantity } : item
      )
    );
  };

  const getTotalValue = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getDiscountValue = () => parseBRL(discountAmount);
  const getSurchargeValue = () => parseBRL(surchargeAmount);

  const getDeliveryFee = () => {
    if (orderType !== 'delivery' || !selectedDeliveryZone) return 0;
    const zone = deliveryZones.find(z => z.id === selectedDeliveryZone);
    return zone?.delivery_fee || 0;
  };

  const getFinalTotal = () => {
    return Math.max(0, getTotalValue() + getDeliveryFee() + getSurchargeValue() - getDiscountValue());
  };

  const getManualPaymentTotal = () => {
    return PDV_PAYMENT_METHODS.reduce((sum, method) => sum + parseBRL(paymentAmounts[method.value]), 0);
  };

  const hasManualPaymentSplit = () => getManualPaymentTotal() > 0.009;

  const getPaymentLines = () => {
    const finalTotal = getFinalTotal();
    if (!hasManualPaymentSplit()) {
      return finalTotal > 0
        ? [{ method: paymentMethod, label: getPaymentMethodLabel(paymentMethod), amount: finalTotal }]
        : [];
    }

    return PDV_PAYMENT_METHODS
      .map((method) => ({
        method: method.value,
        label: method.label,
        amount: parseBRL(paymentAmounts[method.value]),
      }))
      .filter((line) => line.amount > 0.009);
  };

  const getPaymentPaidTotal = () => {
    return getPaymentLines().reduce((sum, line) => sum + line.amount, 0);
  };

  const getPaymentRemaining = () => {
    return Math.max(0, getFinalTotal() - getPaymentPaidTotal());
  };

  const getCashPaymentPortion = () => {
    const cashLine = getPaymentLines().find((line) => line.method === 'dinheiro');
    return Number(cashLine?.amount || 0);
  };

  const getCashReceivedValue = () => parseBRL(changeAmount);

  const getCashChangeValue = () => {
    const cashPortion = getCashPaymentPortion();
    if (cashPortion <= 0) return 0;
    return Math.max(0, getCashReceivedValue() - cashPortion);
  };

  const setSelectedPaymentMethod = (method: PdvPaymentMethod) => {
    setPaymentMethod(method);
    const currentAmount = parseBRL(paymentAmounts[method]);

    if (!hasManualPaymentSplit()) {
      if (method === 'dinheiro') setChangeAmount(formatBRL(getFinalTotal()));
      return;
    }

    if (currentAmount > 0) return;

    const remaining = getPaymentRemaining();
    if (remaining > 0.009) {
      setPaymentAmounts((prev) => ({
        ...prev,
        [method]: formatBRL(remaining),
      }));
      if (method === 'dinheiro') setChangeAmount(formatBRL(remaining));
    }
  };

  const updatePaymentAmount = (method: PdvPaymentMethod, value: string) => {
    setPaymentAmounts((prev) => ({
      ...prev,
      [method]: value,
    }));
    if (method === 'dinheiro') {
      const currentCashReceived = parseBRL(changeAmount);
      const nextCashAmount = parseBRL(value);
      if (!changeAmount || currentCashReceived + 0.009 < nextCashAmount) {
        setChangeAmount(value);
      }
    }
  };

  const clearPaymentSplit = () => {
    setPaymentAmounts(emptyPdvPaymentAmounts());
    setChangeAmount('');
  };

  const getChangeValue = () => {
    return getCashChangeValue();
  };

  const resetCurrentSale = (nextOrderType: 'delivery' | 'pickup' | 'dine_in' | 'counter' = 'counter') => {
    clearPdvDraft();
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setWhatsappConversationId(null);
    setCustomerDocument('');
    setSelectedFiscalRecipient(null);
    setSelectedFiscalModel('65');
    setFiscalRecipientOpen(false);
    setSelectedDeliveryZone('');
    setSelectedTable('');
    setTableLaunchId('');
    setPaymentAmounts(emptyPdvPaymentAmounts());
    setChangeAmount('');
    setDiscountAmount('');
    setSurchargeAmount('');
    setReceivableContactId('');
    setReceivableContact(null);
    setReceivableDueDate('');
    setReceivableNotes('');
    setTefData(null);
    setCardProcessingMode('maquininha');
    setPaymentMethod('pix');
    setOrderType(nextOrderType);
  };

  const getNextSaleOrderType = () => {
    return orderType === 'dine_in' ? 'counter' : orderType;
  };

  const fetchCategories = async () => {
    try {
      let data: any[] | null = null;
      let error: any = null;

      const res1 = await supabase
        .from('product_categories')
        .select('id, name, description, display_order')
        .eq('user_id', user?.id)
        .eq('active', true)
        .order('display_order', { ascending: true });

      data = res1.data as any;
      error = res1.error as any;

      if (error && String(error.message || '').includes('display_order')) {
        const res2 = await supabase
          .from('product_categories')
          .select('id, name, description')
          .eq('user_id', user?.id)
          .eq('active', true)
          .order('name', { ascending: true });
        data = res2.data as any;
        error = res2.error as any;
      }

      if (error) throw error;
      const nextCategories = ((data || []) as any[]).map((category) => enrichCategoryWithMetadata(category)) as CategoryConfig[];
      setCategories(nextCategories);
      if (user?.id) writePdvCatalogCache(user.id, { categories: nextCategories });
    } catch (error) {
      console.error('Erro ao carregar categorias do PDV:', error);
      if (!hasLoadedDataRef.current) setCategories([]);
    }
  };

  const generateOrderNumber = () => {
    return Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  };

  const ensureCashCanReceiveOrder = async () => {
    if (!user?.id) return false;

    let currentSession: CashSession | null = null;
    let currentDeadline: Date | null = null;
    try {
      const [{ data: session, error: sessionError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from('cash_register_sessions' as any)
          .select('id, opened_at, initial_amount, status')
          .eq('user_id', user.id)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('profiles').select('opening_hours').eq('id', user.id).maybeSingle(),
      ]);
      if (sessionError) throw sessionError;
      if (profileError) throw profileError;
      currentSession = (session as CashSession | null) || null;
      currentDeadline = session?.opened_at ? getCashSessionDeadline(session.opened_at, profile?.opening_hours) : null;
      setCashSession(currentSession);
      setCashSessionDeadline(currentDeadline);
    } catch (error) {
      console.error('Falha ao validar o caixa antes de lançar o pedido:', error);
      toast({
        title: 'Não foi possível validar o caixa',
        description: 'Atualize a tela e tente novamente. O pagamento não foi aberto por segurança.',
        variant: 'destructive',
      });
      return false;
    }

    if (!currentSession?.id) {
      toast({
        title: 'Caixa fechado',
        description: 'Abra o caixa antes de lançar um pedido.',
        variant: 'destructive',
      });
      openCashDialog('open');
      return false;
    }
    if (currentDeadline && Date.now() > currentDeadline.getTime()) {
      toast({
        title: 'Caixa pendente de encerramento',
        description: `O limite deste caixa venceu em ${currentDeadline.toLocaleString('pt-BR')}. Feche-o antes de lançar um novo pedido.`,
        variant: 'destructive',
      });
      navigate('/caixa?cashAction=close&motivo=limite');
      return false;
    }
    return true;
  };

  const addToTable = async (tableIdOverride?: string) => {
    const targetTableId = tableIdOverride || selectedTable;
    if (cart.length === 0) {
      toast({
        title: "Pedido vazio",
        description: "Adicione produtos ao pedido antes de adicionar à mesa.",
        variant: "destructive",
      });
      return;
    }

    if (!targetTableId) {
      toast({
        title: "Mesa obrigatória",
        description: "Por favor, selecione uma mesa.",
        variant: "destructive",
      });
      return;
    }

    if (!(await ensureCashCanReceiveOrder())) return;

    try {
      setProcessing(true);

      const orderItems = cart.map(item => {
        const { options, variationLines } = unpackSelectedVariations(item.selectedVariations);
        return {
        product_id: item.id,
        product_name: item.name,
        price: item.price,
        base_price: item.base_price ?? item.price,
        effective_price: item.effective_price ?? item.price,
        price_table_id: item.price_table_id ?? null,
        price_rule_id: item.price_rule_id ?? null,
        price_table_name: item.price_table_name ?? null,
        price_source: item.price_source ?? 'base',
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
        sale_unit: item.weight_based ? 'kg' : 'un',
        options,
        variations: variationLines,
        notes: item.notes || '',
        send_to_kds: item.send_to_kds === true
        };
      });

      const tableFlow = await fetchTableOrderFlowSettings(user?.id);
      const managerItems = filterItemsForTableManagerOrder(orderItems, tableFlow);

      const { data: existingAccount } = await supabase
        .from('table_accounts')
        .select('*')
        .eq('table_id', targetTableId)
        .eq('status', 'open')
        .maybeSingle();

      if (existingAccount) {
        let existingItems = [];
        try {
          if (typeof existingAccount.items === 'string') {
            existingItems = JSON.parse(existingAccount.items);
          } else if (Array.isArray(existingAccount.items)) {
            existingItems = existingAccount.items;
          }
        } catch (e) {
          existingItems = [];
        }

        const updatedItems = [...existingItems, ...orderItems];
        const newTotal = updatedItems.reduce((sum: number, item: any) => sum + item.subtotal, 0);

        const { error } = await supabase
          .from('table_accounts')
          .update({
            items: updatedItems,
            total: newTotal
          })
          .eq('id', existingAccount.id);

        if (error) throw error;
      } else {
        const total = getTotalValue();
        
        const { error } = await supabase
          .from('table_accounts')
          .insert({
            user_id: user?.id,
            table_id: targetTableId,
            items: orderItems,
            total: total,
            status: 'open'
          });

        if (error) throw error;

      }

      await supabase
        .from('tables')
        .update({ status: 'occupied' })
        .eq('id', targetTableId);

      if (shouldCreateTableManagerOrder(tableFlow) && managerItems.length > 0) {
        const orderTotal = managerItems.reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0);
        const orderStatus = getTableManagerOrderStatus(tableFlow);
        const tableNumber = tables.find((table) => table.id === targetTableId)?.table_number;

        const { error: managerOrderError } = await supabase
          .from('orders')
          .insert({
            customer_name: tableNumber ? `Mesa ${tableNumber}` : 'Mesa',
            customer_phone: null,
            customer_address: null,
            order_type: 'dine_in',
            delivery_zone_id: null,
            table_id: targetTableId,
            items: managerItems,
            total: orderTotal,
            discount: 0,
            delivery_fee: 0,
            payment_method: 'pendente',
            change_amount: null,
            status: orderStatus.status,
            acceptance_status: orderStatus.acceptance_status,
            order_number: `MESA-${tableNumber || 'PDV'}-${Date.now().toString().slice(-5)}`,
            user_id: user?.id,
            estimated_time: '15-30 min',
            waiter_id: null,
            cash_register_session_id: cashSession?.id || null,
            variations: {
              source: 'PDV_TABLE',
              table_order_flow: tableFlow.mode,
              show_in_manager: tableFlow.showInManager,
              auto_accept: tableFlow.autoAccept,
            },
          });

        if (managerOrderError) throw managerOrderError;
      }

      toast({
        title: "Itens adicionados à mesa!",
        description: managerItems.length > 0
          ? "Os produtos foram adicionados à mesa e enviados para preparo."
          : "Os produtos ficaram apenas na conta da mesa.",
      });

      setMobileCartOpen(false);
      setTableLaunchOpen(false);
      resetCurrentSale('counter');
      fetchTables();
    } catch (error: any) {
      console.error('Erro ao adicionar à mesa:', error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar à mesa.",
        variant: "destructive"
      });
    } finally {
      setProcessing(false);
    }
  };

  const openTableLaunch = async () => {
    if (cart.length === 0) {
      toast({
        title: "Pedido vazio",
        description: "Adicione produtos ao pedido antes de lançar em uma mesa.",
        variant: "destructive",
      });
      return;
    }
    if (!(await ensureCashCanReceiveOrder())) return;
    setTableLaunchId(selectedTable || '');
    setTableLaunchOpen(true);
  };

  const openCheckout = async () => {
    if (cart.length === 0) {
      toast({
        title: "Pedido vazio",
        description: "Adicione produtos ao pedido antes de fechar a venda.",
        variant: "destructive",
      });
      return;
    }

    if (!(await ensureCashCanReceiveOrder())) return;

    setMobileCartOpen(false);
    setCheckoutOpen(true);
  };

  const addProductByTypedCode = async () => {
    const rawCode = productCodeQuery.trim();
    const code = normalizeProductLookupCode(rawCode);
    if (!code) return;

    const product = products.find((item) =>
      matchesInternalProductCode(item.internal_code, code) ||
      normalizeProductLookupCode(item.barcode) === code
    );

    if (!product) {
      toast({
        title: 'Produto não encontrado',
        description: `Nenhum produto possui o código ${rawCode}.`,
        variant: 'destructive',
      });
      productCodeInputRef.current?.select();
      return;
    }

    await handleProductClick(product);
    setProductCodeQuery('');
    window.requestAnimationFrame(() => productCodeInputRef.current?.focus());
  };

  useEffect(() => {
    if (activeTab !== 'products') return;

    const handlePdvShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      const hasBlockingDialog = showVariationModal || weightDialogOpen || cashDialogOpen || adminPinOpen || tefOpen || tableLaunchOpen || commandLookupOpen || commandQueryOpen || checkoutOpen || shortcutsOpen;
      if (hasBlockingDialog) return;

      const shortcut = resolvePdvFunctionKey(event);

      // Fora de campos de edição, o primeiro número já inicia a digitação do
      // código do produto. Assim o operador não precisa clicar nem apertar F3.
      if (!shortcut && !isEditing && /^\d$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setProductCodeQuery(event.key);
        window.requestAnimationFrame(() => {
          productCodeInputRef.current?.focus();
          productCodeInputRef.current?.setSelectionRange(1, 1);
        });
        return;
      }

      if (!shortcut) return;

      if (shortcut === 'F1') {
        event.preventDefault();
        event.stopPropagation();
        setShortcutsOpen(true);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (shortcut === 'F2') {
        productSearchInputRef.current?.focus();
        productSearchInputRef.current?.select();
      } else if (shortcut === 'F3') {
        productCodeInputRef.current?.focus();
        productCodeInputRef.current?.select();
      } else if (shortcut === 'F4') {
        void openCheckout();
      }
    };

    // Capture garante que o Electron/navegador não consuma a tecla antes do PDV.
    window.addEventListener('keydown', handlePdvShortcut, true);
    return () => window.removeEventListener('keydown', handlePdvShortcut, true);
  }, [activeTab, adminPinOpen, cashDialogOpen, checkoutOpen, commandLookupOpen, commandQueryOpen, shortcutsOpen, showVariationModal, tableLaunchOpen, tefOpen, weightDialogOpen, cart, openCheckout]);

  const isFiscalEmissionActive = async (modelCode: '55' | '65' = '65') => {
    if (!user?.id) return false;

    const { data, status } = await invokeEdgeFunction<any>('nfce-operations', {
      operation: 'politica_emissao',
      model_code: modelCode,
    }, {
      timeoutMs: 15000,
      // Usa a sessão já mantida pelo AuthContext. Isso evita disputar o lock
      // interno do Supabase Auth durante o fechamento da venda.
      authToken: session?.access_token || null,
    });

    if (status < 200 || status >= 300 || !data?.success) {
      throw new Error(
        data?.error || data?.message ||
        'Não foi possível confirmar a configuração fiscal. A venda não será finalizada como não fiscal.',
      );
    }

    return data.enabled === true;
  };

  const runNonBlockingSaleTasks = (params: {
    created: any;
    orderNumber: string;
    selectedTableId: string | null;
    notifyCustomer: boolean;
  }) => {
    const tasks: Promise<unknown>[] = [];

    if (params.notifyCustomer) {
      tasks.push(notifyOrderCreatedById(params.created?.id));
    }
    if (params.selectedTableId) {
      tasks.push(
        Promise.resolve(supabase.from('tables').update({ status: 'occupied' }).eq('id', params.selectedTableId))
          .then(({ error }) => { if (error) throw error; }),
      );
    }
    tasks.push(
      Promise.resolve(supabase.from('security_logs').insert({
        user_id: user?.id,
        event_type: 'order_finalize',
        description: `Pedido ${params.orderNumber} finalizado por ${params.created?.variations?.operator?.name || 'Conta do restaurante'}`,
        severity: 'info',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      } as any)).then(({ error }) => { if (error) throw error; }),
    );

    void Promise.allSettled(tasks).then((results) => {
      results.forEach((result) => {
        if (result.status === 'rejected') console.warn('Tarefa posterior à venda não concluída:', result.reason);
      });
    });
  };

  const emitNfceForOrder = async (order: any) => {
    if (!order?.id) throw new Error('Pedido inválido para emissão fiscal.');
    const recipient = order?.variations?.fiscal_recipient || null;
    const modelCode: '55' | '65' = order?.variations?.fiscal_model === '55' ? '55' : '65';

    const { data, status } = await invokeEdgeFunction<any>('nfce-operations', {
      operation: 'emitir',
      order_id: order.id,
      model_code: modelCode,
      consumer_data: recipient || order.customer_name || order.customer_document || customerDocument
        ? {
            nome: recipient?.name || order.customer_name || null,
            cpf_cnpj: String(recipient?.cpf_cnpj || order.customer_document || customerDocument || '').replace(/\D/g, '') || null,
            email: recipient?.email || null,
            state_registration: recipient?.state_registration || null,
            state_registration_indicator: recipient?.state_registration_indicator || 9,
            address: recipient?.address || null,
            address_number: recipient?.address_number || null,
            address_complement: recipient?.address_complement || null,
            neighborhood: recipient?.neighborhood || null,
            city: recipient?.city || null,
            state: recipient?.state || null,
            postal_code: recipient?.postal_code || null,
            city_code: recipient?.city_code || null,
            country_code: recipient?.country_code || '1058',
            country_name: recipient?.country_name || 'BRASIL',
            final_consumer: recipient?.final_consumer !== false,
          }
        : null,
      observacoes: '',
    }, {
      timeoutMs: 120000,
      authToken: session?.access_token || null,
    });

    if (status < 200 || status >= 300) {
      throw new Error(data?.error || data?.message || `Erro ao emitir documento fiscal modelo ${modelCode}.`);
    }
    if (!data?.success) {
      throw new Error(data?.motivo || data?.error || `O documento fiscal modelo ${modelCode} foi rejeitado pela Sefaz.`);
    }

    return data;
  };

  const buildFiscalValidationItems = () => cart.map((item) => {
    const { options, variationLines } = unpackSelectedVariations(item.selectedVariations);
    return {
      product_id: item.id,
      product_name: item.name,
      price: item.price,
      base_price: item.base_price ?? item.price,
      effective_price: item.effective_price ?? item.price,
      quantity: item.quantity,
      subtotal: item.price * item.quantity,
      sale_unit: item.weight_based ? 'kg' : 'un',
      fiscal_ncm: item.fiscal_ncm || null,
      fiscal_cfop: item.fiscal_cfop || null,
      fiscal_csosn: item.fiscal_csosn || null,
      fiscal_cst_pis: item.fiscal_cst_pis || null,
      fiscal_cst_cofins: item.fiscal_cst_cofins || null,
      fiscal_origem: item.fiscal_origem || null,
      fiscal_cest: item.fiscal_cest || null,
      fiscal_beneficio: item.fiscal_beneficio || null,
      options,
      variations: variationLines,
      notes: item.notes || '',
    };
  });

  const buildFiscalConsumerData = (recipient: any, orderData?: any) => recipient
      ? {
          nome: recipient.name || orderData?.customer_name || null,
          cpf_cnpj: String(recipient.cpf_cnpj || orderData?.customer_document || '').replace(/\D/g, '') || null,
          email: recipient.email || null,
          state_registration: recipient.state_registration || null,
          state_registration_indicator: recipient.state_registration_indicator || 9,
          address: recipient.address || null,
          address_number: recipient.address_number || null,
          address_complement: recipient.address_complement || null,
          neighborhood: recipient.neighborhood || null,
          city: recipient.city || null,
          state: recipient.state || null,
          postal_code: recipient.postal_code || null,
          city_code: recipient.city_code || null,
          country_code: recipient.country_code || '1058',
          country_name: recipient.country_name || 'BRASIL',
          final_consumer: recipient.final_consumer !== false && recipient.final_consumer_default !== false,
        }
      : null;

  const formatFiscalValidationError = (rawMessage: string, _modelCode: '55' | '65') => rawMessage;

  const requestFiscalPrevalidation = async ({
    modelCode,
    recipient,
    items,
    deliveryFee,
    discount,
    orderData,
  }: {
    modelCode: '55' | '65';
    recipient: any;
    items: any[];
    deliveryFee: number;
    discount: number;
    orderData?: any;
  }) => {
    const consumerData = buildFiscalConsumerData(recipient, orderData);

    const { data, status } = await invokeEdgeFunction<any>('nfce-operations', {
      operation: 'validar_pre_emissao',
      model_code: modelCode,
      consumer_data: consumerData,
      items,
      delivery_fee: deliveryFee || 0,
      discount: discount || 0,
    }, {
      timeoutMs: 30000,
      authToken: session?.access_token || null,
    });

    if (status < 200 || status >= 300 || !data?.success) {
      const rawMessage = data?.error || data?.message || `Não foi possível validar o documento fiscal modelo ${modelCode}.`;
      throw new Error(formatFiscalValidationError(rawMessage, modelCode));
    }

    return data;
  };

  const validateFiscalSaleBeforeCreate = async (orderData: any) => {
    const recipient = orderData?.variations?.fiscal_recipient || null;
    const modelCode: '55' | '65' = orderData?.variations?.fiscal_model === '55' ? '55' : '65';

    try {
      await requestFiscalPrevalidation({
        modelCode,
        recipient,
        items: orderData.items,
        deliveryFee: orderData.delivery_fee || 0,
        discount: orderData.discount || 0,
        orderData,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\n\nA venda não foi registrada.`);
    }
  };

  useEffect(() => {
    if (!checkoutOpen || selectedFiscalModel !== '55') {
      setFiscalValidation({ status: 'idle' });
      return;
    }

    if (!selectedFiscalRecipient) {
      setFiscalValidation({
        status: 'invalid',
        message: 'Selecione o destinatário para que o sistema valide a tributação da NF-e.',
      });
      return;
    }

    if (cart.length === 0) {
      setFiscalValidation({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setFiscalValidation({ status: 'checking' });

    const timer = window.setTimeout(async () => {
      try {
        await requestFiscalPrevalidation({
          modelCode: '55',
          recipient: selectedFiscalRecipient,
          items: buildFiscalValidationItems(),
          deliveryFee: getDeliveryFee(),
          discount: parseBRL(discountAmount),
        });
        if (!cancelled) {
          setFiscalValidation({
            status: 'valid',
            message: 'Destinatário e tributação dos produtos validados para NF-e modelo 55.',
          });
        }
      } catch (error) {
        if (!cancelled) {
          setFiscalValidation({
            status: 'invalid',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    checkoutOpen,
    selectedFiscalModel,
    selectedFiscalRecipient,
    cart,
    discountAmount,
    orderType,
    selectedDeliveryZone,
    deliveryZones,
  ]);

  const printOrderAfterSale = async (order: any, fiscalActive?: boolean) => {
    // O modelo escolhido no fechamento acompanha a venda. A presenca de um
    // destinatario nao pode decidir o modelo: consumidor identificado tambem
    // e permitido na NFC-e, enquanto a NF-e precisa ser uma escolha explicita.
    const modelCode: '55' | '65' = order?.variations?.fiscal_model === '55'
      ? '55'
      : '65';
    const shouldEmitFiscal = typeof fiscalActive === 'boolean' ? fiscalActive : await isFiscalEmissionActive(modelCode);

    if (!shouldEmitFiscal) {
      await PrinterService.printOrder(order, {
        openCashDrawer: shouldOpenCashDrawerForOrder(order),
      });
      return { fiscal: false as const, nfce: null };
    }

    toast({
      title: modelCode === '55' ? 'Emitindo NF-e' : 'Emitindo NFC-e',
      description: modelCode === '55' ? 'A nota fiscal modelo 55 será transmitida à Sefaz.' : 'O cupom fiscal modelo 65 será emitido e impresso automaticamente.',
    });

    if (modelCode === '55') {
      // NF-e gera dois documentos distintos: primeiro o comprovante operacional
      // normal na térmica; somente depois transmite e abre o DANFE em PDF A4.
      await PrinterService.printOrder(order, {
        openCashDrawer: shouldOpenCashDrawerForOrder(order),
      });
    }

    const nfceData = await emitNfceForOrder(order);
    const fiscalOrder = { ...order, nfce: nfceData };

    if (modelCode === '55') {
      await PrinterService.openNfeDanfe(nfceData);
      return { fiscal: true as const, nfce: nfceData };
    }

    await PrinterService.printOrder(fiscalOrder, {
      openCashDrawer: shouldOpenCashDrawerForOrder(fiscalOrder),
    });

    return { fiscal: true as const, nfce: nfceData };
  };

  const handleDeliveryCustomerLookup = async () => {
    if (orderType !== 'delivery' || customerPhone.replace(/\D/g, '').length < 10) return;

    const customer = await lookupCustomer(customerPhone);
    if (!customer) {
      setDeliveryCustomerFound('');
      toast({
        title: 'Cliente não localizado',
        description: 'Complete o endereço para cadastrar esta entrega normalmente.',
      });
      return;
    }

    setCustomerName(customer.name || '');
    setCustomerAddress(customer.address || '');
    setDeliveryCustomerFound(customer.name || 'Cadastro encontrado');

    const normalizeLocation = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    const normalizedNeighborhood = normalizeLocation(customer.neighborhood || '');
    const matchingZone = deliveryZones.find((zone) => normalizeLocation(zone.name) === normalizedNeighborhood);
    const savedZone = deliveryZones.find((zone) => zone.id === customer.deliveryZoneId);

    setSelectedDeliveryZone(savedZone?.id || matchingZone?.id || '');
  };

  const handleFinalizeSale = async () => {
    console.log('Finalizando venda...');
    
    if (cart.length === 0) {
      toast({
        title: "Pedido vazio",
        description: "Adicione produtos ao pedido antes de finalizar a venda.",
        variant: "destructive",
      });
      return;
    }

    if (orderType === 'delivery') {
      if (customerPhone.replace(/\D/g, '').length < 10) {
        toast({
          title: "Telefone obrigatório",
          description: "Informe o telefone do cliente para localizar os dados da entrega.",
          variant: "destructive",
        });
        return;
      }

      if (!customerAddress.trim()) {
        toast({
          title: "Endereço obrigatório",
          description: "Por favor, informe o endereço para entrega.",
          variant: "destructive",
        });
        return;
      }

      if (!selectedDeliveryZone) {
        toast({
          title: "Bairro obrigatório",
          description: "Por favor, selecione o bairro para entrega.",
        variant: "destructive",
        });
        return;
      }
    }

    if (orderType === 'dine_in' && !selectedTable && !customerName.includes('Mesa ')) {
      const isTableFinalization = customerName.startsWith('Mesa ') && cart.length > 0;
      if (!isTableFinalization) {
        toast({
          title: "Mesa obrigatória",
          description: "Por favor, selecione uma mesa.",
          variant: "destructive",
        });
        return;
      }
    }

    if (paymentMethod === 'pagar_depois' && !receivableContactId) {
      toast({
        title: 'Selecione o responsável pela conta',
        description: 'Escolha um cadastro existente ou crie um novo antes de registrar a conta.',
        variant: 'destructive',
      });
      return;
    }

    if (paymentMethod === 'pagar_depois' && hasManualPaymentSplit()) {
      toast({
        title: 'Forma de pagamento incompatível',
        description: 'Contas a receber devem ser registradas separadamente, sem divisão com outras formas.',
        variant: 'destructive',
      });
      return;
    }

    const paymentLines = getPaymentLines();
    const paymentPaidTotal = getPaymentPaidTotal();
    const paymentRemaining = getPaymentRemaining();
    const cashPaymentPortion = getCashPaymentPortion();
    const cashReceivedValue = getCashReceivedValue();
    const hasSplitPayment = new Set(paymentLines.map((line) => line.method)).size > 1;
    const primaryPaymentMethod = paymentLines.reduce((winner, line) => (
      line.amount > Number(winner?.amount || 0) ? line : winner
    ), paymentLines[0])?.method || paymentMethod;

    if (paymentLines.length === 0 || paymentPaidTotal + 0.009 < getFinalTotal()) {
      toast({
        title: "Pagamento incompleto",
        description: `Ainda falta ${formatCurrency(paymentRemaining)} para finalizar a venda.`,
        variant: "destructive",
      });
      return;
    }

    if (paymentPaidTotal - getFinalTotal() > 0.009 && cashPaymentPortion <= 0) {
      toast({
        title: "Pagamento acima do total",
        description: "Só é possível gerar troco quando uma parte do pagamento é em dinheiro.",
        variant: "destructive",
      });
      return;
    }

    if (cashPaymentPortion > 0 && changeAmount && cashReceivedValue + 0.009 < cashPaymentPortion) {
      toast({
        title: "Valor insuficiente",
        description: "O valor recebido em dinheiro é menor que a parte em espécie.",
        variant: "destructive",
      });
      return;
    }

    if (orderType === 'delivery' && selectedDeliveryZone) {
      const zone = deliveryZones.find(z => z.id === selectedDeliveryZone);
      if (zone && getTotalValue() < zone.minimum_order) {
        toast({
          title: "Valor mínimo não atingido",
          description: `O valor mínimo para entrega neste bairro é ${formatCurrency(zone.minimum_order)}.`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      setProcessing(true);
      console.log('Validations passed, creating order...');

      const orderNumber = generateOrderNumber();
      
        const orderItems = cart.map(item => {
          const { options, variationLines } = unpackSelectedVariations(item.selectedVariations);
          return {
        product_id: item.id,
        product_name: item.name,
        price: item.price,
        base_price: item.base_price ?? item.price,
        effective_price: item.effective_price ?? item.price,
        price_table_id: item.price_table_id ?? null,
        price_rule_id: item.price_rule_id ?? null,
        price_table_name: item.price_table_name ?? null,
        price_source: item.price_source ?? 'base',
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
        sale_unit: item.weight_based ? 'kg' : 'un',
        fiscal_ncm: item.fiscal_ncm || null,
        fiscal_cfop: item.fiscal_cfop || null,
        fiscal_csosn: item.fiscal_csosn || null,
        fiscal_cst_pis: item.fiscal_cst_pis || null,
        fiscal_cst_cofins: item.fiscal_cst_cofins || null,
        fiscal_origem: item.fiscal_origem || null,
        fiscal_cest: item.fiscal_cest || null,
        fiscal_beneficio: item.fiscal_beneficio || null,
        options,
        variations: variationLines,
        notes: item.notes || ''
          };
        });

      const operatorSession = (() => {
        return getOperatorSession();
      })();
      const isCounterPdvSale = orderType === 'counter';

      if (!cashSession?.id) {
        toast({
          title: 'Caixa fechado',
          description: 'Abra o caixa para finalizar a venda.',
          variant: 'destructive',
        });
        openCashDialog('open');
        return;
      }

      if (!operatorSession?.id) {
        toast({
          title: 'Operador não selecionado',
          description: 'Selecione um operador antes de finalizar.',
          variant: 'destructive',
        });
        return;
      }

      if (cashSessionDeadline && Date.now() > cashSessionDeadline.getTime()) {
        toast({
          title: 'Limite do caixa encerrado',
          description: `Este caixa deveria ter sido fechado até ${cashSessionDeadline.toLocaleString('pt-BR')}. Feche e abra um novo caixa para continuar.`,
          variant: 'destructive',
        });
        navigate('/caixa?cashAction=close&motivo=limite');
        return;
      }

      if (parseBRL(discountAmount) > 0 && !canGiveDiscount(operatorSession)) {
        toast({
          title: 'Sem permissão para desconto',
          description: 'O administrador precisa liberar a permissão "Aplicar Descontos" para este operador.',
          variant: 'destructive',
        });
        return;
      }

      const resolvedCustomerName = (() => {
        if (selectedFiscalRecipient?.name) return selectedFiscalRecipient.name;
        const informedName = customerName.trim();
        if (informedName) return informedName;
        if (orderType === 'dine_in') {
          const tableNumber = tables.find((table) => table.id === selectedTable)?.table_number;
          return tableNumber ? `Mesa ${tableNumber}` : 'Mesa';
        }
        if (orderType === 'delivery') return 'Cliente Delivery';
        if (orderType === 'pickup') return 'Retirada';
        return 'Venda Balcão';
      })();

      const orderData: any = {
        customer_name: resolvedCustomerName,
        customer_phone: selectedFiscalRecipient?.phone || (orderType === 'delivery' || orderType === 'pickup' ? customerPhone.trim() || null : null),
        customer_address: orderType === 'delivery' ? customerAddress.trim() : null,
        customer_id: selectedFiscalRecipient?.id || null,
        customer_document: String(selectedFiscalRecipient?.cpf_cnpj || customerDocument || '').replace(/\D/g, '') || null,
        order_type: orderType,
        delivery_zone_id: orderType === 'delivery' ? selectedDeliveryZone || null : null,
        table_id: orderType === 'dine_in' ? selectedTable || null : null,
        items: orderItems,
        total: getFinalTotal(),
        discount: parseBRL(discountAmount),
        delivery_fee: getDeliveryFee(),
        payment_method: primaryPaymentMethod,
        change_amount: cashPaymentPortion > 0 ? getCashChangeValue() : null,
        status: isCounterPdvSale ? 'completed' : (paymentMethod === 'pix' ? 'pending' : 'preparing'),
        acceptance_status: isCounterPdvSale ? 'accepted' : (paymentMethod === 'pix' ? 'awaiting_pix_payment' : 'accepted'),
        order_number: orderNumber,
        user_id: user?.id,
        source: whatsappConversationId ? 'WHATSAPP' : 'PDV',
        conversation_id: whatsappConversationId,
        estimated_time: '30-45 min',
        waiter_id: operatorSession?.id || null,
        cash_register_session_id: cashSession?.id || null,
        variations: {
          operator: operatorSession ? { id: operatorSession.id, name: operatorSession.name } : null,
          source: whatsappConversationId ? 'WHATSAPP' : 'PDV',
          conversation_id: whatsappConversationId,
          financial_adjustments: {
            subtotal: getTotalValue(),
            discount: parseBRL(discountAmount),
            surcharge: parseBRL(surchargeAmount),
          },
          payment_split: {
            enabled: hasSplitPayment,
            total: getFinalTotal(),
            paid_total: paymentPaidTotal,
            remaining: paymentRemaining,
            cash_received: cashPaymentPortion > 0 ? cashReceivedValue : null,
            change_amount: cashPaymentPortion > 0 ? getCashChangeValue() : null,
            lines: paymentLines.map((line) => ({
              method: line.method,
              label: line.label,
              amount: Number(line.amount.toFixed(2)),
            })),
          },
          receivable: paymentMethod === 'pagar_depois'
            ? {
                contact_id: receivableContactId,
                contact_name: receivableContact?.name || resolvedCustomerName,
                due_date: receivableDueDate || null,
                notes: receivableNotes.trim() || null,
              }
            : null,
          fiscal_model: selectedFiscalModel,
          fiscal_recipient: selectedFiscalRecipient ? {
            customer_id: selectedFiscalRecipient.id,
            name: selectedFiscalRecipient.name,
            cpf_cnpj: String(selectedFiscalRecipient.cpf_cnpj || '').replace(/\D/g, ''),
            email: selectedFiscalRecipient.email || null,
            state_registration: selectedFiscalRecipient.state_registration || null,
            state_registration_indicator: selectedFiscalRecipient.state_registration_indicator || 9,
            address: selectedFiscalRecipient.address || null,
            address_number: selectedFiscalRecipient.address_number || null,
            address_complement: selectedFiscalRecipient.address_complement || null,
            neighborhood: selectedFiscalRecipient.neighborhood || null,
            city: selectedFiscalRecipient.city || null,
            state: selectedFiscalRecipient.state || null,
            postal_code: selectedFiscalRecipient.postal_code || null,
            city_code: selectedFiscalRecipient.city_code || null,
            country_code: selectedFiscalRecipient.country_code || '1058',
            country_name: selectedFiscalRecipient.country_name || 'BRASIL',
            final_consumer: selectedFiscalRecipient.final_consumer_default !== false,
          } : null,
          environment: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
          tef: (paymentMethod === 'cartao_credito' || paymentMethod === 'cartao_debito') && cardProcessingMode === 'tef' ? (tefData || null) : null
        }
      };

      if (paymentMethod === 'pix' && !hasSplitPayment) {
        const { data: pixCfg, error: pixCfgErr } = await supabase
          .from('pix_settings')
          .select('enabled, bank, mp_pdv_enabled')
          .eq('user_id', user?.id)
          .maybeSingle()

        if (pixCfgErr) {
          toast({ title: 'PIX', description: pixCfgErr.message || 'Falha ao carregar configuração do PIX.', variant: 'destructive' });
        }

        const providerKey = String((pixCfg as any)?.bank || 'mercadopago')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        const isMercadoPagoProvider = !providerKey || providerKey === 'mp' || providerKey.includes('mercadopago');
        const useMpPixPdv =
          Boolean((pixCfg as any)?.enabled) &&
          isMercadoPagoProvider &&
          Boolean((pixCfg as any)?.mp_pdv_enabled)

        if (!useMpPixPdv && (pixCfg as any)?.enabled && isMercadoPagoProvider) {
          if (!(pixCfg as any)?.mp_pdv_enabled) {
            toast({ title: 'PIX', description: 'PopPay no PDV está desativado em Configurações → PIX.', variant: 'destructive' });
          }
        }

        if (useMpPixPdv) {
          const mpPayload = {
            ...orderData,
            payment_method: 'pix_online',
            status: 'preparing',
            acceptance_status: 'accepted',
          }

          const { data: checkout } = await invokeEdgeFunction<any>('pix-start-checkout', {
            restaurantUserId: user?.id,
            orderPayload: mpPayload,
            preferredMethod: 'pix',
          }, { timeoutMs: 60000 })

          if (!checkout?.ok || !checkout?.brCode || !checkout?.correlationID) {
            throw new Error(checkout?.error || checkout?.message || 'Falha ao gerar QR do PopPay')
          }

          setMpPixCheckout({
            correlationID: String(checkout.correlationID),
            brCode: String(checkout.brCode),
            qrCodeImage: checkout.qrCodeImage ? String(checkout.qrCodeImage) : undefined,
            paymentLinkUrl: checkout.paymentLinkUrl ? String(checkout.paymentLinkUrl) : undefined,
            paymentId: checkout.paymentId ? String(checkout.paymentId) : undefined,
          })
          setPixAmount(getFinalTotal())
          toast({ title: 'Aguardando pagamento', description: 'Escaneie o QR Code para concluir a venda.' })
          setCheckoutOpen(false);
          return
        }

        orderData.status = isCounterPdvSale ? 'completed' : 'preparing';
        orderData.acceptance_status = 'accepted';
      }

      console.log('Criando pedido:', orderData);

      // Consulta o valor fiscal atual em toda venda, mas inicia em paralelo com
      // a gravação para não adicionar uma espera sequencial ao checkout.
      if (selectedFiscalModel === '55' && !selectedFiscalRecipient) {
        throw new Error('Selecione o destinatário para emitir NF-e modelo 55.');
      }
      const fiscalActivePromise = isFiscalEmissionActive(selectedFiscalModel);
      const fiscalActiveForSale = await fiscalActivePromise;
      if (selectedFiscalModel === '55' && !fiscalActiveForSale) {
        throw new Error('A NF-e modelo 55 está desativada. Ative o modelo 55 em Configurações fiscais antes de concluir esta venda.');
      }

      if (fiscalActiveForSale) {
        await validateFiscalSaleBeforeCreate(orderData);
      }

      const { data, error } = await supabase
        .from('orders')
        .insert([orderData])
        .select();

      if (error) {
        console.error('Erro ao criar pedido:', error);
        throw error;
      }

      console.log('Pedido criado com sucesso:', data);

      const created = Array.isArray(data) ? data[0] : data;

      if (paymentMethod === 'pagar_depois') {
        const { error: receivableError } = await (supabase as any).rpc('register_pdv_receivable', {
          p_order_id: created?.id,
          p_contact_id: receivableContactId,
          p_due_date: receivableDueDate || null,
          p_notes: receivableNotes.trim() || null,
        });

        if (receivableError) {
          if (created?.id) {
            await supabase.from('orders').delete().eq('id', created.id).eq('user_id', user?.id);
          }
          throw new Error('A venda não foi registrada porque a conta a receber não pôde ser criada.');
        }
      }

      runNonBlockingSaleTasks({
        created,
        orderNumber,
        selectedTableId: orderType === 'dine_in' ? selectedTable || null : null,
        notifyCustomer: !isCounterPdvSale,
      });

      if (!fiscalActiveForSale) {
        // A venda já foi persistida e contabilizada. Libera o operador agora;
        // impressão e enriquecimento do cupom continuam sem bloquear o próximo atendimento.
        toast({
          title: 'Venda finalizada!',
          description: `Pedido #${orderNumber} finalizado com sucesso. Total: ${formatCurrency(getFinalTotal())}.`,
        });
        setMobileCartOpen(false);
        setCheckoutOpen(false);
        resetCurrentSale(getNextSaleOrderType());
        setProcessing(false);

        void printOrderAfterSale(created, false).catch((e: any) => {
          console.warn('Falha ao imprimir após a venda:', e);
          toast({
            title: 'Venda registrada, mas não imprimiu',
            description: e?.message || 'Verifique as configurações da impressora.',
            variant: 'destructive',
          });
        });
        return;
      }

      let printResult: { fiscal: boolean; nfce: any | null } = { fiscal: fiscalActiveForSale, nfce: null };
      let fiscalEmissionError: Error | null = null;
      try {
        printResult = await printOrderAfterSale(created, fiscalActiveForSale);
      } catch (e: any) {
        console.warn('Falha ao emitir/imprimir após a venda:', e);
        fiscalEmissionError = e instanceof Error ? e : new Error(String(e?.message || e || 'Falha desconhecida'));
        const fiscalModel = selectedFiscalRecipient ? 'NF-e' : 'NFC-e';
        toast({
          title: fiscalActiveForSale ? `Venda registrada, ${fiscalModel} não emitida` : 'Venda registrada, mas não imprimiu',
          description: e?.message || 'Verifique as configurações fiscais e tente reenviar o documento.',
          variant: 'destructive',
        });
      }
      // Não encobrir uma rejeição/indisponibilidade fiscal com um segundo toast
      // de sucesso. A venda permanece registrada, mas a emissão precisa ficar
      // explicitamente pendente para o operador agir.
      if (!fiscalEmissionError) {
        const fiscalModel = selectedFiscalRecipient ? 'NF-e' : 'NFC-e';
        toast({
          title: 'Venda finalizada e documento autorizado!',
          description: `Pedido #${orderNumber} finalizado com ${fiscalModel} emitida automaticamente.`,
        });
      }
      setMobileCartOpen(false);
      setCheckoutOpen(false);
      resetCurrentSale(getNextSaleOrderType());
    } catch (error: any) {
      console.error('Erro ao finalizar venda:', error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível finalizar a venda.",
        variant: "destructive"
      });
      try {
        // Fallback visual para garantir feedback
        alert(`Falha ao finalizar: ${error?.message || 'Erro desconhecido'}`);
      } catch {}
    } finally {
      setProcessing(false);
    }
  };

  const handleTableFinalization = (items: any[], total: number, tableNumber: number, tableId: string) => {
    const cartItems: CartItem[] = items.map(item => ({
      id: item.product_id,
      name: item.product_name,
      price: item.price,
      quantity: item.quantity,
      selectedVariations: item.options,
      notes: item.notes,
      available: true
    }));

    setCart(cartItems);
    setCustomerName(`Mesa ${tableNumber}`);
    setOrderType('dine_in');
    setSelectedTable(tableId);
    setActiveTab('products');

    toast({
      title: "Conta transferida!",
      description: `A conta da Mesa ${tableNumber} foi transferida para o PDV.`,
    });
  };

  const formatCurrency = (value: number) => {
    return formatBRL(value);
  };

  if (loading) {
    return <PageContentSkeleton />;
  }

  const operatorSelected = !!getOperatorSession()?.id;
  const cartItemsCount = cart.reduce((acc, item) => acc + item.quantity, 0);
  const mobileOrderTypeOptions: Array<{ value: 'counter' | 'delivery' | 'pickup' | 'dine_in'; label: string }> = [
    { value: 'counter', label: 'Balcão' },
    { value: 'delivery', label: 'Entrega' },
    { value: 'pickup', label: 'Retirada' },
    { value: 'dine_in', label: 'Mesa' },
  ];

  return (
    <div className="-mx-4 -mt-4 -mb-4 flex h-[calc(100%+1rem)] flex-col overflow-hidden bg-white sm:-mx-6 sm:-mt-6 sm:-mb-6 sm:h-[calc(100%+1.5rem)]">
      <FirstOperatorDialog open={mustCreateOperator} onCreated={async () => { setMustCreateOperator(false); await checkFirstOperator(); }} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col min-h-0">
        <TabsContent value="products" className="flex-1 overflow-hidden data-[state=active]:flex flex-col lg:flex-row mt-0 min-h-0">
          {/* Left Column: Products (Scrollable) */}
          <div className="flex-1 overflow-y-auto scrollbar-hide px-2 pb-2 pt-0 sm:px-4 sm:pb-4 sm:pt-0 lg:border-r">
            <div className="sticky top-0 z-20 mb-3 flex flex-col gap-2 border-b border-[#FF6400]/10 bg-gradient-to-r from-[#F5EBE1] via-white to-[#FFF8F2] px-2 pb-2 pt-2 shadow-[0_18px_35px_-32px_rgba(0,50,35,0.26)] sm:px-4 lg:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative w-[150px] shrink-0 sm:w-[210px] xl:w-[240px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#003223]/40" />
                  <Input
                    ref={productSearchInputRef}
                    placeholder="Buscar produtos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full rounded-xl border-[#FF6400]/15 bg-white/90 pl-9 text-sm text-[#003223] transition-colors focus:bg-white focus-visible:ring-[#FF6400]/25"
                  />
                </div>
                <div className="relative hidden w-[150px] shrink-0 md:block xl:w-[180px]">
                  <Keyboard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#003223]/40" />
                  <Input
                    ref={productCodeInputRef}
                    aria-label="Código do produto"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Código + Enter"
                    value={productCodeQuery}
                    onChange={(event) => setProductCodeQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      event.stopPropagation();
                      void addProductByTypedCode();
                    }}
                    className="h-9 w-full rounded-xl border-[#FF6400]/15 bg-white/90 pl-9 font-mono text-sm text-[#003223] transition-colors focus:bg-white focus-visible:ring-[#FF6400]/25"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl"
                  title="Ler código pela câmera"
                  onClick={() => setCameraScannerOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="hidden h-9 w-9 shrink-0 rounded-xl md:inline-flex"
                  title="Atalhos do teclado (F1)"
                  aria-label="Ver atalhos do teclado"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
                {(categories.length > 0 || categoryOptions.hasUncategorized) && (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Rolar categorias para a esquerda"
                      onClick={() => scrollCategories('left')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FF6400]/15 bg-white/95 text-[#003223] shadow-sm transition-colors hover:bg-[#F5EBE1] active:scale-95"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div
                      ref={categoryScrollerRef}
                      onWheel={(event) => event.preventDefault()}
                      className="scrollbar-hide flex min-w-0 flex-1 gap-2 overflow-x-hidden pb-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveCategoryId('all')}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          activeCategoryId === 'all'
                            ? 'border-[#003223] bg-[#003223] text-white shadow-sm'
                            : 'border-[#FF6400]/15 bg-white/90 text-[#003223] hover:bg-[#F5EBE1]'
                        }`}
                      >
                        Todas
                      </button>
                      {categoryOptions.categoriesWithProducts.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setActiveCategoryId(category.id)}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activeCategoryId === category.id
                              ? 'border-[#FF6400] bg-[#FF6400] text-white shadow-sm'
                              : 'border-[#FF6400]/15 bg-white/90 text-[#003223] hover:bg-[#F5EBE1]'
                          }`}
                        >
                          {category.name}
                        </button>
                      ))}
                      {categoryOptions.hasUncategorized && (
                        <button
                          type="button"
                          onClick={() => setActiveCategoryId('uncategorized')}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            activeCategoryId === 'uncategorized'
                              ? 'border-[#FF6400] bg-[#FF6400] text-white shadow-sm'
                              : 'border-[#FF6400]/15 bg-white/90 text-[#003223] hover:bg-[#F5EBE1]'
                          }`}
                        >
                          Sem categoria
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Rolar categorias para a direita"
                      onClick={() => scrollCategories('right')}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#FF6400]/15 bg-white/95 text-[#003223] shadow-sm transition-colors hover:bg-[#F5EBE1] active:scale-95"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5 lg:hidden">
                <div className="scrollbar-hide flex gap-1.5 overflow-x-auto">
                  {mobileOrderTypeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setOrderType(option.value)}
                      className={`shrink-0 rounded-[14px] border px-2 py-1 text-[9px] font-semibold transition-colors ${
                        orderType === option.value
                          ? 'border-[#003223] bg-[#003223] text-white'
                          : 'border-[#FF6400]/15 bg-white/90 text-[#003223]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="hidden grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => (cashSession?.id ? navigate('/caixa') : openCashDialog('open'))}
                    className={`flex items-center gap-1.5 rounded-[18px] border px-2.5 py-1.5 text-left text-[11px] font-semibold shadow-sm ${
                      cashSession?.id
                        ? 'border-[#8CC850]/45 bg-[#F4FAEC] text-[#245B2B]'
                        : 'border-[#FF6400]/18 bg-white text-[#003223]'
                    }`}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span>{cashSession?.id ? 'Caixa aberto' : 'Abrir caixa'}</span>
                  </button>
                  <div className={`rounded-[18px] border px-2.5 py-1.5 text-[11px] font-semibold shadow-sm ${operatorSelected ? 'border-[#003223]/12 bg-white text-[#003223]' : 'border-red-200 bg-red-50 text-red-600'}`}>
                    {operatorSelected ? 'Operador selecionado' : 'Selecione o operador'}
                  </div>
                </div>
              </div>
            </div>
            <Card className="h-full flex flex-col border-none shadow-none bg-transparent">
              <div className={`flex-1 ${isMobile ? 'pb-28' : 'pb-24 lg:pb-0'}`}>
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-500">
                      {searchQuery ? 'Nenhum produto encontrado.' : 'Nenhum produto disponível.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {groupedProducts.map((group) => (
                      <section key={group.id} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                          <h2 className="text-sm font-bold text-[#003223] sm:text-base">{group.name}</h2>
                          <span className="rounded-full bg-[#F5EBE1] px-2 py-0.5 text-[10px] font-semibold text-[#0B5137]">
                            {group.products.length}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] xl:gap-2">
                          {group.products.map((product) => {
                            const track = !!(product as any)?.track_stock;
                            const qty = Number((product as any)?.stock_quantity ?? 0) || 0;
                            const threshold = Number((product as any)?.low_stock_threshold ?? 0) || 0;
                            const isLowStock = track && qty <= threshold;
                            return (
                              <Card
                                key={product.id}
                                className={`cursor-pointer group flex aspect-square flex-col overflow-hidden rounded-[16px] border border-[#DCE6DF] bg-white transition-all duration-150 hover:shadow-sm active:scale-95 ${isLowStock ? 'animate-stock-pulse border-red-500 shadow-none' : ''}`}
                                onClick={() => handleProductClick(product)}
                              >
                                <div className="relative mx-1.5 mt-1.5 min-h-0 flex-1 overflow-hidden rounded-[12px] bg-gray-100">
                                  <ProductCardImage product={product} />
                                  <div className="absolute right-1 top-1 rounded-full border border-[#003223]/10 bg-white/95 px-1.5 py-0.5 text-[9px] font-bold text-[#0B5137] shadow-sm backdrop-blur-sm">
                                    {formatCurrency(product.price)}{product.weight_based ? '/kg' : ''}
                                  </div>
                                  {product.weight_based && (
                                    <div className="absolute left-1 top-1 flex items-center gap-1 rounded-full bg-[#003223] px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                                      <Scale className="h-2.5 w-2.5" />
                                      Peso
                                    </div>
                                  )}
                                  {isLowStock && (
                                    <div className="absolute left-1 top-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                                      Estoque baixo
                                    </div>
                                  )}
                                </div>
                                <CardContent className="flex shrink-0 flex-col justify-end bg-white px-1.5 pb-1.5 pt-1">
                                  <h3 className="mb-1 min-h-[1.7rem] font-semibold text-[10px] leading-tight text-[#003223] line-clamp-2 sm:text-[11px]" title={product.name}>
                                    {product.name}
                                  </h3>
                                  <Button
                                    className="h-6 w-full rounded-xl border border-[#D7E2D3] bg-[#F8FAF8] px-1 text-[9px] font-semibold text-[#0B5137] shadow-none hover:border-[#FF6400] hover:bg-[#FF6400] hover:text-white sm:text-[10px]"
                                    size="sm"
                                    variant="ghost"
                                  >
                                    Adicionar
                                  </Button>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Cart (Desktop) */}
          <div className="hidden lg:flex lg:w-[360px] xl:w-[400px] bg-white flex-col h-full z-20 border-l border-[#FF6400]/10">
            <div className="border-b border-[#FF6400]/10 bg-gradient-to-r from-[#FFF8F2] via-white to-[#F5EBE1]/70 p-2 backdrop-blur-sm shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="text-primary w-5 h-5" />
                <h2 className="font-bold text-base">Pedido</h2>
                <span className="ml-auto text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {cart.reduce((acc, item) => acc + item.quantity, 0)} itens
                </span>
              </div>
              
              <Tabs value={orderType} onValueChange={(value) => setOrderType(value as any)} className="w-full">
                <TabsList className="grid h-9 w-full grid-cols-3 items-center rounded-xl border border-[#FF6400]/12 bg-[#F5EBE1]/85 p-1">
                  <TabsTrigger value="counter" className="flex h-7 items-center justify-center rounded-lg text-xs font-semibold text-[#003223]/70 data-[state=active]:bg-[#FF6400] data-[state=active]:text-white">Balcão</TabsTrigger>
                  <TabsTrigger value="delivery" className="flex h-7 items-center justify-center rounded-lg text-xs font-semibold text-[#003223]/70 data-[state=active]:bg-[#FF6400] data-[state=active]:text-white">Entrega</TabsTrigger>
                  <TabsTrigger value="pickup" className="flex h-7 items-center justify-center rounded-lg text-xs font-semibold text-[#003223]/70 data-[state=active]:bg-[#FF6400] data-[state=active]:text-white">Retirada</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Cart Items List - Scrollable */}
            <div 
              id="cart-container" 
              ref={cartContainerRef}
              className="flex-1 overflow-y-auto scrollbar-hide p-0 min-h-0"
            >
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2 p-4">
                  <Store size={40} strokeWidth={1.5} />
                  <p className="text-sm">Sem itens</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {cart.map((item, index) => {
                    const formattedVariations = formatSelectedVariations(item.selectedVariations);
                    const seq = String(index + 1).padStart(2, '0');
                    return (
                      <div key={item.cartItemId} className="flex items-start justify-between p-2 hover:bg-gray-50 transition-colors group">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-medium text-sm text-gray-900 leading-tight line-clamp-2">
                              <span className="text-gray-500 mr-1">{seq}.</span>
                              {item.name}
                            </span>
                            <span className="font-bold text-sm text-gray-900 ml-2 whitespace-nowrap">
                              {formatCurrency(item.price * item.quantity)}
                            </span>
                          </div>
                          
                          <div className="flex items-center text-xs text-gray-500 mb-1 gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                              >
                                <Minus size={12} />
                              </Button>
                              <span className="w-7 text-center text-xs font-medium text-gray-700">{item.quantity}</span>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                              >
                                <Plus size={12} />
                              </Button>
                            </div>
                            <span>{formatCurrency(item.price)} un.</span>
                          </div>

                          {formattedVariations.length > 0 && (
                            <div className="text-[11px] text-gray-500 leading-tight mb-1">
                              {formattedVariations.join(', ')}
                            </div>
                          )}
                          
                          {item.notes && (
                            <div className="text-[11px] text-amber-600 italic bg-amber-50 px-1.5 py-0.5 rounded inline-block mt-0.5">
                              {item.notes}
                            </div>
                          )}
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-gray-400 hover:text-red-500 hover:bg-red-50 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => removeFromCart(item.cartItemId)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Checkout Form & Totals - Fixed at Bottom */}
            <div className="bg-white border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0 z-30">
              <div className="p-2 space-y-2">
                {/* Compact Form */}
                <div className="space-y-2 rounded-xl border border-[#003223]/10 bg-[#FAFCFB] p-2">
                   {orderType === 'pickup' && <div className="flex gap-2">
                      <Input
                        placeholder="Nome do cliente (opcional)"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="h-8 text-xs"
                      />
                      <Input
                        placeholder="Telefone"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="h-8 w-28 shrink-0 text-xs"
                      />
                    </div>}

                    {orderType === 'delivery' && (
                      <>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Telefone do cliente *"
                            value={customerPhone}
                            onChange={(e) => {
                              setCustomerPhone(e.target.value);
                              setDeliveryCustomerFound('');
                            }}
                            onBlur={() => void handleDeliveryCustomerLookup()}
                            className="h-8 text-xs"
                          />
                          <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={customerLookupLoading} onMouseDown={(event) => event.preventDefault()} onClick={() => void handleDeliveryCustomerLookup()}>
                            {customerLookupLoading ? 'Buscando...' : 'Localizar'}
                          </Button>
                        </div>
                        {deliveryCustomerFound && <p className="text-[11px] font-medium text-emerald-700">Cliente encontrado: {deliveryCustomerFound}</p>}
                        <Input
                          placeholder="Endereço *"
                          value={customerAddress}
                          onChange={(e) => setCustomerAddress(e.target.value)}
                          className="h-8 text-xs"
                        />
                        <Select value={selectedDeliveryZone} onValueChange={setSelectedDeliveryZone}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Bairro *" />
                          </SelectTrigger>
                          <SelectContent>
                            {deliveryZones.map((zone) => (
                              <SelectItem key={zone.id} value={zone.id}>
                                {zone.name} (+{formatCurrency(zone.delivery_fee)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}

                    {orderType === 'dine_in' ? (
                      <div className="flex gap-2 items-center">
                         <Select value={selectedTable} onValueChange={setSelectedTable}>
                            <SelectTrigger className="h-8 text-xs flex-1">
                              <SelectValue placeholder="Selecione a Mesa *" />
                            </SelectTrigger>
                            <SelectContent>
                              {tables.length > 0 ? (
                                tables.map((table) => (
                                  <SelectItem key={table.id} value={table.id}>
                                    Mesa {table.table_number} {table.status !== 'available' ? '(Ocupada)' : ''}
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="p-2 text-xs text-center text-muted-foreground">
                                  Nenhuma mesa cadastrada
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-red-500 hover:bg-red-50"
                            onClick={() => {
                              setOrderType('delivery');
                              setSelectedTable('');
                            }}
                          >
                            <Minus size={16} />
                          </Button>
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-[#003223]/10 bg-white px-3 py-2 text-[11px] font-semibold text-slate-500">
                      O pagamento será escolhido ao clicar em Fechar.
                    </div>
                </div>

                {/* Totals Summary */}
                <div className="bg-gray-50 rounded-lg p-1.5 text-[11px] space-y-0.5 border">
                  <div className="flex justify-between text-gray-500">
                    <span>Subtotal</span>
                    <span>{formatCurrency(getTotalValue())}</span>
                  </div>
                  {getDeliveryFee() > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Entrega</span>
                      <span>{formatCurrency(getDeliveryFee())}</span>
                    </div>
                  )}
                  {getDiscountValue() > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Desconto</span>
                      <span>-{formatCurrency(getDiscountValue())}</span>
                    </div>
                  )}
                  {getSurchargeValue() > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Acréscimo</span>
                      <span>{formatCurrency(getSurchargeValue())}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-[13px] text-gray-900 pt-1 border-t border-gray-200 mt-1">
                    <span>Total</span>
                    <span>{formatCurrency(getFinalTotal())}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-2">                  <Button
                    onClick={openCheckout}
                    disabled={processing || cart.length === 0}
                    className="w-full bg-green-600 hover:bg-green-700 h-9 text-sm font-bold shadow-sm"
                  >
                    {processing && orderType !== 'dine_in' ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    ) : (
                      <>
                        Fechar
                        <span className="ml-1 opacity-90 text-xs font-normal">
                          {formatCurrency(getFinalTotal())}
                        </span>
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openTableLaunch}
                    disabled={processing || cart.length === 0}
                    className="h-9 w-full border-[#003223]/20 text-sm font-bold text-[#003223] hover:bg-[#F5EBE1]"
                  >
                    Add à mesa
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          {/* Mobile Cart Summary */}
          <Sheet open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                id="mobile-cart-btn" 
                ref={mobileCartBtnRef}
                className="mobile-safe-x lg:hidden fixed bottom-[calc(env(safe-area-inset-bottom,0px)+4.65rem)] left-1/2 z-40 flex w-[calc(100%-1.75rem)] max-w-[320px] -translate-x-1/2 items-center gap-2 rounded-full border border-[#FF6400]/20 bg-[#FF6400] px-3 py-2 text-left text-white shadow-[0_20px_40px_-24px_rgba(255,100,0,0.55)]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18">
                    <Calculator className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold">
                      {cartItemsCount > 0 ? `${cartItemsCount} item(ns)` : 'Sacola'}
                    </div>
                    <div className="truncate text-[9px] text-white/80">
                      {mobileOrderTypeOptions.find((option) => option.value === orderType)?.label || 'Balcão'} • {operatorSelected ? 'operador ok' : 'selecione operador'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/80">Total</div>
                  <div className="text-[15px] font-bold">{formatCurrency(getFinalTotal())}</div>
                </div>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[74vh] flex flex-col p-0">
               <SheetHeader className="p-4 border-b">
                 <SheetTitle className="flex items-center justify-between gap-3">
                   <span>Sacola</span>
                   <span className="text-sm font-normal text-muted-foreground">{cartItemsCount} item(ns)</span>
                 </SheetTitle>
               </SheetHeader>
               <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {cart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2">
                      <Store size={48} />
                      <p>Sem itens</p>
                    </div>
                  ) : (
                    cart.map((item, index) => {
                      const formattedVariations = formatSelectedVariations(item.selectedVariations);
                      const seq = String(index + 1).padStart(2, '0');
                      return (
                        <div key={item.cartItemId} className="flex flex-col rounded-[14px] border bg-gray-50 p-2">
                          <div className="mb-1.5 flex items-start justify-between">
                            <div className="flex-1 mr-2">
                              <span className="font-medium text-[11px] line-clamp-1">
                                <span className="text-muted-foreground mr-1">{seq}.</span>
                                {item.name}
                              </span>
                              <span className="block text-[9px] text-muted-foreground">
                                {formatCurrency(item.price)} un.
                              </span>
                            </div>
                            <span className="font-bold text-[11px]">
                              {formatCurrency(item.price * item.quantity)}
                            </span>
                          </div>
                          
                          {formattedVariations.length > 0 && (
                            <div className="mb-1.5 border-l-2 border-gray-200 pl-2 text-[10px] text-gray-500">
                              {formattedVariations.map((v, i) => (
                                <div key={i}>{v}</div>
                              ))}
                            </div>
                          )}
                          
                          {item.notes && (
                            <div className="mb-1.5 rounded bg-amber-50 p-1 text-[10px] italic text-amber-600">
                              Obs: {item.notes}
                            </div>
                          )}

                          <div className="flex items-center justify-end gap-1">
                             <Button
                              variant="outline"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                            >
                              <Minus size={12} />
                            </Button>
                            <span className="w-5 text-center text-[11px] font-medium">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                            >
                              <Plus size={12} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-1 h-5 w-5 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => removeFromCart(item.cartItemId)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
               </div>

               {/* Mobile Checkout Form */}
               <div className="border-t bg-white p-3">
                  <div className="mb-3 space-y-2 rounded-xl border border-[#003223]/10 bg-[#FAFCFB] p-2">
                    {orderType === 'pickup' && <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Nome (Opcional)"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="h-9 text-sm"
                      />
                      <Input
                        placeholder="Telefone"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>}

                    {orderType === 'delivery' && (
                      <>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Telefone do cliente *"
                            value={customerPhone}
                            onChange={(e) => {
                              setCustomerPhone(e.target.value);
                              setDeliveryCustomerFound('');
                            }}
                            onBlur={() => void handleDeliveryCustomerLookup()}
                            className="h-9 text-sm"
                          />
                          <Button type="button" variant="outline" className="h-9 px-3 text-xs" disabled={customerLookupLoading} onMouseDown={(event) => event.preventDefault()} onClick={() => void handleDeliveryCustomerLookup()}>
                            {customerLookupLoading ? 'Buscando...' : 'Localizar'}
                          </Button>
                        </div>
                        {deliveryCustomerFound && <p className="text-xs font-medium text-emerald-700">Cliente encontrado: {deliveryCustomerFound}</p>}
                        <Input
                          placeholder="Endereço Completo *"
                          value={customerAddress}
                          onChange={(e) => setCustomerAddress(e.target.value)}
                          className="h-9 text-sm"
                        />
                        <Select value={selectedDeliveryZone} onValueChange={setSelectedDeliveryZone}>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Selecione o Bairro *" />
                          </SelectTrigger>
                          <SelectContent>
                            {deliveryZones.map((zone) => (
                              <SelectItem key={zone.id} value={zone.id}>
                                {zone.name} (+{formatCurrency(zone.delivery_fee)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}

                   {orderType === 'dine_in' ? (
                     <div className="flex gap-2 items-center">
                        <Select value={selectedTable} onValueChange={setSelectedTable}>
                           <SelectTrigger className="h-9 text-sm flex-1">
                             <SelectValue placeholder="Selecione a Mesa *" />
                           </SelectTrigger>
                           <SelectContent>
                             {tables.length > 0 ? (
                               tables.map((table) => (
                                 <SelectItem key={table.id} value={table.id}>
                                   Mesa {table.table_number} {table.status !== 'available' ? '(Ocupada)' : ''}
                                 </SelectItem>
                               ))
                             ) : (
                               <div className="p-2 text-xs text-center text-muted-foreground">
                                 Nenhuma mesa cadastrada
                               </div>
                             )}
                           </SelectContent>
                         </Select>
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-9 w-9 text-red-500 hover:bg-red-50"
                           onClick={() => {
                             setOrderType('delivery');
                             setSelectedTable('');
                           }}
                         >
                           <Minus size={16} />
                         </Button>
                     </div>
                   ) : null}
                    <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                      O pagamento será escolhido ao clicar em Fechar.
                    </div>
                  </div>

                  <div className="mb-3 space-y-1 text-[12px]">
                    <div className="flex justify-between text-gray-500">
                      <span>Subtotal</span>
                      <span>{formatCurrency(getTotalValue())}</span>
                    </div>
                    {getDeliveryFee() > 0 && (
                      <div className="flex justify-between text-gray-500">
                        <span>Entrega</span>
                        <span>{formatCurrency(getDeliveryFee())}</span>
                      </div>
                    )}
                    {getDiscountValue() > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Desconto</span>
                        <span>-{formatCurrency(getDiscountValue())}</span>
                      </div>
                    )}
                    {getSurchargeValue() > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Acréscimo</span>
                        <span>{formatCurrency(getSurchargeValue())}</span>
                      </div>
                    )}
                    <div className="mt-2 flex justify-between border-t pt-2 text-[14px] font-bold">
                      <span>Total</span>
                      <span>{formatCurrency(getFinalTotal())}</span>
                    </div>
                  </div>                  <Button
                    onClick={openCheckout}
                    disabled={processing || cart.length === 0}
                    className="h-9 w-full rounded-xl bg-green-600 text-[12px] font-bold text-white opacity-100 hover:bg-green-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:opacity-100"
                  >
                    {processing && orderType !== 'dine_in' ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                    ) : (
                      <>
                        Fechar
                        <span className="ml-2 text-[10px] font-normal opacity-90">
                          {formatCurrency(getFinalTotal())}
                        </span>
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openTableLaunch}
                    disabled={processing || cart.length === 0}
                    className="mt-2 h-9 w-full rounded-xl border-[#003223]/20 text-[12px] font-bold text-[#003223] hover:bg-[#F5EBE1] disabled:bg-slate-100"
                  >
                    Add à mesa
                  </Button>
               </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

      </Tabs>

      {selectedProduct && (
        <ProductVariationModal
          isOpen={showVariationModal}
          product={selectedProduct}
          variations={productVariations}
          categoryConfig={categories.find((category) => category.id === selectedProduct.category_id)}
          onAddToCart={(product, quantity, variations, notes, variationPrice) => {
            addToCart({...product, available: true}, quantity, variations, notes, variationPrice);
          }}
          onClose={() => {
            setShowVariationModal(false);
            setSelectedProduct(null);
            setProductVariations([]);
          }}
        />
      )}

      <Dialog open={weightDialogOpen} onOpenChange={setWeightDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Informar peso</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-gray-50 p-3 text-sm">
              <div className="font-semibold">{pendingWeightProduct?.name}</div>
              <div className="text-gray-500">{formatCurrency(pendingWeightProduct?.price || 0)} por kg</div>
            </div>
            <div className="space-y-2">
              <Label>Peso em kg</Label>
              <Input
                autoFocus
                inputMode="decimal"
                placeholder="0,100"
                value={manualWeight}
                onChange={(event) => setManualWeight(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  confirmManualWeight();
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={readingScale}
                onClick={() => void fillWeightFromPopConnect()}
              >
                <Scale className="mr-2 h-4 w-4" />
                {readingScale ? 'Lendo no Pop Connect…' : 'Ler peso do Pop Connect'}
              </Button>
              {pwaScaleService.isSupported() && !pwaScaleService.isConnected() && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={async () => {
                    const connected = await pwaScaleService.connectToScale();
                    if (!connected) {
                      toast({ title: 'Balança não conectada', description: 'Permita o acesso à porta USB/serial no navegador.', variant: 'destructive' });
                      return;
                    }
                    try {
                      const reading = await pwaScaleService.getReading(2500);
                      setManualWeight(normalizeScaleWeightToKg(reading.weight, reading.unit).toFixed(3).replace('.', ','));
                    } catch (error: any) {
                      toast({ title: 'Aguardando peso', description: error?.message || 'Coloque o produto na balança.' });
                    }
                  }}
                >
                  <Scale className="mr-2 h-4 w-4" /> Conectar balança ao PWA
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeightDialogOpen(false)}>Cancelar</Button>
            <Button onClick={confirmManualWeight}>
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <BarcodeCameraScanner
        open={cameraScannerOpen}
        onOpenChange={setCameraScannerOpen}
        onDetected={(code) => { void addProductByScannedCode(code); }}
      />

      <Dialog open={commandQueryOpen} onOpenChange={setCommandQueryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Consultar comanda eletrônica</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-[#003223]/10 bg-[#F4FAEC] p-3 text-sm text-[#003223]/75">
              Leia o código de barras ou digite o número impresso na comanda para abrir a conta completa.
            </div>
            <div className="space-y-2">
              <Label htmlFor="electronic-command-code">Código da comanda</Label>
              <Input
                id="electronic-command-code"
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  void lookupElectronicCommand(commandQuery);
                }}
                placeholder="Ex.: 000123"
                className="h-12 font-mono text-lg tracking-wider"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommandQueryOpen(false)}>Cancelar</Button>
            <Button onClick={() => void lookupElectronicCommand(commandQuery)} disabled={!commandQuery.trim()}>
              Consultar conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-[#FF6400]" />
              Atalhos do PDV
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {[
              ['F1', 'Mostrar esta lista de atalhos'],
              ['F2', 'Buscar produto pelo nome'],
              ['F3', 'Digitar código interno ou código de barras'],
              ['F4', 'Fechar o pedido e abrir o pagamento'],
              ['0–9', 'Iniciar a digitação direta do código'],
              ['Enter', 'Confirmar o código digitado'],
            ].map(([key, description]) => (
              <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-[#003223]/10 bg-[#F8FAF8] px-3 py-2.5">
                <span className="text-[#003223]/75">{description}</span>
                <kbd className="min-w-14 rounded-lg border border-[#003223]/15 bg-white px-2 py-1 text-center font-mono font-bold text-[#003223] shadow-sm">
                  {key}
                </kbd>
              </div>
            ))}
            <div className="pt-2 text-xs font-bold uppercase tracking-wide text-[#003223]/55">
              Na tela de pagamento
            </div>
            {[
              ['1', 'Dinheiro'],
              ['2', 'PIX'],
              ['3', 'Abrir opções de cartão'],
              ['4', 'Dividir pagamento'],
              ['6', 'Contas a receber'],
              ['8', 'Dividir pagamento (atalho alternativo)'],
              ['Enter', 'Confirmar pagamento'],
              ['Esc', 'Voltar ou fechar'],
            ].map(([key, description]) => (
              <div key={`payment-${key}`} className="flex items-center justify-between gap-4 rounded-xl border border-[#003223]/10 bg-[#F8FAF8] px-3 py-2.5">
                <span className="text-[#003223]/75">{description}</span>
                <kbd className="min-w-14 rounded-lg border border-[#003223]/15 bg-white px-2 py-1 text-center font-mono font-bold text-[#003223] shadow-sm">
                  {key}
                </kbd>
              </div>
            ))}
            <div className="pt-2 text-xs font-bold uppercase tracking-wide text-[#003223]/55">
              Dentro das opções de cartão
            </div>
            {[
              ['1', 'Crédito'],
              ['2', 'Débito'],
              ['3', 'Voucher'],
              ['4', 'Outros'],
            ].map(([key, description]) => (
              <div key={`card-payment-${key}`} className="flex items-center justify-between gap-4 rounded-xl border border-[#003223]/10 bg-[#F8FAF8] px-3 py-2.5">
                <span className="text-[#003223]/75">{description}</span>
                <kbd className="min-w-14 rounded-lg border border-[#003223]/15 bg-white px-2 py-1 text-center font-mono font-bold text-[#003223] shadow-sm">
                  {key}
                </kbd>
              </div>
            ))}
            <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
              Os atalhos ficam pausados enquanto você preenche um campo. Na janela de cartão, use as teclas de 1 a 4.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <ElectronicCommandDialog
        open={commandLookupOpen}
        onOpenChange={setCommandLookupOpen}
        data={commandLookup}
      />

      <CheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        title="Fechar pedido"
        subtitle={`${cartItemsCount} item(ns) no carrinho`}
        total={getFinalTotal()}
        subtotal={getTotalValue()}
        deliveryFee={getDeliveryFee()}
        discountValue={discountAmount}
        surchargeValue={surchargeAmount}
        onDiscountChange={setDiscountAmount}
        onSurchargeChange={setSurchargeAmount}
        paymentMethod={paymentMethod}
        paymentAmounts={paymentAmounts}
        cashReceived={changeAmount}
        onPaymentMethodChange={setSelectedPaymentMethod}
        onPaymentAmountChange={updatePaymentAmount}
        onCashReceivedChange={setChangeAmount}
        onClearSplit={clearPaymentSplit}
        onConfirm={handleFinalizeSale}
        processing={processing || cart.length === 0}
        keyboardShortcutsEnabled={!shortcutsOpen}
        modeVariant={checkoutSettings.mode}
        cpfValue={customerDocument}
        onCpfChange={setCustomerDocument}
        fiscalRecipient={selectedFiscalRecipient ? {
          name: selectedFiscalRecipient.name,
          document: formatFiscalDocument(selectedFiscalRecipient.cpf_cnpj),
        } : null}
        fiscalModel={selectedFiscalModel}
        fiscalValidation={fiscalValidation}
        onFiscalModelChange={(model) => {
          setSelectedFiscalModel(model);
          setFiscalValidation({ status: model === '55' ? 'checking' : 'idle' });
          if (model === '55' && !selectedFiscalRecipient) setFiscalRecipientOpen(true);
          if (model === '65') setSelectedFiscalRecipient(null);
        }}
        onFiscalRecipientClick={() => setFiscalRecipientOpen(true)}
        onFiscalRecipientClear={() => {
          setSelectedFiscalRecipient(null);
          setFiscalValidation({ status: 'invalid', message: 'Selecione o destinatário para validar a NF-e.' });
        }}
        inlineContent={paymentMethod === 'pagar_depois' ? (
          <div className="space-y-3">
            <ReceivableContactSelect
              value={receivableContactId}
              onChange={(contactId, contact) => {
                setReceivableContactId(contactId);
                setReceivableContact(contact || null);
              }}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Vencimento (opcional)</Label>
                <Input
                  type="date"
                  className="mt-1 h-11 bg-white"
                  value={receivableDueDate}
                  onChange={(event) => setReceivableDueDate(event.target.value)}
                />
              </div>
              <div>
                <Label>Observação da conta</Label>
                <Input
                  className="mt-1 h-11 bg-white"
                  placeholder="Ex.: descontar no fim do mês"
                  value={receivableNotes}
                  onChange={(event) => setReceivableNotes(event.target.value)}
                />
              </div>
            </div>
          </div>
        ) : null}
        extraFields={(
          <div className="space-y-3">
            {orderType === 'pickup' && <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="Nome do cliente (opcional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-10"
              />
              <Input
                placeholder="Telefone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="h-10"
              />
            </div>}

            {orderType === 'delivery' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Telefone do cliente *"
                    value={customerPhone}
                    onChange={(e) => {
                      setCustomerPhone(e.target.value);
                      setDeliveryCustomerFound('');
                    }}
                    onBlur={() => void handleDeliveryCustomerLookup()}
                    className="h-10"
                  />
                  <Button type="button" variant="outline" className="h-10" disabled={customerLookupLoading} onMouseDown={(event) => event.preventDefault()} onClick={() => void handleDeliveryCustomerLookup()}>
                    {customerLookupLoading ? 'Buscando...' : 'Localizar cliente'}
                  </Button>
                </div>
                {deliveryCustomerFound && <p className="text-xs font-medium text-emerald-700">Cliente encontrado: {deliveryCustomerFound}</p>}
                <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
                  <Input
                    placeholder="Endereço *"
                    value={customerAddress}
                    onChange={(e) => setCustomerAddress(e.target.value)}
                    className="h-10"
                  />
                  <Select value={selectedDeliveryZone} onValueChange={setSelectedDeliveryZone}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Bairro *" />
                    </SelectTrigger>
                    <SelectContent>
                      {deliveryZones.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name} (+{formatCurrency(zone.delivery_fee)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {orderType === 'dine_in' && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedTable} onValueChange={setSelectedTable}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Selecione a Mesa *" />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.length > 0 ? (
                      tables.map((table) => (
                        <SelectItem key={table.id} value={table.id}>
                          Mesa {table.table_number} {table.status !== 'available' ? '(Ocupada)' : ''}
                        </SelectItem>
                      ))
                    ) : (
                      <div className="p-2 text-sm text-center text-muted-foreground">Nenhuma mesa cadastrada</div>
                    )}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOrderType('counter');
                    setSelectedTable('');
                  }}
                  className="h-10"
                >
                  Tirar mesa
                </Button>
              </div>
            )}
          </div>
        )}
      />

      <Dialog open={fiscalRecipientOpen} onOpenChange={setFiscalRecipientOpen}>
        <DialogContent className="max-h-[94vh] w-[min(96vw,1100px)] max-w-none overflow-y-auto p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Informar cliente para NF-e modelo 55</DialogTitle>
          </DialogHeader>
          <FiscalRecipientsManager
            onRecipientSelected={(customer) => {
              setSelectedFiscalRecipient(customer);
              setSelectedFiscalModel('55');
              setFiscalRecipientOpen(false);
              toast({
                title: 'Cliente informado para a NF-e',
                description: `${customer.name} será vinculado à venda com os dados fiscais atuais.`,
              });
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={tableLaunchOpen} onOpenChange={setTableLaunchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar pedido em mesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Itens</span>
                <span className="font-semibold">{cartItemsCount}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span>Total</span>
                <span className="font-bold">{formatCurrency(getTotalValue())}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Mesa</Label>
              <Select value={tableLaunchId} onValueChange={setTableLaunchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a mesa" />
                </SelectTrigger>
                <SelectContent>
                  {tables.length > 0 ? (
                    tables.map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        Mesa {table.table_number} {table.status !== 'available' ? '(Ocupada)' : ''}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-center text-muted-foreground">Nenhuma mesa cadastrada</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTableLaunchOpen(false)}>Cancelar</Button>
            <Button onClick={() => addToTable(tableLaunchId)} disabled={processing || !tableLaunchId || cart.length === 0}>
              Lançar na mesa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mpPixCheckout ? (
        <PixCheckoutModal
          isOpen={!!mpPixCheckout}
          onClose={() => setMpPixCheckout(null)}
          correlationID={mpPixCheckout.correlationID}
          brCode={mpPixCheckout.brCode}
          qrCodeImage={mpPixCheckout.qrCodeImage}
          paymentLinkUrl={mpPixCheckout.paymentLinkUrl}
          paymentId={mpPixCheckout.paymentId}
          onPaid={(orderId) => {
            void (async () => {
              setMpPixCheckout(null);
              try {
                const { data: order } = await supabase
                  .from('orders')
                  .select('*')
                  .eq('id', orderId)
                  .maybeSingle();

                const resolvedOrder =
                  order ||
                  ({
                    id: orderId,
                    user_id: user?.id,
                    order_number: 'PIX',
                    created_at: new Date().toISOString(),
                    items: cart,
                    total: pixAmount,
                    delivery_fee: getDeliveryFee(),
                    payment_method: 'pix_online',
                    customer_name: customerName,
                  } as any);

                if (selectedFiscalModel === '55' && !selectedFiscalRecipient) {
                  throw new Error('Selecione o destinatário para emitir NF-e modelo 55.');
                }
                const fiscalActiveForSale = await isFiscalEmissionActive(selectedFiscalModel);
                if (selectedFiscalModel === '55' && !fiscalActiveForSale) {
                  throw new Error('A NF-e modelo 55 está desativada. Ative o modelo 55 em Configurações fiscais.');
                }
                let printResult: { fiscal: boolean; nfce: any | null } = { fiscal: fiscalActiveForSale, nfce: null };
                try {
                  printResult = await printOrderAfterSale(resolvedOrder, fiscalActiveForSale);
                } catch (e: any) {
                  console.warn('Falha ao emitir/imprimir automaticamente (PIX):', e);
                  toast({
                    title: fiscalActiveForSale ? 'Venda registrada, NFC-e não concluída' : 'Venda registrada, mas não imprimiu',
                    description: e?.message || 'Verifique as configurações fiscais e a impressora.',
                    variant: 'destructive',
                  });
                }
                toast({
                  title: "Pagamento confirmado!",
                  description: printResult.fiscal && printResult.nfce
                    ? "Pedido entrou em preparo com NFC-e emitida automaticamente."
                    : "Pedido entrou em preparo e foi enviado para impressão.",
                });
                resetCurrentSale(getNextSaleOrderType());
              } catch (e: any) {
                console.error(e);
                toast({ title: 'Erro', description: e?.message || 'Não foi possível concluir a venda.', variant: 'destructive' });
              }
            })();
          }}
        />
      ) : null}

      <Dialog open={tefOpen} onOpenChange={setTefOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cartão (TEF)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>NSU</Label>
              <Input value={tefData?.nsu || ''} onChange={(e) => setTefData(prev => ({ nsu: e.target.value, auth: prev?.auth || '', brand: prev?.brand || '', acquirer: prev?.acquirer || '', installments: prev?.installments || '' }))} placeholder="NSU" />
            </div>
            <div className="space-y-2">
              <Label>Autorização</Label>
              <Input value={tefData?.auth || ''} onChange={(e) => setTefData(prev => ({ nsu: prev?.nsu || '', auth: e.target.value, brand: prev?.brand || '', acquirer: prev?.acquirer || '', installments: prev?.installments || '' }))} placeholder="Código de autorização" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Bandeira</Label>
                <Input value={tefData?.brand || ''} onChange={(e) => setTefData(prev => ({ nsu: prev?.nsu || '', auth: prev?.auth || '', brand: e.target.value, acquirer: prev?.acquirer || '', installments: prev?.installments || '' }))} placeholder="Visa/Master/..." />
              </div>
              <div className="space-y-2">
                <Label>Parcelas</Label>
                <Input value={tefData?.installments || ''} onChange={(e) => setTefData(prev => ({ nsu: prev?.nsu || '', auth: prev?.auth || '', brand: prev?.brand || '', acquirer: prev?.acquirer || '', installments: e.target.value.replace(/\\D/g, '') }))} placeholder="1" inputMode="numeric" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Adquirente</Label>
              <Input value={tefData?.acquirer || ''} onChange={(e) => setTefData(prev => ({ nsu: prev?.nsu || '', auth: prev?.auth || '', brand: prev?.brand || '', acquirer: e.target.value, installments: prev?.installments || '' }))} placeholder="Ex: Stone / Cielo / Rede" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCardProcessingMode('maquininha'); setTefData(null); setTefOpen(false); }}>Pular</Button>
            <Button onClick={() => setTefOpen(false)}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cashMoveOpen} onOpenChange={setCashMoveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{cashMoveType === 'in' ? 'Suprimento' : 'Sangria'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input value={cashMoveAmount} onChange={(e) => setCashMoveAmount(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input value={cashMoveDesc} onChange={(e) => setCashMoveDesc(e.target.value)} placeholder="Ex: troco / retirada" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashMoveOpen(false)}>Cancelar</Button>
            <Button onClick={submitCashMovement}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminPinDialog
        open={adminPinOpen}
        title="Sangria"
        description="Digite o PIN de administrador para autorizar a sangria."
        confirmLabel="Autorizar"
        onCancel={() => setAdminPinOpen(false)}
        onConfirm={async (pin) => {
          const restaurantUserId = user?.id || '';
          if (!restaurantUserId) {
            toast({ title: 'Erro', description: 'Usuário não autenticado', variant: 'destructive' });
            return;
          }
          const res = await verifyAdminPin({ restaurantUserId, pin });
          if (!res.ok) {
            toast({ title: 'Sem permissão', description: 'PIN inválido ou não é administrador', variant: 'destructive' });
            return;
          }
          setAdminPinOpen(false);
          const amount = Number(cashMoveAmount.replace(',', '.'));
          if (!cashSession?.id) return;
          const { error } = await (supabase as any).from('cash_movements').insert({
            session_id: cashSession.id,
            user_id: restaurantUserId,
            type: cashMoveType,
            amount,
            description: cashMoveDesc || null,
          });
          if (error) {
            toast({ title: 'Erro', description: error.message, variant: 'destructive' });
            return;
          }
          toast({ title: cashMoveType === 'in' ? 'Suprimento registrado' : 'Sangria registrada' });
          setCashMoveOpen(false);
          setCashMoveAmount('');
          setCashMoveDesc('');
        }}
      />

      <Dialog open={cashDialogOpen} onOpenChange={setCashDialogOpen}>
        <DialogContent className={cashDialogMode === 'close' ? 'sm:max-w-2xl' : undefined}>
          <DialogHeader>
            <DialogTitle>{cashDialogMode === 'open' ? 'Abrir Caixa' : 'Fechar Caixa'}</DialogTitle>
          </DialogHeader>
          {cashDialogMode === 'open' ? (
            <div className="space-y-2">
              <Label>Valor inicial</Label>
              <CurrencyTextInput value={cashAmountInput} onValueChange={setCashAmountInput} placeholder="R$ 0,00" />
            </div>
          ) : (
            <div className="space-y-4">
              {cashCloseLoading ? (
                <div className="text-sm text-muted-foreground">Carregando resumo do caixa...</div>
              ) : cashCloseSummary ? (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Abertura</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.initial)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Vendas (total)</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.total)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">PIX</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.pix)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Cartão de débito</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.debit)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Cartão de crédito</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.credit)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Dinheiro (vendas)</div>
                      <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.cash)}</div>
                    </div>
                    <div className="border rounded-md p-3">
                      <div className="text-xs text-muted-foreground">Suprimento / Sangria</div>
                      <div className="text-lg font-bold">
                        {formatCurrency(cashCloseSummary.inAmount)} / {formatCurrency(cashCloseSummary.outAmount)}
                      </div>
                    </div>
                    {cashCloseSummary.genericCard > 0 && (
                      <div className="border rounded-md p-3">
                        <div className="text-xs text-muted-foreground">Voucher / outros cartões</div>
                        <div className="text-lg font-bold">{formatCurrency(cashCloseSummary.genericCard)}</div>
                      </div>
                    )}
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="text-xs text-blue-700">Contas a receber</div>
                      <div className="text-lg font-bold text-blue-950">{formatCurrency(cashCloseSummary.receivable)}</div>
                      <div className="text-[11px] text-blue-700">Somente para controle</div>
                    </div>
                  </div>

                  <div className="border rounded-md p-3 bg-gray-50">
                    <div className="text-xs text-muted-foreground">Saldo esperado em dinheiro</div>
                    <div className="text-xl font-bold">{formatCurrency(cashCloseSummary.expectedCash)}</div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Não foi possível calcular o resumo do caixa.</div>
              )}

              <div className="space-y-2">
                <Label>Valor contado em dinheiro</Label>
                <CurrencyTextInput value={cashAmountInput} onValueChange={setCashAmountInput} placeholder="R$ 0,00" />
                {cashCloseSummary && (
                  <div className="text-xs text-muted-foreground">
                    Diferença: {formatCurrency(parseBRL(cashAmountInput) - cashCloseSummary.expectedCash)}
                  </div>
                )}
              </div>
              <div className={`rounded-2xl border p-4 ${openTablesCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                {cashCloseLoading ? (
                  <p className="text-sm text-slate-600">Conferindo mesas em atendimento...</p>
                ) : openTablesCount > 0 ? (
                  <div className="space-y-3">
                    <div className="flex gap-3 text-amber-950">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-semibold">{openTablesCount} mesa(s) ainda aberta(s)</p>
                        <p className="text-sm">Finalize as mesas ou autorize expressamente o fechamento.</p>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/75 p-3 text-sm text-amber-950">
                      <Checkbox
                        checked={openTablesConsent}
                        onCheckedChange={(checked) => setOpenTablesConsent(checked === true)}
                        aria-label="Confirmar fechamento com mesas abertas"
                      />
                      <span>Estou ciente e autorizo fechar o caixa com mesas abertas.</span>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-emerald-800">Nenhuma mesa aberta. O fechamento está liberado.</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCashSubmit}
              disabled={cashDialogMode === 'close' && (cashCloseLoading || (openTablesCount > 0 && !openTablesConsent))}
            >
              {cashDialogMode === 'open' ? 'Abrir' : 'Fechar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PDV;


