import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Plus, DollarSign, Upload, FileText, Search, Undo2, Sparkles, PackageCheck, Tags, ListFilter, ReceiptText, Download, Eye, Paperclip, XCircle, AlertTriangle, Trash2, ScanSearch, PencilLine } from 'lucide-react';
import { addMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CurrencyTextInput } from '@/components/ui/currency-text-input';
import { parseBRL } from '@/lib/currency';
import { useLocation } from 'react-router-dom';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import { ReverseExpenseDialog } from '@/components/finance/ReverseExpenseDialog';
import { PageHero } from '@/components/layout/PageHero';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PayablesTable } from '@/components/finance/PayablesTable';
import { Checkbox } from '@/components/ui/checkbox';
import { PURCHASE_UNITS, invoiceItemNeedsUnitConfirmation } from '@/lib/finance/purchaseInvoice';

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  expense_date: string;
  receipt_url?: string;
  receipt_path?: string | null;
  receipt_name?: string | null;
  receipt_mime_type?: string | null;
  user_id: string;
  created_at: string;
  is_active?: boolean;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  reversed_by?: string | null;
  reversed_by_waiter_id?: string | null;
  reversed_by_name?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  paid_amount?: number | null;
  status?: string | null;
  payable_group_id?: string | null;
  payable_origin_type?: 'single' | 'installment' | 'recurring' | 'purchase_invoice' | null;
  installment_number?: number | null;
  installment_count?: number | null;
  competence_date?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  cancelled_by_name?: string | null;
}

interface SmartInvoiceItem {
  local_id?: string;
  id?: string;
  description: string;
  normalized_name: string;
  category: string;
  subcategory?: string | null;
  quantity: number;
  unit: string;
  stock_unit: string;
  unit_price: number;
  total_price: number;
  confidence: number;
  similar_to?: string | null;
  control_stock: boolean;
  ingredient_id?: string | null;
  product_id?: string | null;
  stock_quantity_added?: number;
  product_quantity_added?: number;
  conversion_factor?: number;
  unit_source?: 'xml' | 'invoice' | 'catalog' | 'inferred' | 'unknown' | 'confirmed' | string;
  unit_confirmed?: boolean;
  inventory_kind?: 'ingredient' | 'resale_product' | 'packaging' | 'cleaning' | 'service' | 'other' | string;
  match_confidence?: number;
  matched_product_tracks_stock?: boolean;
  create_sale_product?: boolean;
}

interface SmartInvoiceImport {
  id: string;
  supplier_name?: string | null;
  supplier_document?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  total_amount: number;
  expense_category: string;
  status?: 'draft' | 'committed' | 'cancelled';
  expense_id?: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_mime_type?: string | null;
  attachment_size_bytes?: number | null;
  receipt_url?: string | null;
  created_at?: string;
  committed_at?: string | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  reversed_by_name?: string | null;
  launch_expense?: boolean;
  launch_stock?: boolean;
  due_date?: string | null;
  payment_method?: string | null;
}

const getExpenseDateKey = (exp: any) => {
  const raw = exp?.expense_date ?? exp?.date ?? exp?.created_at ?? '';
  return String(raw || '').slice(0, 10);
};

const FALLBACK_EXPENSE_CATEGORIES = ['Ingredientes', 'Bebidas', 'Embalagens', 'Aluguel', 'Energia', 'Água', 'Internet', 'Funcionários', 'Marketing', 'Manutenção', 'Impostos', 'Taxas', 'Outros'];

const newManualStockItem = (): SmartInvoiceItem => ({
  local_id: crypto.randomUUID(),
  description: '',
  normalized_name: '',
  category: 'Insumos',
  subcategory: '',
  quantity: 1,
  unit: 'un',
  stock_unit: 'un',
  conversion_factor: 1,
  unit_price: 0,
  total_price: 0,
  confidence: 0,
  match_confidence: 0,
  control_stock: true,
  unit_source: 'confirmed',
  unit_confirmed: true,
  inventory_kind: 'ingredient',
});

