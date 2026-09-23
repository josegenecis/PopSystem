import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Link as LinkIcon, Type, Loader2, CheckCircle2, Wand2, FileJson, RefreshCw, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeComplementOptionName } from '@/lib/text';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import Tesseract from 'tesseract.js';

interface MenuImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  initialUrl?: string;
  initialImageDataUrl?: string;
}

interface ImportedVariant {
  name: string;
  price: number;
}

interface ImportedVariationGroup {
  name: string;
  required?: boolean;
  min_selections?: number;
  max_selections?: number;
  options: ImportedVariant[];
}

interface ImportedProduct {
  name: string;
  price: number;
  description?: string;
  image_url?: string;
  available?: boolean;
  variants?: ImportedVariant[];
  price_variants?: ImportedVariant[];
  variations?: ImportedVariationGroup[];
}

interface ImportedCategory {
  name: string;
  items: ImportedProduct[];
}

type MenuImportStats = {
  categoriesFound: number;
  productsFound: number;
  complementsFound: number;
  groupedProducts: number;
};

type NormalizedMenuResult = {
  categories: ImportedCategory[];
  stats: MenuImportStats;
};

type LinkImportPreview = {
  platform: string;
  restaurant?: {
    name?: string;
    phone?: string;
    address?: string;
  };
  stats: {
    categories: number;
    products: number;
    productsWithImages: number;
    variationLinks: number;
    deliveryRegions: number;
    banners: number;
  };
  preview?: {
    categories?: Array<{ name: string; products: number }>;
    products?: Array<{ name: string; price: number; category: string; variations: number; image_url?: string | null }>;
    delivery_zones?: Array<{ name: string; delivery_fee: number; delivery_time?: string }>;
  };
};

