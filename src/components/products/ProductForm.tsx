import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBRL } from '@/lib/currency';
import { normalizeComplementOptionName } from '@/lib/text';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { Barcode, GripVertical, MoreVertical, Pencil, Plus, Sparkles, Star, Trash2, BookOpen, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { compressImageFileToMaxBytes } from '@/utils/imageCompression';
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd';

import ProductImageUpload from './ProductImageUpload';
import ProductRecipeManager, { type ProductRecipeManagerHandle } from './ProductRecipeManager';
import { CurrencyInput } from '@/components/ui/currency-input';
import { IntegerInput } from '@/components/ui/integer-input';
import { buildCategoryDescriptionWithMetadata, enrichCategoryWithMetadata } from '@/lib/category-metadata';
import { invalidateSimpleVariationCaches } from '@/hooks/useSimpleVariations';

// Defining the interface here to ensure consistency
interface ProductItem {
  id?: string;
  user_id?: string;
  name: string;
  barcode?: string;
  description?: string; 
  price: number;
  costing_mode?: 'automatic_recipe' | 'manual';
  manual_unit_cost?: number | null;
  category: string;
  category_id?: string;
  image_url?: string;
  available: boolean;
  weight_based: boolean; // Ensuring this is not optional
  send_to_kds: boolean;
  show_in_pdv: boolean;
  show_in_delivery: boolean;
  receipt_ingredients_enabled?: boolean;
  receipt_ingredients?: string;
  track_stock: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  is_highlight?: boolean;
  original_price?: number;
  discount_percentage?: number;
  fiscal_ncm?: string;
  fiscal_cfop?: string;
  fiscal_csosn?: string;
  fiscal_cst_pis?: string;
  fiscal_cst_cofins?: string;
  fiscal_origem?: string;
  fiscal_cest?: string;
  fiscal_beneficio?: string;
  fiscal_observacao?: string;
  fiscal_ibs_cbs_cst?: string;
  fiscal_cclass_trib?: string;
  fiscal_reducao_ibs?: number;
  fiscal_reducao_cbs?: number;
  fiscal_default_operation_id?: string;
}

type FiscalOperationOption = {
  id: string;
  name: string;
  cfop: string;
  model_codes: string[];
};

interface ProductVariant {
  id?: string;
  name: string;
  price: number;
  promotional_price?: number;
  display_order: number;
  _deleted?: boolean; // internal flag
}

type VariationPricingMode = 'default' | 'free' | 'half' | 'multiplier' | 'fixed';

type VariationOptionOverride = {
  price?: number | null;
  label?: string;
  hidden?: boolean;
  display_order?: number | null;
  recommended?: boolean;
};

type VariationOptionOverrideRaw = {
  price: string;
  label: string;
  hidden: boolean;
  order: string;
  recommended: boolean;
};

type VariationConfig = {
  required: boolean;
  min_selections: number;
  max_selections: number;
  free_selections_limit: number;
  allow_paid_excess: boolean;
  paid_max_selections: number | null;
  pricing_mode: VariationPricingMode;
  price_multiplier: number | null;
  fixed_option_price: number | null;
  option_price_overrides: Record<string, VariationOptionOverride>;
};

type VariationConfigRaw = {
  pricingMode: VariationPricingMode;
  min: string;
  max: string;
  free: string;
  paidMax: string;
  multiplier: string;
  fixedPrice: string;
  optionOverrides: Record<string, VariationOptionOverrideRaw>;
};

interface ProductFormProps {
  product?: ProductItem;

  onSave: (productId?: string) => void;

  onCancel: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({ product, onSave, onCancel }) => {
  const { user, activeStoreId } = useAuth();
  const fiscalStoreId = product?.user_id || activeStoreId || user?.id;
  const [formData, setFormData] = useState<ProductItem>({
    name: '',
    barcode: '',
    description: '',
    price: 0,
    costing_mode: 'automatic_recipe',
    manual_unit_cost: null,
    category: '',
    image_url: '',
    available: true,
    weight_based: false,
    send_to_kds: false,
    show_in_pdv: true,
    show_in_delivery: true,
    receipt_ingredients_enabled: false,
    receipt_ingredients: '',
    track_stock: false,
    stock_quantity: 0,
    low_stock_threshold: 5,
    is_highlight: false,
    original_price: 0,
    discount_percentage: 0,
    fiscal_ncm: '',
    fiscal_cfop: '',
    fiscal_csosn: '',
    fiscal_cst_pis: '',
    fiscal_cst_cofins: '',
    fiscal_origem: '0',
    fiscal_cest: '',
    fiscal_beneficio: '',
    fiscal_observacao: '',
    fiscal_ibs_cbs_cst: '',
    fiscal_cclass_trib: '',
    fiscal_reducao_ibs: 0,
    fiscal_reducao_cbs: 0,
    fiscal_default_operation_id: '',
    ...product
  });
  const [categories, setCategories] = useState([]);
  const [globalVariations, setGlobalVariations] = useState([]);
  const [selectedVariations, setSelectedVariations] = useState<string[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Array<{ id: string; name: string; category?: string | null }>>([]);
  const [fiscalOperations, setFiscalOperations] = useState<FiscalOperationOption[]>([]);
  
  // Price Variants State
  const [priceVariants, setPriceVariants] = useState<ProductVariant[]>([]);

  const [variationSettings, setVariationSettings] = useState<Record<string, VariationConfig>>({});
  const [variationSettingsRaw, setVariationSettingsRaw] = useState<Record<string, VariationConfigRaw>>({});
  const [loading, setLoading] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIsPizza, setNewCategoryIsPizza] = useState(false);
  const [newCategoryPizzaHalfPriceMode, setNewCategoryPizzaHalfPriceMode] = useState<'highest' | 'split_halves'>('highest');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [priceRaw, setPriceRaw] = useState<string>(String(Math.round(((product?.price ?? 0) * 100))));
  const [originalPriceRaw, setOriginalPriceRaw] = useState<string>(String(Math.round(((product?.original_price ?? 0) * 100))));
  const [stockQuantityRaw, setStockQuantityRaw] = useState<string>(String(product?.stock_quantity ?? 0));
  const [lowStockThresholdRaw, setLowStockThresholdRaw] = useState<string>(String(product?.low_stock_threshold ?? 5));
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null);
  const [createdProductId, setCreatedProductId] = useState<string | null>(product?.id || null);
  const createdProductIdRef = useRef<string | null>(product?.id || null);
  const autoSaveInFlightRef = useRef(false);
  const recipeManagerRef = useRef<ProductRecipeManagerHandle | null>(null);
  const [stockSchemaSupported, setStockSchemaSupported] = useState(true);
  const [stockSchemaError, setStockSchemaError] = useState<string | null>(null);
  const [unsupportedColumns, setUnsupportedColumns] = useState<string[]>([]);
  const [isEnhanceOpen, setIsEnhanceOpen] = useState(false);
  const [enhanceLoading, setEnhanceLoading] = useState(false);
  const [enhancedPreview, setEnhancedPreview] = useState<string>('');
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
  const [barcodeLookupStatus, setBarcodeLookupStatus] = useState<string>('');
  const [priceMode, setPriceMode] = useState<'simple' | 'variants'>('simple');
  const [variationsDialogOpen, setVariationsDialogOpen] = useState(false);
  const [applyVariationDialogOpen, setApplyVariationDialogOpen] = useState(false);
  const [applyVariationId, setApplyVariationId] = useState<string | null>(null);
  const [applyTargetProductIds, setApplyTargetProductIds] = useState<string[]>([]);
  const [applyingVariation, setApplyingVariation] = useState(false);
  const variationSaveTimerRef = useRef<number | null>(null);
  const lastBarcodeLookupRef = useRef<string>('');

  const isUnsupported = (column: string) => unsupportedColumns.includes(column);
  const markUnsupported = (column: string) => {
    setUnsupportedColumns(prev => (prev.includes(column) ? prev : [...prev, column]));
  };

  const getMissingColumnFromError = (err: any) => {
    const msg = String(err?.message || err?.details || err?.hint || '');
    const m = msg.match(/Could not find the '([^']+)' column/);
    return m?.[1] || null;
  };

  const stockColumns = new Set(['track_stock', 'stock_quantity', 'low_stock_threshold']);

  const parseDecimalField = (value: string, fallback: number) => {
    const normalized = String(value ?? '').replace(',', '.').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const getDefaultPricingMode = (pricingMode?: string | null): VariationPricingMode => {
    const value = String(pricingMode || '').trim();
    if (value === 'free' || value === 'half' || value === 'multiplier' || value === 'fixed') return value;
    return 'default';
  };

  const getVariationDefaults = (): VariationConfig => ({
    required: false,
    min_selections: 0,
    max_selections: 1,
    free_selections_limit: 0,
    allow_paid_excess: false,
    paid_max_selections: null,
    pricing_mode: 'default',
    price_multiplier: 1,
    fixed_option_price: null,
    option_price_overrides: {}
  });

  const normalizeOptionOverride = (value: any): VariationOptionOverride => {
    if (typeof value === 'number') {
      return { price: Math.max(0, Number(value) || 0) };
    }
    if (!value || typeof value !== 'object') return {};
    const price = value.price !== undefined && value.price !== null ? Math.max(0, Number(value.price) || 0) : undefined;
    const label = value.label !== undefined && value.label !== null ? String(value.label).trim() : '';
    const hidden = Boolean(value.hidden);
    const recommended = Boolean(value.recommended);
    const displayOrder = value.display_order !== undefined && value.display_order !== null
      ? Math.max(0, Math.floor(Number(value.display_order) || 0))
      : undefined;
    return {
      ...(price !== undefined ? { price } : {}),
      ...(label ? { label } : {}),
      ...(hidden ? { hidden } : {}),
      ...(recommended ? { recommended } : {}),
      ...(displayOrder !== undefined ? { display_order: displayOrder } : {})
    };
  };

  const toOptionOverrideRaw = (value?: VariationOptionOverride): VariationOptionOverrideRaw => ({
    price: String(Number(value?.price ?? 0)),
    label: String(value?.label || ''),
    hidden: Boolean(value?.hidden),
    order: value?.display_order !== undefined && value?.display_order !== null ? String(Number(value.display_order)) : '',
    recommended: Boolean(value?.recommended)
  });

  const syncVariationSettingsRaw = (settings: Record<string, VariationConfig>) => {
    const raw: Record<string, VariationConfigRaw> = {};
    Object.entries(settings || {}).forEach(([id, s]) => {
      raw[id] = {
        pricingMode: getDefaultPricingMode(s?.pricing_mode),
        min: String(Math.max(0, Math.floor(Number(s?.min_selections) || 0))),
        max: String(Math.max(1, Math.floor(Number(s?.max_selections) || 1))),
        free: String(Math.max(0, Math.floor(Number(s?.free_selections_limit) || 0))),
        paidMax: String(Math.max(1, Math.floor(Number(s?.paid_max_selections) || Number(s?.max_selections) || 1))),
        multiplier: String(Number(s?.price_multiplier ?? 1)),
        fixedPrice: String(Number(s?.fixed_option_price ?? 0)),
        optionOverrides: Object.fromEntries(
          Object.entries(s?.option_price_overrides || {}).map(([name, value]) => [name, toOptionOverrideRaw(value)])
        )
      };
    });
    setVariationSettingsRaw(raw);
  };

  const commitVariationMinMax = (variationId: string) => {
    const current = variationSettings?.[variationId] || getVariationDefaults();
    const raw = variationSettingsRaw?.[variationId] || {
      pricingMode: getDefaultPricingMode(current.pricing_mode),
      min: String(current.min_selections ?? 0),
      max: String(current.max_selections ?? 1),
      free: String(current.free_selections_limit ?? 0),
      paidMax: String(current.paid_max_selections ?? current.max_selections ?? 1),
      multiplier: String(Number(current.price_multiplier ?? 1)),
      fixedPrice: String(Number(current.fixed_option_price ?? 0)),
      optionOverrides: Object.fromEntries(
        Object.entries(current.option_price_overrides || {}).map(([name, value]) => [name, toOptionOverrideRaw(value)])
      )
    };
    const minNum = Math.max(0, Math.floor(raw.min === '' ? Number(current.min_selections ?? 0) : Number(raw.min) || 0));
    const maxNum = Math.max(1, Math.floor(raw.max === '' ? Number(current.max_selections ?? 1) : Number(raw.max) || 1));
    const safeMax = Math.max(maxNum, minNum);
    const freeNum = Math.max(0, Math.floor(raw.free === '' ? Number(current.free_selections_limit ?? 0) : Number(raw.free) || 0));
    const paidMaxNum = current.allow_paid_excess
      ? Math.max(safeMax, Math.floor(raw.paidMax === '' ? Number(current.paid_max_selections ?? safeMax) : Number(raw.paidMax) || safeMax))
      : null;
    const pricingMode = getDefaultPricingMode(raw.pricingMode || current.pricing_mode);
    const priceMultiplier = pricingMode === 'half'
      ? 0.5
      : Math.max(0, parseDecimalField(raw.multiplier, Number(current.price_multiplier ?? 1)));
    const fixedOptionPrice = pricingMode === 'fixed'
      ? Math.max(0, parseDecimalField(raw.fixedPrice, Number(current.fixed_option_price ?? 0)))
      : null;
    const nextRawState = {
      ...variationSettingsRaw,
      [variationId]: {
        pricingMode,
        min: raw.min === '' ? '' : String(minNum),
        max: raw.max === '' ? '' : String(safeMax),
        free: raw.free === '' ? '' : String(Math.min(freeNum, paidMaxNum ?? safeMax)),
        paidMax: raw.paidMax === '' ? '' : String(paidMaxNum ?? safeMax),
        multiplier: raw.multiplier === '' ? '' : String(priceMultiplier),
        fixedPrice: raw.fixedPrice === '' ? '' : String(fixedOptionPrice ?? 0),
        optionOverrides: raw.optionOverrides || {}
      }
    };
    const resolvedSettings = buildPersistedVariationSettings(variationSettings, nextRawState);
    setVariationSettings(resolvedSettings);
    setVariationSettingsRaw(nextRawState);
  };

  const getVariationConfig = (variationId: string) => variationSettings?.[variationId] || getVariationDefaults();

  const updateVariationRaw = (variationId: string, updates: Partial<VariationConfigRaw>) => {
    setVariationSettingsRaw(prev => {
      const currentSetting = getVariationConfig(variationId);
      return {
        ...prev,
        [variationId]: {
          pricingMode: prev[variationId]?.pricingMode ?? getDefaultPricingMode(currentSetting.pricing_mode),
          min: prev[variationId]?.min ?? String(currentSetting.min_selections ?? 0),
          max: prev[variationId]?.max ?? String(currentSetting.max_selections ?? 1),
          free: prev[variationId]?.free ?? String(currentSetting.free_selections_limit ?? 0),
          paidMax: prev[variationId]?.paidMax ?? String(currentSetting.paid_max_selections ?? currentSetting.max_selections ?? 1),
          multiplier: prev[variationId]?.multiplier ?? String(Number(currentSetting.price_multiplier ?? 1)),
          fixedPrice: prev[variationId]?.fixedPrice ?? String(Number(currentSetting.fixed_option_price ?? 0)),
          optionOverrides: prev[variationId]?.optionOverrides ?? Object.fromEntries(
            Object.entries(currentSetting.option_price_overrides || {}).map(([name, value]) => [name, toOptionOverrideRaw(value)])
          ),
          ...updates
        }
      };
    });
  };

  const updateVariationRawAndPersist = (variationId: string, updates: Partial<VariationConfigRaw>) => {
    const currentSetting = getVariationConfig(variationId);
    const currentRaw = variationSettingsRaw[variationId];
    const nextRawForVariation: VariationConfigRaw = {
      pricingMode: currentRaw?.pricingMode ?? getDefaultPricingMode(currentSetting.pricing_mode),
      min: currentRaw?.min ?? String(currentSetting.min_selections ?? 0),
      max: currentRaw?.max ?? String(currentSetting.max_selections ?? 1),
      free: currentRaw?.free ?? String(currentSetting.free_selections_limit ?? 0),
      paidMax: currentRaw?.paidMax ?? String(currentSetting.paid_max_selections ?? currentSetting.max_selections ?? 1),
      multiplier: currentRaw?.multiplier ?? String(Number(currentSetting.price_multiplier ?? 1)),
      fixedPrice: currentRaw?.fixedPrice ?? String(Number(currentSetting.fixed_option_price ?? 0)),
      optionOverrides: currentRaw?.optionOverrides ?? Object.fromEntries(
        Object.entries(currentSetting.option_price_overrides || {}).map(([name, value]) => [name, toOptionOverrideRaw(value)])
      ),
      ...updates
    };

    const nextRawState = {
      ...variationSettingsRaw,
      [variationId]: nextRawForVariation
    };

    setVariationSettingsRaw(nextRawState);
    setVariationSettings(buildPersistedVariationSettings(variationSettings, nextRawState));
  };

  const getVariationEffectiveOptionPrice = (variationId: string, option: any) => {
    const config = getVariationConfig(variationId);
    const optionName = String(option?.name || '').trim();
    const override = normalizeOptionOverride(config.option_price_overrides?.[optionName]);
    if (override.price !== undefined && override.price !== null) return Math.max(0, Number(override.price) || 0);
    const basePrice = Math.max(0, Number(option?.price) || 0);
    if (config.pricing_mode === 'free') return 0;
    if (config.pricing_mode === 'half') return basePrice * 0.5;
    if (config.pricing_mode === 'multiplier') return basePrice * Math.max(0, Number(config.price_multiplier) || 1);
    if (config.pricing_mode === 'fixed') return Math.max(0, Number(config.fixed_option_price) || 0);
    return basePrice;
  };

  const getOptionOverrideRawState = (variationId: string, option: any): VariationOptionOverrideRaw => {
    const optionName = String(option?.name || '').trim();
    const configOverride = normalizeOptionOverride(getVariationConfig(variationId).option_price_overrides?.[optionName]);
    const rawOverride = variationSettingsRaw[variationId]?.optionOverrides?.[optionName];
    const effectivePrice = getVariationEffectiveOptionPrice(variationId, option);
    return {
      price: rawOverride?.price ?? (configOverride.price !== undefined && configOverride.price !== null ? String(configOverride.price) : String(effectivePrice)),
      label: rawOverride?.label ?? String(configOverride.label || ''),
      hidden: rawOverride?.hidden ?? Boolean(configOverride.hidden),
      order: rawOverride?.order ?? (configOverride.display_order !== undefined && configOverride.display_order !== null ? String(configOverride.display_order) : ''),
      recommended: rawOverride?.recommended ?? Boolean(configOverride.recommended)
    };
  };

  const handleOptionPriceOverrideChange = (variationId: string, optionName: string, rawValue: string) => {
    updateVariationRaw(variationId, {
      optionOverrides: {
        ...(variationSettingsRaw[variationId]?.optionOverrides || {}),
        [optionName]: {
          ...(variationSettingsRaw[variationId]?.optionOverrides?.[optionName] || toOptionOverrideRaw(getVariationConfig(variationId).option_price_overrides?.[optionName])),
          price: rawValue
        }
      }
    });
  };

  const persistVariationOverrideChanges = async (
    variationId: string,
    nextRawState: Record<string, VariationConfigRaw>,
    nextSettings?: Record<string, VariationConfig>
  ) => {
    const pid = product?.id || createdProductId;
    const resolvedSettings = nextSettings || buildPersistedVariationSettings(variationSettings, nextRawState);
    setVariationSettings(resolvedSettings);
    setVariationSettingsRaw(nextRawState);
    if (!pid) return;
    if (variationSaveTimerRef.current) {
      window.clearTimeout(variationSaveTimerRef.current);
      variationSaveTimerRef.current = null;
    }
    await saveProductVariations(pid, selectedVariations, { silent: true, settingsOverride: resolvedSettings });
  };

  const commitOptionPriceOverride = (variationId: string, optionName: string, option?: any) => {
    const fallback = getVariationEffectiveOptionPrice(variationId, option || { name: optionName, price: 0 });
    const currentRaw = option ? getOptionOverrideRawState(variationId, option) : (variationSettingsRaw[variationId]?.optionOverrides?.[optionName] || toOptionOverrideRaw(getVariationConfig(variationId).option_price_overrides?.[optionName]));
    const parsedValue = Math.max(0, parseDecimalField(currentRaw.price, fallback));
    const existingOverride = normalizeOptionOverride((variationSettings[variationId] || getVariationDefaults()).option_price_overrides?.[optionName]);

    setVariationSettings(prev => ({
      ...prev,
      [variationId]: {
        ...(prev[variationId] || getVariationDefaults()),
        option_price_overrides: {
          ...((prev[variationId] || getVariationDefaults()).option_price_overrides || {}),
          [optionName]: {
            ...normalizeOptionOverride((prev[variationId] || getVariationDefaults()).option_price_overrides?.[optionName]),
            price: parsedValue,
            label: String(currentRaw.label || '').trim(),
            hidden: Boolean(currentRaw.hidden),
            recommended: Boolean(currentRaw.recommended),
            ...(String(currentRaw.order || '').trim() ? { display_order: Math.max(0, Math.floor(Number(currentRaw.order) || 0)) } : {})
          }
        }
      }
    }));

    updateVariationRaw(variationId, {
      optionOverrides: {
        ...(variationSettingsRaw[variationId]?.optionOverrides || {}),
        [optionName]: {
          ...currentRaw,
          price: String(parsedValue)
        }
      }
    });
  };

  const handleOptionOverrideFieldChange = (
    variationId: string,
    optionName: string,
    field: keyof VariationOptionOverrideRaw,
    value: string | boolean
  ) => {
    updateVariationRaw(variationId, {
      optionOverrides: {
        ...(variationSettingsRaw[variationId]?.optionOverrides || {}),
        [optionName]: {
          ...(variationSettingsRaw[variationId]?.optionOverrides?.[optionName] || toOptionOverrideRaw(getVariationConfig(variationId).option_price_overrides?.[optionName])),
          [field]: value as never
        }
      }
    });
  };

  const commitOptionOverride = (variationId: string, optionName: string, option?: any) => {
    const currentRaw = option ? getOptionOverrideRawState(variationId, option) : (variationSettingsRaw[variationId]?.optionOverrides?.[optionName] || toOptionOverrideRaw(getVariationConfig(variationId).option_price_overrides?.[optionName]));
    const persistRaw = (rawValue: VariationOptionOverrideRaw) => {
      const fallbackPrice = getVariationEffectiveOptionPrice(variationId, option || { name: optionName, price: 0 });
      const existingOverride = normalizeOptionOverride(getVariationConfig(variationId).option_price_overrides?.[optionName]);
      const normalized: VariationOptionOverride = {
        ...existingOverride,
        price: Math.max(0, parseDecimalField(rawValue.price, fallbackPrice)),
        label: normalizeComplementOptionName(String(rawValue.label || '')),
        hidden: Boolean(rawValue.hidden),
        recommended: Boolean(rawValue.recommended),
        ...(String(rawValue.order || '').trim() ? { display_order: Math.max(0, Math.floor(Number(rawValue.order) || 0)) } : {})
      };

      const currentVariation = variationSettings[variationId] || getVariationDefaults();
      const nextRawState = {
        ...variationSettingsRaw,
        [variationId]: {
          ...(variationSettingsRaw[variationId] || {
            pricingMode: getDefaultPricingMode(currentVariation.pricing_mode),
            min: String(currentVariation.min_selections ?? 0),
            max: String(currentVariation.max_selections ?? 1),
            free: String(currentVariation.free_selections_limit ?? 0),
            paidMax: String(currentVariation.paid_max_selections ?? currentVariation.max_selections ?? 1),
            multiplier: String(Number(currentVariation.price_multiplier ?? 1)),
            fixedPrice: String(Number(currentVariation.fixed_option_price ?? 0)),
            optionOverrides: {}
          }),
          optionOverrides: {
            ...(variationSettingsRaw[variationId]?.optionOverrides || {}),
            [optionName]: toOptionOverrideRaw(normalized)
          }
        }
      };
      const nextSettings = buildPersistedVariationSettings(variationSettings, nextRawState);
      void persistVariationOverrideChanges(variationId, nextRawState, nextSettings).catch(() => {});
    };
    persistRaw(currentRaw);
  };

  const toggleOptionHidden = (variationId: string, optionName: string, option?: any) => {
    const currentRaw = option ? getOptionOverrideRawState(variationId, option) : (variationSettingsRaw[variationId]?.optionOverrides?.[optionName] || toOptionOverrideRaw(getVariationConfig(variationId).option_price_overrides?.[optionName]));
    const nextRaw: VariationOptionOverrideRaw = {
      ...currentRaw,
      hidden: !currentRaw.hidden
    };
    const currentVariation = variationSettings[variationId] || getVariationDefaults();
    const nextRawState = {
      ...variationSettingsRaw,
      [variationId]: {
        ...(variationSettingsRaw[variationId] || {
          pricingMode: getDefaultPricingMode(currentVariation.pricing_mode),
          min: String(currentVariation.min_selections ?? 0),
          max: String(currentVariation.max_selections ?? 1),
          free: String(currentVariation.free_selections_limit ?? 0),
          paidMax: String(currentVariation.paid_max_selections ?? currentVariation.max_selections ?? 1),
          multiplier: String(Number(currentVariation.price_multiplier ?? 1)),
          fixedPrice: String(Number(currentVariation.fixed_option_price ?? 0)),
          optionOverrides: {}
        }),
        optionOverrides: {
          ...(variationSettingsRaw[variationId]?.optionOverrides || {}),
          [optionName]: nextRaw
        }
      }
    };
    const nextSettings = buildPersistedVariationSettings(variationSettings, nextRawState);
    setVariationSettings(nextSettings);
    setVariationSettingsRaw(nextRawState);

    const pid = product?.id || createdProductId;
    if (!pid) return;
    if (variationSaveTimerRef.current) {
      window.clearTimeout(variationSaveTimerRef.current);
      variationSaveTimerRef.current = null;
    }
    invalidateSimpleVariationCaches(pid);
    void saveProductVariations(pid, selectedVariations, { silent: true, settingsOverride: nextSettings }).catch(() => {});
  };

  const clearOptionPriceOverride = (variationId: string, optionName: string) => {
    const currentVariation = variationSettings[variationId] || getVariationDefaults();
    const currentRaw = variationSettingsRaw[variationId] || {
      pricingMode: getDefaultPricingMode(currentVariation.pricing_mode),
      min: String(currentVariation.min_selections ?? 0),
      max: String(currentVariation.max_selections ?? 1),
      free: String(currentVariation.free_selections_limit ?? 0),
      paidMax: String(currentVariation.paid_max_selections ?? currentVariation.max_selections ?? 1),
      multiplier: String(Number(currentVariation.price_multiplier ?? 1)),
      fixedPrice: String(Number(currentVariation.fixed_option_price ?? 0)),
      optionOverrides: {}
    };
    const nextOptionOverrides = { ...(currentRaw.optionOverrides || {}) };
    delete nextOptionOverrides[optionName];
    const nextRawState = {
      ...variationSettingsRaw,
      [variationId]: {
        ...currentRaw,
        optionOverrides: nextOptionOverrides
      }
    };
    const nextSettings = buildPersistedVariationSettings(variationSettings, nextRawState);
    void persistVariationOverrideChanges(variationId, nextRawState, nextSettings).catch(() => {});
  };

  const buildPersistedVariationSettings = (
    baseSettings: Record<string, VariationConfig> = variationSettings,
    rawSettings: Record<string, VariationConfigRaw> = variationSettingsRaw
  ) => {
    const nextSettings: Record<string, VariationConfig> = { ...baseSettings };
    const variationIds = new Set([
      ...Object.keys(baseSettings || {}),
      ...Object.keys(rawSettings || {}),
      ...selectedVariations
    ]);

    variationIds.forEach((variationId) => {
      const current = nextSettings[variationId] || getVariationDefaults();
      const raw = rawSettings?.[variationId];
      if (!raw) {
        nextSettings[variationId] = current;
        return;
      }

      const minNum = Math.max(0, Math.floor(raw.min === '' ? Number(current.min_selections ?? 0) : Number(raw.min) || 0));
      const maxNum = Math.max(1, Math.floor(raw.max === '' ? Number(current.max_selections ?? 1) : Number(raw.max) || 1));
      const safeMax = Math.max(maxNum, minNum);
      const freeNum = Math.max(0, Math.floor(raw.free === '' ? Number(current.free_selections_limit ?? 0) : Number(raw.free) || 0));
      const allowPaidExcess = Boolean(current.allow_paid_excess);
      const paidMaxNum = allowPaidExcess
        ? Math.max(safeMax, Math.floor(raw.paidMax === '' ? Number(current.paid_max_selections ?? safeMax) : Number(raw.paidMax) || safeMax))
        : null;
      const pricingMode = getDefaultPricingMode(raw.pricingMode || current.pricing_mode);
      const priceMultiplier = pricingMode === 'half'
        ? 0.5
        : Math.max(0, parseDecimalField(raw.multiplier, Number(current.price_multiplier ?? 1)));
      const fixedOptionPrice = pricingMode === 'fixed'
        ? Math.max(0, parseDecimalField(raw.fixedPrice, Number(current.fixed_option_price ?? 0)))
        : null;
      const optionPriceOverrides = Object.fromEntries(
        Object.entries(raw.optionOverrides || {}).map(([name, value]) => {
          const currentOverride = current.option_price_overrides?.[name] || {};
          const normalized = {
            ...normalizeOptionOverride(currentOverride),
            price: Math.max(0, parseDecimalField(value?.price ?? '', Number(currentOverride?.price ?? 0))),
            label: String(value?.label || '').trim(),
            hidden: Boolean(value?.hidden),
            recommended: Boolean(value?.recommended),
            ...(String(value?.order || '').trim() ? { display_order: Math.max(0, Math.floor(Number(value.order) || 0)) } : {})
          };
          return [name, normalized];
        })
      );

      nextSettings[variationId] = {
        ...current,
        min_selections: minNum,
        max_selections: safeMax,
        free_selections_limit: Math.min(freeNum, paidMaxNum ?? safeMax),
        paid_max_selections: paidMaxNum,
        pricing_mode: pricingMode,
        price_multiplier: priceMultiplier,
        fixed_option_price: fixedOptionPrice,
        option_price_overrides: optionPriceOverrides
      };
    });

    return nextSettings;
  };

  const getVariationSummary = (variationId: string) => {
    const config = getVariationConfig(variationId);
    const summary: string[] = [];
    summary.push(config.required ? 'Obrigatório' : 'Opcional');
    summary.push(`Máx. ${config.max_selections}`);
    if ((config.free_selections_limit || 0) > 0) summary.push(`${config.free_selections_limit} grátis`);
    if (config.allow_paid_excess) summary.push(`Extras até ${config.paid_max_selections ?? config.max_selections}`);
    if (config.pricing_mode === 'free') summary.push('Grupo grátis');
    if (config.pricing_mode === 'half') summary.push('Preço pela metade');
    if (config.pricing_mode === 'multiplier') summary.push(`${Number(config.price_multiplier || 1).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x no produto`);
    if (config.pricing_mode === 'fixed') summary.push(`R$ ${Number(config.fixed_option_price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por item`);
    return summary;
  };

  const getImageAsDataUrl = async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Não foi possível baixar a imagem');
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler imagem'));
      reader.readAsDataURL(blob);
    });
    return dataUrl;
  };

  const enhanceImageLocal = async (sourceUrl: string): Promise<string> => {
    const dataUrl = sourceUrl.startsWith('data:') ? sourceUrl : await getImageAsDataUrl(sourceUrl);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Falha ao carregar imagem'));
      i.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível');

    ctx.filter = 'contrast(1.12) saturate(1.18) brightness(1.03)';
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png', 0.92);
  };

  const uploadEnhancedToStorage = async (dataUrl: string): Promise<string> => {
    const blob = await (await fetch(dataUrl)).blob();
    const rawFile = new File([blob], `ai-enhanced-${Date.now()}.png`, { type: blob.type || 'image/png', lastModified: Date.now() });
    const prepared = await compressImageFileToMaxBytes(rawFile, { maxBytes: 100 * 1024, maxDimension: 1600, preferMimeType: 'image/webp' });
    const filePath = `products/${prepared.name}`;
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, prepared, { contentType: prepared.type, upsert: true } as any);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleOpenEnhance = async () => {
    if (!formData.image_url) {
      toast({ title: 'Sem imagem', description: 'Adicione uma imagem antes de melhorar.', variant: 'destructive' });
      return;
    }
    setIsEnhanceOpen(true);
    setEnhanceLoading(true);
    setEnhancedPreview('');
    try {
      const { data } = await invokeEdgeFunction<any>('enhance-product-image', { 
        imageUrl: formData.image_url,
        productName: formData.name // Envia o nome também
      });
      if (data?.ok && data?.imageBase64) {
        setEnhancedPreview(String(data.imageBase64));
        return;
      }
      const localEnhanced = await enhanceImageLocal(formData.image_url);
      setEnhancedPreview(localEnhanced);
    } catch {
      const localEnhanced = await enhanceImageLocal(formData.image_url);
      setEnhancedPreview(localEnhanced);
    } finally {
      setEnhanceLoading(false);
    }
  };

  const handleUseEnhanced = async () => {
    if (!enhancedPreview) return;
    try {
      setLoading(true);
      const url = enhancedPreview.startsWith('http') ? enhancedPreview : await uploadEnhancedToStorage(enhancedPreview);
      setFormData(prev => ({ ...prev, image_url: url }));
      toast({ title: 'Imagem atualizada', description: 'A imagem aprimorada foi aplicada ao produto.' });
      setIsEnhanceOpen(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Não foi possível aplicar a imagem.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateDescription = async () => {
    try {
      if (!formData.name.trim()) {
        toast({ title: 'Informe o nome', description: 'Preencha o nome do produto para gerar a descrição.', variant: 'destructive' });
        return;
      }
      setGeneratingDescription(true);
      const payload = {
        name: formData.name,
        category: formData.category,
        price: formData.price,
        currentDescription: formData.description || ''
      };
      const { data } = await invokeEdgeFunction<any>('generate-product-description', payload);
      if (data?.ok && data?.description) {
        setFormData(prev => ({ ...prev, description: String(data.description) }));
        toast({ title: 'Descrição gerada', description: 'Revise o texto antes de salvar.' });
        return;
      }
      const fallback = formData.description?.trim()
        ? formData.description
        : `${formData.name}${formData.category ? ` (${formData.category})` : ''}.`;
      setFormData(prev => ({ ...prev, description: fallback }));
      toast({ title: 'Descrição sugerida', description: 'Revise o texto antes de salvar.' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e?.message || 'Falha ao gerar descrição.', variant: 'destructive' });
    } finally {
      setGeneratingDescription(false);
    }
  };

  const buildBaseData = () => {
    const baseData: any = {
      user_id: user?.id,
      name: formData.name.trim(),
      description: formData.description?.trim() || null,
      price: formData.price,
      costing_mode: formData.costing_mode || 'automatic_recipe',
      manual_unit_cost: formData.costing_mode === 'manual'
        ? Math.max(0, Number(formData.manual_unit_cost) || 0)
        : null,
      category_id: formData.category_id,
      category: formData.category,
      available: formData.available,
      is_available: formData.available,
      weight_based: formData.weight_based,
      send_to_kds: formData.send_to_kds,
      show_in_pdv: formData.weight_based ? true : formData.show_in_pdv,
      show_in_delivery: formData.weight_based ? false : formData.show_in_delivery,
      receipt_ingredients_enabled: Boolean(formData.receipt_ingredients_enabled),
      receipt_ingredients: formData.receipt_ingredients?.trim() || null,
      image_url: formData.image_url || null,
    };

    if (!isUnsupported('barcode')) baseData.barcode = formData.barcode?.trim() || null;
    if (!isUnsupported('is_highlight')) baseData.is_highlight = formData.is_highlight;
    if (!isUnsupported('original_price')) baseData.original_price = formData.original_price;
    if (!isUnsupported('discount_percentage')) baseData.discount_percentage = formData.discount_percentage;
    if (!isUnsupported('fiscal_ncm')) baseData.fiscal_ncm = formData.fiscal_ncm?.replace(/\D/g, '').slice(0, 8) || null;
    if (!isUnsupported('fiscal_cfop')) baseData.fiscal_cfop = formData.fiscal_cfop?.replace(/\D/g, '').slice(0, 4) || null;
    if (!isUnsupported('fiscal_csosn')) baseData.fiscal_csosn = formData.fiscal_csosn?.replace(/\D/g, '').slice(0, 3) || null;
    if (!isUnsupported('fiscal_cst_pis')) baseData.fiscal_cst_pis = formData.fiscal_cst_pis?.replace(/\D/g, '').slice(0, 2) || null;
    if (!isUnsupported('fiscal_cst_cofins')) baseData.fiscal_cst_cofins = formData.fiscal_cst_cofins?.replace(/\D/g, '').slice(0, 2) || null;
    if (!isUnsupported('fiscal_origem')) baseData.fiscal_origem = formData.fiscal_origem?.replace(/\D/g, '').slice(0, 1) || '0';
    if (!isUnsupported('fiscal_cest')) baseData.fiscal_cest = formData.fiscal_cest?.replace(/\D/g, '').slice(0, 7) || null;
    if (!isUnsupported('fiscal_beneficio')) baseData.fiscal_beneficio = formData.fiscal_beneficio?.trim() || null;
    if (!isUnsupported('fiscal_observacao')) baseData.fiscal_observacao = formData.fiscal_observacao?.trim() || null;
    if (!isUnsupported('fiscal_ibs_cbs_cst')) baseData.fiscal_ibs_cbs_cst = formData.fiscal_ibs_cbs_cst?.replace(/\D/g, '').slice(0, 3) || null;
    if (!isUnsupported('fiscal_cclass_trib')) baseData.fiscal_cclass_trib = formData.fiscal_cclass_trib?.replace(/\D/g, '').slice(0, 6) || null;
    if (!isUnsupported('fiscal_reducao_ibs')) baseData.fiscal_reducao_ibs = Math.min(100, Math.max(0, Number(formData.fiscal_reducao_ibs) || 0));
    if (!isUnsupported('fiscal_reducao_cbs')) baseData.fiscal_reducao_cbs = Math.min(100, Math.max(0, Number(formData.fiscal_reducao_cbs) || 0));
    if (!isUnsupported('fiscal_default_operation_id')) baseData.fiscal_default_operation_id = formData.fiscal_default_operation_id || null;

    if (stockSchemaSupported && !isUnsupported('track_stock') && !isUnsupported('stock_quantity') && !isUnsupported('low_stock_threshold')) {
      baseData.track_stock = formData.track_stock;
      baseData.stock_quantity = formData.weight_based
        ? Math.max(0, Number(Number(formData.stock_quantity || 0).toFixed(6)))
        : Math.max(0, Math.floor(Number(formData.stock_quantity) || 0));
      baseData.low_stock_threshold = formData.weight_based
        ? Math.max(0, Number(Number(formData.low_stock_threshold || 0).toFixed(6)))
        : Math.max(0, Math.floor(Number(formData.low_stock_threshold) || 0));
    }

    return baseData;
  };

  const updateProductWithFallback = async (productId: string, data: any) => {
    let payload: any = { ...data };
    const removed = new Set<string>();
    while (true) {
      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', productId);
      if (!error) return;

      const missing = getMissingColumnFromError(error);
      if (String((error as any)?.code || '') === 'PGRST204' && missing && !removed.has(missing)) {
        removed.add(missing);
        markUnsupported(missing);
        if (stockColumns.has(missing)) {
          setStockSchemaSupported(false);
          setStockSchemaError(`${(error as any)?.code ? `${(error as any).code}: ` : ''}${String((error as any)?.message || '')}`);
        }
        delete payload[missing];
        continue;
      }
      throw error;
    }
  };

  const checkStockSchema = async () => {
    try {
      setStockSchemaError(null);
      const { error } = await (supabase as any)
        .from('products')
        .select('id, track_stock')
        .eq('user_id', user?.id)
        .limit(1);

      if (error) {
        const msg = String((error as any)?.message || (error as any)?.details || '');
        const code = String((error as any)?.code || '');
        const missing = getMissingColumnFromError(error);
        if (
          (code === 'PGRST204' && missing && stockColumns.has(missing)) ||
          (msg.includes('track_stock') && msg.toLowerCase().includes('schema cache'))
        ) {
          setStockSchemaSupported(false);
          setStockSchemaError(`${code ? `${code}: ` : ''}${msg}`);
          return false;
        }
      }

      setStockSchemaSupported(true);
      return true;
    } catch (e: any) {
      setStockSchemaSupported(true);
      return true;
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    checkStockSchema().catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!fiscalStoreId) {
      setFiscalOperations([]);
      return;
    }
    let cancelled = false;
    const loadFiscalOperations = async () => {
      // Coluna adicionada na homologação; os tipos gerados serão atualizados após a validação.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('fiscal_tax_rules')
        .select('id,name,cfop,model_codes')
        .eq('user_id', fiscalStoreId)
        .eq('active', true)
        .not('accountant_approved_at', 'is', null)
        .contains('model_codes', ['65'])
        .order('priority', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn('Não foi possível carregar operações fiscais do produto', error);
        setFiscalOperations([]);
        return;
      }
      setFiscalOperations((data || []) as FiscalOperationOption[]);
    };
    void loadFiscalOperations();
    return () => { cancelled = true; };
  }, [fiscalStoreId]);

  // Formata a string de centavos (somente dígitos) para BRL
  const formatFromRaw = (raw: string) => {
    const cents = parseInt(raw || '0', 10) || 0;
    const value = cents / 100;
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    const raw = digitsOnly === '' ? '0' : digitsOnly;
    setPriceRaw(raw);
    setFormData(prev => ({ ...prev, price: (parseInt(raw, 10) || 0) / 100 }));
  };

  const handleOriginalPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    const raw = digitsOnly === '' ? '0' : digitsOnly;
    setOriginalPriceRaw(raw);
    const originalPrice = (parseInt(raw, 10) || 0) / 100;
    
    // Auto calculate discount percentage if price is set
    let discount = 0;
    if (originalPrice > 0 && formData.price > 0 && originalPrice > formData.price) {
      discount = Math.round(((originalPrice - formData.price) / originalPrice) * 100);
    }
    
    setFormData(prev => ({ 
      ...prev, 
      original_price: originalPrice,
      discount_percentage: discount
    }));
  };

  const createCategory = async () => {
    if (!newCategoryName.trim()) {
      toast({
        title: "Nome da categoria é obrigatório",
        variant: "destructive"
      });
      return;
    }

    if (!user?.id) {
      toast({
        title: "Erro de autenticação",
        description: "Usuário não autenticado",
        variant: "destructive"
      });
      return;
    }

    setCreatingCategory(true);
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .insert([{ 
          name: newCategoryName.trim(),
          user_id: user.id,
          description: buildCategoryDescriptionWithMetadata('', {
            is_pizza: newCategoryIsPizza,
            pizza_half_price_mode: newCategoryPizzaHalfPriceMode
          })
        }])
        .select()
        .single();

      if (error) throw error;

      // Atualiza a lista de categorias
      setCategories(prev => [...prev, enrichCategoryWithMetadata(data as any)]);
      
      // Seleciona a nova categoria
      setFormData(prev => ({ 
        ...prev, 
        category: data.name,
        category_id: data.id 
      }));

      setNewCategoryName('');
      setNewCategoryIsPizza(false);
      setNewCategoryPizzaHalfPriceMode('highest');
      setShowCreateCategory(false);
      
      toast({
        title: "Categoria criada com sucesso!",
        description: `A categoria "${data.name}" foi adicionada.`
      });
    } catch (error: any) {
      console.error('Erro ao criar categoria:', error);
      toast({
        title: "Erro ao criar categoria",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setCreatingCategory(false);
    }
  };

  const ensureIndustrializedCategory = async () => {
    const existing = (categories as any[]).find((cat: any) => String(cat?.name || '').trim().toLowerCase() === 'industrializados');
    if (existing?.id) return existing;

    if (!user?.id) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('product_categories')
      .insert([{
        name: 'Industrializados',
        user_id: user.id,
        description: buildCategoryDescriptionWithMetadata('Produtos cadastrados automaticamente por código de barras.', {
          is_pizza: false,
          pizza_half_price_mode: 'highest'
        })
      }])
      .select()
      .single();

    if (error) throw error;
    const enriched = enrichCategoryWithMetadata(data as any);
    setCategories(prev => [...prev, enriched]);
    return enriched;
  };

  const lookupProductByBarcode = async (rawBarcode?: string, options?: { silent?: boolean }) => {
    const barcode = String(rawBarcode ?? formData.barcode ?? '').replace(/\D/g, '').trim();
    if (!barcode || barcode.length < 8 || barcode.length > 14 || !user?.id) return;
    if (barcodeLookupLoading) return;

    lastBarcodeLookupRef.current = barcode;
    setBarcodeLookupLoading(true);
    setBarcodeLookupStatus(options?.silent ? 'Buscando produto pelo código...' : '');

    try {
      const { data, status } = await invokeEdgeFunction('product-barcode-lookup', { barcode }, { timeoutMs: 20000 });
      if (status >= 400 || data?.error) {
        throw new Error(data?.error || 'Não foi possível consultar esse código.');
      }

      if (!data?.found || !data?.product?.name) {
        setBarcodeLookupStatus('Produto não encontrado na base pública. Você pode preencher manualmente.');
        if (!options?.silent) {
          toast({
            title: 'Produto não encontrado',
            description: 'Preencha os dados manualmente e salve com esse código.',
          });
        }
        return;
      }

      const productInfo = data.product;
      const category = formData.category_id ? null : await ensureIndustrializedCategory();
      const nextStock = Math.max(1, Number(formData.stock_quantity || 0) || 0);

      setStockQuantityRaw(String(nextStock));
      setLowStockThresholdRaw(String(formData.low_stock_threshold || 5));
      setFormData(prev => ({
        ...prev,
        barcode,
        name: prev.name?.trim() ? prev.name : String(productInfo.name || '').trim(),
        description: prev.description?.trim() ? prev.description : String(productInfo.description || '').trim(),
        image_url: prev.image_url?.trim() ? prev.image_url : String(productInfo.image_url || '').trim(),
        category: prev.category || category?.name || prev.category,
        category_id: prev.category_id || category?.id || prev.category_id,
        track_stock: true,
        stock_quantity: nextStock,
        low_stock_threshold: Math.max(1, Number(prev.low_stock_threshold || 5) || 5),
        show_in_pdv: true,
        available: true
      }));

      setBarcodeLookupStatus(`Produto encontrado: ${productInfo.name}`);
      toast({
        title: 'Produto encontrado pelo código',
        description: 'Dados preenchidos e estoque ativado. Confira o preço antes de salvar.',
      });
    } catch (error: any) {
      console.error('Erro ao consultar código de barras:', error);
      setBarcodeLookupStatus('Falha ao consultar o código. Você pode preencher manualmente.');
      if (!options?.silent) {
        toast({
          title: 'Erro ao buscar produto',
          description: error?.message || 'Não foi possível consultar esse código.',
          variant: 'destructive'
        });
      }
    } finally {
      setBarcodeLookupLoading(false);
    }
  };

  useEffect(() => {
    const barcode = String(formData.barcode || '').replace(/\D/g, '').trim();
    if (!barcode || barcode.length < 8 || barcode.length > 14) {
      setBarcodeLookupStatus('');
      return;
    }
    if (product?.id || formData.name?.trim() || lastBarcodeLookupRef.current === barcode) return;

    const timer = window.setTimeout(() => {
      void lookupProductByBarcode(barcode, { silent: true });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [formData.barcode, formData.name, product?.id, user?.id, categories.length]);


  useEffect(() => {
    if (user?.id) {
      loadCategories();
      loadGlobalVariations();
      loadAvailableProducts();
      if (product?.id) {
        loadProductVariations(product.id);
        loadPriceVariants(product.id);
      }
    }
  }, [product?.id, user?.id]);





  const loadCategories = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true);

      if (error) throw error;
      setCategories(((data || []) as any[]).map((category) => enrichCategoryWithMetadata(category)));
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
    }
  };

  const loadGlobalVariations = async () => {
    if (!user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('global_variations')
        .select('*')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;
      setGlobalVariations((data || []).map((variation: any) => ({
        ...variation,
        options: typeof variation.options === 'string' ? JSON.parse(variation.options) : variation.options
      })));

    } catch (error) {
      console.error('Erro ao carregar variações globais:', error);
    }
  };

  const loadAvailableProducts = async () => {
    if (!user?.id) return;

    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category')
        .eq('user_id', user.id)
        .order('name');

      if (error) throw error;
      setAvailableProducts((data || []).filter((item: any) => item?.id));
    } catch (error) {
      console.error('Erro ao carregar produtos para replicar complementos:', error);
    }
  };

  const loadProductVariations = async (productId: string) => {

    console.log('🔍 Carregando variações do produto:', productId);
    try {
      let data: any[] | null = null;
      let error: any = null;
      const selectAttempts = [
        'global_variation_id, required, min_selections, max_selections, free_selections_limit, allow_paid_excess, paid_max_selections, display_order, pricing_mode, price_multiplier, fixed_option_price, option_price_overrides',
        'global_variation_id, required, min_selections, max_selections, free_selections_limit, allow_paid_excess, paid_max_selections, display_order',
        'global_variation_id, required, min_selections, max_selections, display_order',
        'global_variation_id'
      ];

      for (const selectClause of selectAttempts) {
        try {
          let query = supabase
            .from('product_global_variation_links')
            .select(selectClause)
            .eq('product_id', productId);
          if (selectClause.includes('display_order')) {
            query = query.order('display_order', { ascending: true });
          }
          const res = await query;
          data = (res as any).data;
          error = (res as any).error;
          if (!error) break;
        } catch (e: any) {
          error = e;
        }
      }

      console.log('📊 Resultado da consulta de variações:', { data, error });

      if (error) throw error;
      
      const links = (data || []) as any[];
      const variationIds = links?.map((link: any) => link.global_variation_id).filter(Boolean) || [];
      console.log('🎯 IDs das variações carregadas:', variationIds);
      
      setSelectedVariations(variationIds);
      
      const gvIds = variationIds.length ? variationIds : [];
      const { data: gvData } = await supabase
        .from('global_variations')
        .select('id, required, max_selections')
        .in('id', gvIds);

      const byId = new Map((gvData || []).map((gv: any) => [String(gv.id), gv]));
      const settings: Record<string, VariationConfig> = {};
      for (const link of links) {
        const id = String(link.global_variation_id || '');
        if (!id) continue;
        const gv = byId.get(id);
        const required = link.required !== undefined && link.required !== null ? Boolean(link.required) : Boolean(gv?.required);
        const minSel = link.min_selections !== undefined && link.min_selections !== null ? Math.max(0, Number(link.min_selections) || 0) : 0;
        const maxSel = link.max_selections !== undefined && link.max_selections !== null ? Math.max(1, Number(link.max_selections) || 1) : Math.max(1, Number(gv?.max_selections) || 1);
        const allowPaidExcess = Boolean((link as any).allow_paid_excess);
        const paidMax = allowPaidExcess ? Math.max(Math.max(maxSel, minSel), Number((link as any).paid_max_selections) || Math.max(maxSel, minSel)) : null;
        settings[id] = {
          required,
          min_selections: minSel,
          max_selections: Math.max(maxSel, minSel),
          free_selections_limit: Math.max(0, Number((link as any).free_selections_limit) || 0),
          allow_paid_excess: allowPaidExcess,
          paid_max_selections: paidMax,
          pricing_mode: getDefaultPricingMode((link as any).pricing_mode),
          price_multiplier: Math.max(0, Number((link as any).price_multiplier) || 1),
          fixed_option_price: (link as any).fixed_option_price !== undefined && (link as any).fixed_option_price !== null
            ? Math.max(0, Number((link as any).fixed_option_price) || 0)
            : null,
          option_price_overrides: typeof (link as any).option_price_overrides === 'object' && (link as any).option_price_overrides
            ? Object.fromEntries(
                Object.entries((link as any).option_price_overrides).map(([name, value]) => [String(name), normalizeOptionOverride(value)])
              )
            : {}
        };
      }
      
      console.log('⚙️ Configurações das variações carregadas:', settings);
      setVariationSettings(settings);
      syncVariationSettingsRaw(settings);
      return;
    } catch (error) {
      console.error('❌ Erro ao carregar variações do produto:', error);
      await loadProductVariationsLegacy(productId);
    }
  };

  const loadProductVariationsLegacy = async (productId: string) => {
    console.log('🔍 Carregando variações do produto (legacy):', productId);
    try {
      const { data, error } = await supabase
        .from('product_global_variation_links')
        .select('global_variation_id')
        .eq('product_id', productId);

      console.log('📊 Resultado da consulta de variações:', { data, error });

      if (error) throw error;
      
      const variationIds = data?.map((link: any) => link.global_variation_id) || [];
      console.log('🎯 IDs das variações carregadas:', variationIds);
      
      setSelectedVariations(variationIds);
      
      // Carregar configurações padrão das variações globais
      const gvIds = variationIds.length ? variationIds : [];
      const { data: gvData } = await supabase
        .from('global_variations')
        .select('id, required, max_selections')
        .in('id', gvIds);
      const settings: Record<string, VariationConfig> = {};
      (gvData || []).forEach((gv: any) => {
        settings[gv.id] = {
          required: !!gv.required,
          min_selections: 0,
          max_selections: gv.max_selections ?? 1,
          free_selections_limit: 0,
          allow_paid_excess: false,
          paid_max_selections: null,
          pricing_mode: 'default',
          price_multiplier: 1,
          fixed_option_price: null,
          option_price_overrides: {}
        };
      });
      
      console.log('⚙️ Configurações das variações carregadas:', settings);
      setVariationSettings(settings);
      syncVariationSettingsRaw(settings);
      
    } catch (error) {
      console.error('❌ Erro ao carregar variações do produto:', error);

    }
  };

  const loadPriceVariants = async (productId: string) => {
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', productId)
        .order('display_order');
      
      if (error) {
        // If table doesn't exist yet, just ignore (might happen during dev)
        if (error.code === '42P01') return;
        throw error;
      }

      if (data && data.length > 0) {
        setPriceVariants(data);
        setPriceMode('variants');
      }
    } catch (error) {
      console.error('Erro ao carregar variantes de preço:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();


    if (!user?.id || !formData.name || !formData.category_id) {
      toast({
        title: "Erro",
        description: "Preencha todos os campos obrigatórios (nome e categoria).",
        variant: "destructive"
      });
      return;
    }
    
    if (priceMode === 'variants' && priceVariants.filter(v => !v._deleted).length === 0) {
      toast({
        title: "Erro",
        description: "Adicione pelo menos uma variante de preço ou mude para preço simples.",
        variant: "destructive"
      });
      return;
    }

    try {
      setLoading(true);
      const persistedVariationSettings = buildPersistedVariationSettings();
      setVariationSettings(persistedVariationSettings);
      syncVariationSettingsRaw(persistedVariationSettings);

      const baseData = buildBaseData();
      // If using variants, maybe set base price to 0 or min variant price
      if (priceMode === 'variants') {
        const minPrice = Math.min(...priceVariants.filter(v => !v._deleted).map(v => v.price));
        baseData.price = minPrice > 0 ? minPrice : 0;
      }

      let productId = product?.id || createdProductId;

      if (productId) {
        const productData = {
          ...baseData,
          updated_at: new Date().toISOString()
        } as const;
        console.log('Atualizando produto:', productId, productData);
        await updateProductWithFallback(productId, productData);
      } else {
        // Tentativa mínima: apenas campos essenciais
        const minimalData = {
          user_id: user.id,
          name: formData.name.trim(),
          price: formData.price,
          category_id: formData.category_id,
          category: formData.category,
          available: formData.available,
          weight_based: formData.weight_based,
          send_to_kds: formData.send_to_kds,
          show_in_pdv: formData.show_in_pdv,
          show_in_delivery: formData.show_in_delivery,
          receipt_ingredients_enabled: Boolean(formData.receipt_ingredients_enabled),
          receipt_ingredients: formData.receipt_ingredients?.trim() || null,
        } as const;

        let insertResultId: string | null = null;
        console.log('Inserindo produto (mínimo):', minimalData);
        const { data: minimalInsert, error: minimalError } = await supabase
          .from('products')
          .insert([minimalData])
          .select('id')
          .single();

        if (minimalError) {
          console.error('Erro na inserção mínima:', minimalError);
          throw minimalError;
        }
        insertResultId = minimalInsert?.id || null;

        // Atualizar campos adicionais se inserção mínima funcionou
        if (insertResultId) {
          const productData = {
            ...baseData,
            updated_at: new Date().toISOString()
          } as const;
          console.log('Atualizando campos adicionais do produto:', insertResultId, productData);
          await updateProductWithFallback(insertResultId, productData);
        }

        if (insertResultId) {
          productId = insertResultId;
          setCreatedProductId(insertResultId);
        }
      }
      
      // Salvar vínculos de variações globais
      if (productId) {
        await saveProductVariations(productId, selectedVariations, { settingsOverride: persistedVariationSettings });
        
        // Salvar variantes de preço
        if (priceMode === 'variants') {
          await savePriceVariants(productId);
        } else {
            // Check if we need to clear existing variants if switching back to simple?
            // Maybe optional, but cleaner.
        }

        // Se o usuario preencheu uma linha da ficha e clicou no botao principal
        // do produto, persiste a linha antes de fechar o formulario.
        await recipeManagerRef.current?.savePendingItem();
      }

      toast({
        title: "Sucesso",
        description: `Produto ${product?.id ? 'atualizado' : 'criado'} com sucesso!`,
      });

      onSave(productId);

    } catch (error: any) {
      const rawMsg = String(error?.message || error?.details || error?.hint || '');
      const missing = getMissingColumnFromError(error);
      if (String(error?.code || '') === 'PGRST204' && missing) {
        markUnsupported(missing);
        if (stockColumns.has(missing)) {
          setStockSchemaSupported(false);
          setStockSchemaError(`${error?.code ? `${error.code}: ` : ''}${rawMsg}`);
        }
      }
      console.error('Erro ao salvar produto:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
      toast({
        title: "Erro",
        description: rawMsg.includes('track_stock') || rawMsg.includes('stock_quantity') || rawMsg.includes('low_stock_threshold')
          ? `Seu banco conectado ao app ainda não tem o controle de estoque. Rode o SQL de estoque no Supabase do projeto ${(supabase as any)?.supabaseUrl || ''} e tente novamente.`
          : (String(error?.code || '') === 'PGRST204' && missing)
            ? `O banco conectado ao app não tem a coluna "${missing}". Ajuste o banco (ou rode reload schema) e tente novamente.`
          : (error?.message || error?.details || error?.hint || "Erro ao salvar produto."),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Autosave: salva automaticamente ao alterar campos essenciais
  useEffect(() => {
    createdProductIdRef.current = createdProductId;
  }, [createdProductId]);

  useEffect(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const timer = setTimeout(async () => {
      // requisitos mínimos
      if (loading) return;
      if (autoSaveInFlightRef.current) return;
      const canCreate = !!user?.id && !!formData.name.trim() && !!formData.category_id;
      if (canCreate) {
        try {
          // se não há product.id, cria mín e atualiza
      autoSaveInFlightRef.current = true;
      const currentId = createdProductIdRef.current;
      if (!currentId) {
        const minimalData = {
          user_id: user!.id,
          name: formData.name.trim(),
          price: formData.price,
          category_id: formData.category_id,
          category: formData.category,
          available: formData.available,
          weight_based: formData.weight_based,
          send_to_kds: formData.send_to_kds,
          show_in_pdv: formData.show_in_pdv,
          show_in_delivery: formData.show_in_delivery,
          receipt_ingredients_enabled: Boolean(formData.receipt_ingredients_enabled),
          receipt_ingredients: formData.receipt_ingredients?.trim() || null,
        } as const;
        const { data: insertData, error: insertErr } = await supabase
          .from('products')
          .insert([minimalData])
          .select('id')
          .single();
        if (!insertErr && insertData?.id) {
            setCreatedProductId(insertData.id);
            createdProductIdRef.current = insertData.id;
            // atualiza com campos adicionais
            const additional: any = {
              ...buildBaseData(),
              updated_at: new Date().toISOString()
            };
            await updateProductWithFallback(insertData.id, additional);
        }
      } else {
        const updateData: any = {
          ...buildBaseData(),
          updated_at: new Date().toISOString()
        };
        await updateProductWithFallback(currentId, updateData);
      }
        } catch (err) {
          const rawMsg = String((err as any)?.message || (err as any)?.details || '');
          const missing = getMissingColumnFromError(err);
          if (String((err as any)?.code || '') === 'PGRST204' && missing) {
            markUnsupported(missing);
            if (stockColumns.has(missing)) {
              setStockSchemaSupported(false);
              setStockSchemaError(`${(err as any)?.code ? `${(err as any).code}: ` : ''}${rawMsg}`);
            }
          }
          console.warn('Autosave produto falhou', err);
        } finally {
          autoSaveInFlightRef.current = false;
        }
      }
    }, 800);
    setAutoSaveTimer(timer);
    return () => clearTimeout(timer);
  }, [user?.id, loading, createdProductId, formData.name, formData.barcode, formData.price, formData.costing_mode, formData.manual_unit_cost, formData.category_id, formData.category, formData.description, formData.image_url, formData.available, formData.show_in_delivery, formData.receipt_ingredients_enabled, formData.receipt_ingredients, formData.is_highlight, formData.original_price, formData.track_stock, formData.stock_quantity, formData.low_stock_threshold, formData.fiscal_ncm, formData.fiscal_cfop, formData.fiscal_csosn, formData.fiscal_cst_pis, formData.fiscal_cst_cofins, formData.fiscal_origem, formData.fiscal_cest, formData.fiscal_beneficio, formData.fiscal_observacao, formData.fiscal_ibs_cbs_cst, formData.fiscal_cclass_trib, formData.fiscal_reducao_ibs, formData.fiscal_reducao_cbs, formData.fiscal_default_operation_id, stockSchemaSupported]);


  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    
    const items = Array.from(selectedVariations);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setSelectedVariations(items);
  };

  const buildVariationLinkPayload = (
    productId: string,
    variationId: string,
    idx: number,
    settingsSource: Record<string, VariationConfig>
  ) => {
    const s = settingsSource?.[variationId] || getVariationDefaults();
    const minSel = Math.max(0, Math.floor(Number(s.min_selections) || 0));
    const maxSel = Math.max(1, Math.floor(Number(s.max_selections) || 1));
    const allowPaidExcess = Boolean(s.allow_paid_excess);
    const paidMax = allowPaidExcess ? Math.max(maxSel, Math.floor(Number(s.paid_max_selections) || maxSel)) : null;
    const pricingMode = getDefaultPricingMode(s.pricing_mode);
    const priceMultiplier = pricingMode === 'half'
      ? 0.5
      : pricingMode === 'multiplier'
        ? Math.max(0, Number(s.price_multiplier) || 1)
        : 1;
    const fixedOptionPrice = pricingMode === 'fixed'
      ? Math.max(0, Number(s.fixed_option_price) || 0)
      : null;
    const optionPriceOverrides = Object.keys(s.option_price_overrides || {}).length > 0 ? s.option_price_overrides : null;

    return {
      product_id: productId,
      global_variation_id: variationId,
      required: Boolean(s.required),
      min_selections: minSel,
      max_selections: Math.max(maxSel, minSel),
      free_selections_limit: Math.max(0, Math.floor(Number(s.free_selections_limit) || 0)),
      allow_paid_excess: allowPaidExcess,
      paid_max_selections: paidMax,
      display_order: idx,
      pricing_mode: pricingMode,
      price_multiplier: priceMultiplier,
      fixed_option_price: fixedOptionPrice,
      option_price_overrides: optionPriceOverrides
    };
  };

  const insertVariationLinksWithCompatibility = async (links: Array<Record<string, any>>) => {
    let data: any = null;
    let error: any = null;
    const insertAttempts = [
      ['product_id', 'global_variation_id', 'required', 'min_selections', 'max_selections', 'free_selections_limit', 'allow_paid_excess', 'paid_max_selections', 'display_order', 'pricing_mode', 'price_multiplier', 'fixed_option_price', 'option_price_overrides'],
      ['product_id', 'global_variation_id', 'required', 'min_selections', 'max_selections', 'free_selections_limit', 'allow_paid_excess', 'paid_max_selections', 'display_order'],
      ['product_id', 'global_variation_id', 'required', 'min_selections', 'max_selections', 'display_order'],
      ['product_id', 'global_variation_id']
    ] as const;

    const advancedUpdateAttempts = [
      ['required', 'min_selections', 'max_selections', 'free_selections_limit', 'allow_paid_excess', 'paid_max_selections', 'display_order', 'pricing_mode', 'price_multiplier', 'fixed_option_price', 'option_price_overrides'],
      ['free_selections_limit', 'allow_paid_excess', 'paid_max_selections', 'pricing_mode', 'price_multiplier', 'fixed_option_price', 'option_price_overrides'],
      ['pricing_mode', 'price_multiplier', 'fixed_option_price', 'option_price_overrides'],
      ['option_price_overrides']
    ] as const;

    const applyAdvancedFields = async (link: Record<string, any>) => {
      for (const allowedKeys of advancedUpdateAttempts) {
        const payload = Object.fromEntries(
          Object.entries(link).filter(([key, value]) => key !== 'product_id' && key !== 'global_variation_id' && value !== undefined && allowedKeys.includes(key as typeof allowedKeys[number]))
        );
        if (Object.keys(payload).length === 0) return null;
        const res = await supabase
          .from('product_global_variation_links')
          .update(payload as any)
          .eq('product_id', link.product_id)
          .eq('global_variation_id', link.global_variation_id);
        const updateError = (res as any).error;
        if (!updateError) return null;
      }
      return null;
    };

    for (const [attemptIndex, allowedKeys] of insertAttempts.entries()) {
      const payload = links.map((link) => Object.fromEntries(
        Object.entries(link).filter(([key]) => allowedKeys.includes(key as typeof allowedKeys[number]))
      ));
      const res = await supabase.from('product_global_variation_links').insert(payload as any);
      data = (res as any).data;
      error = (res as any).error;
      if (!error) {
        if (attemptIndex > 0) {
          for (const link of links) {
            await applyAdvancedFields(link);
          }
        }
        break;
      }
    }

    return { data, error };
  };

  const openApplyVariationDialog = (variationId: string) => {
    setApplyVariationId(variationId);
    setApplyTargetProductIds([]);
    setApplyVariationDialogOpen(true);
  };

  const applyVariationToOtherProducts = async () => {
    if (!applyVariationId || applyTargetProductIds.length === 0) {
      setApplyVariationDialogOpen(false);
      return;
    }

    try {
      setApplyingVariation(true);
      const resolvedSettings = buildPersistedVariationSettings();
      setVariationSettings(resolvedSettings);
      syncVariationSettingsRaw(resolvedSettings);

      for (const targetProductId of applyTargetProductIds) {
        const existingIndex = selectedVariations.findIndex((id) => id === applyVariationId);
        const payload = buildVariationLinkPayload(targetProductId, applyVariationId, Math.max(existingIndex, 0), resolvedSettings);
        const { error: deleteError } = await supabase
          .from('product_global_variation_links')
          .delete()
          .eq('product_id', targetProductId)
          .eq('global_variation_id', applyVariationId);

        if (deleteError) throw deleteError;

        const { error } = await insertVariationLinksWithCompatibility([payload]);
        if (error) throw error;
      }

      toast({
        title: 'Grupo aplicado',
        description: 'O grupo de complementos foi aplicado aos produtos selecionados.'
      });
      setApplyVariationDialogOpen(false);
      setApplyTargetProductIds([]);
    } catch (error: any) {
      toast({
        title: 'Erro ao aplicar grupo',
        description: error?.message || 'Não foi possível aplicar este grupo a outros produtos.',
        variant: 'destructive'
      });
    } finally {
      setApplyingVariation(false);
    }
  };

  const saveProductVariations = async (
    productId: string,
    variations: string[] = selectedVariations,
    options?: { silent?: boolean; settingsOverride?: Record<string, VariationConfig> }
  ) => {
    const resolvedSettings = options?.settingsOverride || buildPersistedVariationSettings();
    if (!options?.settingsOverride) {
      setVariationSettings(resolvedSettings);
    }
    console.log('🔄 Iniciando saveProductVariations:', { 
      productId, 
      variations, 
      selectedVariations,
      variationSettings: resolvedSettings 
    });
    
    try {
      invalidateSimpleVariationCaches(productId);
      // Primeiro, deletar vínculos existentes
      console.log('🗑️ Deletando vínculos existentes para produto:', productId);
      const { error: deleteError } = await supabase
        .from('product_global_variation_links')
        .delete()
        .eq('product_id', productId);
      
      if (deleteError) {
        console.error('❌ Erro ao deletar vínculos existentes:', deleteError);
        throw deleteError;
      }
      
      console.log('✅ Vínculos existentes deletados com sucesso');
      
      if (variations.length > 0) {
        console.log('📝 Criando novos vínculos para', variations.length, 'variações');
        
        const links = variations.map((variationId, idx) => buildVariationLinkPayload(productId, variationId, idx, resolvedSettings));
        
        console.log('💾 Inserindo vínculos no banco:', links);
        const { data, error } = await insertVariationLinksWithCompatibility(links);
          
        console.log('📊 Resultado da inserção:', { data, error });
        
        if (error) {
          console.error('❌ Erro ao inserir vínculos:', error);
          if (!options?.silent) {
            toast({
              title: "Erro ao salvar vínculo de variações globais",
              description: error.message,
              variant: "destructive"
            });
          }
          throw error;
        } else {
          console.log('✅ Vínculos inseridos com sucesso!');
          if (!options?.silent) {
            toast({
              title: "Adicionais vinculados",
              description: `${variations.length} variações globais salvas com sucesso!`,
              variant: "default"
            });
          }
        }
      } else {
        console.log('ℹ️ Nenhuma variação selecionada para salvar');
      }
    } catch (error) {
      console.error('💥 Erro geral ao salvar variações do produto:', error);
      if (!options?.silent) {
        toast({
          title: "Erro ao salvar variações",
          description: "Ocorreu um erro ao salvar as variações globais",
          variant: "destructive"
        });
      }
      throw error;
    }
  };

  useEffect(() => {
    const pid = product?.id || createdProductId;
    if (!pid) return;
    if (variationSaveTimerRef.current) window.clearTimeout(variationSaveTimerRef.current);
    variationSaveTimerRef.current = window.setTimeout(() => {
      void saveProductVariations(pid, selectedVariations, { silent: true }).catch(() => {});
    }, 900);
    return () => {
      if (variationSaveTimerRef.current) window.clearTimeout(variationSaveTimerRef.current);
      variationSaveTimerRef.current = null;
    };
  }, [product?.id, createdProductId, selectedVariations, variationSettings]);

  const handleVariationToggle = (variationId: string, checked: boolean) => {

    setSelectedVariations(prev => {
      const updated = checked 
        ? [...prev, variationId]
        : prev.filter(id => id !== variationId);
      console.log('DEBUG handleVariationToggle updated:', updated);
      return updated;
    });
    if (checked) {
      setVariationSettings(prev => {
        const next = {
          ...prev,
          [variationId]: prev[variationId] || getVariationDefaults()
        };
        return next;
      });
      setVariationSettingsRaw(prev => ({
        ...prev,
        [variationId]: prev[variationId] || { min: '0', max: '1', free: '0', paidMax: '1', multiplier: '1', fixedPrice: '0', optionOverrides: {} }
      }));
    } else {
      setVariationSettings(prev => {
        const copy = { ...prev };
        delete copy[variationId];
        return copy;
      });
      setVariationSettingsRaw(prev => {
        const copy = { ...prev };
        delete copy[variationId];
        return copy;
      });
    }
  };

  const handleVariationSettingChange = (variationId: string, field: keyof VariationConfig, value: boolean | number | null | string) => {
    setVariationSettings(prev => ({
      ...prev,
      [variationId]: {
        ...(prev[variationId] || getVariationDefaults()),
        [field]: value
      }
    }));
  };

  // Price Variants Functions
  const handleAddPriceVariant = () => {
    const newVariant: ProductVariant = {
      name: 'Novo Tamanho',
      price: 0,
      display_order: priceVariants.length
    };
    setPriceVariants([...priceVariants, newVariant]);
  };

  const handleRemovePriceVariant = (index: number) => {
    setPriceVariants(prev => {
      const next = [...prev];
      if (next[index].id) {
        next[index]._deleted = true;
      } else {
        next.splice(index, 1);
      }
      return next;
    });
  };

  const handlePriceVariantChange = (index: number, field: keyof ProductVariant, value: any) => {
    setPriceVariants(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const onPriceVariantsDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    
    const items = Array.from(priceVariants);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    // Update display_order based on new index
    const updated = items.map((item, idx) => ({ ...item, display_order: idx }));
    setPriceVariants(updated);
  };

  const savePriceVariants = async (productId: string) => {
    try {
      const toDelete = priceVariants.filter(v => v._deleted && v.id).map(v => v.id);
      const toUpsert = priceVariants.filter(v => !v._deleted).map((v, idx) => ({
        id: v.id,
        product_id: productId,
        name: v.name,
        price: v.price,
        display_order: idx
      }));

      if (toDelete.length > 0) {
        await supabase.from('product_variants').delete().in('id', toDelete);
      }

      if (toUpsert.length > 0) {
        // Remove IDs from new items to let DB generate them
        const { error } = await supabase.from('product_variants').upsert(toUpsert.map(v => {
            if (!v.id) {
                const { id, ...rest } = v;
                return rest;
            }
            return v;
        }));
        if (error) throw error;
      }
    } catch (error) {
      console.error('Erro ao salvar variantes de preço:', error);
      toast({
        title: "Erro ao salvar variantes de preço",
        variant: "destructive"
      });
    }
  };


  return (
    <div className="rounded-[30px] border border-[#FF6400]/15 bg-gradient-to-br from-[#FFF8F2] via-white to-[#F5EBE1]/70 shadow-[0_30px_90px_-60px_rgba(255,100,0,0.45)]">
      <div className="flex items-center gap-2 justify-between py-4 px-5">
        <div className="text-xl font-bold text-boracume-dark-green uppercase tracking-tight">{product?.id ? 'Editar produto' : 'Novo produto'}</div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-[#003223]/45 hover:bg-[#F5EBE1] hover:text-boracume-orange">
            <Star className="h-5 w-5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-xl text-[#003223]/45 hover:bg-[#F5EBE1]">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-6 mt-1">
        <div className="pt-3 grid grid-cols-[auto,1fr] gap-3 items-start bg-gradient-to-br from-[#F5EBE1] via-white to-[#F5EBE1]/70 p-4 rounded-[26px] border border-[#FF6400]/20 shadow-[0_22px_45px_-35px_rgba(255,100,0,0.35)]">
          <ProductImageUpload
            compact
            onImageUploaded={(url) => setFormData(prev => ({ ...prev, image_url: url }))}
            currentImageUrl={formData.image_url}
          />

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name" className="text-boracume-dark-green font-semibold">Nome do Produto *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                required
                className="bg-white rounded-xl shadow-sm h-11"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description" className="text-boracume-dark-green font-semibold">Descrição</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="bg-white rounded-xl shadow-sm"
              />
            </div>
            <div className="rounded-2xl border border-[#FF6400]/15 bg-[#FFF8F2] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor="receipt_ingredients_enabled" className="text-boracume-dark-green font-semibold">
                    Imprimir ingredientes no cupom
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Use somente em produtos preparados com composição fixa. A descrição comum continua apenas no cardápio.
                  </p>
                </div>
                <Switch
                  id="receipt_ingredients_enabled"
                  checked={Boolean(formData.receipt_ingredients_enabled)}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, receipt_ingredients_enabled: Boolean(checked) }))}
                />
              </div>
              {formData.receipt_ingredients_enabled ? (
                <div className="mt-3 space-y-1">
                  <Label htmlFor="receipt_ingredients" className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Ingredientes/complementos fixos
                  </Label>
                  <Textarea
                    id="receipt_ingredients"
                    value={formData.receipt_ingredients || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, receipt_ingredients: e.target.value }))}
                    rows={2}
                    className="bg-white rounded-xl shadow-sm"
                    placeholder="Ex: banana, leite em pó, granola, leite condensado"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="relative rounded-2xl border-[#FF6400]/20 bg-white/90 text-[#003223] hover:bg-[#F5EBE1]" onClick={handleOpenEnhance} disabled={loading}>
            <Sparkles className="h-4 w-4 mr-2" />
            Melhorar imagem
            <Badge className="absolute -top-2 right-2 bg-boracume-orange">IA</Badge>
          </Button>
          <Button type="button" variant="outline" className="relative rounded-2xl border-[#FF6400]/20 bg-white/90 text-[#003223] hover:bg-[#F5EBE1]" onClick={handleGenerateDescription} disabled={generatingDescription}>
            <Sparkles className="h-4 w-4 mr-2" />
            {generatingDescription ? 'Gerando...' : 'Gerar descrição'}
            <Badge className="absolute -top-2 right-2 bg-boracume-orange">IA</Badge>
          </Button>
        </div>

        <Dialog open={isEnhanceOpen} onOpenChange={setIsEnhanceOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Melhorar imagem com IA</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Imagem atual</div>
                <div className="border rounded-lg p-2 bg-white">
                  {formData.image_url ? (
                    <img src={formData.image_url} alt="Imagem atual" className="w-full max-h-[320px] object-contain" />
                  ) : (
                    <div className="text-sm text-muted-foreground">Sem imagem</div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Imagem aprimorada</div>
                <div className="border rounded-lg p-2 bg-white">
                  {enhanceLoading ? (
                    <div className="text-sm text-muted-foreground">Processando...</div>
                  ) : enhancedPreview ? (
                    <img src={enhancedPreview} alt="Imagem aprimorada" className="w-full max-h-[320px] object-contain" />
                  ) : (
                    <div className="text-sm text-muted-foreground">Sem prévia</div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsEnhanceOpen(false)}>
                Voltar
              </Button>
              <Button type="button" onClick={handleUseEnhanced} disabled={!enhancedPreview || enhanceLoading}>
                Usar imagem com IA
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="space-y-3 bg-gradient-to-br from-[#F5EBE1] via-white to-[#F5EBE1]/70 p-4 rounded-[26px] border border-[#FF6400]/20 shadow-[0_22px_45px_-35px_rgba(255,100,0,0.25)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-boracume-dark-green">Preço</div>
            <Tabs value={priceMode} onValueChange={(v) => setPriceMode(v as any)}>
              <TabsList className="h-8 bg-white border border-[#FF6400]/15">
                <TabsTrigger value="simple" className="h-7 text-xs">Simples</TabsTrigger>
                <TabsTrigger value="variants" className="h-7 text-xs">Variantes</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Tabs value={priceMode} onValueChange={(v) => setPriceMode(v as any)}>
            <TabsContent value="simple" className="mt-2">
              <div className="space-y-2">
                <Label htmlFor="price" className="text-sm font-semibold">Valor Final (R$)</Label>
                <Input
                  id="price"
                  type="text"
                  value={formatFromRaw(priceRaw)}
                  onChange={handlePriceChange}
                  placeholder="0,00"
                  required={false}
                  className="bg-white rounded-xl shadow-sm h-11 text-lg font-bold text-boracume-dark-green"
                />
              </div>
            </TabsContent>
            <TabsContent value="variants" className="mt-2">
              <div className="space-y-3">
                 <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={handleAddPriceVariant} className="rounded-xl border-boracume-green text-boracume-dark-green hover:bg-boracume-green/10">
                        <Plus className="h-4 w-4 mr-1 text-boracume-orange" />
                        Adicionar Tamanho
                    </Button>
                 </div>
                 
                 <DragDropContext onDragEnd={onPriceVariantsDragEnd}>
                    <Droppable droppableId="price-variants-list">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                                {priceVariants.filter(v => !v._deleted).map((variant, index) => (
                                    <Draggable key={variant.id || `temp-${index}`} draggableId={variant.id || `temp-${index}`} index={index}>
                                        {(draggableProvided) => (
                                            <div
                                                ref={draggableProvided.innerRef}
                                                {...draggableProvided.draggableProps}
                                                className="flex items-center gap-2 p-3 border border-gray-100 rounded-xl bg-white shadow-sm hover:border-boracume-green transition-colors group"
                                            >
                                                <div {...draggableProvided.dragHandleProps} className="cursor-grab text-gray-300 group-hover:text-boracume-orange transition-colors">
                                                    <GripVertical className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1">
                                                    <Input 
                                                        value={variant.name}
                                                        onChange={(e) => handlePriceVariantChange(index, 'name', e.target.value)}
                                                        placeholder="Ex: Pequena"
                                                        className="h-10 border-gray-100 focus-visible:ring-boracume-green"
                                                    />
                                                </div>
                                                <div className="w-36">
                                                    <CurrencyInput
                                                        value={variant.price}
                                                        onValueChange={(value) => handlePriceVariantChange(index, 'price', value)}
                                                        placeholder="R$ 0,00"
                                                        className="h-10 font-bold text-boracume-dark-green border-gray-100 focus-visible:ring-boracume-green"
                                                    />
                                                </div>
                                                <Button 
                                                    type="button" 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    className="h-10 w-10 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl"
                                                    onClick={() => handleRemovePriceVariant(index)}
                                                >
                                                    <Trash2 className="h-5 w-5" />
                                                </Button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                 </DragDropContext>
                 
                 {priceVariants.filter(v => !v._deleted).length === 0 && (
                     <div className="text-sm text-center text-muted-foreground py-4 border border-dashed rounded-lg">
                         Nenhuma variante adicionada
                     </div>
                 )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4 rounded-2xl border border-[#003223]/10 bg-white p-4 shadow-sm">
          <div>
            <div className="text-sm font-semibold text-boracume-dark-green">Custo do produto</div>
            <p className="mt-1 text-xs text-[#003223]/60">
              Usado no CMV, lucro bruto e margem. O custo fica congelado em cada venda.
            </p>
          </div>
          <Select
            value={formData.costing_mode || 'automatic_recipe'}
            onValueChange={(value: 'automatic_recipe' | 'manual') => setFormData(prev => ({
              ...prev,
              costing_mode: value,
              manual_unit_cost: value === 'manual' ? (prev.manual_unit_cost ?? 0) : null,
            }))}
          >
            <SelectTrigger className="h-11 rounded-xl bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="automatic_recipe">Automático pela ficha técnica</SelectItem>
              <SelectItem value="manual">Custo direto informado</SelectItem>
            </SelectContent>
          </Select>
          {formData.costing_mode === 'manual' && (
            <div className="space-y-2">
              <Label htmlFor="manual_unit_cost" className="font-semibold text-boracume-dark-green">
                Custo por {formData.weight_based ? 'kg' : 'unidade'} (R$)
              </Label>
              <CurrencyInput
                id="manual_unit_cost"
                value={Number(formData.manual_unit_cost) || 0}
                onValueChange={(value) => setFormData(prev => ({ ...prev, manual_unit_cost: Math.max(0, value) }))}
                placeholder="R$ 0,00"
                className="h-11 rounded-xl bg-white font-semibold"
              />
              <p className="text-xs text-[#003223]/60">
                {formData.weight_based
                  ? 'Informe quanto custa 1 kg deste produto.'
                  : 'Informe quanto custa cada unidade vendida.'}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 bg-boracume-light/30 p-4 rounded-2xl border border-boracume-light mt-3">
          <div className="space-y-1">
            <Label htmlFor="stock_quantity" className="text-boracume-dark-green font-semibold">Estoque</Label>
            {formData.weight_based ? (
              <Input
                id="stock_quantity"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                value={stockQuantityRaw}
                onChange={(event) => {
                  const value = event.target.value;
                  setStockQuantityRaw(value);
                  if (value !== '') {
                    setFormData(prev => ({ ...prev, stock_quantity: Math.max(0, Number(value) || 0) }));
                  }
                }}
                className="bg-white rounded-xl h-11"
                disabled={!formData.track_stock}
              />
            ) : (
              <IntegerInput
                id="stock_quantity"
                value={stockQuantityRaw}
                min={0}
                fallback={formData.stock_quantity ?? 0}
                onValueChange={(value) => {
                  setStockQuantityRaw(value);
                  if (value !== '') {
                    setFormData(prev => ({ ...prev, stock_quantity: Math.max(0, parseInt(value || '0', 10) || 0) }));
                  }
                }}
                className="bg-white rounded-xl h-11"
                disabled={!formData.track_stock}
              />
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="low_stock_threshold" className="text-boracume-dark-green font-semibold">Estoque mín.</Label>
            {formData.weight_based ? (
              <Input
                id="low_stock_threshold"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.001"
                value={lowStockThresholdRaw}
                onChange={(event) => {
                  const value = event.target.value;
                  setLowStockThresholdRaw(value);
                  if (value !== '') {
                    setFormData(prev => ({ ...prev, low_stock_threshold: Math.max(0, Number(value) || 0) }));
                  }
                }}
                className="bg-white rounded-xl h-11"
                disabled={!formData.track_stock}
              />
            ) : (
              <IntegerInput
                id="low_stock_threshold"
                value={lowStockThresholdRaw}
                min={0}
                fallback={formData.low_stock_threshold ?? 0}
                onValueChange={(value) => {
                  setLowStockThresholdRaw(value);
                  if (value !== '') {
                    setFormData(prev => ({ ...prev, low_stock_threshold: Math.max(0, parseInt(value || '0', 10) || 0) }));
                  }
                }}
                className="bg-white rounded-xl h-11"
                disabled={!formData.track_stock}
              />
            )}
          </div>
          <div className="col-span-2 flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="text-sm font-semibold text-boracume-dark-green">Controle de estoque ativo</div>
            <Switch
              id="track_stock"
              checked={formData.track_stock}
              onCheckedChange={async (checked) => {
                if (checked) {
                  const ok = await checkStockSchema();
                  if (!ok) return;
                }
                setFormData(prev => ({ ...prev, track_stock: checked }));
              }}
              disabled={false}
            />
          </div>
          {!stockSchemaSupported && (
            <div className="col-span-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
              Controle de estoque ainda não está habilitado no banco.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#FF6400]/15 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5EBE1] text-[#003223]">
              <Barcode className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <Label htmlFor="barcode" className="text-boracume-dark-green font-semibold">
                  Código de barras / QR / SKU
                </Label>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Bipe o produto ou digite o código que será usado no PDV para adicionar automaticamente.
                </p>
              </div>
              <Input
                id="barcode"
                value={formData.barcode || ''}
                onChange={(e) => {
                  const barcode = e.target.value.replace(/\s+/g, '');
                  setFormData(prev => ({ ...prev, barcode }));
                  setBarcodeLookupStatus('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void lookupProductByBarcode();
                  }
                }}
                placeholder="Ex: 7891234567890"
                inputMode="text"
                autoComplete="off"
                className="h-11 rounded-xl bg-[#FFFDF9] font-semibold tracking-wide text-[#003223]"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-[#8CC850] bg-white text-[#003223] hover:bg-[#F5EBE1]"
                  onClick={() => lookupProductByBarcode()}
                  disabled={barcodeLookupLoading || !String(formData.barcode || '').replace(/\D/g, '').trim()}
                >
                  <Barcode className="mr-2 h-4 w-4" />
                  {barcodeLookupLoading ? 'Buscando...' : 'Buscar e preencher pelo código'}
                </Button>
                {barcodeLookupStatus ? (
                  <div className="text-xs font-medium text-[#003223]/70">
                    {barcodeLookupStatus}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <Accordion type="single" collapsible className="rounded-2xl border border-[#003223]/10 bg-white px-4 shadow-sm">
          <AccordionItem value="fiscal" className="border-none">
            <AccordionTrigger className="py-4 text-left text-sm font-bold text-[#003223] hover:no-underline">
              Fiscal do produto
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 rounded-xl border border-[#003223]/10 bg-[#F7FBF5] p-3 sm:col-span-2">
                  <Label htmlFor="fiscal_default_operation_id" className="text-boracume-dark-green font-semibold">Operação fiscal padrão no PDV</Label>
                  <Select
                    value={formData.fiscal_default_operation_id || 'automatic'}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, fiscal_default_operation_id: value === 'automatic' ? '' : value }))}
                  >
                    <SelectTrigger id="fiscal_default_operation_id" className="h-11 rounded-xl bg-[#FFFDF9] font-semibold">
                      <SelectValue placeholder="Selecione a operação" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">Automática — conforme o contexto da venda</SelectItem>
                      {fiscalOperations.map((operation) => (
                        <SelectItem key={operation.id} value={operation.id}>{operation.name} · CFOP {operation.cfop}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-[#003223]/65">A operação escolhida será priorizada para este produto no PDV quando for compatível com a venda. Somente operações aprovadas para NFC-e aparecem aqui.</p>
                  {fiscalOperations.length === 0 ? <p className="text-xs font-medium text-amber-700">Nenhuma operação fiscal aprovada para NFC-e está disponível.</p> : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_ncm" className="text-boracume-dark-green font-semibold">NCM</Label>
                  <Input
                    id="fiscal_ncm"
                    value={formData.fiscal_ncm || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_ncm: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                    placeholder="Ex: 21069090"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_cfop" className="text-boracume-dark-green font-semibold">CFOP</Label>
                  <Input
                    id="fiscal_cfop"
                    value={formData.fiscal_cfop || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_cfop: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="Ex: 5102"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_csosn" className="text-boracume-dark-green font-semibold">CSOSN/CST ICMS</Label>
                  <Input
                    id="fiscal_csosn"
                    value={formData.fiscal_csosn || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_csosn: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                    placeholder="Ex: 102 ou 500"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_origem" className="text-boracume-dark-green font-semibold">Origem</Label>
                  <Select
                    value={formData.fiscal_origem || '0'}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, fiscal_origem: value }))}
                  >
                    <SelectTrigger id="fiscal_origem" className="h-11 rounded-xl bg-[#FFFDF9] font-semibold">
                      <SelectValue placeholder="Origem" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Nacional</SelectItem>
                      <SelectItem value="1">1 - Estrangeira importação direta</SelectItem>
                      <SelectItem value="2">2 - Estrangeira mercado interno</SelectItem>
                      <SelectItem value="3">3 - Nacional acima 40% importado</SelectItem>
                      <SelectItem value="4">4 - Nacional produção PPB</SelectItem>
                      <SelectItem value="5">5 - Nacional até 40% importado</SelectItem>
                      <SelectItem value="6">6 - Estrangeira importação direta sem similar</SelectItem>
                      <SelectItem value="7">7 - Estrangeira mercado interno sem similar</SelectItem>
                      <SelectItem value="8">8 - Nacional acima 70% importado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_cst_pis" className="text-boracume-dark-green font-semibold">CST PIS</Label>
                  <Input
                    id="fiscal_cst_pis"
                    value={formData.fiscal_cst_pis || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_cst_pis: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                    placeholder="Ex: 07"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_cst_cofins" className="text-boracume-dark-green font-semibold">CST COFINS</Label>
                  <Input
                    id="fiscal_cst_cofins"
                    value={formData.fiscal_cst_cofins || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_cst_cofins: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
                    placeholder="Ex: 07"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_cest" className="text-boracume-dark-green font-semibold">CEST</Label>
                  <Input
                    id="fiscal_cest"
                    value={formData.fiscal_cest || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_cest: e.target.value.replace(/\D/g, '').slice(0, 7) }))}
                    placeholder="Quando houver ST"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fiscal_beneficio" className="text-boracume-dark-green font-semibold">Benefício fiscal</Label>
                  <Input
                    id="fiscal_beneficio"
                    value={formData.fiscal_beneficio || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_beneficio: e.target.value }))}
                    placeholder="Se exigido pela UF"
                    className="h-11 rounded-xl bg-[#FFFDF9] font-semibold"
                  />
                </div>
                <div className="space-y-2 rounded-xl border border-[#003223]/10 bg-[#F7FBF5] p-3 sm:col-span-2">
                  <div>
                    <Label htmlFor="fiscal_cclass_trib" className="text-boracume-dark-green font-semibold">
                      IBS/CBS — classificação tributária
                    </Label>
                    <p className="mt-1 text-xs text-[#003223]/65">Informe apenas após conferir a tabela oficial vigente. A regra aprovada da operação prevalece sobre este cadastro.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1"><Label htmlFor="fiscal_ibs_cbs_cst">CST IBS/CBS</Label><Input id="fiscal_ibs_cbs_cst" value={formData.fiscal_ibs_cbs_cst || ''} onChange={(event) => setFormData(prev => ({ ...prev, fiscal_ibs_cbs_cst: event.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="3 dígitos" className="h-11 rounded-xl bg-[#FFFDF9] font-semibold" /></div>
                    <div className="space-y-1"><Label htmlFor="fiscal_cclass_trib">cClassTrib</Label><Input id="fiscal_cclass_trib" value={formData.fiscal_cclass_trib || ''} onChange={(event) => setFormData(prev => ({ ...prev, fiscal_cclass_trib: event.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="6 dígitos" className="h-11 rounded-xl bg-[#FFFDF9] font-semibold" /></div>
                  </div>
                  <div className="grid gap-2 text-xs font-medium text-[#003223]/75 sm:grid-cols-2">
                    <span>Redução IBS: {Number(formData.fiscal_reducao_ibs || 0).toLocaleString('pt-BR')}%</span>
                    <span>Redução CBS: {Number(formData.fiscal_reducao_cbs || 0).toLocaleString('pt-BR')}%</span>
                  </div>
                  <a
                    href={`https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributariaNcm?dfeTypes=NFCE&ncm=${formData.fiscal_ncm || ''}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-xs font-semibold text-[#2767D9] underline underline-offset-2"
                  >
                    Conferir este NCM no classificador oficial da SVRS
                  </a>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="fiscal_observacao" className="text-boracume-dark-green font-semibold">Observação fiscal interna</Label>
                  <Textarea
                    id="fiscal_observacao"
                    value={formData.fiscal_observacao || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fiscal_observacao: e.target.value }))}
                    rows={2}
                    placeholder="Ex: produto com substituição tributária, conferir contador"
                    className="rounded-xl bg-[#FFFDF9]"
                  />
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Se deixar em branco, o fiscal usa os padrões configurados em Fiscal/NFC-e. Produtos com imposto retido normalmente usam CSOSN 500/CST correspondente e CEST quando aplicável.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="flex gap-2 flex-wrap">
          <Button type="button" variant="outline" size="sm" className="rounded-xl border-dashed bg-white" onClick={() => toast({ title: 'Em breve' })}>+ Desconto</Button>
          <Button type="button" variant="outline" size="sm" className="rounded-xl border-dashed bg-white" onClick={() => toast({ title: 'Em breve' })}>+ Embalagem</Button>
        </div>

        {/* Ficha Técnica (Receita) */}
        {createdProductId && (
          <ProductRecipeManager ref={recipeManagerRef} productId={createdProductId} />
        )}
        {!createdProductId && (
          <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 flex items-center justify-center gap-2">
            <BookOpen className="h-4 w-4" />
            Salve o produto primeiro para cadastrar a Ficha Técnica.
          </div>
        )}

        <div className="space-y-4 rounded-[26px] border border-[#FF6400]/20 bg-gradient-to-br from-[#F5EBE1] via-white to-[#F5EBE1]/70 p-4 shadow-[0_22px_45px_-35px_rgba(255,100,0,0.35)]">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#FF6400]/20 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#FF6400]">
                <Sparkles className="h-3.5 w-3.5" />
                Adicionais do produto
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-[#003223]">Adicionar variações</div>
                <Badge variant="secondary" className="rounded-full bg-[#8CC850] px-2.5 py-0.5 text-[#003223]">{selectedVariations.length}</Badge>
              </div>
              <div className="text-xs text-[#003223]/70">Organize sabores, bordas e adicionais com mais clareza visual e contraste.</div>
            </div>
            <Button type="button" variant="outline" onClick={() => setVariationsDialogOpen(true)} className="h-10 rounded-2xl border-[#FF6400]/20 bg-white/90 px-3 text-[#FF6400] hover:bg-[#F5EBE1]">
              <Plus className="mr-1 h-4 w-4" />
              Selecionar
            </Button>
          </div>

          {selectedVariations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#FF6400]/25 bg-white/90 p-5 text-center text-sm text-[#003223]/45">
              Nenhuma variação selecionada.
            </div>
          ) : (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="variations-list">
                {(provided) => (
                  <div 
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="space-y-3"
                  >
                    {selectedVariations.map((id, index) => {
                      const v = globalVariations.find((gv: any) => gv.id === id);
                      if (!v) return null;
                      
                      return (
                        <Draggable key={id} draggableId={id} index={index}>
                          {(draggableProvided) => (
                            <div 
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              className="overflow-hidden rounded-[22px] border border-[#FF6400]/15 bg-white/95 shadow-[0_12px_30px_-24px_rgba(0,50,35,0.18)]"
                            >
                              <div className="flex items-start gap-3 p-3.5">
                                <button 
                                  type="button"
                                  {...draggableProvided.dragHandleProps}
                                  className="mt-0.5 cursor-grab rounded-xl border border-[#FF6400]/15 bg-[#F5EBE1] p-1.5 text-[#003223]/60 transition hover:bg-[#F5EBE1] active:cursor-grabbing"
                                >
                                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate text-sm font-semibold text-[#003223]">{v.name}</div>
                                    {getVariationSummary(v.id).map((item) => (
                                      <Badge key={`${v.id}-${item}`} variant="outline" className="rounded-full border-[#8CC850]/40 bg-[#8CC850]/15 text-[10px] text-[#003223]">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="mt-1 text-xs text-[#003223]/65">
                                    Ajuste obrigatoriedade, limite grátis e adicionais pagos sem bagunça visual.
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 rounded-xl border-[#8CC850]/30 bg-white/90 px-3 text-xs font-semibold text-[#003223] hover:bg-[#8CC850]/12"
                                      onClick={() => openApplyVariationDialog(v.id)}
                                    >
                                      Aplicar a outros produtos
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              <div className="border-t border-[#FF6400]/10 bg-gradient-to-br from-[#F5EBE1]/70 to-white px-3.5 py-3">
                                <div className="grid gap-2.5 xl:grid-cols-[1.2fr_1fr_1fr_1.1fr]">
                                  <div className="grid gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className={getVariationConfig(v.id).required ? 'h-9 justify-center rounded-xl border-[#003223] bg-[#003223] px-3 text-white hover:bg-[#003223]/90' : 'h-9 justify-center rounded-xl border-[#003223]/15 bg-white/90 px-3 text-[#003223] hover:bg-white'}
                                      onClick={() => handleVariationSettingChange(v.id, 'required', !getVariationConfig(v.id).required)}
                                    >
                                      {getVariationConfig(v.id).required ? 'Obrigatório' : 'Opcional'}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className={getVariationConfig(v.id).allow_paid_excess ? 'h-9 justify-center rounded-xl border-[#FF6400] bg-[#FF6400] px-3 text-white hover:bg-[#FF6400]/90' : 'h-9 justify-center rounded-xl border-[#FF6400]/20 bg-white/90 px-3 text-[#FF6400] hover:bg-white'}
                                      onClick={() => handleVariationSettingChange(v.id, 'allow_paid_excess', !getVariationConfig(v.id).allow_paid_excess)}
                                    >
                                      {getVariationConfig(v.id).allow_paid_excess ? 'Extras pagos' : 'Sem extras pagos'}
                                    </Button>
                                  </div>
                                  <div className="rounded-xl border border-[#FF6400]/15 bg-white/95 px-3 py-2">
                                    <Label htmlFor={`pricing-mode-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Preço no produto</Label>
                                    <Select
                                      value={variationSettingsRaw[v.id]?.pricingMode ?? getVariationConfig(v.id).pricing_mode}
                                      onValueChange={(value) => {
                                        const pricingMode = value as VariationPricingMode;
                                        handleVariationSettingChange(v.id, 'pricing_mode', pricingMode);
                                        updateVariationRaw(v.id, { pricingMode });
                                        if (pricingMode === 'half') {
                                          handleVariationSettingChange(v.id, 'price_multiplier', 0.5);
                                          handleVariationSettingChange(v.id, 'fixed_option_price', null);
                                          updateVariationRaw(v.id, { pricingMode, multiplier: '0.5', fixedPrice: '0' });
                                        }
                                        if (pricingMode === 'default') {
                                          handleVariationSettingChange(v.id, 'price_multiplier', 1);
                                          handleVariationSettingChange(v.id, 'fixed_option_price', null);
                                          updateVariationRaw(v.id, { pricingMode, multiplier: '1', fixedPrice: '0' });
                                        }
                                        if (pricingMode === 'free') {
                                          handleVariationSettingChange(v.id, 'fixed_option_price', 0);
                                          updateVariationRaw(v.id, { pricingMode, fixedPrice: '0' });
                                        }
                                        if (pricingMode === 'multiplier') {
                                          handleVariationSettingChange(v.id, 'fixed_option_price', null);
                                          updateVariationRaw(v.id, { pricingMode, fixedPrice: '0' });
                                        }
                                        if (pricingMode === 'fixed') {
                                          handleVariationSettingChange(v.id, 'price_multiplier', 1);
                                          updateVariationRaw(v.id, { pricingMode, multiplier: '1' });
                                        }
                                      }}
                                    >
                                      <SelectTrigger id={`pricing-mode-${v.id}`} className="mt-1 h-9 rounded-lg border-[#FF6400]/20 bg-[#F5EBE1]/45 text-sm font-semibold text-[#003223]">
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="default">Preço normal</SelectItem>
                                        <SelectItem value="free">Sem cobrar</SelectItem>
                                        <SelectItem value="half">Metade do valor</SelectItem>
                                        <SelectItem value="multiplier">Multiplicador</SelectItem>
                                        <SelectItem value="fixed">Preço fixo por item</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                    <div className="rounded-xl border border-[#FF6400]/15 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`min-selections-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Mín.</Label>
                                      <IntegerInput
                                        id={`min-selections-${v.id}`}
                                        min={0}
                                        value={variationSettingsRaw[v.id]?.min ?? String(getVariationConfig(v.id).min_selections ?? 0)}
                                        onValueChange={value => updateVariationRaw(v.id, { min: value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#FF6400]/20 bg-[#F5EBE1]/45 text-center text-sm font-semibold text-[#003223]"
                                      />
                                    </div>
                                    <div className="rounded-xl border border-[#FF6400]/15 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`max-selections-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Máx.</Label>
                                      <IntegerInput
                                        id={`max-selections-${v.id}`}
                                        min={1}
                                        value={variationSettingsRaw[v.id]?.max ?? String(getVariationConfig(v.id).max_selections ?? 1)}
                                        onValueChange={value => updateVariationRaw(v.id, { max: value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#FF6400]/20 bg-[#F5EBE1]/45 text-center text-sm font-semibold text-[#003223]"
                                      />
                                    </div>
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                                    <div className="rounded-xl border border-[#8CC850]/25 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`free-selections-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Grátis</Label>
                                      <IntegerInput
                                        id={`free-selections-${v.id}`}
                                        min={0}
                                        value={variationSettingsRaw[v.id]?.free ?? String(getVariationConfig(v.id).free_selections_limit ?? 0)}
                                        onValueChange={value => updateVariationRaw(v.id, { free: value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#8CC850]/35 bg-[#8CC850]/12 text-center text-sm font-semibold text-[#003223]"
                                      />
                                    </div>
                                    <div className="rounded-xl border border-[#003223]/12 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`paid-max-selections-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Total</Label>
                                      <IntegerInput
                                        id={`paid-max-selections-${v.id}`}
                                        min={Math.max(1, getVariationConfig(v.id).max_selections ?? 1)}
                                        disabled={!getVariationConfig(v.id).allow_paid_excess}
                                        value={variationSettingsRaw[v.id]?.paidMax ?? String(getVariationConfig(v.id).paid_max_selections ?? getVariationConfig(v.id).max_selections ?? 1)}
                                        onValueChange={value => updateVariationRaw(v.id, { paidMax: value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-center text-sm font-semibold text-[#003223] disabled:opacity-50"
                                      />
                                    </div>
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                                    <div className="rounded-xl border border-[#003223]/12 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`price-multiplier-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Multiplicador</Label>
                                      <Input
                                        id={`price-multiplier-${v.id}`}
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        disabled={getVariationConfig(v.id).pricing_mode !== 'multiplier'}
                                        value={variationSettingsRaw[v.id]?.multiplier ?? String(Number(getVariationConfig(v.id).price_multiplier ?? 1))}
                                        onChange={e => updateVariationRaw(v.id, { multiplier: e.target.value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-center text-sm font-semibold text-[#003223] disabled:opacity-50"
                                      />
                                    </div>
                                    <div className="rounded-xl border border-[#003223]/12 bg-white/95 px-3 py-2">
                                      <Label htmlFor={`fixed-price-${v.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/60">Preço fixo</Label>
                                      <Input
                                        id={`fixed-price-${v.id}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        disabled={getVariationConfig(v.id).pricing_mode !== 'fixed'}
                                        value={variationSettingsRaw[v.id]?.fixedPrice ?? String(Number(getVariationConfig(v.id).fixed_option_price ?? 0))}
                                        onChange={e => updateVariationRaw(v.id, { fixedPrice: e.target.value })}
                                        onBlur={() => commitVariationMinMax(v.id)}
                                        className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-center text-sm font-semibold text-[#003223] disabled:opacity-50"
                                      />
                                    </div>
                                  </div>
                                </div>
                                <Accordion type="single" collapsible className="mt-3 rounded-2xl border border-[#FF6400]/10 bg-white/75 px-2">
                                  <AccordionItem value={`options-${v.id}`} className="border-b-0">
                                    <AccordionTrigger className="px-2 py-3 text-sm font-semibold text-[#003223] hover:no-underline">
                                      Ver e editar cada complemento deste grupo
                                    </AccordionTrigger>
                                    <AccordionContent className="px-2 pb-3">
                                      <div className="space-y-2">
                                        {Array.isArray(v.options) && v.options.length > 0 ? v.options.map((option: any, optionIndex: number) => {
                                          const optionName = String(option?.name || '').trim();
                                          const basePrice = Math.max(0, Number(option?.price) || 0);
                                          const optionOverride = normalizeOptionOverride(getVariationConfig(v.id).option_price_overrides?.[optionName]);
                                          const optionRaw = getOptionOverrideRawState(v.id, option);
                                          const effectivePrice = getVariationEffectiveOptionPrice(v.id, option);
                                          const hasOverride = getVariationConfig(v.id).option_price_overrides?.[optionName] !== undefined;
                                          return (
                                            <div key={`${v.id}-option-${optionIndex}`} className="rounded-2xl border border-[#FF6400]/10 bg-gradient-to-r from-[#F5EBE1]/55 via-white to-[#F5EBE1]/35 p-3">
                                              <div className="grid gap-3 xl:grid-cols-[1.2fr_120px_130px_auto]">
                                                <div className="min-w-0">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <div className="truncate text-sm font-semibold text-[#003223]">{optionOverride.label || optionName}</div>
                                                  </div>
                                                  <div className="mt-1 text-xs text-[#003223]/60">Nome original: {optionName}</div>
                                                </div>
                                                <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2">
                                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/55">Base do grupo</div>
                                                  <div className="mt-1 text-sm font-bold text-[#003223]">
                                                    {formatBRL(basePrice)}
                                                  </div>
                                                </div>
                                                <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2">
                                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/55">Valor atual</div>
                                                  <div className="mt-1 text-sm font-bold text-[#FF6400]">
                                                    {formatBRL(effectivePrice)}
                                                  </div>
                                                </div>
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="icon"
                                                  className={`h-12 w-12 rounded-xl border-[#003223]/15 bg-white ${optionRaw.hidden ? 'text-[#FF6400]' : 'text-[#003223]'} hover:bg-[#F5EBE1]`}
                                                  onClick={() => {
                                                    toggleOptionHidden(v.id, optionName, option);
                                                  }}
                                                >
                                                  {optionRaw.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </Button>
                                              </div>
                                              <div className="mt-3 grid gap-2 xl:grid-cols-[1.2fr_130px_130px]">
                                                <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2">
                                                  <Label htmlFor={`option-label-${v.id}-${optionIndex}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/55">Nome neste produto</Label>
                                                  <Input
                                                    id={`option-label-${v.id}-${optionIndex}`}
                                                    value={optionRaw.label}
                                                    onChange={e => handleOptionOverrideFieldChange(v.id, optionName, 'label', e.target.value)}
                                                    onBlur={() => commitOptionOverride(v.id, optionName, option)}
                                                    placeholder={optionName}
                                                    className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-sm font-medium text-[#003223]"
                                                  />
                                                </div>
                                                <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2">
                                                  <Label htmlFor={`option-price-${v.id}-${optionIndex}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/55">Preço</Label>
                                                  <CurrencyInput
                                                    id={`option-price-${v.id}-${optionIndex}`}
                                                    value={parseDecimalField(optionRaw.price, effectivePrice)}
                                                    onValueChange={(value) => handleOptionPriceOverrideChange(v.id, optionName, String(value))}
                                                    onBlur={() => commitOptionOverride(v.id, optionName, option)}
                                                    className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-center text-sm font-semibold text-[#003223]"
                                                  />
                                                </div>
                                                <div className="rounded-xl border border-[#003223]/10 bg-white px-3 py-2">
                                                  <Label htmlFor={`option-order-${v.id}-${optionIndex}`} className="text-[10px] font-semibold uppercase tracking-wide text-[#003223]/55">Ordem</Label>
                                                  <IntegerInput
                                                    id={`option-order-${v.id}-${optionIndex}`}
                                                    min={0}
                                                    value={optionRaw.order}
                                                    onValueChange={(value) => handleOptionOverrideFieldChange(v.id, optionName, 'order', value)}
                                                    onBlur={() => commitOptionOverride(v.id, optionName, option)}
                                                    className="mt-1 h-9 rounded-lg border-[#003223]/15 bg-[#003223]/[0.04] text-center text-sm font-semibold text-[#003223]"
                                                  />
                                                </div>
                                              </div>
                                              <div className="mt-3 flex flex-wrap justify-end gap-2">
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="sm"
                                                  className="h-10 rounded-xl border-[#FF6400]/20 bg-white text-[#FF6400] hover:bg-[#F5EBE1]"
                                                  onClick={() => commitOptionOverride(v.id, optionName, option)}
                                                >
                                                  Salvar ajustes
                                                </Button>
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="sm"
                                                  disabled={!hasOverride}
                                                  className="h-10 rounded-xl border-[#003223]/15 bg-white text-[#003223] hover:bg-[#F5EBE1] disabled:opacity-40"
                                                  onClick={() => clearOptionPriceOverride(v.id, optionName)}
                                                >
                                                  Resetar para o grupo
                                                </Button>
                                              </div>
                                            </div>
                                          );
                                        }) : (
                                          <div className="rounded-xl border border-dashed border-[#FF6400]/20 bg-white/90 p-4 text-sm text-[#003223]/55">
                                            Este grupo ainda não possui opções cadastradas.
                                          </div>
                                        )}
                                      </div>
                                    </AccordionContent>
                                  </AccordionItem>
                                </Accordion>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>

        <Dialog open={variationsDialogOpen} onOpenChange={setVariationsDialogOpen}>
          <DialogContent className="max-w-2xl rounded-[28px] border border-orange-200/70 bg-gradient-to-br from-orange-50/95 via-white to-amber-50/95 shadow-[0_28px_70px_-35px_rgba(249,115,22,0.45)]">
            <DialogHeader>
              <DialogTitle className="text-slate-900">Selecionar variações</DialogTitle>
            </DialogHeader>
            {globalVariations.length === 0 ? (
              <div className="text-sm text-muted-foreground">Nenhuma variação global cadastrada.</div>
            ) : (
              <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-2 sm:grid-cols-2">
                {globalVariations.map((variation: any) => (
                  <div key={variation.id} className={`flex items-start space-x-3 rounded-2xl border p-4 shadow-sm ${variation.active !== false ? 'border-orange-100 bg-white/90' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                    <Checkbox
                      id={`variation-${variation.id}`}
                      checked={selectedVariations.includes(variation.id)}
                      onCheckedChange={(checked) => handleVariationToggle(variation.id, checked as boolean)}
                    />
                    <div className="flex-1">
                      <Label htmlFor={`variation-${variation.id}`} className="font-medium cursor-pointer text-slate-900">
                        {variation.name}
                      </Label>
                      <div className="mt-1 text-xs text-slate-500">
                        {variation.active !== false ? 'Complemento ativo' : 'Complemento oculto'}
                      </div>
                      {variation.description && (
                        <p className="text-sm text-muted-foreground mt-1">{variation.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={() => setVariationsDialogOpen(false)} className="rounded-2xl bg-boracume-orange text-white hover:bg-orange-600">
                Concluir
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={applyVariationDialogOpen} onOpenChange={setApplyVariationDialogOpen}>
          <DialogContent className="max-w-2xl rounded-[28px] border border-[#FF6400]/12 bg-gradient-to-br from-[#FFF8F2] via-white to-[#F5EBE1]/65 shadow-[0_28px_70px_-35px_rgba(0,50,35,0.22)]">
            <DialogHeader>
              <DialogTitle className="text-slate-900">Aplicar grupo a outros produtos</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm text-[#003223]/70">
                Selecione os produtos que também devem receber este grupo de complementos com as mesmas configurações.
              </div>
              <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-2 sm:grid-cols-2">
                {availableProducts
                  .filter((item) => item.id !== (product?.id || createdProductId))
                  .map((item) => (
                    <div key={item.id} className="flex items-start space-x-3 rounded-2xl border border-[#FF6400]/10 bg-white/90 p-4 shadow-sm">
                      <Checkbox
                        id={`apply-variation-${item.id}`}
                        checked={applyTargetProductIds.includes(item.id)}
                        onCheckedChange={(checked) => {
                          setApplyTargetProductIds((prev) => checked
                            ? [...prev, item.id]
                            : prev.filter((id) => id !== item.id));
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={`apply-variation-${item.id}`} className="cursor-pointer font-medium text-slate-900">
                          {item.name}
                        </Label>
                        {item.category && (
                          <div className="mt-1 text-xs text-[#003223]/55">{item.category}</div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-xl border-[#003223]/12 bg-white/85 px-4 text-[#003223] hover:bg-[#F5EBE1]" onClick={() => setApplyVariationDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" className="h-9 rounded-xl bg-[#8CC850] px-4 text-[#003223] hover:bg-[#79b541]" disabled={applyingVariation || applyTargetProductIds.length === 0} onClick={applyVariationToOtherProducts}>
                {applyingVariation ? 'Aplicando...' : 'Aplicar grupo'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="space-y-2 bg-gradient-to-br from-[#F5EBE1] via-white to-[#F5EBE1]/70 p-4 rounded-[26px] border border-[#FF6400]/20 shadow-[0_22px_45px_-35px_rgba(255,100,0,0.25)]">
          <Label htmlFor="category" className="text-boracume-dark-green font-semibold">Categoria</Label>
          <div className="flex gap-2">
            <Select 
              value={formData.category} 
              onValueChange={(value) => {
                const category = categories.find((cat: any) => cat.name === value);
                setFormData(prev => ({ 
                  ...prev, 
                  category: value,
                  category_id: category?.id || null
                }));
              }}
            >
              <SelectTrigger className="flex-1 bg-white rounded-xl h-11 border-[#FF6400]/20">
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((category: any) => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Dialog open={showCreateCategory} onOpenChange={setShowCreateCategory}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="h-11 w-11 rounded-xl border-[#FF6400]/20 text-boracume-orange hover:bg-[#F5EBE1]">
                  <Plus className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Criar Nova Categoria</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-category">Nome da Categoria</Label>
                    <Input
                      id="new-category"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder="Digite o nome da categoria"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          createCategory();
                        }
                      }}
                    />
                  </div>
                  <div className="rounded-xl border border-[#FF6400]/10 bg-[#F5EBE1]/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-[#003223]">Categoria de pizza</Label>
                        <p className="mt-1 text-xs text-[#003223]/60">Usa 1 sabor ou 2 sabores com regra automÃ¡tica.</p>
                      </div>
                      <Switch checked={newCategoryIsPizza} onCheckedChange={setNewCategoryIsPizza} />
                    </div>
                    {newCategoryIsPizza && (
                      <div className="mt-3 space-y-2">
                        <Label>Regra do meio a meio</Label>
                        <Select
                          value={newCategoryPizzaHalfPriceMode}
                          onValueChange={(value: 'highest' | 'split_halves') => setNewCategoryPizzaHalfPriceMode(value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="highest">Prevalece o sabor de maior valor</SelectItem>
                            <SelectItem value="split_halves">Soma metade de cada sabor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => {
                        setShowCreateCategory(false);
                        setNewCategoryName('');
                        setNewCategoryIsPizza(false);
                        setNewCategoryPizzaHalfPriceMode('highest');
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button 
                      type="button" 
                      onClick={createCategory}
                      disabled={creatingCategory || !newCategoryName.trim()}
                    >
                      {creatingCategory ? 'Criando...' : 'Criar'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 bg-gradient-to-br from-[#F5EBE1] via-white to-[#F5EBE1]/70 p-4 rounded-[26px] border border-[#FF6400]/20 shadow-[0_22px_45px_-35px_rgba(255,100,0,0.25)]">
          <div className="flex items-center space-x-2">
            <Switch
              id="available"
              checked={formData.available}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, available: checked }))}
            />
            <Label htmlFor="available" className="font-medium text-boracume-dark-green">Disponível</Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="show_in_delivery"
              checked={formData.show_in_delivery}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, show_in_delivery: checked }))}
              disabled={formData.weight_based}
            />
            <Label htmlFor="show_in_delivery" className="font-medium text-boracume-dark-green">Mostrar no delivery</Label>
          </div>

          <div className="flex items-center space-x-2 col-span-2 rounded-xl border border-[#003223]/10 bg-white/80 p-3">
            <Switch
              id="weight_based"
              checked={formData.weight_based}
              onCheckedChange={(checked) => setFormData(prev => ({
                ...prev,
                weight_based: checked,
                show_in_pdv: checked ? true : prev.show_in_pdv,
                show_in_delivery: checked ? false : prev.show_in_delivery
              }))}
            />
            <div>
              <Label htmlFor="weight_based" className="font-medium text-boracume-dark-green">Vendido por peso</Label>
              <p className="text-xs text-[#003223]/60">Produto aparece somente no PDV e puxa o peso da balança ao selecionar.</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 col-span-2">
            <Switch
              id="is_highlight"
              checked={!!formData.is_highlight}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_highlight: checked }))}
              disabled={isUnsupported('is_highlight')}
            />
            <Label htmlFor="is_highlight" className="font-medium text-boracume-dark-green">Adicionar aos destaques</Label>
          </div>
        </div>

        <div className="flex gap-3 pt-6 pb-2">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1 rounded-2xl h-12 text-boracume-dark-green border-[#FF6400]/20 bg-white/90 hover:bg-[#F5EBE1]">
            Cancelar
          </Button>
          <Button type="submit" disabled={loading} className="flex-1 rounded-2xl font-bold h-12 text-white bg-gradient-to-r from-[#FF6400] to-[#FF8A3D] hover:from-[#FF6400] hover:to-[#FF7A24] transition-transform hover:scale-[1.02]">
            {loading ? 'Salvando...' : 'Salvar Produto'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ProductForm;