export default function Despesas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const smartInvoiceRef = useRef<HTMLDivElement | null>(null);
  const manualFormRef = useRef<HTMLDivElement | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filteredExpenses, setFilteredExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Form states
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dueDate, setDueDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [payableType, setPayableType] = useState<'single' | 'installment' | 'recurring'>('single');
  const [occurrenceCount, setOccurrenceCount] = useState('2');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [smartInvoiceFile, setSmartInvoiceFile] = useState<File | null>(null);
  const [smartInvoiceImport, setSmartInvoiceImport] = useState<SmartInvoiceImport | null>(null);
  const [smartInvoiceItems, setSmartInvoiceItems] = useState<SmartInvoiceItem[]>([]);
  const [smartInvoiceLoading, setSmartInvoiceLoading] = useState(false);
  const [smartInvoiceCommitting, setSmartInvoiceCommitting] = useState(false);
  const [smartLaunchExpense, setSmartLaunchExpense] = useState(true);
  const [smartLaunchStock, setSmartLaunchStock] = useState(true);
  const [purchaseInvoices, setPurchaseInvoices] = useState<SmartInvoiceImport[]>([]);
  const [attachmentBusyId, setAttachmentBusyId] = useState('');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<'all' | 'draft' | 'committed' | 'cancelled'>('all');
  const [purchaseDetails, setPurchaseDetails] = useState<{ invoice: SmartInvoiceImport; items: SmartInvoiceItem[] } | null>(null);
  const [purchaseDetailsLoading, setPurchaseDetailsLoading] = useState(false);
  const [purchaseToReverse, setPurchaseToReverse] = useState<SmartInvoiceImport | null>(null);
  const [financialCategories, setFinancialCategories] = useState<string[]>(FALLBACK_EXPENSE_CATEGORIES);
  const [financialCategoryRows, setFinancialCategoryRows] = useState<Array<{ id: string; name: string }>>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState('');
  const [competenceDate, setCompetenceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expenseNotes, setExpenseNotes] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [manualMovesStock, setManualMovesStock] = useState(false);
  const [manualStockItems, setManualStockItems] = useState<SmartInvoiceItem[]>([]);
  const [manualClassifying, setManualClassifying] = useState(false);

  useEffect(() => {
    if (!user) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    void Promise.all([loadExpenses(), loadPurchaseInvoices(), loadFinancialCategories()]);
  }, [user]);

  const loadFinancialCategories = async () => {
    if (!user?.id) return;
    const { data, error } = await (supabase as any).rpc('ensure_default_financial_categories', { p_store_user_id: user.id });
    if (error) {
      console.error('Error loading financial categories:', error);
      return;
    }
    const names = (data || []).map((row: any) => String(row.name || '').trim()).filter(Boolean);
    setFinancialCategoryRows((data || []).map((row: any) => ({ id: String(row.id), name: String(row.name || '').trim() })).filter((row: any) => row.id && row.name));
    if (names.length > 0) setFinancialCategories(names);
  };

  const renameFinancialCategory = async (row: { id: string; name: string }) => {
    const nextName = window.prompt('Novo nome da categoria:', row.name)?.trim();
    if (!nextName || nextName === row.name) return;
    try {
      const { error } = await (supabase as any).rpc('rename_financial_category', { p_category_id: row.id, p_new_name: nextName });
      if (error) throw error;
      await Promise.all([loadFinancialCategories(), loadExpenses()]);
      toast({ title: 'Categoria atualizada', description: 'Os lançamentos vinculados também foram atualizados.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível editar a categoria', description: friendlyErrorMessage(error, 'Tente novamente.'), variant: 'destructive' });
    }
  };

  const addFinancialCategory = async () => {
    if (!user?.id || !newCategoryName.trim()) return;
    setSavingCategory(true);
    try {
      const { error } = await (supabase as any).from('financial_categories').insert({
        user_id: user.id,
        name: newCategoryName.trim(),
        category_type: 'payable',
        created_by: user.id,
        updated_by: user.id,
      });
      if (error) throw error;
      setNewCategoryName('');
      await loadFinancialCategories();
      toast({ title: 'Categoria criada', description: 'A nova categoria já pode ser usada nas contas a pagar.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível criar a categoria', description: friendlyErrorMessage(error, 'Confira o nome e tente novamente.'), variant: 'destructive' });
    } finally {
      setSavingCategory(false);
    }
  };

  useEffect(() => {
    filterExpenses();
  }, [expenses, searchTerm, selectedCategory, dateFrom, dateTo]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('smartInvoice') !== '1') return;

    window.setTimeout(() => {
      smartInvoiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }, [location.search]);

  const loadExpenses = async () => {
    try {
      if (!user?.id) return;
      setLoading(true);
      await (supabase as any).rpc('refresh_my_payable_statuses');
      const base = () => supabase.from('expenses').select('*').eq('user_id', user.id);
      const first = await base().order('expense_date', { ascending: false });
      if (first.error) {
        const msg = String(first.error.message || '');
        const fallback = msg.includes('expense_date') || msg.includes('column') ? await base().order('created_at', { ascending: false }) : first;
        if (fallback.error) throw fallback.error;
        setExpenses((fallback.data as any[]) || []);
      } else {
        setExpenses((first.data as any[]) || []);
      }
    } catch (error) {
      console.error('Error loading expenses:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as despesas.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPurchaseInvoices = async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('smart_invoice_imports' as any)
      .select('id,supplier_name,supplier_document,invoice_number,invoice_date,due_date,payment_method,total_amount,expense_category,status,expense_id,attachment_path,attachment_name,attachment_mime_type,attachment_size_bytes,receipt_url,created_at,committed_at,reversed_at,reversal_reason,reversed_by_name,launch_expense,launch_stock')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('Error loading purchase invoices:', error);
      return;
    }
    setPurchaseInvoices((data || []) as unknown as SmartInvoiceImport[]);
  };

  const filterExpenses = () => {
    let filtered = expenses.filter((exp) => exp.is_active !== false || exp.status === 'cancelled');

    if (searchTerm) {
      filtered = filtered.filter(exp => 
        exp.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter(exp => exp.category === selectedCategory);
    }

    if (dateFrom) {
      filtered = filtered.filter(exp => getExpenseDateKey(exp) >= dateFrom);
    }

    if (dateTo) {
      filtered = filtered.filter(exp => getExpenseDateKey(exp) <= dateTo);
    }

    setFilteredExpenses(filtered);
  };

  const updateManualStockItem = (index: number, patch: Partial<SmartInvoiceItem>) => {
    setManualStockItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      if (patch.description !== undefined && !item.normalized_name.trim()) {
        next.normalized_name = patch.description;
      }
      if (patch.quantity !== undefined || patch.unit_price !== undefined) {
        next.total_price = Number(next.quantity || 0) * Number(next.unit_price || 0);
      }
      return next;
    }));
  };

  const classifyManualStockItems = async () => {
    if (!user?.id || manualStockItems.length === 0) return;
    const invalidItem = manualStockItems.find((item) => !String(item.normalized_name || item.description).trim());
    if (invalidItem) {
      toast({ title: 'Informe os produtos', description: 'Preencha o nome de cada item antes da identificação.', variant: 'destructive' });
      return;
    }
    setManualClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('smart-invoice-import', {
        body: { operation: 'classify-manual', userId: user.id, items: manualStockItems },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(String((data as any).error));
      setManualStockItems(((data as any)?.items || []).map((item: SmartInvoiceItem) => ({
        ...item,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        conversion_factor: Number(item.conversion_factor || 1),
        confidence: Number(item.confidence || 0),
        match_confidence: Number(item.match_confidence || 0),
        unit_confirmed: item.unit_confirmed !== false,
      })));
      toast({ title: 'Itens identificados', description: 'Tipo, categoria e produtos semelhantes foram conferidos pela IA.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível identificar', description: friendlyErrorMessage(error, 'Revise os itens manualmente.'), variant: 'destructive' });
    } finally {
      setManualClassifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?.id) return;
    if (!description.trim() || !amount || !category || !expenseDate || !dueDate) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Por favor, preencha todos os campos obrigatórios.',
        variant: 'destructive'
      });
      return;
    }
    const amountValue = parseBRL(amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toast({
        title: 'Valor inválido',
        description: 'A despesa deve ser maior que zero.',
        variant: 'destructive'
      });
      return;
    }
    const count = payableType === 'single' ? 1 : Math.max(2, Math.min(120, Number.parseInt(occurrenceCount, 10) || 0));
    if (payableType !== 'single' && (!Number.isInteger(count) || count < 2)) {
      toast({ title: 'Quantidade inválida', description: 'Informe ao menos 2 parcelas ou recorrências.', variant: 'destructive' });
      return;
    }
    if (manualMovesStock) {
      if (payableType !== 'single') {
        toast({ title: 'Compra com estoque deve ser avulsa', description: 'Registre os itens agora e parcele depois a obrigação financeira, se necessário.', variant: 'destructive' });
        return;
      }
      const invalidStockItem = manualStockItems.find((item) => (
        !String(item.normalized_name || item.description).trim()
        || Number(item.quantity) <= 0
        || Number(item.unit_price) < 0
        || Number(item.conversion_factor || 0) <= 0
      ));
      if (manualStockItems.length === 0 || invalidStockItem) {
        toast({ title: 'Revise os itens do estoque', description: 'Adicione ao menos um produto com nome, quantidade, unidade e custo válidos.', variant: 'destructive' });
        return;
      }
    }

    setIsSubmitting(true);

    try {
      let receiptUrl: string | undefined;
      let receiptPath: string | undefined;
      let receiptName: string | undefined;
      let receiptMimeType: string | undefined;

      // Upload receipt if provided
      if (receiptFile) {
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${user.id}/manual/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('purchase-invoice-attachments')
          .upload(filePath, receiptFile);

        if (uploadError) {
          throw new Error(`Não foi possível salvar o comprovante: ${uploadError.message}`);
        } else {
          receiptPath = filePath;
          receiptName = receiptFile.name;
          receiptMimeType = receiptFile.type;
        }
      }

      if (manualMovesStock) {
        const { data, error } = await supabase.functions.invoke('smart-invoice-import', {
          body: {
            operation: 'commit-manual',
            userId: user.id,
            launchExpense: true,
            launchStock: true,
            purchase: {
              description: description.trim(),
              total_amount: amountValue,
              expense_category: category,
              invoice_date: expenseDate,
              due_date: dueDate,
              competence_date: competenceDate,
              supplier_name: supplierName.trim() || null,
              payment_method: defaultPaymentMethod || null,
              notes: expenseNotes.trim() || null,
              cost_center: costCenter.trim() || null,
              attachment_path: receiptPath || null,
              attachment_name: receiptName || null,
              attachment_mime_type: receiptMimeType || null,
              attachment_size_bytes: receiptFile?.size || 0,
            },
            items: manualStockItems,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error(String((data as any).error));

        const stockEntries = Array.isArray((data as any)?.stock) ? (data as any).stock : [];
        const updatedProducts = stockEntries.filter((entry: any) => entry.product_updated === true).length;
        toast({
          title: 'Compra lançada com estoque',
          description: `${stockEntries.length} entrada(s) registrada(s)${updatedProducts ? ` e ${updatedProducts} produto(s) de venda atualizado(s)` : ''}.`,
        });
        setManualMovesStock(false);
        setManualStockItems([]);
      } else {

      // Cada parcela/competência é uma obrigação independente. Assim, a baixa de
      // uma nunca altera as demais ocorrências da mesma compra ou recorrência.
      const groupId = count > 1 ? crypto.randomUUID() : null;
      const baseDueDate = new Date(`${dueDate}T12:00:00`);
      const totalInCents = Math.round(amountValue * 100);
      const rows = Array.from({ length: count }, (_, index) => {
        const installmentCents = payableType === 'installment'
          ? Math.floor(totalInCents / count) + (index < totalInCents % count ? 1 : 0)
          : totalInCents;
        const occurrenceDueDate = format(addMonths(baseDueDate, index), 'yyyy-MM-dd');
        return {
          description: payableType === 'installment' ? `${description.trim()} · ${index + 1}/${count}` : description.trim(),
          amount: installmentCents / 100,
          category,
          receipt_url: receiptUrl,
          receipt_path: receiptPath,
          receipt_name: receiptName,
          receipt_mime_type: receiptMimeType,
          user_id: user.id,
          expense_date: count > 1 ? occurrenceDueDate : expenseDate,
          due_date: occurrenceDueDate,
          competence_date: count > 1 ? occurrenceDueDate : competenceDate,
          status: occurrenceDueDate < format(new Date(), 'yyyy-MM-dd') ? 'overdue' : 'open',
          paid_amount: 0,
          supplier_name: supplierName.trim() || null,
          payment_method: defaultPaymentMethod || null,
          notes: expenseNotes.trim() || null,
          cost_center: costCenter.trim() || null,
          created_by: user.id,
          updated_by: user.id,
          payable_group_id: groupId,
          payable_origin_type: payableType,
          installment_number: count > 1 ? index + 1 : null,
          installment_count: count > 1 ? count : null,
        };
      });

      const payloadBase: any = {
        ...rows[0],
      };

      const firstInsert = await supabase
        .from('expenses')
        .insert(rows as any);

      if (firstInsert.error) {
        const msg = String(firstInsert.error.message || '').toLowerCase();
        const mentionsExpenseDate = msg.includes('expense_date') || (msg.includes('column') && msg.includes('expense'));
        if (mentionsExpenseDate) {
          const retry = await supabase
            .from('expenses')
            .insert({ ...payloadBase, date: expenseDate } as any);
          if (retry.error) throw retry.error;
        } else {
          throw firstInsert.error;
        }
      }

      toast({
        title: 'Sucesso',
        description: count > 1
          ? `${count} ${payableType === 'installment' ? 'parcelas' : 'competências'} criadas separadamente.`
          : 'Conta a pagar registrada com sucesso.'
      });
      }

      // Reset form
      setDescription('');
      setAmount('');
      setCategory('');
      setExpenseDate(format(new Date(), 'yyyy-MM-dd'));
      setDueDate(format(new Date(), 'yyyy-MM-dd'));
      setCompetenceDate(format(new Date(), 'yyyy-MM-dd'));
      setPayableType('single');
      setOccurrenceCount('2');
      setReceiptFile(null);
      setSupplierName('');
      setDefaultPaymentMethod('');
      setExpenseNotes('');
      setCostCenter('');
      
      // Reload expenses
      await Promise.all([loadExpenses(), loadPurchaseInvoices()]);
    } catch (error: any) {
      console.error('Error registering expense:', error);
      toast({
        title: 'Erro',
        description: friendlyErrorMessage(error, 'Não foi possível registrar a despesa.'),
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type and size
      const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (!validTypes.includes(file.type)) {
        toast({
          title: 'Tipo de arquivo inválido',
          description: 'Aceitamos apenas JPG, PNG e PDF.',
          variant: 'destructive'
        });
        return;
      }

      if (file.size > maxSize) {
        toast({
          title: 'Arquivo muito grande',
          description: 'O comprovante deve ter no máximo 5MB.',
          variant: 'destructive'
        });
        return;
      }

      setReceiptFile(file);
    }
  };

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleSmartInvoiceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'application/xml', 'text/xml'];
    const isXml = file.name.toLowerCase().endsWith('.xml');
    const maxSize = 10 * 1024 * 1024;
    if (!validTypes.includes(file.type) && !isXml) {
      toast({
        title: 'Arquivo inválido',
        description: 'Envie JPG, PNG, PDF ou o XML da nota.',
        variant: 'destructive'
      });
      return;
    }
    if (file.size > maxSize) {
      toast({
        title: 'Arquivo muito grande',
        description: 'A nota deve ter no máximo 10 MB.',
        variant: 'destructive'
      });
      return;
    }
    setSmartInvoiceFile(file);
    setSmartInvoiceImport(null);
    setSmartInvoiceItems([]);
  };

  const analyzeSmartInvoice = async () => {
    if (!smartInvoiceFile) {
      toast({
        title: 'Selecione a nota',
        description: 'Envie uma imagem ou PDF para a IA processar.',
        variant: 'destructive'
      });
      return;
    }

    setSmartInvoiceLoading(true);
    try {
      const fileBase64 = await fileToBase64(smartInvoiceFile);
      const { data, error } = await supabase.functions.invoke('smart-invoice-import', {
        body: {
          operation: 'analyze',
          fileBase64,
          mimeType: smartInvoiceFile.type || (smartInvoiceFile.name.toLowerCase().endsWith('.xml') ? 'application/xml' : 'application/octet-stream'),
          fileName: smartInvoiceFile.name,
          fileSize: smartInvoiceFile.size,
          userId: user?.id,
        }
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(String((data as any).error));

      const analyzedImport = (data as any).import as SmartInvoiceImport;
      setSmartInvoiceImport({
        ...analyzedImport,
        expense_category: String(analyzedImport?.expense_category || '').toLowerCase() === 'insumos'
          ? 'Ingredientes'
          : analyzedImport?.expense_category || 'Outros',
      });
      setSmartInvoiceItems(((data as any).items || []).map((item: any) => ({
        ...item,
        quantity: Number(item.quantity || 1),
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        confidence: Number(item.confidence || 0),
        control_stock: item.control_stock !== false,
        conversion_factor: Number(item.conversion_factor || 1),
        unit_source: item.unit_source || 'unknown',
        unit_confirmed: item.unit_confirmed === true,
      })));
      toast({
        title: 'Nota processada',
        description: 'Confira os itens antes de lançar no financeiro e estoque.'
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao processar nota',
        description: error?.message || 'A IA não conseguiu ler essa nota.',
        variant: 'destructive'
      });
    } finally {
      setSmartInvoiceLoading(false);
    }
  };

  const updateSmartInvoiceItem = (index: number, patch: Partial<SmartInvoiceItem>) => {
    setSmartInvoiceItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      if (patch.quantity !== undefined || patch.unit_price !== undefined) {
        next.total_price = Number(next.quantity || 0) * Number(next.unit_price || 0);
      }
      return next;
    }));
  };

  const commitSmartInvoice = async () => {
    if (!smartInvoiceImport?.id || smartInvoiceItems.length === 0) {
      toast({ title: 'Nota não conferida', description: 'Processe ou abra uma nota em conferência antes de lançar.', variant: 'destructive' });
      return;
    }
    if (!smartLaunchExpense && !smartLaunchStock) {
      toast({ title: 'Escolha o destino', description: 'Ative o lançamento no financeiro, no estoque ou em ambos.', variant: 'destructive' });
      return;
    }
    const invalidItem = smartInvoiceItems.find((item) => !item.normalized_name.trim() || Number(item.quantity) <= 0 || Number(item.unit_price) < 0);
    if (invalidItem) {
      toast({ title: 'Revise os itens', description: 'Todos os itens precisam de nome, quantidade positiva e custo válido.', variant: 'destructive' });
      return;
    }
    const uncertainUnit = smartInvoiceItems.find((item) => smartLaunchStock && invoiceItemNeedsUnitConfirmation(item));
    if (uncertainUnit) {
      toast({ title: 'Confirme as unidades', description: `Revise a unidade de ${uncertainUnit.normalized_name} antes de movimentar o estoque.`, variant: 'destructive' });
      return;
    }
    setSmartInvoiceCommitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('smart-invoice-import', {
        body: {
          operation: 'commit',
          importId: smartInvoiceImport.id,
          userId: user?.id,
          launchExpense: smartLaunchExpense,
          launchStock: smartLaunchStock,
          items: smartInvoiceItems,
          purchase: smartInvoiceImport,
        }
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error(String((data as any).error));
      toast({
        title: 'Nota lançada',
        description: `Despesa e ${((data as any)?.stock || []).length} item(ns) de estoque processados.`
      });
      setSmartInvoiceFile(null);
      setSmartInvoiceImport(null);
      setSmartInvoiceItems([]);
      await Promise.all([loadExpenses(), loadPurchaseInvoices()]);
    } catch (error: any) {
      toast({
        title: 'Erro ao lançar nota',
        description: error?.message || 'Não foi possível concluir o lançamento.',
        variant: 'destructive'
      });
    } finally {
      setSmartInvoiceCommitting(false);
    }
  };

  const cancelDraftPurchaseInvoice = async () => {
    if (!smartInvoiceImport?.id) {
      setSmartInvoiceFile(null);
      setSmartInvoiceItems([]);
      return;
    }
    setSmartInvoiceCommitting(true);
    try {
      const { error } = await (supabase as any).rpc('cancel_purchase_invoice_draft', { p_import_id: smartInvoiceImport.id });
      if (error) throw error;
      setSmartInvoiceFile(null);
      setSmartInvoiceImport(null);
      setSmartInvoiceItems([]);
      await loadPurchaseInvoices();
      toast({ title: 'Operação cancelada', description: 'Nenhuma conta ou movimentação de estoque foi criada.' });
    } catch (error: any) {
      toast({ title: 'Não foi possível cancelar', description: friendlyErrorMessage(error, 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setSmartInvoiceCommitting(false);
    }
  };

  const loadPurchaseDetails = async (purchase: SmartInvoiceImport, openEditor = false) => {
    if (!user?.id) return;
    setPurchaseDetailsLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('smart_invoice_import_items')
        .select('*')
        .eq('import_id', purchase.id)
        .eq('user_id', user.id)
        .order('created_at');
      if (error) throw error;
      const items = ((data || []) as SmartInvoiceItem[]).map((item) => ({
        ...item,
        quantity: Number(item.quantity || 0), unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0), confidence: Number(item.confidence || 0),
        stock_quantity_added: Number(item.stock_quantity_added || 0),
        product_quantity_added: Number(item.product_quantity_added || 0),
        conversion_factor: Number(item.conversion_factor || 1),
        unit_source: item.unit_source || 'unknown',
        unit_confirmed: item.unit_confirmed === true,
      }));
      if (openEditor) {
        setSmartInvoiceImport({
          ...purchase,
          expense_category: String(purchase.expense_category || '').toLowerCase() === 'insumos' ? 'Ingredientes' : purchase.expense_category,
        });
        setSmartInvoiceItems(items);
        setSmartLaunchExpense(purchase.launch_expense !== false);
        setSmartLaunchStock(purchase.launch_stock !== false);
        window.setTimeout(() => smartInvoiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      } else {
        setPurchaseDetails({ invoice: purchase, items });
      }
    } catch (error: any) {
      toast({ title: 'Erro ao abrir nota', description: friendlyErrorMessage(error, 'Não foi possível carregar os itens.'), variant: 'destructive' });
    } finally {
      setPurchaseDetailsLoading(false);
    }
  };

  const reversePurchaseInvoice = async (pin: string, reason: string) => {
    if (!purchaseToReverse || !user?.id) return false;
    try {
      const { error } = await (supabase as any).rpc('reverse_purchase_invoice_authorized', {
        p_import_id: purchaseToReverse.id,
        p_store_user_id: user.id,
        p_reason: reason,
        p_admin_pin: pin,
      });
      if (error) throw error;
      toast({ title: 'Nota estornada', description: 'A despesa e as entradas de estoque da nota foram desfeitas com auditoria.' });
      setPurchaseToReverse(null);
      setPurchaseDetails(null);
      await Promise.all([loadPurchaseInvoices(), loadExpenses()]);
      return true;
    } catch (error: any) {
      toast({ title: 'Erro ao estornar nota', description: friendlyErrorMessage(error, 'Não foi possível concluir o estorno.'), variant: 'destructive' });
      return false;
    }
  };

  const openAttachment = async (params: {
    id: string;
    path?: string | null;
    legacyUrl?: string | null;
    name?: string | null;
    download?: boolean;
  }) => {
    const previewWindow = !params.download ? window.open('about:blank', '_blank') : null;
    setAttachmentBusyId(params.id);
    try {
      let url = String(params.legacyUrl || '');
      if (params.path) {
        const options = params.download ? { download: params.name || true } : undefined;
        const { data, error } = await supabase.storage
          .from('purchase-invoice-attachments')
          .createSignedUrl(params.path, 120, options as any);
        if (error || !data?.signedUrl) throw error || new Error('URL do anexo não gerada.');
        url = data.signedUrl;
      }
      if (!url) throw new Error('Este lançamento não possui arquivo anexado.');

      if (params.download) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = params.name || 'anexo-nota';
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } else if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error: any) {
      previewWindow?.close();
      toast({ title: 'Erro ao abrir anexo', description: error?.message || 'Não foi possível acessar o arquivo.', variant: 'destructive' });
    } finally {
      setAttachmentBusyId('');
    }
  };

  const attachFileToPurchase = async (purchase: SmartInvoiceImport, file?: File) => {
    if (!file || !user?.id) return;
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf', 'application/xml', 'text/xml'];
    if ((!validTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.xml')) || file.size > 10 * 1024 * 1024) {
      toast({ title: 'Anexo inválido', description: 'Use JPG, PNG, WEBP, PDF ou XML de até 10 MB.', variant: 'destructive' });
      return;
    }

    setAttachmentBusyId(purchase.id);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || (file.type === 'application/pdf' ? 'pdf' : 'jpg');
      const effectiveMimeType = file.type || (extension === 'xml' ? 'application/xml' : 'application/octet-stream');
      const path = `${user.id}/smart-invoices/${purchase.id}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('purchase-invoice-attachments')
        .upload(path, file, { contentType: effectiveMimeType, cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;

      const attachmentPayload = {
        attachment_path: path,
        attachment_name: file.name,
        attachment_mime_type: effectiveMimeType,
        attachment_size_bytes: file.size,
      };
      const { error: importError } = await (supabase as any)
        .from('smart_invoice_imports')
        .update(attachmentPayload)
        .eq('id', purchase.id)
        .eq('user_id', user.id);
      if (importError) throw importError;

      if (purchase.expense_id) {
        const { error: expenseError } = await (supabase as any)
          .from('expenses')
          .update({ receipt_path: path, receipt_name: file.name, receipt_mime_type: effectiveMimeType })
          .eq('id', purchase.expense_id)
          .eq('user_id', user.id);
        if (expenseError) throw expenseError;
      }

      toast({ title: 'Anexo salvo', description: 'O arquivo foi vinculado à nota de compra e ao lançamento financeiro.' });
      await Promise.all([loadPurchaseInvoices(), loadExpenses()]);
    } catch (error: any) {
      toast({ title: 'Erro ao anexar arquivo', description: error?.message || 'Não foi possível salvar o anexo.', variant: 'destructive' });
    } finally {
      setAttachmentBusyId('');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    const raw = String(dateString || '');
    const d = raw ? new Date(raw) : new Date();
    return format(d, 'dd/MM/yyyy', { locale: ptBR });
  };

  const getTotalExpenses = () => {
    return filteredExpenses
      .filter((expense) => expense.status !== 'cancelled')
      .reduce((sum, exp) => sum + exp.amount, 0);
  };

  const categorySummary = Object.values(
    filteredExpenses.filter((expense) => expense.status !== 'cancelled').reduce((acc, expense) => {
      const key = expense.category || 'outros';
      if (!acc[key]) {
        acc[key] = {
          category: key,
          total: 0,
          count: 0,
          lastDate: '',
          expenses: [] as Expense[],
        };
      }
      acc[key].total += Number(expense.amount || 0);
      acc[key].count += 1;
      acc[key].expenses.push(expense);
      const dateKey = getExpenseDateKey(expense);
      if (!acc[key].lastDate || dateKey > acc[key].lastDate) acc[key].lastDate = dateKey;
      return acc;
    }, {} as Record<string, { category: string; total: number; count: number; lastDate: string; expenses: Expense[] }>)
  ).sort((a, b) => b.total - a.total);

  const totalForCategoryShare = Math.max(getTotalExpenses(), 1);
  const smartInvoiceTotal = smartInvoiceItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
  const smartInvoiceDeclaredTotal = Number(smartInvoiceImport?.total_amount || 0);
  const smartInvoiceDifference = Number((smartInvoiceDeclaredTotal - smartInvoiceTotal).toFixed(2));
  const filteredPurchaseInvoices = purchaseInvoices.filter((purchase) => purchaseStatusFilter === 'all' || purchase.status === purchaseStatusFilter);
  const reversedExpenses = expenses
    .filter((expense) => expense.is_active === false && expense.status !== 'cancelled')
    .filter((expense) => !searchTerm || expense.description.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((expense) => !selectedCategory || expense.category === selectedCategory)
    .filter((expense) => !dateFrom || getExpenseDateKey(expense) >= dateFrom)
    .filter((expense) => !dateTo || getExpenseDateKey(expense) <= dateTo)
    .sort((a, b) => new Date(b.reversed_at || b.created_at).getTime() - new Date(a.reversed_at || a.created_at).getTime());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4 sm:p-6">
      <PageHero
        title="Contas a pagar"
        description="Registre despesas, acompanhe comprovantes e mantenha o histórico de estornos com rastreabilidade."
        eyebrow="Financeiro"
        icon={ReceiptText}
        actions={(
          <div className="rounded-2xl border border-white/20 bg-white/15 px-5 py-3 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Despesas ativas</p>
            <p className="mt-1 text-xl font-bold">{getTotalExpenses().toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          </div>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => smartInvoiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="group rounded-2xl border border-emerald-200 bg-emerald-950 p-5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-white/10 p-3"><Sparkles className="h-6 w-6 text-orange-400" /></span>
            <span><strong className="block text-lg">Importar nota, cupom ou XML</strong><span className="mt-1 block text-sm text-emerald-100">A IA lê o documento, classifica os itens e prepara financeiro e estoque.</span></span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => manualFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="group rounded-2xl border border-orange-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-lg"
        >
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-orange-100 p-3"><PencilLine className="h-6 w-6 text-orange-700" /></span>
            <span><strong className="block text-lg text-emerald-950">Lançar compra manualmente</strong><span className="mt-1 block text-sm text-slate-600">Cadastre só a conta ou inclua os produtos para também dar entrada no estoque.</span></span>
          </div>
        </button>
      </div>

      <Card ref={smartInvoiceRef} className="border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-950">
            <Sparkles className="h-5 w-5 text-orange-600" />
            Nota inteligente para financeiro e estoque
          </CardTitle>
          <CardDescription>
              Envie foto, PDF ou XML. O sistema lê os produtos, permite a conferência e lança financeiro e estoque em uma única operação segura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <Input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.xml,application/xml,text/xml"
              onChange={handleSmartInvoiceFile}
              className="h-11 bg-white"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={analyzeSmartInvoice}
              disabled={smartInvoiceLoading || !smartInvoiceFile}
            >
              {smartInvoiceLoading ? (
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-emerald-800" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Processar com IA
            </Button>
            <Button
              type="button"
              className="h-11 bg-emerald-800 hover:bg-emerald-900"
              onClick={commitSmartInvoice}
              disabled={smartInvoiceCommitting || !smartInvoiceImport || smartInvoiceItems.length === 0}
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              {smartInvoiceCommitting ? 'Lançando...' : 'Lançar nota'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => void cancelDraftPurchaseInvoice()}
              disabled={smartInvoiceCommitting || (!smartInvoiceFile && !smartInvoiceImport)}
            >
              <XCircle className="mr-2 h-4 w-4" />Cancelar operação
            </Button>
          </div>

          {smartInvoiceFile && (
            <div className="text-sm text-slate-600">
              Arquivo selecionado: <span className="font-semibold">{smartInvoiceFile.name}</span>
            </div>
          )}

          {smartInvoiceImport && (
            <div className="grid gap-3 rounded-2xl border border-emerald-100 bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1"><Label>Fornecedor</Label><Input value={smartInvoiceImport.supplier_name || ''} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, supplier_name: event.target.value } : current)} /></div>
              <div className="space-y-1"><Label>CNPJ / CPF</Label><Input value={smartInvoiceImport.supplier_document || ''} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, supplier_document: event.target.value } : current)} /></div>
              <div className="space-y-1"><Label>Número da nota</Label><Input value={smartInvoiceImport.invoice_number || ''} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, invoice_number: event.target.value } : current)} /></div>
              <div className="space-y-1"><Label>Data da compra / emissão</Label><Input type="date" value={smartInvoiceImport.invoice_date || ''} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, invoice_date: event.target.value } : current)} /></div>
              <div className="space-y-1"><Label>Vencimento</Label><Input type="date" value={smartInvoiceImport.due_date || ''} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, due_date: event.target.value } : current)} /></div>
              <div className="space-y-1"><Label>Forma de pagamento</Label><Select value={smartInvoiceImport.payment_method || 'not_informed'} onValueChange={(value) => setSmartInvoiceImport((current) => current ? { ...current, payment_method: value === 'not_informed' ? null : value } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_informed">Não informada</SelectItem><SelectItem value="pix">PIX</SelectItem><SelectItem value="dinheiro">Dinheiro</SelectItem><SelectItem value="debito">Débito</SelectItem><SelectItem value="credito">Crédito</SelectItem><SelectItem value="boleto">Boleto</SelectItem><SelectItem value="transferencia">Transferência</SelectItem><SelectItem value="outros">Outros</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Categoria financeira</Label><Select value={smartInvoiceImport.expense_category || ''} onValueChange={(value) => setSmartInvoiceImport((current) => current ? { ...current, expense_category: value } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{financialCategories.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Valor total da nota</Label><Input type="number" min="0.01" step="0.01" value={smartInvoiceImport.total_amount || smartInvoiceTotal} onChange={(event) => setSmartInvoiceImport((current) => current ? { ...current, total_amount: Number(event.target.value || 0) } : current)} /><p className="text-[11px] text-slate-500">A seleção de estoque não altera este total.</p></div>
            </div>
          )}

          {smartInvoiceItems.length > 0 && (
            <div className="space-y-4">
              <div className={`grid gap-3 rounded-2xl border p-4 text-sm md:grid-cols-4 ${Math.abs(smartInvoiceDifference) > 0.01 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div><span className="block text-xs text-slate-500">Total declarado</span><strong>{formatCurrency(smartInvoiceDeclaredTotal)}</strong></div>
                <div><span className="block text-xs text-slate-500">Soma dos itens</span><strong>{formatCurrency(smartInvoiceTotal)}</strong></div>
                <div><span className="block text-xs text-slate-500">Diferença</span><strong className={Math.abs(smartInvoiceDifference) > 0.01 ? 'text-amber-800' : 'text-emerald-800'}>{formatCurrency(smartInvoiceDifference)}</strong></div>
                <div className="flex items-center gap-2">{Math.abs(smartInvoiceDifference) > 0.01 ? <><AlertTriangle className="h-5 w-5 text-amber-700" /><span className="font-semibold text-amber-800">Revise antes de lançar</span></> : <><PackageCheck className="h-5 w-5 text-emerald-700" /><span className="font-semibold text-emerald-800">Totais conferidos</span></>}</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                  <div>
                    <div className="font-semibold text-emerald-950">Lançar no financeiro</div>
                    <div className="text-xs text-slate-500">Cria uma despesa com o total da nota.</div>
                  </div>
                  <Switch checked={smartLaunchExpense} onCheckedChange={setSmartLaunchExpense} />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
                  <div>
                    <div className="font-semibold text-emerald-950">Lançar no estoque</div>
                    <div className="text-xs text-slate-500">Cria/atualiza insumos e movimentações de entrada.</div>
                  </div>
                  <Switch checked={smartLaunchStock} onCheckedChange={setSmartLaunchStock} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold text-emerald-950">Produtos encontrados</p><p className="text-xs text-slate-500">Somente os itens marcados movimentam estoque; todos continuam no total financeiro.</p></div>
                <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSmartInvoiceItems((items) => items.map((item) => ({ ...item, control_stock: true })))}>Selecionar todos</Button><Button type="button" size="sm" variant="outline" onClick={() => setSmartInvoiceItems((items) => items.map((item) => ({ ...item, control_stock: false })))}>Desmarcar todos</Button></div>
              </div>
              <div className="space-y-2 rounded-2xl border bg-slate-50/70 p-2">
                {smartInvoiceItems.map((item, index) => (
                  <div key={item.id || index} className="rounded-xl border bg-white p-3 shadow-sm">
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-6 xl:grid-cols-12">
                      <div className="col-span-2 md:col-span-3 xl:col-span-3">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Item</Label>
                        <Input value={item.normalized_name} onChange={(event) => updateSmartInvoiceItem(index, { normalized_name: event.target.value })} className="mt-1 h-8 px-2 text-xs font-semibold" />
                        <p className="mt-1 truncate text-[10px] text-slate-500" title={item.description}>{item.description}</p>
                      </div>
                      <div className="col-span-1 md:col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Categoria</Label>
                        <Input value={item.category} onChange={(event) => updateSmartInvoiceItem(index, { category: event.target.value })} className="mt-1 h-8 px-2 text-xs" />
                      </div>
                      <div className="col-span-1 md:col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Subcategoria</Label>
                        <Input value={item.subcategory || ''} onChange={(event) => updateSmartInvoiceItem(index, { subcategory: event.target.value })} className="mt-1 h-8 px-2 text-xs" />
                      </div>
                      <div className="col-span-1 md:col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Qtd.</Label>
                        <Input type="number" step="0.001" value={item.quantity} onChange={(event) => updateSmartInvoiceItem(index, { quantity: Number(event.target.value || 0) })} className="mt-1 h-8 px-2 text-xs" />
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Compra</Label>
                        <Select value={item.unit || 'un'} onValueChange={(value) => updateSmartInvoiceItem(index, { unit: value, unit_confirmed: true, unit_source: 'confirmed' })}>
                          <SelectTrigger className="mt-1 h-8 px-2 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{PURCHASE_UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit.toUpperCase()}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Converte</Label>
                        <Input type="number" min="0.000001" step="0.001" value={item.conversion_factor || 1} onChange={(event) => updateSmartInvoiceItem(index, { conversion_factor: Number(event.target.value || 1), unit_confirmed: true, unit_source: 'confirmed' })} className="mt-1 h-8 px-2 text-xs" />
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Estoque</Label>
                        <Select value={item.stock_unit || item.unit || 'un'} onValueChange={(value) => updateSmartInvoiceItem(index, { stock_unit: value, unit_confirmed: true, unit_source: 'confirmed' })}>
                          <SelectTrigger className="mt-1 h-8 px-2 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{PURCHASE_UNITS.map(unit => <SelectItem key={unit} value={unit}>{unit.toUpperCase()}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Custo un.</Label>
                        <Input type="number" step="0.01" value={item.unit_price} onChange={(event) => updateSmartInvoiceItem(index, { unit_price: Number(event.target.value || 0) })} className="mt-1 h-8 px-2 text-xs" />
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total</Label>
                        <div className="mt-1 flex h-8 items-center rounded-md bg-slate-100 px-2 text-xs font-bold">{formatCurrency(Number(item.total_price || 0))}</div>
                      </div>
                      <div className="col-span-1 xl:col-span-1">
                        <Label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Entrada</Label>
                        <div className="mt-1 flex h-8 items-center gap-2"><Checkbox checked={item.control_stock} onCheckedChange={(checked) => updateSmartInvoiceItem(index, { control_stock: checked === true })} /><span className="text-[11px]">Movimentar</span></div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                      <Badge variant={item.confidence >= 0.8 ? 'default' : 'secondary'} className="text-[10px]">IA {Math.round(Number(item.confidence || 0) * 100)}%</Badge>
                      <Badge variant="outline" className="text-[10px]">Unidade: {item.unit_source === 'invoice' || item.unit_source === 'xml' ? 'documento' : item.unit_source === 'catalog' ? 'catálogo' : item.unit_source === 'inferred' ? 'inferida e validada' : item.unit_source === 'confirmed' ? 'confirmada' : 'revisar'}</Badge>
                      <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">1 {String(item.unit || 'un').toUpperCase()} = {Number(item.conversion_factor || 1)} {String(item.stock_unit || item.unit || 'un').toUpperCase()}</span>
                      {invoiceItemNeedsUnitConfirmation(item) && <span className="flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" />Confirmar unidade</span>}
                      {item.similar_to && <span className="font-semibold text-emerald-700">Catálogo: {item.similar_to} ({Math.round(Number(item.match_confidence || 0) * 100)}%)</span>}
                      {item.matched_product_tracks_stock && <span className="text-blue-700">Produto de venda também será atualizado</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-emerald-50/60">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-emerald-950"><Paperclip className="h-5 w-5" />Central de notas de compra</CardTitle>
              <CardDescription>Conferência, anexos, lançamentos, estoque e estornos reunidos em um histórico auditável.</CardDescription>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs sm:flex">
              <div className="rounded-xl border bg-white px-3 py-2"><strong className="block text-base text-emerald-800">{purchaseInvoices.filter((item) => item.status === 'committed').length}</strong>Lançadas</div>
              <div className="rounded-xl border bg-white px-3 py-2"><strong className="block text-base text-amber-700">{purchaseInvoices.filter((item) => item.status === 'draft').length}</strong>Conferência</div>
              <div className="rounded-xl border bg-white px-3 py-2"><strong className="block text-base text-red-700">{purchaseInvoices.filter((item) => item.status === 'cancelled').length}</strong>Estornadas</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <Tabs value={purchaseStatusFilter} onValueChange={(value) => setPurchaseStatusFilter(value as typeof purchaseStatusFilter)} className="mb-5">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="all">Todas ({purchaseInvoices.length})</TabsTrigger>
              <TabsTrigger value="draft">Em conferência</TabsTrigger>
              <TabsTrigger value="committed">Lançadas</TabsTrigger>
              <TabsTrigger value="cancelled">Estornadas</TabsTrigger>
            </TabsList>
          </Tabs>
          {purchaseInvoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed py-10 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-10 w-10 opacity-50" />
              <p>Nenhuma nota de compra processada.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor / nota</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Anexo original</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPurchaseInvoices.map((purchase) => {
                    const hasAttachment = Boolean(purchase.attachment_path || purchase.receipt_url);
                    const isBusy = attachmentBusyId === purchase.id;
                    return (
                      <TableRow key={purchase.id}>
                        <TableCell>
                          <div className="font-semibold">{purchase.supplier_name || 'Fornecedor não identificado'}</div>
                          <div className="text-xs text-muted-foreground">{purchase.invoice_number ? `Nota ${purchase.invoice_number}` : 'Sem número'} · processada em {purchase.created_at ? formatDate(purchase.created_at) : '-'}</div>
                        </TableCell>
                        <TableCell>{purchase.invoice_date ? formatDate(purchase.invoice_date) : '-'}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(Number(purchase.total_amount || 0))}</TableCell>
                        <TableCell>
                          <Badge className={purchase.status === 'committed' ? 'bg-emerald-700' : purchase.status === 'cancelled' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 hover:bg-amber-100'}>
                            {purchase.status === 'committed' ? 'Lançada' : purchase.status === 'cancelled' ? 'Estornada' : 'Em conferência'}
                          </Badge>
                          {purchase.status === 'cancelled' && purchase.reversal_reason && <div className="mt-1 max-w-[220px] text-xs text-red-700">{purchase.reversal_reason}</div>}
                        </TableCell>
                        <TableCell>
                          {hasAttachment ? (
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void openAttachment({ id: purchase.id, path: purchase.attachment_path, legacyUrl: purchase.receipt_url, name: purchase.attachment_name })}>
                                <Eye className="mr-1.5 h-3.5 w-3.5" />Visualizar
                              </Button>
                              <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void openAttachment({ id: purchase.id, path: purchase.attachment_path, legacyUrl: purchase.receipt_url, name: purchase.attachment_name, download: true })}>
                                <Download className="mr-1.5 h-3.5 w-3.5" />Baixar
                              </Button>
                            </div>
                          ) : (
                            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-orange-200 bg-orange-50 px-3 text-xs font-bold text-orange-800 hover:bg-orange-100">
                              <Upload className="mr-1.5 h-3.5 w-3.5" />{isBusy ? 'Enviando...' : 'Anexar arquivo'}
                              <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.xml,application/xml,text/xml" className="sr-only" disabled={isBusy} onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void attachFileToPurchase(purchase, file);
                                event.target.value = '';
                              }} />
                            </label>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button type="button" variant="ghost" size="sm" disabled={purchaseDetailsLoading} onClick={() => void loadPurchaseDetails(purchase)}>
                              <FileText className="mr-1.5 h-3.5 w-3.5" />Ver itens
                            </Button>
                            {purchase.status === 'draft' && (
                              <Button type="button" size="sm" className="bg-emerald-800 hover:bg-emerald-900" onClick={() => void loadPurchaseDetails(purchase, true)}>
                                <PackageCheck className="mr-1.5 h-3.5 w-3.5" />Continuar lançamento
                              </Button>
                            )}
                            {purchase.status === 'committed' && (
                              <Button type="button" variant="ghost" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setPurchaseToReverse(purchase)}>
                                <Undo2 className="mr-1.5 h-3.5 w-3.5" />Estornar nota
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Expense Form */}
        <Card ref={manualFormRef}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Nova conta / despesa
            </CardTitle>
            <CardDescription>
              Informe o essencial agora; os dados complementares ficam em Mais opções.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div>
                  <p className="font-bold text-emerald-950">Esta compra deve entrar no estoque?</p>
                  <p className="text-xs text-emerald-800">Ao ativar, informe os itens. A IA procura produtos semelhantes e evita cadastro duplicado.</p>
                </div>
                <Switch checked={manualMovesStock} onCheckedChange={(checked) => {
                  setManualMovesStock(checked);
                  if (checked) {
                    setPayableType('single');
                    setManualStockItems((items) => items.length ? items : [newManualStockItem()]);
                  }
                }} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição *</Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Compra de ingredientes para pizza"
                  required
                />
              </div>

              <details className="rounded-xl border bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-bold text-emerald-950">Mais opções</summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2"><Label>Fornecedor</Label><Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Nome do fornecedor" /></div>
                  <div className="space-y-2"><Label>Forma prevista de pagamento</Label><Select value={defaultPaymentMethod || 'not_informed'} onValueChange={(value) => setDefaultPaymentMethod(value === 'not_informed' ? '' : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="not_informed">Não informada</SelectItem><SelectItem value="pix">PIX</SelectItem><SelectItem value="dinheiro">Dinheiro</SelectItem><SelectItem value="debito">Débito</SelectItem><SelectItem value="credito">Crédito</SelectItem><SelectItem value="boleto">Boleto</SelectItem><SelectItem value="transferencia">Transferência</SelectItem><SelectItem value="outros">Outros</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>Competência</Label><Input type="date" value={competenceDate} onChange={(event) => setCompetenceDate(event.target.value)} /></div>
                  <div className="space-y-2"><Label>Centro de custo</Label><Input value={costCenter} onChange={(event) => setCostCenter(event.target.value)} placeholder="Opcional" /></div>
                  <div className="space-y-2 md:col-span-2"><Label>Observação</Label><Input value={expenseNotes} onChange={(event) => setExpenseNotes(event.target.value)} placeholder="Opcional" /></div>
                </div>
              </details>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="amount">Valor (R$) *</Label>
                    <CurrencyTextInput
                      id="amount"
                      value={amount}
                      onValueChange={setAmount}
                      placeholder="R$ 0,00"
                      required
                    />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expenseDate">Data da despesa *</Label>
                  <Input
                    id="expenseDate"
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dueDate">Vencimento *</Label>
                  <Input
                    id="dueDate"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_160px]">
                <div className="space-y-2">
                  <Label>Tipo de lançamento</Label>
                  <Select value={payableType} onValueChange={(value) => setPayableType(value as typeof payableType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Conta avulsa</SelectItem>
                      <SelectItem value="installment">Compra parcelada</SelectItem>
                      <SelectItem value="recurring">Conta recorrente mensal</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {payableType === 'installment' && 'O valor total será dividido em parcelas mensais independentes.'}
                    {payableType === 'recurring' && 'O valor informado será repetido em competências mensais independentes.'}
                    {payableType === 'single' && 'Uma única conta será criada.'}
                  </p>
                </div>
                {payableType !== 'single' && (
                  <div className="space-y-2">
                    <Label htmlFor="occurrenceCount">{payableType === 'installment' ? 'Parcelas' : 'Meses'}</Label>
                    <Input id="occurrenceCount" type="number" min={2} max={120} value={occurrenceCount} onChange={(event) => setOccurrenceCount(event.target.value)} />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Categoria *</Label>
                <Select value={category} onValueChange={setCategory} required>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Selecione uma categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {financialCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {manualMovesStock && (
                <div className="space-y-4 rounded-2xl border border-emerald-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-bold text-emerald-950">Itens da entrada de estoque</h3>
                      <p className="text-xs text-slate-600">A correspondência é conferida com o catálogo desta loja antes de qualquer alteração.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setManualStockItems((items) => [...items, newManualStockItem()])}>
                        <Plus className="mr-1.5 h-4 w-4" />Adicionar item
                      </Button>
                      <Button type="button" size="sm" className="bg-emerald-800 hover:bg-emerald-900" disabled={manualClassifying || manualStockItems.length === 0} onClick={() => void classifyManualStockItems()}>
                        <ScanSearch className="mr-1.5 h-4 w-4" />{manualClassifying ? 'Identificando...' : 'Identificar com IA'}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {manualStockItems.map((item, index) => (
                      <div key={item.local_id || item.id || index} className="rounded-xl border bg-white p-3">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
                          <div className="space-y-1 xl:col-span-4">
                            <Label>Produto / insumo *</Label>
                            <Input value={item.description} placeholder="Ex.: Coca-Cola lata 350 ml" onChange={(event) => updateManualStockItem(index, { description: event.target.value, normalized_name: event.target.value, ingredient_id: null, product_id: null, similar_to: null })} />
                            {item.similar_to && (
                              <p className="text-xs font-semibold text-emerald-700">Encontrado no estoque: {item.similar_to} ({Math.round(Number(item.match_confidence || 0) * 100)}%)</p>
                            )}
                            {item.matched_product_tracks_stock && <p className="text-xs text-blue-700">O estoque do produto de venda também será atualizado.</p>}
                          </div>
                          <div className="space-y-1 xl:col-span-2"><Label>Categoria</Label><Input value={item.category} onChange={(event) => updateManualStockItem(index, { category: event.target.value })} /></div>
                          <div className="space-y-1 xl:col-span-1"><Label>Qtd.</Label><Input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateManualStockItem(index, { quantity: Number(event.target.value || 0) })} /></div>
                          <div className="space-y-1 xl:col-span-1"><Label>Compra</Label><Select value={item.unit} onValueChange={(value) => updateManualStockItem(index, { unit: value, unit_confirmed: true, unit_source: 'confirmed' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PURCHASE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit.toUpperCase()}</SelectItem>)}</SelectContent></Select></div>
                          <div className="space-y-1 xl:col-span-1"><Label>Conversão</Label><Input type="number" min="0.000001" step="0.001" value={item.conversion_factor || 1} onChange={(event) => updateManualStockItem(index, { conversion_factor: Number(event.target.value || 1) })} /></div>
                          <div className="space-y-1 xl:col-span-1"><Label>Estoque</Label><Select value={item.stock_unit} onValueChange={(value) => updateManualStockItem(index, { stock_unit: value, unit_confirmed: true, unit_source: 'confirmed' })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PURCHASE_UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit.toUpperCase()}</SelectItem>)}</SelectContent></Select></div>
                          <div className="space-y-1 xl:col-span-1"><Label>Custo un.</Label><Input type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => updateManualStockItem(index, { unit_price: Number(event.target.value || 0) })} /></div>
                          <div className="flex items-end xl:col-span-1"><Button type="button" variant="ghost" size="icon" className="text-red-700" aria-label={`Remover ${item.description || `item ${index + 1}`}`} onClick={() => setManualStockItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-slate-600">
                          <span>Tipo: <strong>{item.inventory_kind === 'resale_product' ? 'Produto para revenda' : item.inventory_kind === 'packaging' ? 'Embalagem' : item.inventory_kind === 'cleaning' ? 'Limpeza' : item.inventory_kind === 'service' ? 'Serviço (não movimenta)' : 'Insumo'}</strong></span>
                          <span>Entrada: {Number(item.quantity || 0)} {String(item.unit).toUpperCase()} × {Number(item.conversion_factor || 1)} = <strong>{Number(item.quantity || 0) * Number(item.conversion_factor || 1)} {String(item.stock_unit).toUpperCase()}</strong> · Total {formatCurrency(Number(item.total_price || 0))}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3">
                    <span className="font-semibold text-emerald-950">Total dos itens: {formatCurrency(manualStockItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0))}</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAmount(manualStockItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0).toFixed(2).replace('.', ','))}>Usar no valor da conta</Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="receipt">Comprovante (opcional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="receipt"
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    onChange={handleFileChange}
                    className="flex-1"
                  />
                  {receiptFile && (
                    <Badge variant="secondary">
                      {receiptFile.name}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Aceita JPG, PNG e PDF (máx. 5MB)
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Registrando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    {manualMovesStock ? 'Registrar compra e dar entrada' : 'Registrar conta'}
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Resumo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total de despesas:</span>
              <span className="text-2xl font-bold">{formatCurrency(getTotalExpenses())}</span>
            </div>
            
            <div className="grid gap-2">
              {financialCategories.map(cat => {
                const categoryTotal = filteredExpenses
                  .filter(exp => exp.category === cat && exp.status !== 'cancelled')
                  .reduce((sum, exp) => sum + exp.amount, 0);
                
                if (categoryTotal === 0) return null;
                
                return (
                  <div key={cat} className="flex justify-between text-sm">
                    <span className="capitalize">{cat}:</span>
                    <span>{formatCurrency(categoryTotal)}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="searchExpenses">Pesquisar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="searchExpenses"
                  placeholder="Descrição..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filterCategory">Categoria</Label>
              <Select value={selectedCategory || 'all'} onValueChange={(val) => setSelectedCategory(val === 'all' ? '' : val)}>
                <SelectTrigger id="filterCategory">
                  <SelectValue placeholder="Todas categorias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas categorias</SelectItem>
                  {financialCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateFrom">De</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">Até</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="lancamentos" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="lancamentos" className="gap-2">
            <FileText className="h-4 w-4" />
            Lançamentos
          </TabsTrigger>
          <TabsTrigger value="categorias" className="gap-2">
            <Tags className="h-4 w-4" />
            Por categoria
          </TabsTrigger>
          <TabsTrigger value="estornos" className="gap-2">
            <Undo2 className="h-4 w-4" />
            Histórico de estornos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lancamentos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Despesas ({filteredExpenses.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma despesa encontrada</p>
                  <p className="text-sm mt-1">Tente ajustar os filtros ou registrar uma nova despesa</p>
                </div>
              ) : user?.id ? (
                <PayablesTable
                  expenses={filteredExpenses}
                  userId={user.id}
                  categories={financialCategories}
                  onReload={loadExpenses}
                  onOpenAttachment={openAttachment}
                  attachmentBusyId={attachmentBusyId}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categorias">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListFilter className="h-5 w-5" />
                Despesas por categoria
              </CardTitle>
              <CardDescription>
                Os mesmos filtros acima controlam esta visão, facilitando a conferência por período.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-5 flex flex-col gap-2 rounded-xl border bg-slate-50 p-3 sm:flex-row">
                <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Nova categoria financeira" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addFinancialCategory(); } }} />
                <Button type="button" disabled={savingCategory || !newCategoryName.trim()} onClick={() => void addFinancialCategory()}><Plus className="mr-2 h-4 w-4" />Adicionar categoria</Button>
              </div>
              <div className="mb-5 flex flex-wrap gap-2">
                {financialCategoryRows.map((row) => <Button key={row.id} type="button" size="sm" variant="outline" onClick={() => void renameFinancialCategory(row)}>{row.name}<span className="ml-2 text-[10px] text-muted-foreground">editar</span></Button>)}
              </div>
              {categorySummary.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Tags className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Nenhuma categoria encontrada no período.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {categorySummary.map((item) => {
                    const percentage = Math.round((item.total / totalForCategoryShare) * 100);
                    return (
                      <div key={item.category} className="rounded-2xl border bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className="capitalize">{item.category}</Badge>
                              <span className="text-sm text-muted-foreground">{item.count} lançamento(s)</span>
                            </div>
                            <div className="mt-2 text-2xl font-bold">{formatCurrency(item.total)}</div>
                            <div className="text-xs text-muted-foreground">
                              {percentage}% do total filtrado
                              {item.lastDate ? ` - último lançamento em ${formatDate(item.lastDate)}` : ''}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectedCategory(item.category)}
                          >
                            Filtrar categoria
                          </Button>
                        </div>
                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-700" style={{ width: `${Math.min(percentage, 100)}%` }} />
                        </div>
                        <div className="mt-4 grid gap-2">
                          {item.expenses.slice(0, 4).map((expense) => (
                            <div key={expense.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                              <span className="truncate pr-4">{expense.description}</span>
                              <span className="whitespace-nowrap font-semibold">{formatCurrency(expense.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="estornos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Undo2 className="h-5 w-5" />
                Histórico de estornos ({reversedExpenses.length})
              </CardTitle>
              <CardDescription>
                Registro permanente de despesas retiradas dos totais, com motivo, responsável e horário.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reversedExpenses.length === 0 ? (
                <div className="rounded-2xl border border-dashed py-10 text-center text-muted-foreground">
                  <PackageCheck className="mx-auto mb-2 h-10 w-10 opacity-50" />
                  <p>Nenhum estorno encontrado para os filtros selecionados.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Despesa original</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Estornada em</TableHead>
                        <TableHead>Responsável</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reversedExpenses.map((expense) => (
                        <TableRow key={expense.id}>
                          <TableCell>
                            <div className="font-medium">{expense.description}</div>
                            <div className="text-xs text-muted-foreground">
                              Lançada em {formatDate(getExpenseDateKey(expense))}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold">{formatCurrency(expense.amount)}</TableCell>
                          <TableCell>
                            {expense.reversed_at
                              ? format(new Date(expense.reversed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
                              : 'Data não registrada'}
                          </TableCell>
                          <TableCell>{expense.reversed_by_name || 'Administrador'}</TableCell>
                          <TableCell className="max-w-[360px] whitespace-normal">
                            {expense.reversal_reason || 'Motivo não registrado em lançamento antigo'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ReverseExpenseDialog
        open={Boolean(purchaseToReverse)}
        title="Estornar nota de compra"
        entityLabel="nota de compra"
        description={purchaseToReverse ? `${purchaseToReverse.supplier_name || 'Fornecedor'}${purchaseToReverse.invoice_number ? ` · NF ${purchaseToReverse.invoice_number}` : ''}` : undefined}
        amountLabel={purchaseToReverse ? formatCurrency(Number(purchaseToReverse.total_amount || 0)) : undefined}
        auditMessage="A despesa vinculada e todas as entradas de estoque desta nota serão desfeitas. O registro permanecerá na aba Estornadas."
        onCancel={() => setPurchaseToReverse(null)}
        onConfirm={reversePurchaseInvoice}
      />

      <Dialog open={Boolean(purchaseDetails)} onOpenChange={(open) => !open && setPurchaseDetails(null)}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da nota de compra</DialogTitle>
            <DialogDescription>
              {purchaseDetails?.invoice.supplier_name || 'Fornecedor não identificado'}
              {purchaseDetails?.invoice.invoice_number ? ` · Nota ${purchaseDetails.invoice.invoice_number}` : ''}
            </DialogDescription>
          </DialogHeader>
          {purchaseDetails && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-2xl bg-emerald-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="block text-xs text-muted-foreground">Status</span><strong>{purchaseDetails.invoice.status === 'committed' ? 'Lançada' : purchaseDetails.invoice.status === 'cancelled' ? 'Estornada' : 'Em conferência'}</strong></div>
                <div><span className="block text-xs text-muted-foreground">Emissão</span><strong>{purchaseDetails.invoice.invoice_date ? formatDate(purchaseDetails.invoice.invoice_date) : '-'}</strong></div>
                <div><span className="block text-xs text-muted-foreground">Total</span><strong>{formatCurrency(Number(purchaseDetails.invoice.total_amount || 0))}</strong></div>
                <div><span className="block text-xs text-muted-foreground">Destinos</span><strong>{[purchaseDetails.invoice.launch_expense && 'Financeiro', purchaseDetails.invoice.launch_stock && 'Estoque'].filter(Boolean).join(' + ') || 'Pendente'}</strong></div>
              </div>
              {purchaseDetails.invoice.status === 'cancelled' && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  <strong>Estornada{purchaseDetails.invoice.reversed_by_name ? ` por ${purchaseDetails.invoice.reversed_by_name}` : ''}:</strong> {purchaseDetails.invoice.reversal_reason || 'Motivo não informado'}
                </div>
              )}
              <div className="overflow-x-auto rounded-2xl border">
                <Table>
                  <TableHeader><TableRow><TableHead>Produto / insumo</TableHead><TableHead>Categoria</TableHead><TableHead>Quantidade</TableHead><TableHead>Custo unit.</TableHead><TableHead>Total</TableHead><TableHead>Entrada registrada</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {purchaseDetails.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><div className="font-medium">{item.normalized_name}</div><div className="text-xs text-muted-foreground">{item.description}</div></TableCell>
                        <TableCell>{item.category}{item.subcategory ? ` / ${item.subcategory}` : ''}</TableCell>
                        <TableCell>{Number(item.quantity).toLocaleString('pt-BR')} {item.unit}</TableCell>
                        <TableCell>{formatCurrency(Number(item.unit_price || 0))}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(Number(item.total_price || 0))}</TableCell>
                        <TableCell>{item.control_stock ? `${Number(item.stock_quantity_added || 0).toLocaleString('pt-BR')} ${item.stock_unit}` : 'Sem controle'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