const MenuImportModal: React.FC<MenuImportModalProps> = ({ isOpen, onClose, onImportComplete, initialUrl = '', initialImageDataUrl = '' }) => {
  const [activeTab, setActiveTab] = useState('text');
  const [textInput, setTextInput] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Processando...');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<LinkImportPreview | null>(null);
  const cancelRef = useRef(false);
  
  const { toast } = useToast();
  const { user, session } = useAuth();

  useEffect(() => {
    cancelRef.current = !isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (initialUrl) {
      setActiveTab('link');
      setUrlInput(initialUrl);
      setLinkPreview(null);
      return;
    }
    if (initialImageDataUrl) {
      setActiveTab('image');
      setImagePreview(initialImageDataUrl);
      void fetch(initialImageDataUrl)
        .then((response) => response.blob())
        .then((blob) => setSelectedImage(new File([blob], `cardapio-${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`, { type: blob.type || 'image/jpeg' })))
        .catch(() => {
          setSelectedImage(null);
          setImagePreview(null);
        });
    }
  }, [initialImageDataUrl, initialUrl, isOpen]);

  const isValidUrl = (value: string) => {
    try {
      const u = new URL(value.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const structuredMenuPlatform = (value: string) => {
    try {
      const url = new URL(value.trim());
      const host = url.host.toLowerCase();
      if (host.includes('brendi.com.br')) return 'brendi';
      if (host === 'app.minichef.online' && /^\/delivery\/[^/]+\/?$/i.test(url.pathname)) return 'minichef';
      return null;
    } catch {
      return null;
    }
  };

  const isAuthImportError = (message?: string | null) => {
    const normalized = String(message || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return (
      normalized.includes('usuario') ||
      normalized.includes('autentic') ||
      normalized.includes('logado') ||
      normalized.includes('jwt') ||
      normalized.includes('token')
    );
  };

  const importBrendiViaCompatibleFlow = async (url: string) => {
    setLoadingMessage('Usando modo compatível do Brendi...');
    const { data, status } = await invokeEdgeFunction('scrape-menu', {
      type: 'url',
      data: url,
      action: 'start',
    }, { timeoutMs: 120000, authToken: session?.access_token });

    if (status !== 200 || !data?.success || !Array.isArray(data.categories)) {
      throw new Error(data?.error || 'Não foi possível extrair esse cardápio pelo modo compatível.');
    }

    return data.categories as ImportedCategory[];
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

  const normalizeImageUrl = (value?: string | null) => {
    const v = (value || '').trim().replace(/^['"]|['"]$/g, '');
    if (!v || v === 'null' || v === 'undefined' || v === '[object Object]') return null;
    if (v.startsWith('//')) return `https:${v}`;
    if (v.startsWith('http://')) return `https://${v.slice('http://'.length)}`;
    if (v.startsWith('https://')) return v;
    if (v.includes('ifood-static.com.br') || v.includes('ifood-static.com')) return `https://${v}`;
    return null;
  };

  const normalizeKey = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const repairMojibake = (value: any): any => {
    if (typeof value === 'string') {
      if (!/[ÃÂâ€]/.test(value)) return value;
      try {
        const bytes = new Uint8Array(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const originalBadness = (value.match(/[ÃÂ�]/g) || []).length;
        const decodedBadness = (decoded.match(/[ÃÂ�]/g) || []).length;
        return decodedBadness < originalBadness ? decoded : value;
      } catch {
        return value;
      }
    }
    if (Array.isArray(value)) return value.map(repairMojibake);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairMojibake(entry)]));
    }
    return value;
  };

  const mergeImportedMenus = (base: ImportedCategory[], enrich: ImportedCategory[]) => {
    const enrichProducts = new Map<string, ImportedProduct>();
    for (const c of enrich || []) {
      for (const p of c.items || []) {
        if (!p?.name) continue;
        enrichProducts.set(normalizeKey(p.name), p);
      }
    }
    return (base || []).map(cat => ({
      ...cat,
      items: (cat.items || []).map(p => {
        const e = enrichProducts.get(normalizeKey(p.name || ''));
        if (!e) return p;
        const merged: ImportedProduct = { ...p };
        if ((!merged.description || !merged.description.trim()) && e.description) merged.description = e.description;
        if ((!merged.image_url || !normalizeImageUrl(merged.image_url)) && e.image_url) merged.image_url = e.image_url;
        if ((!merged.price_variants || merged.price_variants.length === 0) && e.price_variants?.length) merged.price_variants = e.price_variants;
        if ((!merged.variants || merged.variants.length === 0) && e.variants?.length) merged.variants = e.variants;
        if ((!merged.variations || merged.variations.length === 0) && e.variations?.length) merged.variations = e.variations;
        return merged;
      })
    }));
  };

  const parseMenuText = (text: string) => {
    const lines = text.split('\n');
    const products: ImportedProduct[] = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const priceMatch = line.match(/(?:R\$\s*)?(\d+[,.]\d{2})/);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1].replace(',', '.'));
        const name = line.replace(priceMatch[0], '').replace(/[.\-_]{2,}/, '').trim();
        
        if (name && price > 0) {
          products.push({ name, price });
        }
      }
    }
    
    return [{ name: "Geral", items: products }];
  };

  const normalizeImportedProduct = (raw: any): ImportedProduct => {
    const variants = raw?.variants || raw?.variantes || raw?.price_variants || raw?.precos || [];
    const variations = raw?.variations || raw?.variacoes || raw?.complementos || raw?.addons || [];
    return {
      name: String(raw?.name || raw?.nome || raw?.title || raw?.titulo || '').trim(),
      price: Number(raw?.price ?? raw?.preco ?? raw?.valor ?? raw?.amount ?? 0) || 0,
      description: String(raw?.description || raw?.descricao || raw?.details || raw?.detalhes || '').trim(),
      image_url: raw?.image_url || raw?.imagem || raw?.image || raw?.foto || raw?.url_imagem || '',
      available: raw?.available ?? raw?.ativo,
      variants: Array.isArray(variants) ? variants.map((variant: any) => ({
        name: String(variant?.name || variant?.nome || variant?.title || '').trim(),
        price: Number(variant?.price ?? variant?.preco ?? variant?.valor ?? 0) || 0,
      })) : [],
      variations: Array.isArray(variations) ? variations.map((group: any) => ({
        name: String(group?.name || group?.nome || group?.title || 'Adicionais').trim(),
        required: Boolean(group?.required ?? group?.obrigatorio ?? Number(group?.min_selections ?? group?.minimo ?? group?.min ?? 0) > 0),
        min_selections: Math.max(0, Number(group?.min_selections ?? group?.minimo ?? group?.min ?? 0) || 0),
        max_selections: Math.max(1, Number(group?.max_selections ?? group?.maximo ?? group?.max ?? 1) || 1),
        options: Array.isArray(group?.options || group?.opcoes || group?.items || group?.itens)
          ? (group?.options || group?.opcoes || group?.items || group?.itens).map((option: any) => ({
              name: String(option?.name || option?.nome || option?.title || '').trim(),
              price: Number(option?.price ?? option?.preco ?? option?.valor ?? 0) || 0,
            }))
          : [],
      })) : [],
    };
  };

  const centsToMoney = (value: any) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return numeric / 100;
  };

  const normalizeImportedMenu = (rawJson: any): NormalizedMenuResult => {
    const json = repairMojibake(rawJson || {});
    const complements = Array.isArray(json?.complementos) ? json.complementos : [];
    const complementsById = new Map<string, any>();
    for (const complement of complements) {
      const id = String(complement?.id ?? complement?.codigo ?? complement?.uuid ?? '').trim();
      if (id) complementsById.set(id, complement);
    }

    const normalizeStats = (categories: ImportedCategory[], stats?: Partial<MenuImportStats>): NormalizedMenuResult => ({
      categories,
      stats: {
        categoriesFound: stats?.categoriesFound ?? categories.length,
        productsFound: stats?.productsFound ?? categories.reduce((sum, category) => sum + (category.items?.length || 0), 0),
        complementsFound: stats?.complementsFound ?? complements.length,
        groupedProducts: stats?.groupedProducts ?? categories.reduce((sum, category) => sum + (category.items?.length || 0), 0),
      },
    });

    if (Array.isArray(json?.categories)) {
      return normalizeStats(json.categories.map((cat: any) => ({
        name: cat.category || cat.categoria || cat.nome || cat.name || cat.title || 'Geral',
        items: (Array.isArray(cat.products)
          ? cat.products
          : Array.isArray(cat.produtos)
            ? cat.produtos
            : Array.isArray(cat.itens)
              ? cat.itens
              : Array.isArray(cat.items)
                ? cat.items
                : []).map(normalizeImportedProduct).filter((product: ImportedProduct) => product.name),
      })));
    }

    if (!Array.isArray(json) && Array.isArray(json?.products || json?.produtos || json?.items || json?.itens)) {
      const products = json.products || json.produtos || json.items || json.itens;
      return normalizeStats([{
        name: json?.category || json?.categoria || json?.name || json?.nome || 'Geral',
        items: products.map(normalizeImportedProduct).filter((product: ImportedProduct) => product.name),
      }], {
        categoriesFound: 1,
        productsFound: products.length,
        complementsFound: complements.length,
        groupedProducts: products.length,
      });
    }

    const rawCategories = Array.isArray(json)
      ? json
      : (json?.categorias || json?.menu || json?.sections || []);

    if (Array.isArray(json?.categorias) && Array.isArray(json?.produtos)) {
      const categories = json.categorias;
      const products = json.produtos;
      const categoryById = new Map<string, ImportedCategory>();

      for (const category of categories) {
        const id = String(category?.id ?? category?.categoria_id ?? category?.codigo ?? category?.uuid ?? '').trim();
        const name = String(category?.nome || category?.name || category?.titulo || 'Geral').trim() || 'Geral';
        const normalizedCategory = { name, items: [] as ImportedProduct[] };
        categoryById.set(id || normalizeKey(name), normalizedCategory);
      }

      const fallbackCategory: ImportedCategory = { name: 'Geral', items: [] };
      let groupedProducts = 0;

      for (const product of products) {
        const categoryId = String(product?.categoria_id ?? product?.category_id ?? product?.categoriaId ?? '').trim();
        const targetCategory = categoryById.get(categoryId) || fallbackCategory;
        const complementIds = Array.isArray(product?.complementos_ids)
          ? product.complementos_ids
          : Array.isArray(product?.complemento_ids)
            ? product.complemento_ids
            : Array.isArray(product?.complements_ids)
              ? product.complements_ids
              : [];

        const variations = complementIds
          .map((id: any) => complementsById.get(String(id).trim()))
          .filter(Boolean)
          .map((complement: any): ImportedVariationGroup => {
            const options = Array.isArray(complement?.opcoes || complement?.options)
              ? (complement.opcoes || complement.options)
              : [];
            const minSelections = Math.max(
              0,
              Number(complement?.min_escolhas ?? complement?.min_selections ?? complement?.min ?? 0) || 0,
            );
            return {
              name: String(complement?.nome || complement?.name || 'Adicionais').trim() || 'Adicionais',
              required: Boolean(complement?.obrigatorio ?? complement?.required ?? minSelections > 0),
              min_selections: minSelections,
              max_selections: Math.max(
                1,
                minSelections,
                Number(complement?.max_escolhas ?? complement?.max_selections ?? complement?.max ?? 10) || 10,
              ),
              options: options.map((option: any) => ({
                name: String(option?.titulo || option?.nome || option?.name || '').trim(),
                price: centsToMoney(option?.preco_extra ?? option?.price ?? option?.preco ?? 0),
              })).filter((option: ImportedVariant) => option.name),
            };
          })
          .filter((variation: ImportedVariationGroup) => variation.options.length > 0);

        const normalizedProduct: ImportedProduct = {
          name: String(product?.nome || product?.name || product?.titulo || '').trim(),
          description: String(product?.descricao || product?.description || '').trim(),
          price: centsToMoney(product?.preco ?? product?.price ?? product?.valor ?? 0),
          image_url: product?.imagem || product?.image_url || product?.image || product?.foto || '',
          available: product?.ativo ?? product?.available,
          variations,
        };

        if (!normalizedProduct.name) continue;
        targetCategory.items.push(normalizedProduct);
        groupedProducts += 1;
      }

      const normalizedCategories = Array.from(categoryById.values()).filter(category => category.items.length > 0);
      if (fallbackCategory.items.length > 0) normalizedCategories.push(fallbackCategory);

      return normalizeStats(normalizedCategories, {
        categoriesFound: categories.length,
        productsFound: products.length,
        complementsFound: complements.length,
        groupedProducts,
      });
    }

    if (Array.isArray(rawCategories)) {
      return normalizeStats(rawCategories.map((cat: any) => ({
        name: cat.category || cat.categoria || cat.nome || cat.name || cat.title || 'Geral',
        items: (Array.isArray(cat.products)
          ? cat.products
          : Array.isArray(cat.produtos)
            ? cat.produtos
            : Array.isArray(cat.itens)
              ? cat.itens
              : Array.isArray(cat.items)
                ? cat.items
                : []).map(normalizeImportedProduct).filter((product: ImportedProduct) => product.name),
      })));
    }

    return normalizeStats([]);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const resetLinkPreview = () => setLinkPreview(null);

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          const MAX_SIZE = 900; 
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);
          
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.75);
          resolve(compressedBase64);
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = error => reject(error);
    });
  };

  const invokeScrapeMenuWithRetry = async (body: any, retries = 2) => {
    let last: { data: any | null; status: number } = { data: null, status: 500 };
    for (let i = 0; i <= retries; i++) {
      last = await invokeEdgeFunction('scrape-menu', body);
      if (last.status === 200) return last;
      await new Promise<void>(resolve => window.setTimeout(resolve, 600 + i * 600));
    }
    return last;
  };

  const pollForResults = async (runId: string): Promise<ImportedCategory[]> => {
      const POLL_INTERVAL = 5000; // 5 segundos
      const MAX_ATTEMPTS = 60; // 5 minutos máximo
      let attempts = 0;
      let consecutiveFailures = 0;

      return new Promise((resolve, reject) => {
          const checkStatus = async () => {
              if (cancelRef.current) {
                reject(new Error('Cancelado.'));
                return;
              }
              attempts++;
              setLoadingMessage(`Extraindo cardápio... (${attempts}s)`);
              
              try {
                  const { data, status } = await invokeEdgeFunction('scrape-menu', { 
                      action: 'check', 
                      runId: runId 
                  });

                  // 1. Erro de Rede ou Status HTTP (não 200)
                  if (status !== 200) {
                      consecutiveFailures++;
                      // Se for erro 500 (interno), geralmente é falha fatal se não tiver success: true
                      console.warn('Erro HTTP ao checar status:', status, data);
                      if (consecutiveFailures >= 3) {
                        reject(new Error(data?.error || 'Falha de rede ao consultar o servidor. Tente novamente.'));
                        return;
                      }
                      // Tentar novamente (pode ser instabilidade)
                  } 
                  
                  // 2. Erro Lógico retornado pelo Backend
                  else if (!data.success) {
                      try {
                        console.error('[Import] scrape-menu falhou:', { runId, data });
                      } catch {}
                      // Se o backend diz que falhou, PARAR IMEDIATAMENTE.
                      // Isso evita o loop infinito quando o backend retorna "Dataset vazio" ou "Erro Apify".
                      const details = data?.debug?.datasetId ? ` (runId: ${runId}, dataset: ${data.debug.datasetId})` : ` (runId: ${runId})`;
                      reject(new Error(`${data.error || 'Falha desconhecida na extração.'}${details}`));
                      return;
                  }
                  
                  // 3. Status Específico do Job
                  else if (data.status === 'failed') {
                      const details = data?.debug?.datasetId ? ` (runId: ${runId}, dataset: ${data.debug.datasetId})` : ` (runId: ${runId})`;
                      reject(new Error(`${data.error || 'O processo de extração falhou.'}${details}`));
                      return;
                  }
                  else if (data.status === 'completed') {
                      resolve(data.categories || []);
                      return;
                  }
                  else {
                      consecutiveFailures = 0;
                  }
                  
                  // 4. Timeout Frontend
                  if (attempts >= MAX_ATTEMPTS) {
                      reject(new Error('Tempo limite excedido (5 minutos).'));
                      return;
                  }

                  // 5. Tentar novamente (status: processing ou erro de rede)
                  if (!cancelRef.current) setTimeout(checkStatus, POLL_INTERVAL);

              } catch (e) {
                  console.error('Erro no polling:', e);
                  // Continuar tentando mesmo com erro de rede
                  consecutiveFailures++;
                  if (attempts >= MAX_ATTEMPTS || consecutiveFailures >= 3) {
                      reject(e);
                      return;
                  }
                  if (!cancelRef.current) setTimeout(checkStatus, POLL_INTERVAL);
              }
          };

          checkStatus();
      });
  };

  const handleImport = async () => {
    if (activeTab === 'text' && !textInput.trim()) {
        toast({ title: 'Atenção', description: 'Cole o texto do cardápio.', variant: 'destructive' });
        return;
    }
    if (activeTab === 'json' && !jsonInput.trim()) {
        toast({ title: 'Atenção', description: 'Cole os dados do cardápio.', variant: 'destructive' });
        return;
    }
    if (activeTab === 'link' && !urlInput.trim()) {
        toast({ title: 'Atenção', description: 'Insira um link válido.', variant: 'destructive' });
        return;
    }
    if (activeTab === 'link' && urlInput.trim() && !isValidUrl(urlInput)) {
        toast({ title: 'Atenção', description: 'O valor informado não é uma URL válida. Use a aba Texto para colar descrições.', variant: 'destructive' });
        return;
    }
    if (activeTab === 'image' && !selectedImage) {
        toast({ title: 'Atenção', description: 'Selecione uma imagem.', variant: 'destructive' });
        return;
    }

    setLoading(true);
    setLoadingMessage('Iniciando...');
    console.log(`[Import] Iniciando importação...`, activeTab);

    try {
      let categoriesToImport: ImportedCategory[] = [];

      if (activeTab === 'text') {
        setLoadingMessage('Processando texto...');
        const normalizedText = String(repairMojibake(textInput) || '');
        const { data, status } = await invokeEdgeFunction('scrape-menu', {
          type: 'text',
          data: normalizedText,
          action: 'start'
        });
        if (status !== 200 || !data.success) {
          categoriesToImport = parseMenuText(normalizedText);
        } else {
          categoriesToImport = data.categories || [];
        }
      } 
      else if (activeTab === 'json') {
        setLoadingMessage('Validando dados...');
        try {
          const parsed = repairMojibake(JSON.parse(jsonInput));
          const normalized = normalizeImportedMenu(parsed);
          console.log('[Import JSON] categorias encontradas:', normalized.stats.categoriesFound);
          console.log('[Import JSON] produtos encontrados:', normalized.stats.productsFound);
          console.log('[Import JSON] complementos encontrados:', normalized.stats.complementsFound);
          console.log('[Import JSON] produtos agrupados:', normalized.stats.groupedProducts);

          if (normalized.stats.categoriesFound <= 0 || normalized.categories.length <= 0) {
            throw new Error('Não encontrei categorias nesse JSON. Verifique se o arquivo tem categories ou categorias.');
          }

          if (normalized.stats.productsFound <= 0 || normalized.stats.groupedProducts <= 0) {
            throw new Error('Não encontrei produtos nesse JSON. Verifique se o arquivo tem produtos/items dentro das categorias.');
          }

          categoriesToImport = normalized.categories;

        } catch (e) {
          const message = e instanceof Error ? e.message : 'Formato inválido. Verifique se copiou corretamente.';
          throw new Error(message);
        }
      }
      else if (activeTab === 'link') {
        const structuredPlatform = structuredMenuPlatform(urlInput);
        if (structuredPlatform) {
          setLoadingMessage('Analisando cardápio...');
          const { data, status } = await invokeEdgeFunction('menu-importer', {
            action: 'analyze',
            url: urlInput.trim(),
          }, { timeoutMs: 120000 });

          if (status !== 200 || !data?.success) {
            const errorMessage = data?.error || 'Não foi possível analisar esse link.';
            if (structuredPlatform === 'brendi' && isAuthImportError(errorMessage)) {
              categoriesToImport = await importBrendiViaCompatibleFlow(urlInput.trim());
            } else {
              throw new Error(errorMessage);
            }
          } else {
            setLinkPreview({
              platform: data.platform,
              restaurant: data.restaurant,
              stats: data.stats,
              preview: data.preview,
            });
            toast({
              title: 'Cardápio encontrado',
              description: `${data.stats.products} produtos, ${data.stats.categories} categorias e ${data.stats.deliveryRegions} bairros encontrados.`,
            });
            return;
          }
        }

        // 1. Iniciar Job (Async)
        setLoadingMessage('Extraindo dados...');
        const { data: startData, status: startStatus } = await invokeEdgeFunction('scrape-menu', { 
            type: 'url', 
            data: urlInput,
            action: 'start'
        });

        if (startStatus !== 200 || !startData.success) {
            throw new Error(startData?.error || 'Não foi possível iniciar a leitura.');
        }

        const runId = startData.runId;
        
        // 2. Se retornou runId, fazer Polling
        if (runId) {
            console.log('[Import] Job iniciado. RunID:', runId);
            categoriesToImport = await pollForResults(runId);
        } else if (startData.categories && startData.categories.length > 0) {
            // Fallback imediato se não precisar de polling
            categoriesToImport = startData.categories;
        } else {
            throw new Error('Não foi possível extrair o cardápio. Verifique se o link está correto e público.');
        }
      }
      else if (activeTab === 'image') {
         setLoadingMessage('Lendo texto da imagem...');
         const optimizedBase64 = await convertFileToBase64(selectedImage!);
         let extractedText = '';
         try {
           const res = await Tesseract.recognize(optimizedBase64, 'por', {
             logger: (m: any) => {
               if (m?.status === 'recognizing text' && typeof m?.progress === 'number') {
                 setLoadingMessage(`Lendo texto da imagem... ${Math.round(m.progress * 100)}%`);
               }
             }
           });
           extractedText = String(repairMojibake(res?.data?.text || '') || '').trim();
         } catch {}

         if (extractedText) {
           setLoadingMessage('Estruturando cardápio...');
           const { data, status } = await invokeEdgeFunction('scrape-menu', {
             type: 'text',
             data: extractedText,
             action: 'start'
           });
           if (status === 200 && data.success) {
             categoriesToImport = data.categories || [];
           }
         }

         const hasAnyVariantsOrAddons = (categoriesToImport || []).some((c: ImportedCategory) =>
           (c.items || []).some((p: ImportedProduct) =>
             (p.price_variants && p.price_variants.length > 0) ||
             (p.variants && p.variants.length > 0) ||
             (p.variations && p.variations.length > 0)
           )
         );

         if (categoriesToImport.length === 0) {
           setLoadingMessage('Processando imagem...');
           const { data, status } = await invokeEdgeFunction('scrape-menu', { 
              type: 'image',
              data: optimizedBase64,
              action: 'start'
           });
           if (status !== 200 || !data.success) {
               throw new Error(data?.error || 'Erro ao processar imagem.');
           }
           categoriesToImport = data.categories || [];
         } else if (!hasAnyVariantsOrAddons) {
           setLoadingMessage('Procurando variações e adicionais...');
           const { data, status } = await invokeScrapeMenuWithRetry({ 
              type: 'image',
              data: optimizedBase64,
              action: 'start'
           });
           if (status === 200 && data?.success && Array.isArray(data.categories) && data.categories.length > 0) {
             categoriesToImport = mergeImportedMenus(categoriesToImport, data.categories);
           }
         }
      }

      if (categoriesToImport.length === 0) {
        throw new Error('Nenhum produto encontrado.');
      }

      categoriesToImport = repairMojibake(categoriesToImport);
      
      console.log('[Import] Sucesso! Importando para o banco...');
      setLoadingMessage('Salvando produtos...');

      let totalProducts = 0;
      let totalImages = 0;
      let totalProductsUpdated = 0;
      let totalAddonGroupsLinked = 0;
      let totalAddonGroupsCreated = 0;
      let totalAddonErrors = 0;

      const normalizeOptionsToString = (raw: any) => {
        let arr: any[] = [];
        if (!raw) arr = [];
        else if (typeof raw === 'string') {
          try { arr = JSON.parse(raw); } catch { arr = []; }
        } else if (Array.isArray(raw)) {
          arr = raw;
        } else if (typeof raw === 'object') {
          arr = Object.entries(raw).map(([name, price]) => ({ name, price }));
        }
        const normalized = (arr || [])
          .map((o: any) => ({
            name: normalizeComplementOptionName(String(o?.name || '')),
            price: Number(o?.price) >= 0 ? Number(o?.price) : 0
          }))
          .filter((o: any) => o.name);
        normalized.sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));
        return JSON.stringify(normalized);
      };

      const keyForGlobalVariation = (name: string, options: any) =>
        `${normalizeKey(name)}|${normalizeOptionsToString(options)}`;

      const globalVariationByKey = new Map<string, string>();
      try {
        const { data: existingGlobals } = await supabase
          .from('global_variations')
          .select('id,name,options')
          .eq('user_id', user?.id);
        for (const gv of (existingGlobals || []) as any[]) {
          const k = keyForGlobalVariation(String(gv?.name || ''), gv?.options);
          if (k) globalVariationByKey.set(k, String(gv.id));
        }
      } catch {}

      const syncProductVariations = async (productId: string, product: ImportedProduct) => {
        if (!product.variations || product.variations.length === 0) return;

        for (const v of product.variations || []) {
          const groupName = String(v?.name || '').trim();
          if (!groupName) continue;
          const optionsString = normalizeOptionsToString(v?.options);
          const optionsArr: any[] = (() => { try { return JSON.parse(optionsString); } catch { return []; } })();
          if (!Array.isArray(optionsArr) || optionsArr.length === 0) continue;

          const key = `${normalizeKey(groupName)}|${optionsString}`;
          let globalId = globalVariationByKey.get(key);
          const minSelections = Math.max(0, Number(v?.min_selections) || 0);
          const maxSelections = Math.max(1, minSelections, Number(v?.max_selections) || 1);
          const required = Boolean(v?.required) || minSelections > 0;

          if (!globalId) {
            try {
              const { data: created, error: createError } = await supabase
                .from('global_variations')
                .insert({
                  user_id: user?.id,
                  name: groupName,
                  required,
                  max_selections: maxSelections,
                  options: optionsString,
                  description: ''
                })
                .select('id')
                .single();
              if (!createError && created?.id) {
                globalId = String(created.id);
                globalVariationByKey.set(key, globalId);
                totalAddonGroupsCreated++;
              }
            } catch (e) {
              totalAddonErrors++;
              continue;
            }
          }

          if (globalId) {
            try {
              await (supabase as any)
                .from('product_global_variation_links')
                .upsert(
                  {
                    product_id: productId,
                    global_variation_id: globalId,
                    required,
                    min_selections: minSelections,
                    max_selections: maxSelections,
                  },
                  { onConflict: 'product_id,global_variation_id' }
                );
              totalAddonGroupsLinked++;
            } catch (e) {
              totalAddonErrors++;
            }
          }
        }
      };

      // Salvamento no Banco (igual ao anterior)
      for (const category of categoriesToImport) {
        let categoryId: string | null = null;

        if (category.name && category.name !== 'Geral') {
            const { data: existingCat } = await supabase
                .from('product_categories')
                .select('id')
                .eq('user_id', user?.id)
                .eq('name', category.name)
                .maybeSingle();
            
            if (existingCat) {
                categoryId = existingCat.id;
            } else {
                const { data: newCat, error: catError } = await supabase
                    .from('product_categories')
                    .insert({ user_id: user?.id, name: category.name })
                    .select('id')
                    .single();
                
                if (!catError && newCat) categoryId = newCat.id;
            }
        }

        for (const product of category.items) {
            if (!product || !product.name) continue; // Pula produtos nulos ou sem nome

            const priceVariants = (product.price_variants && product.price_variants.length > 0)
              ? product.price_variants
              : (product.variants || []);

            const normalizedPriceVariants = (priceVariants || [])
              .filter(v => v && String(v.name || '').trim())
              .map(v => ({
                name: String(v.name).trim(),
                price: Number(v.price) || 0
              }))
              .filter(v => v.price > 0);

            const effectiveBasePrice =
              Number(product.price) > 0
                ? Number(product.price)
                : (normalizedPriceVariants.length > 0
                    ? Math.min(...normalizedPriceVariants.map(v => v.price))
                    : 0);
            const normalizedImageUrl = normalizeImageUrl(product.image_url);
            const productAvailable = product.available !== false;

            const { data: existingProduct } = await supabase
                .from('products')
                .select('id')
                .eq('user_id', user?.id)
                .eq('name', product.name)
                .maybeSingle();

            if (existingProduct?.id) {
                try {
                  await supabase
                    .from('products')
                    .update({
                      price: effectiveBasePrice,
                      description: product.description ? product.description.toLowerCase() : '',
                      image_url: normalizedImageUrl,
                      category: category.name || 'Geral',
                      category_id: categoryId,
                      available: productAvailable,
                      is_available: productAvailable,
                      show_in_pdv: productAvailable,
                      show_in_delivery: productAvailable
                    })
                    .eq('id', existingProduct.id)
                    .eq('user_id', user?.id);
                  totalProductsUpdated++;
                } catch (updateError) {
                  console.error('[Import] Erro ao atualizar produto existente:', product.name, updateError);
                }

                await syncProductVariations(String(existingProduct.id), product);
                continue;
            }

            const { data: newProduct, error: prodError } = await supabase
                .from('products')
                .insert({
                    user_id: user?.id,
                    name: product.name,
                    price: effectiveBasePrice,
                    description: product.description ? product.description.toLowerCase() : '',
                    image_url: normalizedImageUrl,
                    category: category.name || 'Geral',
                    category_id: categoryId,
                    available: productAvailable,
                    is_available: productAvailable,
                    show_in_pdv: productAvailable,
                    show_in_delivery: productAvailable
                })
                .select('id')
                .single();

            if (prodError) {
                console.error('[Import] Erro ao inserir produto:', product.name, prodError);
                continue; // Pula para o próximo se der erro
            }

            if (!prodError && newProduct) {
                totalProducts++;
                if (normalizedImageUrl) totalImages++;
                if (normalizedPriceVariants.length > 0) {
                    const variantsData = normalizedPriceVariants.map(v => ({
                        product_id: newProduct.id,
                        name: v.name,
                        price: v.price
                    }));
                    try {
                        await (supabase as any).from('product_variants').insert(variantsData);
                    } catch (varError) {
                        console.error('Error inserting variants:', varError);
                    }
                }

                await syncProductVariations(String(newProduct.id), product);
            }
        }
      }

      if (totalProducts === 0 && totalProductsUpdated === 0 && totalAddonGroupsLinked === 0) {
        throw new Error('Nenhum produto novo foi criado. Verifique se o JSON tem produtos válidos ou se esses produtos já existem no sistema.');
      }

      const addonsSummary = `${totalAddonGroupsLinked} adicionais encontrados` + (totalAddonGroupsCreated > 0 ? ` (${totalAddonGroupsCreated} novos)` : '');
      const addonsErrorsSummary = totalAddonErrors > 0 ? ` • ${totalAddonErrors} falhas em adicionais` : '';
      toast({
        title: 'Encontramos seu cardápio',
        description: `${totalProducts} produtos novos${totalProductsUpdated > 0 ? `, ${totalProductsUpdated} atualizados` : ''}. ${totalImages} imagens. ${addonsSummary}${addonsErrorsSummary}.`,
      });
      
      onImportComplete();
      onClose();
      setTextInput('');
      setJsonInput('');
      setSelectedImage(null);
      setImagePreview(null);
      setUrlInput('');
      setLinkPreview(null);
      
    } catch (error: any) {
      console.error('[Import] Erro:', error);
      toast({
        title: 'Erro na importação',
        description: error?.message || 'Erro desconhecido.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
      setLoadingMessage('Processando...');
    }
  };

  const applyLinkImport = async (replace: boolean) => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setLoadingMessage(replace ? 'Substituindo cardápio...' : 'Importando cardápio...');

    try {
      const { data, status } = await invokeEdgeFunction('menu-importer', {
        action: 'apply',
        url: urlInput.trim(),
        replace,
      }, { timeoutMs: 180000 });

      if (status !== 200 || !data?.success) {
        throw new Error(data?.error || 'Não foi possível importar esse cardápio.');
      }

      toast({
        title: 'Cardápio importado',
        description: `${data.result.productsCreated} produtos, ${data.result.globalVariationsCreated} complementos e ${data.stats.deliveryRegions} bairros importados.`,
      });

      onImportComplete();
      onClose();
      setUrlInput('');
      setLinkPreview(null);
    } catch (error: any) {
      toast({
        title: 'Erro na importação',
        description: error?.message || 'Erro desconhecido.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setLoadingMessage('Processando...');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-purple-600" />
            Migrar Cardápio com IA
          </DialogTitle>
          <DialogDescription>
            Cole o link, envie uma foto ou importe um JSON do cardápio. O PopSystem organiza tudo automaticamente.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
            <TabsTrigger value="text" className="text-xs"><Type className="w-4 h-4 mr-1" /> Texto</TabsTrigger>
            <TabsTrigger value="json" className="text-xs"><FileJson className="w-4 h-4 mr-1" /> JSON</TabsTrigger>
            <TabsTrigger value="link" className="text-xs"><LinkIcon className="w-4 h-4 mr-1" /> Link</TabsTrigger>
            <TabsTrigger value="image" className="text-xs"><Upload className="w-4 h-4 mr-1" /> Foto</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cole o texto do cardápio</Label>
              <Textarea 
                placeholder="Ex: X-Bacon ... R$ 25,00&#10;Coca-Cola ... R$ 6,00"
                className="h-40"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="json" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cole o JSON do cardápio</Label>
              <Textarea
                placeholder={`{\n  "categories": [\n    {\n      "name": "Lanches",\n      "items": [\n        { "name": "X-Bacon", "price": 25.00, "description": "..." }\n      ]\n    }\n  ]\n}`}
                className="h-40 font-mono text-xs"
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
              />
              <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
                <FileJson className="h-4 w-4" />
                <span>Aceita categorias com <strong>items</strong>, <strong>products</strong>, <strong>itens</strong> ou <strong>produtos</strong>.</span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="link" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Link do Cardápio</Label>
              <Input 
                placeholder="https://..." 
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  resetLinkPreview();
                }}
              />
              <div className="flex items-center gap-2 p-3 bg-purple-50 text-purple-800 rounded-md text-xs border border-purple-100">
                <Wand2 className="w-4 h-4" />
                <span>Links MiniChef, MenuDino, Brendi, Anota.ai, OlaClick e CardapioWeb são importados automaticamente com produtos, imagens e complementos.</span>
              </div>
              {linkPreview && (
                <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div>
                    <p className="text-sm font-bold text-emerald-950">Prévia encontrada</p>
                    <p className="text-xs text-emerald-800">
                      {linkPreview.restaurant?.name || 'Restaurante'} {linkPreview.restaurant?.address ? `• ${linkPreview.restaurant.address}` : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.categories}</p>
                      <p className="text-xs text-emerald-700">categorias</p>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.products}</p>
                      <p className="text-xs text-emerald-700">produtos</p>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.productsWithImages}</p>
                      <p className="text-xs text-emerald-700">imagens</p>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.variationLinks}</p>
                      <p className="text-xs text-emerald-700">complementos</p>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.deliveryRegions}</p>
                      <p className="text-xs text-emerald-700">bairros</p>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="text-xl font-bold text-emerald-950">{linkPreview.stats.banners}</p>
                      <p className="text-xs text-emerald-700">banners</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-white p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Categorias</p>
                      <div className="space-y-1">
                        {(linkPreview.preview?.categories || []).slice(0, 6).map((category) => (
                          <div key={category.name} className="flex justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-slate-900">{category.name}</span>
                            <span className="shrink-0 text-slate-500">{category.products} itens</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Produtos</p>
                      <div className="space-y-1">
                        {(linkPreview.preview?.products || []).slice(0, 6).map((product) => (
                          <div key={`${product.category}-${product.name}`} className="flex justify-between gap-3 text-sm">
                            <span className="truncate font-medium text-slate-900">{product.name}</span>
                            <span className="shrink-0 text-slate-500">{formatCurrency(product.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="image" className="space-y-4 py-4">
            <div className="border-2 border-dashed border-gray-300 rounded-lg h-48 flex flex-col items-center justify-center text-gray-500 relative overflow-hidden bg-gray-50">
              {imagePreview ? (
                <>
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-contain opacity-50" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Button variant="secondary" size="sm" className="shadow-lg" onClick={() => {
                        setSelectedImage(null);
                        setImagePreview(null);
                    }}>
                      Trocar Imagem
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 mb-2" />
                  <p className="text-sm">Clique para enviar foto do cardápio</p>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={handleImageSelect}
                  />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              cancelRef.current = true;
              setLoading(false);
              setLoadingMessage('Processando...');
              onClose();
            }}
          >
            Cancelar
          </Button>
          {activeTab === 'link' && linkPreview ? (
            <>
              <Button variant="outline" onClick={() => applyLinkImport(false)} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PlusCircle className="w-4 h-4 mr-2" />}
                Somar sem apagar
              </Button>
              <Button onClick={() => applyLinkImport(true)} disabled={loading} className="bg-orange-600 hover:bg-orange-700">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Substituir cardápio
              </Button>
            </>
          ) : (
            <Button onClick={handleImport} disabled={loading} className={activeTab !== 'text' ? "bg-purple-600 hover:bg-purple-700" : ""}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {loading ? loadingMessage : 'Analisar Cardápio'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MenuImportModal;
