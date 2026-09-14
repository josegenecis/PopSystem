
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageSquare, Send, Phone, Bot, User, Users, Mail, Search, PlayCircle, Sparkles, Settings, Activity, Save, RefreshCw, Clock3, UserCheck, CheckCircle2, Inbox, MoreVertical, Smile, ShoppingBag, MapPin, PanelRightClose, PanelRightOpen, ChevronLeft, Paperclip, Mic, Square, FileText, Download, Check, CheckCheck, Utensils, WalletCards, Truck, Plus, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getLocalOperatorSession } from '@/services/operatorAuth';
import { buildBrazilPhoneCandidates, phonesAreEquivalent } from '@/utils/phoneCandidates';
import { signWhatsAppMedia, uploadWhatsAppMedia, whatsappMediaType } from '@/services/whatsappMedia';
import { fillWhatsAppQuickReply, isPossiblePaymentReceipt, minutesUntilTomorrow, orderItemSuggestions } from '@/lib/whatsappCentral';

interface Message {
  id: string;
  conversation_id?: string;
  content: string;
  sender: 'bot' | 'customer' | 'agent';
  sent_at: string;
  message_type?: string;
  delivered?: boolean | null;
  media_path?: string | null;
  media_mime_type?: string | null;
  media_name?: string | null;
  media_size?: number | null;
  transcription?: string | null;
  media_url?: string;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read' | 'received' | 'failed';
  provider_message_id?: string | null;
  quoted_message_id?: string | null;
}

const MESSAGE_PAGE_SIZE = 60;

function mapWhatsAppMessage(message: unknown): Message {
  const row = message as Record<string, unknown>;
  return {
    id: String(row.id || ''),
    conversation_id: row.conversation_id ? String(row.conversation_id) : undefined,
    content: String(row.content || ''),
    sender: row.sender as Message['sender'],
    sent_at: String(row.sent_at || new Date().toISOString()),
    message_type: row.message_type ? String(row.message_type) : undefined,
    delivered: typeof row.delivered === 'boolean' ? row.delivered : null,
    media_path: row.media_path ? String(row.media_path) : null,
    media_mime_type: row.media_mime_type ? String(row.media_mime_type) : null,
    media_name: row.media_name ? String(row.media_name) : null,
    media_size: typeof row.media_size === 'number' ? row.media_size : null,
    transcription: row.transcription ? String(row.transcription) : null,
    delivery_status: row.delivery_status as Message['delivery_status'],
    provider_message_id: row.provider_message_id ? String(row.provider_message_id) : null,
    quoted_message_id: row.quoted_message_id ? String(row.quoted_message_id) : null,
  };
}

interface Conversation {
  id: string;
  customer_phone: string;
  customer_name: string;
  status: string;
  created_at: string;
  bot_paused?: boolean;
  bot_paused_at?: string | null;
  ai_conversation_id?: string | null;
  ai_status?: string | null;
  human_required?: boolean | null;
  owner?: string | null;
  current_state?: string | null;
  unread_count?: number;
  queue_status?: 'new' | 'assigned' | 'waiting_customer' | 'resolved';
  assigned_operator_id?: string | null;
  assigned_operator_name?: string | null;
  assigned_at?: string | null;
  last_customer_message_at?: string | null;
  updated_at?: string;
  last_message?: string;
  last_message_sender?: string;
  operational_status?: 'NEW' | 'OPEN' | 'WAITING_CUSTOMER' | 'WAITING_RESTAURANT' | 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'RESOLVED' | 'ARCHIVED';
  first_response_at?: string | null;
  resolved_at?: string | null;
  resolution_reason?: string | null;
}

interface AiSettings {
  enabled: boolean;
  assistant_name: string;
  tone: string;
  service_style: string;
  order_flow: string;
  welcome_message: string;
  out_of_hours_message: string;
  human_transfer_message: string;
  delivery_rules: string;
  payment_rules: string;
  menu_recommendation_rules: string;
  human_handoff_rules: string;
  forbidden_responses: string;
  upsell_enabled: boolean;
  max_history_messages: number;
  specific_rules: string;
}

interface AiLog {
  id: string;
  action: string;
  input: any;
  output: any;
  error: string | null;
  created_at: string;
}

interface QuickReply {
  id: string;
  shortcut: string;
  content: string;
}

interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  neighborhood?: string | null;
  reference?: string | null;
  is_default?: boolean;
}

interface CopilotSuggestion {
  summary: string;
  suggestedReply: string;
  intent: string;
  confidence: number;
  possibleOrder: string[];
  alert: string;
}

const defaultAiSettings: AiSettings = {
  enabled: true,
  assistant_name: 'POP AI',
  tone: 'vendedor, cordial e objetivo',
  service_style: 'Atendimento rápido, simpático, parecido com um atendente humano do restaurante.',
  order_flow: 'Enviar o cardápio, ajudar o cliente a escolher e coletar apenas o próximo dado necessário.',
  welcome_message: '',
  out_of_hours_message: '',
  human_transfer_message: 'Vou chamar alguém da equipe para te ajudar.',
  delivery_rules: '',
  payment_rules: '',
  menu_recommendation_rules: 'Recomendar produtos reais do cardápio, combos e itens em destaque quando fizer sentido.',
  human_handoff_rules: 'Chamar atendente em reclamações, cancelamentos, cobrança, erro no pedido ou quando o cliente pedir uma pessoa.',
  forbidden_responses: 'Não inventar preço, prazo, produto, taxa, promoção ou disponibilidade.',
  upsell_enabled: true,
  max_history_messages: 30,
  specific_rules: ''
};

const operatorQuickReplies = [
  'Olá! Como posso ajudar?',
  'Só um momento, vou verificar.',
  'Seu pedido já está em preparo.',
  'Posso ajudar em mais alguma coisa?'
];

async function hydrateMessageMedia(message: Message): Promise<Message> {
  if (!message.media_path) return message;
  return { ...message, media_url: await signWhatsAppMedia(message.media_path) };
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const operationalStatusLabels: Record<string, string> = {
  NEW: 'Nova', OPEN: 'Aberta', WAITING_CUSTOMER: 'Aguardando cliente',
  WAITING_RESTAURANT: 'Aguardando restaurante', AI_ACTIVE: 'IA atendendo',
  HUMAN_ACTIVE: 'Humano atendendo', RESOLVED: 'Resolvida', ARCHIVED: 'Arquivada'
};

const isBotPaused = (conversation: {
  status?: string | null;
  bot_paused?: boolean | null;
  ai_status?: string | null;
  human_required?: boolean | null;
  owner?: string | null;
  current_state?: string | null;
}) => {
  const status = String(conversation.status || '').trim().toLowerCase();
  const aiStatus = String(conversation.ai_status || '').trim().toLowerCase();
  const owner = String(conversation.owner || '').trim().toUpperCase();
  const currentState = String(conversation.current_state || '').trim().toUpperCase();

  if (status.startsWith('bot_paused_until:')) {
    const until = new Date(status.slice('bot_paused_until:'.length)).getTime();
    if (Number.isFinite(until)) return until > Date.now();
  }

  if (status === 'active' || status === 'ai_active' || aiStatus === 'ai_active' || owner === 'AI') return false;
  if (conversation.human_required || aiStatus === 'human_required' || aiStatus === 'human_active' || owner === 'HUMAN' || currentState === 'HUMAN_ATTENDING') {
    return true;
  }
  if (status === 'bot_paused') return true;

  return Boolean(conversation.bot_paused);
};

const WhatsAppChatbot = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [massMessage, setMassMessage] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [activeTab, setActiveTab] = useState('conversations');
  const [aiSettings, setAiSettings] = useState<AiSettings>(defaultAiSettings);
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [aiLogs, setAiLogs] = useState<AiLog[]>([]);
  const [loadingAiLogs, setLoadingAiLogs] = useState(false);
  const [queueFilter, setQueueFilter] = useState<'open' | 'mine' | 'unread' | 'ai' | 'human' | 'waiting_customer' | 'waiting_restaurant' | 'resolved' | 'archived' | 'all'>('open');
  const [conversationSearch, setConversationSearch] = useState('');
  const [remoteSearchConversationIds, setRemoteSearchConversationIds] = useState<string[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [internalNotes, setInternalNotes] = useState<Array<{ id: string; content: string; created_by_name: string; created_at: string }>>([]);
  const [conversationEvents, setConversationEvents] = useState<Array<{ id: string; description: string; created_at: string }>>([]);
  const [internalNoteDraft, setInternalNoteDraft] = useState('');
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quickReplyShortcut, setQuickReplyShortcut] = useState('');
  const [quickReplyContent, setQuickReplyContent] = useState('');
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([]);
  const [newAddress, setNewAddress] = useState('');
  const [customTag, setCustomTag] = useState('');
  const [conversationToResolve, setConversationToResolve] = useState<Conversation | null>(null);
  const [resolutionReason, setResolutionReason] = useState('Atendimento concluído');
  const [resolvingConversation, setResolvingConversation] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [paymentCheckout, setPaymentCheckout] = useState<{ status: string; updated_at: string } | null>(null);
  const [deliveryAssignment, setDeliveryAssignment] = useState<{ status: string; picked_up_at?: string | null; delivered_at?: string | null; driver_name?: string | null; driver_phone?: string | null } | null>(null);
  const [generatingCharge, setGeneratingCharge] = useState(false);
  const [loadingCopilot, setLoadingCopilot] = useState(false);
  const [copilotSuggestion, setCopilotSuggestion] = useState<CopilotSuggestion | null>(null);
  const [dashboardOrders, setDashboardOrders] = useState<Array<{ id: string; total: number; customer_phone: string | null; created_at: string; conversation_id?: string | null }>>([]);
  const [dashboardPeriod, setDashboardPeriod] = useState<1 | 7 | 30>(1);
  const selectedConversationRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const messagesBottomRef = useRef<HTMLDivElement>(null);
  const messagesListRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const notificationAudioContextRef = useRef<AudioContext | null>(null);
  const operator = getLocalOperatorSession();
  const operatorId = operator?.id || user?.id || '';
  const operatorName = operator?.name || user?.email || 'Administrador';
  const selectedConversationPhone = conversations.find((item) => item.id === selectedConversation)?.customer_phone;

  useEffect(() => { selectedConversationRef.current = selectedConversation; }, [selectedConversation]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => () => { document.title = 'PopSystem'; }, []);
  useEffect(() => {
    const container = messagesListRef.current;
    const pendingRestore = pendingScrollRestoreRef.current;
    if (container && pendingRestore) {
      container.scrollTop = pendingRestore.top + container.scrollHeight - pendingRestore.height;
      pendingScrollRestoreRef.current = null;
      return;
    }
    messagesBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const buildTemporaryHumanPausePayload = (minutes: number | null = 60) => {
    const now = new Date();
    const resumeAt = minutes == null ? null : new Date(now.getTime() + minutes * 60 * 1000);
    return {
      status: resumeAt ? `bot_paused_until:${resumeAt.toISOString()}` : 'bot_paused',
      bot_paused: true,
      bot_paused_at: now.toISOString(),
      bot_paused_by: user?.id || null,
      owner: 'HUMAN',
      current_state: 'HUMAN_ATTENDING',
      operational_status: 'HUMAN_ACTIVE',
      last_human_message_at: now.toISOString(),
      ai_resume_at: resumeAt?.toISOString() || null,
      metadata: {
        reason: 'manual_operator_pause',
        aiResumeAt: resumeAt?.toISOString() || null,
        lastHumanMessageAt: now.toISOString(),
        handoffMode: resumeAt ? 'temporary_human_owner' : 'indefinite_human_owner'
      },
      updated_at: now.toISOString()
    };
  };

  // Buscar conversas
  useEffect(() => {
    if (user?.id) {
      fetchConversations();
      fetchCustomers();
      fetchStaff();
      fetchQuickReplies();
      fetchAiSettings();
      fetchAiLogs();
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) void fetchDashboardOrders();
  }, [dashboardPeriod, user?.id]);

  // Buscar mensagens da conversa selecionada
  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation);
      fetchAiLogs();
      void (supabase as any).from('whatsapp_conversations').update({
        unread_count: 0,
        last_read_at: new Date().toISOString(),
      }).eq('id', selectedConversation).eq('user_id', user?.id);
    }
  }, [selectedConversation, user?.id]);

  useEffect(() => {
    if (!selectedConversationPhone || !user?.id) {
      setRecentOrders([]);
      setInternalNotes([]);
      setConversationEvents([]);
      setCustomerAddresses([]);
      setPaymentCheckout(null);
      setDeliveryAssignment(null);
      return;
    }
    const candidates = Array.from(new Set(buildBrazilPhoneCandidates(selectedConversationPhone).flatMap((phone) => [phone, `+${phone}`])));
    void Promise.all([
      (supabase as any)
        .from('orders')
        .select('id,order_number,status,total,created_at,customer_address,order_type,items,payment_method,delivery_fee,acceptance_status,user_id,estimated_delivery_time')
        .eq('user_id', user.id)
        .in('customer_phone', candidates)
        .order('created_at', { ascending: false })
        .limit(5),
      (supabase as any)
        .from('whatsapp_conversation_notes')
        .select('id,content,created_by_name,created_at')
        .eq('user_id', user.id)
        .eq('conversation_id', selectedConversation)
        .order('created_at', { ascending: false })
        .limit(20),
      (supabase as any)
        .from('whatsapp_conversation_events')
        .select('id,description,created_at')
        .eq('user_id', user.id)
        .eq('conversation_id', selectedConversation)
        .order('created_at', { ascending: false })
        .limit(20)
    ]).then(async ([ordersResult, notesResult, eventsResult]) => {
      setRecentOrders(ordersResult.data || []);
      setInternalNotes(notesResult.data || []);
      setConversationEvents(eventsResult.data || []);
      const customer = customers.find((item) => phonesAreEquivalent(item.phone, selectedConversationPhone));
      const latestOrder = ordersResult.data?.[0];
      const [addressesResult, checkoutResult, assignmentResult] = await Promise.all([
        customer?.id ? (supabase as any).from('customer_addresses').select('id,label,address,neighborhood,reference,is_default').eq('user_id', user.id).eq('customer_id', customer.id).order('is_default', { ascending: false }).order('updated_at', { ascending: false }) : Promise.resolve({ data: [] }),
        latestOrder?.id ? (supabase as any).from('pix_checkouts').select('status,updated_at').eq('restaurant_user_id', user.id).eq('order_id', latestOrder.id).order('updated_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
        latestOrder?.id ? (supabase as any).from('delivery_assignments').select('status,picked_up_at,delivered_at,delivery_personnel(name,phone)').eq('restaurant_id', user.id).eq('order_id', latestOrder.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setCustomerAddresses(addressesResult.data || []);
      setPaymentCheckout(checkoutResult.data || null);
      const assignment = assignmentResult.data as any;
      setDeliveryAssignment(assignment ? { ...assignment, driver_name: assignment.delivery_personnel?.name, driver_phone: assignment.delivery_personnel?.phone } : null);
    });
  }, [selectedConversation, selectedConversationPhone, user?.id, customers]);

  useEffect(() => {
    if (!user?.id) return;
    const refreshTimer = window.setInterval(() => {
      void fetchConversations();
    }, 30_000);
    const channel = supabase.channel(`whatsapp-service-queue:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `user_id=eq.${user.id}` }, (payload) => {
        const next = payload.new as Conversation;
        const previous = payload.old as Partial<Conversation>;
        setConversations((current) => {
          if (payload.eventType === 'DELETE') return current.filter((item) => item.id !== previous.id);
          const normalized = { ...next, bot_paused: isBotPaused(next), unread_count: Number(next.unread_count || 0) };
          const exists = current.some((item) => item.id === normalized.id);
          const merged = exists ? current.map((item) => item.id === normalized.id ? { ...item, ...normalized } : item) : [normalized, ...current];
          return merged.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_messages' }, (payload) => {
        const message = payload.new as Message;
        if (!message?.id) return;
        if (message.message_type === 'order_draft') return;
        const conversation = conversationsRef.current.find((item) => item.id === message.conversation_id);
        if (!conversation) return;
        setConversations((current) => current.map((item) => item.id === message.conversation_id
          ? { ...item, last_message: message.content, last_message_sender: message.sender, updated_at: message.sent_at }
          : item));
        if (message.conversation_id === selectedConversationRef.current) {
          void hydrateMessageMedia(message).then((hydrated) => {
            setMessages((current) => current.some((item) => item.id === hydrated.id)
              ? current.map((item) => item.id === hydrated.id ? { ...item, ...hydrated } : item)
              : [...current, hydrated]);
          });
        }
        if (payload.eventType === 'INSERT' && message.sender === 'customer') {
          if (document.hidden || message.conversation_id !== selectedConversationRef.current) {
            document.title = `Nova mensagem${conversation?.customer_name ? ` de ${conversation.customer_name}` : ''} · PopSystem`;
            window.setTimeout(() => { document.title = 'PopSystem'; }, 5000);
            if (notificationPermission === 'granted') {
              const notification = new Notification(conversation?.customer_name || 'Nova mensagem no WhatsApp', {
                body: message.content || 'Mídia recebida',
                tag: `whatsapp-${message.conversation_id}`,
              });
              notification.onclick = () => {
                window.focus();
                if (message.conversation_id) setSelectedConversation(message.conversation_id);
                notification.close();
              };
              const context = notificationAudioContextRef.current;
              if (context) {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.frequency.value = 880;
                gain.gain.setValueAtTime(0.08, context.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
                oscillator.connect(gain).connect(context.destination);
                oscillator.start();
                oscillator.stop(context.currentTime + 0.18);
              }
            }
          }
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_conversation_events', filter: `user_id=eq.${user.id}` }, (payload) => {
        const event = payload.new as { id: string; conversation_id: string; description: string; created_at: string };
        if (event.conversation_id === selectedConversationRef.current) {
          setConversationEvents((current) => current.some((item) => item.id === event.id) ? current : [event, ...current].slice(0, 20));
        }
      })
      .subscribe();
    return () => {
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [notificationPermission, user?.id]);

  useEffect(() => {
    const orderId = recentOrders[0]?.id;
    if (!user?.id || !orderId) return;
    const channel = supabase.channel(`whatsapp-context:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pix_checkouts', filter: `order_id=eq.${orderId}` }, (payload) => {
        const checkout = payload.new as { status?: string; updated_at?: string };
        if (checkout?.status) setPaymentCheckout({ status: checkout.status, updated_at: checkout.updated_at || new Date().toISOString() });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `order_id=eq.${orderId}` }, (payload) => {
        const assignment = payload.new as { status?: string; picked_up_at?: string | null; delivered_at?: string | null };
        if (assignment?.status) setDeliveryAssignment((current) => ({ ...current, ...assignment }));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [recentOrders, user?.id]);

  useEffect(() => {
    const query = conversationSearch.trim();
    if (!user?.id || query.length < 2) {
      setRemoteSearchConversationIds([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void Promise.all([
        (supabase as any).from('whatsapp_messages')
          .select('conversation_id,whatsapp_conversations!inner(user_id)')
          .eq('whatsapp_conversations.user_id', user.id)
          .ilike('content', `%${query}%`)
          .limit(200),
        (supabase as any).from('orders')
          .select('customer_phone')
          .eq('user_id', user.id)
          .ilike('order_number', `%${query}%`)
          .limit(100),
      ]).then(([messageResult, orderResult]) => {
        const ids = new Set<string>((messageResult.data || []).map((row: any) => String(row.conversation_id)));
        const phones = (orderResult.data || []).map((row: any) => String(row.customer_phone || '')).filter(Boolean);
        conversations.forEach((conversation) => {
          if (phones.some((phone: string) => phonesAreEquivalent(phone, conversation.customer_phone))) ids.add(conversation.id);
        });
        setRemoteSearchConversationIds(Array.from(ids));
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [conversationSearch, conversations, user?.id]);

  const fetchConversations = async () => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('user_id', user?.id)
        .order('updated_at', { ascending: false })
        .limit(300);

      if (error) throw error;
      
      // Transformar os dados para o tipo correto
      const typedConversations: Conversation[] = (data || []).map(conv => ({
        id: conv.id,
        customer_phone: conv.customer_phone,
        customer_name: conv.customer_name || 'Cliente',
        status: conv.status,
        created_at: conv.created_at,
        bot_paused: isBotPaused(conv as any),
        bot_paused_at: (conv as any).bot_paused_at || null,
        ai_conversation_id: (conv as any).ai_conversation_id || null,
        ai_status: (conv as any).ai_status || null,
        human_required: (conv as any).human_required || false,
        owner: (conv as any).owner || null,
        current_state: (conv as any).current_state || null,
        unread_count: Number((conv as any).unread_count || 0),
        queue_status: (conv as any).queue_status || 'new',
        assigned_operator_id: (conv as any).assigned_operator_id || null,
        assigned_operator_name: (conv as any).assigned_operator_name || null,
        assigned_at: (conv as any).assigned_at || null,
        last_customer_message_at: (conv as any).last_customer_message_at || null,
        updated_at: (conv as any).updated_at || conv.created_at,
        last_message: (conv as any).last_message_preview || '',
        last_message_sender: (conv as any).last_message_sender || '',
        operational_status: (conv as any).operational_status || undefined,
        first_response_at: (conv as any).first_response_at || null,
        resolved_at: (conv as any).resolved_at || null,
        resolution_reason: (conv as any).resolution_reason || null,
      }));
      
      setConversations(typedConversations);
      if (!selectedConversationRef.current && typedConversations.length > 0) setSelectedConversation(typedConversations[0].id);
      const requestedConversation = searchParams.get('conversation');
      if (requestedConversation && typedConversations.some((item) => item.id === requestedConversation)) {
        setSelectedConversation(requestedConversation);
        setActiveTab('conversations');
        setSearchParams({}, { replace: true });
      }
    } catch (error: any) {
      console.error('Erro ao buscar conversas:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar as conversas.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const takeConversation = async (conversation: Conversation) => {
    const now = new Date().toISOString();
    const query = (supabase as any)
      .from('whatsapp_conversations')
      .update({
        queue_status: 'assigned',
        assigned_operator_id: operatorId,
        assigned_operator_name: operatorName,
        assigned_at: now,
        unread_count: 0,
        last_read_at: now,
        owner: 'HUMAN',
        human_required: true,
        operational_status: 'HUMAN_ACTIVE',
        updated_at: now,
      })
      .eq('id', conversation.id)
      .eq('user_id', user?.id)
      .or(`assigned_operator_id.is.null,assigned_operator_id.eq.${operatorId}`)
      .select('id')
      .maybeSingle();
    const { data, error } = await query;
    if (error) throw error;
    if (!data) throw new Error(`Esta conversa já foi assumida por ${conversation.assigned_operator_name || 'outro atendente'}.`);
    setConversations((current) => current.map((item) => item.id === conversation.id ? {
      ...item,
      queue_status: 'assigned',
      assigned_operator_id: operatorId,
      assigned_operator_name: operatorName,
      assigned_at: now,
      unread_count: 0,
      operational_status: 'HUMAN_ACTIVE',
    } : item));
  };

  const resolveConversation = async (conversation: Conversation, reason: string) => {
    const now = new Date().toISOString();
    const { error } = await (supabase as any).from('whatsapp_conversations').update({
      queue_status: 'resolved',
      resolved_at: now,
      operational_status: 'RESOLVED',
      unread_count: 0,
      last_read_at: now,
      resolution_reason: reason,
      resolved_by: operatorId,
      resolved_by_name: operatorName,
      updated_at: now,
    }).eq('id', conversation.id).eq('user_id', user?.id);
    if (error) throw error;
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, queue_status: 'resolved', operational_status: 'RESOLVED', resolution_reason: reason, unread_count: 0 } : item));
    toast({ title: 'Conversa resolvida', description: `${reason}. Ela continuará disponível no histórico.` });
  };

  const confirmResolution = async () => {
    if (!conversationToResolve || !resolutionReason) return;
    setResolvingConversation(true);
    try {
      await resolveConversation(conversationToResolve, resolutionReason);
      setConversationToResolve(null);
    } catch (error: any) {
      toast({ title: 'Não foi possível resolver', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setResolvingConversation(false);
    }
  };

  const enableIncomingAlerts = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') {
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor && !notificationAudioContextRef.current) {
        notificationAudioContextRef.current = new AudioContextConstructor();
        await notificationAudioContextRef.current.resume();
      }
      toast({ title: 'Alertas ativados', description: 'Novas mensagens poderão tocar e aparecer mesmo em outra aba.' });
    }
  };

  const transferConversation = async (conversation: Conversation, nextOperatorId: string) => {
    const nextOperator = staff.find((item) => item.id === nextOperatorId);
    if (!nextOperator || !user?.id) return;
    const now = new Date().toISOString();
    const { error } = await (supabase as any).from('whatsapp_conversations').update({
      queue_status: 'assigned',
      assigned_operator_id: nextOperator.id,
      assigned_operator_name: nextOperator.name,
      assigned_at: now,
      owner: 'HUMAN',
      human_required: true,
      operational_status: 'HUMAN_ACTIVE',
      updated_at: now,
    }).eq('id', conversation.id).eq('user_id', user.id);
    if (error) throw error;
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, assigned_operator_id: nextOperator.id, assigned_operator_name: nextOperator.name, assigned_at: now, queue_status: 'assigned', operational_status: 'HUMAN_ACTIVE' } : item));
    toast({ title: 'Atendimento transferido', description: `${nextOperator.name} recebeu a conversa.` });
  };

  const saveInternalNote = async () => {
    const content = internalNoteDraft.trim();
    if (!content || !selectedConversation || !user?.id) return;
    const { data, error } = await (supabase as any).from('whatsapp_conversation_notes').insert({
      user_id: user.id,
      conversation_id: selectedConversation,
      content,
      created_by_id: operatorId,
      created_by_name: operatorName,
    }).select('id,content,created_by_name,created_at').single();
    if (error) {
      toast({ title: 'Nota não salva', description: error.message, variant: 'destructive' });
      return;
    }
    setInternalNotes((current) => [data, ...current]);
    setInternalNoteDraft('');
  };

  const createOrderFromConversation = (suggestedItems: string[] = []) => {
    if (!selectedConv) return;
    sessionStorage.setItem('popsystem_whatsapp_order_handoff', JSON.stringify({
      customerName: selectedCustomer?.name || selectedConv.customer_name,
      customerPhone: selectedCustomer?.phone || selectedConv.customer_phone,
      customerAddress: selectedCustomer?.address || recentOrders[0]?.customer_address || '',
      conversationId: selectedConv.id,
      suggestedItems,
      createdAt: Date.now(),
    }));
    navigate('/pdv');
  };

  const waitingMinutes = (conversation: Conversation) => {
    const value = conversation.last_customer_message_at || conversation.created_at;
    return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  };

  const formatWaitingDuration = (totalMinutes: number) => {
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    if (totalHours < 24) {
      return remainingMinutes > 0 ? `${totalHours} h ${remainingMinutes} min` : `${totalHours} h`;
    }

    const totalDays = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    if (totalDays < 30) {
      return remainingHours > 0 ? `${totalDays} d ${remainingHours} h` : `${totalDays} ${totalDays === 1 ? 'dia' : 'dias'}`;
    }

    const totalMonths = Math.floor(totalDays / 30);
    const remainingDays = totalDays % 30;
    const monthLabel = totalMonths === 1 ? 'mês' : 'meses';
    return remainingDays > 0 ? `${totalMonths} ${monthLabel} ${remainingDays} d` : `${totalMonths} ${monthLabel}`;
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .neq('message_type', 'order_draft')
        .order('sent_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);

      if (error) throw error;
      if (selectedConversationRef.current !== conversationId) return;
      
      const typedMessages = (data || []).slice().reverse().map(mapWhatsAppMessage);

      setMessages(await Promise.all(typedMessages.map(hydrateMessageMedia)));
      setHasOlderMessages((data || []).length === MESSAGE_PAGE_SIZE);
    } catch (error: any) {
      console.error('Erro ao buscar mensagens:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar as mensagens.",
        variant: "destructive"
      });
    }
  };

  const loadOlderMessages = async () => {
    const conversationId = selectedConversationRef.current;
    const oldestMessage = messages[0];
    const container = messagesListRef.current;
    if (!conversationId || !oldestMessage || !container || loadingOlderMessages || !hasOlderMessages) return;

    setLoadingOlderMessages(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .neq('message_type', 'order_draft')
        .lt('sent_at', oldestMessage.sent_at)
        .order('sent_at', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE);
      if (error) throw error;

      const olderMessages = await Promise.all((data || []).slice().reverse().map(mapWhatsAppMessage).map(hydrateMessageMedia));
      if (selectedConversationRef.current !== conversationId) return;
      if (olderMessages.length > 0) pendingScrollRestoreRef.current = { height: container.scrollHeight, top: container.scrollTop };
      setMessages((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return [...olderMessages.filter((item) => !currentIds.has(item.id)), ...current];
      });
      setHasOlderMessages((data || []).length === MESSAGE_PAGE_SIZE);
    } catch (error: any) {
      toast({ title: 'Histórico não carregado', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sendingMessage) return;
    const conversation = conversations.find(c => c.id === selectedConversation);
    if (!conversation) return;
    const messageToSend = newMessage.trim();
    const optimisticId = `sending-${Date.now()}`;
    setSendingMessage(true);
    setNewMessage('');
    setMessages((current) => [...current, {
      id: optimisticId,
      content: messageToSend,
      sender: 'agent',
      sent_at: new Date().toISOString(),
      delivered: false,
      delivery_status: 'sending'
    }]);

    try {
      if (conversation.assigned_operator_id !== operatorId) await takeConversation(conversation);
      const pausePayload = buildTemporaryHumanPausePayload();

      let { error: pauseError } = await supabase
        .from('whatsapp_conversations')
        .update(pausePayload as any)
        .eq('id', selectedConversation)
        .eq('user_id', user?.id);

      if (pauseError && /bot_paused|owner|current_state|last_human_message_at|ai_resume_at|metadata|schema cache|column/i.test(String(pauseError.message || ''))) {
        const fallbackPausePayload = {
          status: pausePayload.status,
          updated_at: new Date().toISOString()
        };
        const fallbackResult = await supabase
          .from('whatsapp_conversations')
          .update(fallbackPausePayload as any)
          .eq('id', selectedConversation)
          .eq('user_id', user?.id);
        pauseError = fallbackResult.error;
      }

      if (pauseError) throw pauseError;

      const aiPausePayload = {
        status: 'human_active',
        owner: 'HUMAN',
        current_state: 'HUMAN_ATTENDING',
        last_human_message_at: pausePayload.last_human_message_at,
        ai_resume_at: pausePayload.ai_resume_at,
        metadata: {
          ...(pausePayload.metadata || {}),
          legacyConversationId: selectedConversation
        },
        last_message_at: pausePayload.updated_at
      };

      let aiPauseQuery = supabase
        .from('ai_conversations')
        .update(aiPausePayload as any)
        .eq('restaurant_id', user?.id);

      if (conversation.ai_conversation_id) {
        aiPauseQuery = aiPauseQuery.eq('id', conversation.ai_conversation_id);
      } else {
        aiPauseQuery = aiPauseQuery.eq('phone', String(conversation.customer_phone || '').replace(/\D/g, ''));
      }

      const { error: aiPauseError } = await aiPauseQuery;
      if (aiPauseError && !/owner|current_state|last_human_message_at|ai_resume_at|metadata|schema cache|column/i.test(String(aiPauseError.message || ''))) {
        throw aiPauseError;
      }

      const { data: sendResult, error: sendError } = await supabase.functions.invoke('whatsapp-send', {
        body: {
          number: conversation.customer_phone,
          message: messageToSend
        }
      });

      if (sendError) throw sendError;
      if ((sendResult as any)?.error) {
        throw new Error((sendResult as any)?.message || 'Falha ao enviar mensagem no WhatsApp.');
      }

      const { data: insertedMessage, error } = await supabase
        .from('whatsapp_messages')
        .insert({
          conversation_id: selectedConversation,
          content: messageToSend,
          sender: 'agent',
          message_type: 'text',
          delivered: true,
          delivery_status: 'sent',
          provider_message_id: (sendResult as any)?.providerMessageId || null
        })
        .select('*')
        .single();

      if (error) throw error;

      setMessages((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimisticId && item.id !== insertedMessage.id);
        return [...withoutOptimistic, insertedMessage as Message].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
      });
      setConversations(prev => prev.map(item => item.id === selectedConversation ? { ...item, ...pausePayload } : item));
      
      toast({
        title: "Mensagem enviada",
        description: "A IA ficará em silêncio por 60 minutos enquanto o atendente conduz a conversa."
      });
    } catch (error: any) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setNewMessage(messageToSend);
      console.error('Erro ao enviar mensagem:', error);
      toast({
        title: "Erro",
        description: "Não foi possível enviar a mensagem.",
        variant: "destructive"
      });
    } finally {
      setSendingMessage(false);
    }
  };

  const sendMediaFile = async (file: File) => {
    if (!selectedConversation || !user?.id || uploadingMedia) return;
    const conversation = conversations.find((item) => item.id === selectedConversation);
    if (!conversation) return;
    const caption = newMessage.trim();
    const kind = whatsappMediaType(file.type);
    const optimisticId = `uploading-${Date.now()}`;
    const localUrl = URL.createObjectURL(file);
    let uploadedPath = '';
    setUploadingMedia(true);
    setNewMessage('');
    setMessages((current) => [...current, {
      id: optimisticId,
      content: caption || (kind === 'audio' ? 'Mensagem de voz' : file.name),
      sender: 'agent',
      sent_at: new Date().toISOString(),
      delivered: false,
      message_type: kind,
      media_mime_type: file.type,
      media_name: file.name,
      media_size: file.size,
      media_url: localUrl,
      delivery_status: 'sending',
    }]);

    try {
      if (conversation.assigned_operator_id !== operatorId) await takeConversation(conversation);
      const uploaded = await uploadWhatsAppMedia(user.id, selectedConversation, file);
      uploadedPath = uploaded.path;
      const { data: sendResult, error: sendError } = await supabase.functions.invoke('whatsapp-send', {
        body: {
          number: conversation.customer_phone,
          message: caption,
          mediaUrl: uploaded.signedUrl,
          mediaType: uploaded.mediaType,
          mimeType: file.type,
          fileName: file.name,
        }
      });
      if (sendError) throw sendError;
      if ((sendResult as any)?.error) throw new Error((sendResult as any)?.message || 'A Evolution não confirmou o envio do arquivo.');

      const { data: inserted, error: insertError } = await (supabase as any).from('whatsapp_messages').insert({
        conversation_id: selectedConversation,
        content: caption || (kind === 'audio' ? 'Mensagem de voz' : file.name),
        sender: 'agent',
        message_type: kind,
        delivered: true,
        media_path: uploaded.path,
        media_mime_type: file.type,
        media_name: file.name,
        media_size: file.size,
        delivery_status: 'sent',
        provider_message_id: (sendResult as any)?.providerMessageId || null,
      }).select('*').single();
      if (insertError) throw insertError;
      const hydrated = { ...inserted, media_url: uploaded.signedUrl } as Message;
      setMessages((current) => [...current.filter((item) => item.id !== optimisticId && item.id !== hydrated.id), hydrated]
        .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()));
      setConversations((current) => current.map((item) => item.id === selectedConversation ? { ...item, ...buildTemporaryHumanPausePayload() } : item));
    } catch (error: any) {
      if (uploadedPath) await supabase.storage.from('whatsapp-media').remove([uploadedPath]);
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setNewMessage(caption);
      toast({ title: 'Arquivo não enviado', description: error?.message || 'Verifique a conexão do WhatsApp.', variant: 'destructive' });
    } finally {
      URL.revokeObjectURL(localUrl);
      setUploadingMedia(false);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  };

  const toggleAudioRecording = async () => {
    if (recordingAudio) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast({ title: 'Gravação indisponível', description: 'Este navegador não permite gravar áudio.', variant: 'destructive' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingAudio(false);
        const mimeType = recorder.mimeType.split(';')[0] || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        audioChunksRef.current = [];
        if (blob.size > 0) {
          const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
          void sendMediaFile(new File([blob], `audio-${Date.now()}.${extension}`, { type: mimeType }));
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingAudio(true);
    } catch (error: any) {
      toast({ title: 'Microfone não disponível', description: error?.message || 'Autorize o acesso ao microfone para gravar.', variant: 'destructive' });
    }
  };

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    recorder.onstop = null;
    recorder.stream.getTracks().forEach((track) => track.stop());
    if (recorder.state === 'recording') recorder.stop();
  }, []);

  const toggleBotPause = async (conversationId: string, paused: boolean, minutes: number | null = 60) => {
    try {
      const payload = paused
        ? buildTemporaryHumanPausePayload(minutes)
        : {
            status: 'active',
            bot_paused: false,
            bot_paused_at: null,
            bot_paused_by: null,
            owner: 'AI',
            current_state: 'IDLE',
            operational_status: 'AI_ACTIVE',
            last_human_message_at: null,
            ai_resume_at: null,
            updated_at: new Date().toISOString()
          };

      let { error } = await supabase
        .from('whatsapp_conversations')
        .update(payload as any)
        .eq('id', conversationId)
        .eq('user_id', user?.id);

      if (error && /bot_paused|owner|current_state|last_human_message_at|ai_resume_at|metadata|schema cache|column/i.test(String(error.message || ''))) {
        const fallbackPayload = {
          status: paused ? String((payload as any).status || 'bot_paused') : 'active',
          updated_at: new Date().toISOString()
        };
        const fallbackResult = await supabase
          .from('whatsapp_conversations')
          .update(fallbackPayload as any)
          .eq('id', conversationId)
          .eq('user_id', user?.id);
        error = fallbackResult.error;
      }

      if (error) throw error;

      const selected = conversations.find(item => item.id === conversationId);
      if (selected?.ai_conversation_id) {
        await supabase
          .from('ai_conversations')
          .update(paused
            ? {
                status: 'human_active',
                owner: 'HUMAN',
                current_state: 'HUMAN_ATTENDING',
                last_human_message_at: (payload as any).last_human_message_at,
                ai_resume_at: (payload as any).ai_resume_at,
                last_message_at: (payload as any).updated_at
              } as any
            : {
                status: 'ai_active',
                owner: 'AI',
                current_state: 'IDLE',
                ai_resume_at: null,
                last_message_at: new Date().toISOString()
              } as any)
          .eq('restaurant_id', user?.id)
          .eq('id', selected.ai_conversation_id);
      }

      setConversations(prev => prev.map(item => item.id === conversationId ? { ...item, ...payload } : item));
      toast({
        title: paused ? 'Robô pausado' : 'Robô reativado',
        description: paused
          ? (minutes == null ? 'A conversa ficará com o atendimento humano até a reativação manual.' : `O atendimento humano ficará ativo por ${minutes} minutos.`)
          : 'O bot voltará a responder novas mensagens.'
      });
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error?.message || 'Não foi possível atualizar a pausa do robô.',
        variant: 'destructive'
      });
    }
  };

  const fetchCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCustomers(data || []);
    } catch (error: any) {
      console.error('Erro ao buscar clientes:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os clientes.",
        variant: "destructive"
      });
    }
  };

  const fetchStaff = async () => {
    if (!user?.id) return;
    const { data } = await (supabase as any)
      .from('waiters')
      .select('id,name')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('name');
    setStaff(data || []);
  };

  const fetchQuickReplies = async () => {
    if (!user?.id) return;
    const { data, error } = await (supabase as any)
      .from('whatsapp_quick_replies')
      .select('id,shortcut,content')
      .eq('user_id', user.id)
      .order('shortcut');
    if (!error) setQuickReplies(data || []);
  };

  const fetchDashboardOrders = async () => {
    if (!user?.id) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (dashboardPeriod - 1));
    const { data, error } = await (supabase as any).from('orders')
      .select('id,total,customer_phone,created_at,conversation_id')
      .eq('user_id', user.id)
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: false })
      .limit(1000);
    if (!error) setDashboardOrders(data || []);
  };

  const expandQuickReply = (content: string) => {
    const latestOrder = recentOrders[0];
    const restaurantName = String((user as any)?.user_metadata?.restaurant_name || 'nosso restaurante');
    return fillWhatsAppQuickReply(content, {
      customerName: selectedCustomer?.name || selectedConv?.customer_name,
      restaurantName,
      menuLink: `${window.location.origin}/share/menu/${user?.id || ''}`,
      orderNumber: latestOrder?.order_number,
      deliveryTime: latestOrder?.estimated_delivery_time,
    });
  };

  const applyQuickReply = (reply: QuickReply) => setNewMessage(expandQuickReply(reply.content));

  const saveQuickReply = async () => {
    if (!user?.id) return;
    const shortcut = `/${quickReplyShortcut.trim().replace(/^\/+/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '')}`;
    const content = quickReplyContent.trim();
    if (shortcut.length < 3 || !content) return;
    const { error } = await (supabase as any).from('whatsapp_quick_replies').upsert({
      user_id: user.id, shortcut, content, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,shortcut' });
    if (error) {
      toast({ title: 'Resposta não salva', description: error.message, variant: 'destructive' });
      return;
    }
    setQuickReplyShortcut('');
    setQuickReplyContent('');
    await fetchQuickReplies();
  };

  const deleteQuickReply = async (id: string) => {
    if (!user?.id) return;
    const { error } = await (supabase as any).from('whatsapp_quick_replies').delete().eq('id', id).eq('user_id', user.id);
    if (!error) setQuickReplies((current) => current.filter((item) => item.id !== id));
  };

  const toggleCustomerTag = async (tag: string) => {
    if (!selectedCustomer || !user?.id) return;
    const currentTags = Array.isArray(selectedCustomer.tags) ? selectedCustomer.tags : [];
    const nextTags = currentTags.includes(tag) ? currentTags.filter((item: string) => item !== tag) : [...currentTags, tag];
    const { error } = await (supabase as any).from('customers').update({ tags: nextTags, updated_at: new Date().toISOString() }).eq('id', selectedCustomer.id).eq('user_id', user.id);
    if (error) return toast({ title: 'Tag não atualizada', description: error.message, variant: 'destructive' });
    setCustomers((current) => current.map((item) => item.id === selectedCustomer.id ? { ...item, tags: nextTags } : item));
  };

  const addCustomCustomerTag = async () => {
    const tag = customTag.trim().slice(0, 40);
    if (!tag || !selectedCustomer) return;
    const currentTags = Array.isArray(selectedCustomer.tags) ? selectedCustomer.tags : [];
    if (!currentTags.some((item: string) => item.toLocaleLowerCase('pt-BR') === tag.toLocaleLowerCase('pt-BR'))) {
      await toggleCustomerTag(tag);
    }
    setCustomTag('');
  };

  const addCustomerAddress = async () => {
    if (!selectedCustomer?.id || !user?.id || !newAddress.trim()) return;
    const { data, error } = await (supabase as any).from('customer_addresses').insert({
      user_id: user.id,
      customer_id: selectedCustomer.id,
      label: customerAddresses.length ? 'Outro endereço' : 'Principal',
      address: newAddress.trim(),
      is_default: customerAddresses.length === 0,
    }).select('id,label,address,neighborhood,reference,is_default').single();
    if (error) return toast({ title: 'Endereço não salvo', description: error.message, variant: 'destructive' });
    setCustomerAddresses((current) => [data, ...current]);
    setNewAddress('');
  };

  const prepareMenuMessage = () => {
    if (!user?.id) return;
    setNewMessage(`Confira nosso cardápio:\n${window.location.origin}/share/menu/${user.id}`);
  };

  const prepareDeliveryMessage = () => {
    const latestOrder = recentOrders[0];
    if (!latestOrder) return toast({ title: 'Sem pedido', description: 'Crie ou selecione um pedido antes de consultar a entrega.' });
    const status = deliveryAssignment?.status || latestOrder.status || 'aguardando preparação';
    const driver = deliveryAssignment?.driver_name ? ` com ${deliveryAssignment.driver_name}` : '';
    setNewMessage(`Atualização do pedido #${latestOrder.order_number}: ${status}${driver}.`);
  };

  const repeatOrderInPdv = (order: any) => {
    createOrderFromConversation(orderItemSuggestions(order?.items));
  };

  const generatePixCharge = async () => {
    const order = recentOrders[0];
    if (!order?.id || !user?.id || generatingCharge) return toast({ title: 'Sem pedido para cobrar', description: 'Crie o pedido no PDV antes de gerar a cobrança.' });
    setGeneratingCharge(true);
    try {
      const { data, error } = await supabase.functions.invoke('pix-start-checkout', {
        body: {
          restaurantUserId: user.id,
          orderId: order.id,
          preferredMethod: 'pix',
          orderPayload: {
            order_id: order.id,
            order_number: order.order_number,
            total: Number(order.total || 0),
            delivery_fee: Number(order.delivery_fee || 0),
            payment_method: 'pix_online',
            customer_name: selectedCustomer?.name || selectedConv?.customer_name || 'Cliente',
            customer_phone: selectedCustomer?.phone || selectedConv?.customer_phone || '',
            order_type: order.order_type || 'counter',
            items: Array.isArray(order.items) ? order.items : [],
          },
        },
      });
      if (error || !(data as any)?.ok) throw new Error((data as any)?.message || (data as any)?.error || error?.message || 'Não foi possível gerar o PIX.');
      const pixCode = String((data as any)?.brCode || '');
      const paymentLink = String((data as any)?.paymentLinkUrl || '');
      if (!pixCode && !paymentLink) throw new Error('O provedor não retornou código ou link de pagamento.');
      setNewMessage(`Pagamento PIX do pedido #${order.order_number}:\n${pixCode || paymentLink}\n\nA confirmação acontece automaticamente. Não é necessário enviar comprovante.`);
      setPaymentCheckout({ status: 'CREATED', updated_at: new Date().toISOString() });
      toast({ title: 'PIX gerado', description: 'A cobrança foi colocada no campo de mensagem. Revise e envie ao cliente.' });
    } catch (error: any) {
      toast({ title: 'Cobrança não gerada', description: error?.message || 'Verifique a configuração do PopPay.', variant: 'destructive' });
    } finally {
      setGeneratingCharge(false);
    }
  };

  const askCopilot = async () => {
    if (!selectedConversation || loadingCopilot) return;
    setLoadingCopilot(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-copilot', { body: { conversationId: selectedConversation } });
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'Copiloto indisponível.');
      setCopilotSuggestion((data as any).copilot as CopilotSuggestion);
    } catch (error: any) {
      toast({ title: 'Copiloto indisponível', description: error?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setLoadingCopilot(false);
    }
  };

  const fetchAiSettings = async () => {
    if (!user?.id) return;
    try {
      const [aiResult, whatsappResult] = await Promise.all([
        (supabase as any)
          .from('ai_settings')
          .select('*')
          .eq('restaurant_id', user.id)
          .maybeSingle(),
        supabase
          .from('whatsapp_settings')
          .select('enabled, default_message, auto_responses')
          .eq('user_id', user.id)
          .maybeSingle()
      ]);

      if (aiResult.error && !String(aiResult.error.message || '').includes('relation "public.ai_settings" does not exist')) {
        throw aiResult.error;
      }

      const data = aiResult.data;
      const autoResponses = (whatsappResult.data?.auto_responses && typeof whatsappResult.data.auto_responses === 'object' && !Array.isArray(whatsappResult.data.auto_responses))
        ? whatsappResult.data.auto_responses as Record<string, any>
        : {};
      const botConfig = (autoResponses.bot_config && typeof autoResponses.bot_config === 'object')
        ? autoResponses.bot_config as Record<string, any>
        : {};
      const metadata = (data?.metadata && typeof data.metadata === 'object') ? data.metadata : {};

      if (data) {
        setAiSettings({
          enabled: data.enabled !== false,
          assistant_name: data.assistant_name || 'POP AI',
          tone: data.tone || botConfig.tone || defaultAiSettings.tone,
          service_style: metadata.service_style || botConfig.service_style || defaultAiSettings.service_style,
          order_flow: metadata.order_flow || botConfig.order_flow || defaultAiSettings.order_flow,
          welcome_message: data.welcome_message || botConfig.welcome_message || '',
          out_of_hours_message: data.out_of_hours_message || '',
          human_transfer_message: data.human_transfer_message || defaultAiSettings.human_transfer_message,
          delivery_rules: metadata.delivery_rules || botConfig.delivery_rules || '',
          payment_rules: metadata.payment_rules || botConfig.payment_rules || '',
          menu_recommendation_rules: metadata.menu_recommendation_rules || botConfig.menu_recommendation_rules || defaultAiSettings.menu_recommendation_rules,
          human_handoff_rules: metadata.human_handoff_rules || botConfig.human_handoff_rules || defaultAiSettings.human_handoff_rules,
          forbidden_responses: Array.isArray(data.forbidden_responses)
            ? data.forbidden_responses.join('\n')
            : botConfig.forbidden_responses || defaultAiSettings.forbidden_responses,
          upsell_enabled: data.upsell_enabled !== false,
          max_history_messages: Number(data.max_history_messages || 30),
          specific_rules: data.specific_rules || ''
        });
      } else if (Object.keys(botConfig).length || whatsappResult.data) {
        setAiSettings(prev => ({
          ...prev,
          enabled: whatsappResult.data?.enabled !== false,
          assistant_name: botConfig.assistant_name || prev.assistant_name,
          tone: botConfig.tone || prev.tone,
          service_style: botConfig.service_style || prev.service_style,
          order_flow: botConfig.order_flow || prev.order_flow,
          welcome_message: botConfig.welcome_message || whatsappResult.data?.default_message || prev.welcome_message,
          human_transfer_message: botConfig.human_transfer_message || prev.human_transfer_message,
          delivery_rules: botConfig.delivery_rules || prev.delivery_rules,
          payment_rules: botConfig.payment_rules || prev.payment_rules,
          menu_recommendation_rules: botConfig.menu_recommendation_rules || prev.menu_recommendation_rules,
          human_handoff_rules: botConfig.human_handoff_rules || prev.human_handoff_rules,
          forbidden_responses: botConfig.forbidden_responses || prev.forbidden_responses,
          specific_rules: botConfig.specific_rules || prev.specific_rules,
        }));
      }
    } catch (error: any) {
      console.error('Erro ao carregar POP AI:', error);
    }
  };

  const saveAiSettings = async () => {
    if (!user?.id) return;
    setSavingAiSettings(true);
    try {
      const payload = {
        restaurant_id: user.id,
        enabled: aiSettings.enabled,
        assistant_name: aiSettings.assistant_name || 'POP AI',
        tone: aiSettings.tone || defaultAiSettings.tone,
        welcome_message: aiSettings.welcome_message || null,
        out_of_hours_message: aiSettings.out_of_hours_message || null,
        human_transfer_message: aiSettings.human_transfer_message || defaultAiSettings.human_transfer_message,
        upsell_enabled: aiSettings.upsell_enabled,
        max_history_messages: Math.min(80, Math.max(10, Number(aiSettings.max_history_messages || 30))),
        forbidden_responses: aiSettings.forbidden_responses
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        specific_rules: aiSettings.specific_rules || null,
        metadata: {
          service_style: aiSettings.service_style,
          order_flow: aiSettings.order_flow,
          delivery_rules: aiSettings.delivery_rules,
          payment_rules: aiSettings.payment_rules,
          menu_recommendation_rules: aiSettings.menu_recommendation_rules,
          human_handoff_rules: aiSettings.human_handoff_rules,
        },
        updated_at: new Date().toISOString()
      };

      const { error } = await (supabase as any)
        .from('ai_settings')
        .upsert(payload, { onConflict: 'restaurant_id' });

      if (error && !String(error.message || '').includes('relation "public.ai_settings" does not exist')) throw error;

      const { data: existingWhatsapp } = await supabase
        .from('whatsapp_settings')
        .select('auto_responses, phone_number, default_message')
        .eq('user_id', user.id)
        .maybeSingle();

      const currentAutoResponses = (existingWhatsapp?.auto_responses && typeof existingWhatsapp.auto_responses === 'object' && !Array.isArray(existingWhatsapp.auto_responses))
        ? existingWhatsapp.auto_responses as Record<string, any>
        : {};
      const botConfig = {
        assistant_name: payload.assistant_name,
        tone: payload.tone,
        service_style: aiSettings.service_style,
        order_flow: aiSettings.order_flow,
        welcome_message: aiSettings.welcome_message,
        out_of_hours_message: aiSettings.out_of_hours_message,
        human_transfer_message: aiSettings.human_transfer_message,
        delivery_rules: aiSettings.delivery_rules,
        payment_rules: aiSettings.payment_rules,
        menu_recommendation_rules: aiSettings.menu_recommendation_rules,
        human_handoff_rules: aiSettings.human_handoff_rules,
        forbidden_responses: aiSettings.forbidden_responses,
        specific_rules: aiSettings.specific_rules,
        upsell_enabled: aiSettings.upsell_enabled,
        max_history_messages: payload.max_history_messages,
      };

      const { error: whatsappError } = await supabase
        .from('whatsapp_settings')
        .upsert({
          user_id: user.id,
          phone_number: existingWhatsapp?.phone_number || '',
          default_message: aiSettings.welcome_message || existingWhatsapp?.default_message || 'Olá! Gostaria de fazer um pedido.',
          enabled: true,
          ai_enabled: aiSettings.enabled,
          auto_responses: {
            ...currentAutoResponses,
            welcome: aiSettings.welcome_message || currentAutoResponses.welcome,
            bot_config: botConfig,
          },
          updated_at: new Date().toISOString()
        } as any, { onConflict: 'user_id' });

      if (whatsappError) throw whatsappError;

      toast({
        title: 'POP AI atualizado',
        description: 'As regras do atendente virtual foram salvas.'
      });
      fetchAiSettings();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar o POP AI.',
        variant: 'destructive'
      });
    } finally {
      setSavingAiSettings(false);
    }
  };

  const fetchAiLogs = async () => {
    if (!user?.id) return;
    setLoadingAiLogs(true);
    try {
      let query = (supabase as any)
        .from('ai_logs')
        .select('*')
        .eq('restaurant_id', user.id)
        .order('created_at', { ascending: false })
        .limit(40);

      const current = conversations.find(item => item.id === selectedConversation);
      if (current?.ai_conversation_id) {
        query = query.eq('conversation_id', current.ai_conversation_id);
      }

      const { data, error } = await query;
      if (error && !String(error.message || '').includes('relation "public.ai_logs" does not exist')) {
        throw error;
      }
      setAiLogs(data || []);
    } catch (error: any) {
      console.error('Erro ao carregar logs POP AI:', error);
    } finally {
      setLoadingAiLogs(false);
    }
  };

  const toggleCustomerSelection = (customerId: string) => {
    setSelectedCustomers(prev => 
      prev.includes(customerId) 
        ? prev.filter(id => id !== customerId)
        : [...prev, customerId]
    );
  };

  const selectAllCustomers = () => {
    const filteredCustomers = customers.filter(customer =>
      customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      customer.phone.includes(customerSearch)
    );
    setSelectedCustomers(filteredCustomers.map(c => c.id));
  };

  const clearSelection = () => {
    setSelectedCustomers([]);
  };

  const sendMassMessage = async () => {
    if (!massMessage.trim() || selectedCustomers.length === 0) return;
    const selectedPhones = customers
      .filter((customer) => selectedCustomers.includes(customer.id))
      .map((customer) => String(customer.phone || '').trim())
      .filter(Boolean);
    sessionStorage.setItem('popsystem_whatsapp_campaign_handoff', JSON.stringify({
      message: massMessage.trim(),
      phones: selectedPhones,
      createdAt: Date.now(),
    }));
    navigate('/marketing?tab=whatsapp');
  };

  const selectedConv = conversations.find(c => c.id === selectedConversation);
  const selectedCustomer = selectedConv ? customers.find((customer) => {
    return phonesAreEquivalent(customer.phone, selectedConv.customer_phone);
  }) : null;
  const slashQuery = newMessage.trim().startsWith('/') ? newMessage.trim().toLowerCase() : '';
  const suggestedQuickReplies = slashQuery
    ? quickReplies.filter((reply) => reply.shortcut.toLowerCase().startsWith(slashQuery)).slice(0, 6)
    : [];
  const dashboardMetrics = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (dashboardPeriod - 1));
    const periodConversations = conversations.filter((conversation) => new Date(conversation.created_at) >= start);
    const firstResponseSeconds = periodConversations
      .filter((conversation) => conversation.first_response_at)
      .map((conversation) => (new Date(conversation.first_response_at as string).getTime() - new Date(conversation.created_at).getTime()) / 1000)
      .filter((seconds) => seconds >= 0);
    const orderPhones = dashboardOrders.map((order) => order.customer_phone).filter(Boolean) as string[];
    const converted = periodConversations.filter((conversation) => orderPhones.some((phone) => phonesAreEquivalent(phone, conversation.customer_phone))).length;
    const handlingSeconds = periodConversations
      .filter((conversation) => conversation.resolved_at)
      .map((conversation) => (new Date(conversation.resolved_at as string).getTime() - new Date(conversation.created_at).getTime()) / 1000)
      .filter((seconds) => seconds >= 0);
    const operatorMap = new Map<string, { name: string; conversations: number; resolved: number; orders: number; conversion: number }>();
    periodConversations.forEach((conversation) => {
      const name = conversation.assigned_operator_name || 'Não atribuída';
      const conversationOrders = dashboardOrders.filter((order) => order.conversation_id === conversation.id || (order.customer_phone && phonesAreEquivalent(order.customer_phone, conversation.customer_phone))).length;
      const current = operatorMap.get(name) || { name, conversations: 0, resolved: 0, orders: 0, conversion: 0 };
      current.conversations += 1;
      current.orders += conversationOrders;
      if (conversation.queue_status === 'resolved') current.resolved += 1;
      current.conversion = current.conversations ? Math.round((current.orders / current.conversations) * 100) : 0;
      operatorMap.set(name, current);
    });
    return {
      conversations: periodConversations.length,
      unassigned: periodConversations.filter((item) => !item.assigned_operator_id && item.queue_status !== 'resolved').length,
      active: periodConversations.filter((item) => item.queue_status !== 'resolved').length,
      resolved: periodConversations.filter((item) => item.queue_status === 'resolved').length,
      averageFirstResponseSeconds: firstResponseSeconds.length ? Math.round(firstResponseSeconds.reduce((sum, value) => sum + value, 0) / firstResponseSeconds.length) : 0,
      averageHandlingSeconds: handlingSeconds.length ? Math.round(handlingSeconds.reduce((sum, value) => sum + value, 0) / handlingSeconds.length) : 0,
      orders: dashboardOrders.length,
      revenue: dashboardOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
      averageTicket: dashboardOrders.length ? dashboardOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) / dashboardOrders.length : 0,
      conversion: periodConversations.length ? Math.round((converted / periodConversations.length) * 100) : 0,
      aiResolved: periodConversations.filter((item) => item.queue_status === 'resolved' && !item.assigned_operator_id).length,
      transferredToHuman: periodConversations.filter((item) => item.human_required || item.assigned_operator_id).length,
      abandoned: periodConversations.filter((item) => item.resolution_reason === 'Cliente não respondeu').length,
      operators: Array.from(operatorMap.values()).sort((a, b) => b.conversations - a.conversations),
    };
  }, [conversations, dashboardOrders, dashboardPeriod]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <MessageSquare className="mx-auto h-8 w-8 animate-pulse text-gray-400" />
          <p className="mt-2 text-sm text-gray-500">Carregando conversas...</p>
        </div>
      </div>
    );
  }

  const filteredCustomers = customers.filter(customer =>
    customer.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    customer.phone.includes(customerSearch)
  );
  const queueCounts = conversations.reduce((counts, conversation) => {
    counts.all += 1;
    if (conversation.queue_status !== 'resolved' && conversation.queue_status !== 'waiting_customer') counts.open += 1;
    if (conversation.assigned_operator_id === operatorId && conversation.queue_status !== 'resolved') counts.mine += 1;
    if (conversation.queue_status === 'waiting_customer') counts.waiting_customer += 1;
    if (conversation.queue_status === 'resolved') counts.resolved += 1;
    return counts;
  }, { open: 0, mine: 0, waiting_customer: 0, resolved: 0, all: 0 });
  const normalizedConversationSearch = conversationSearch.trim().toLocaleLowerCase('pt-BR');
  const visibleConversations = conversations.filter((conversation) => {
    if (normalizedConversationSearch && !`${conversation.customer_name} ${conversation.customer_phone} ${conversation.last_message || ''}`.toLocaleLowerCase('pt-BR').includes(normalizedConversationSearch) && !remoteSearchConversationIds.includes(conversation.id)) return false;
    if (queueFilter === 'all') return true;
    if (queueFilter === 'mine') return conversation.assigned_operator_id === operatorId && conversation.queue_status !== 'resolved';
    if (queueFilter === 'unread') return Number(conversation.unread_count || 0) > 0;
    if (queueFilter === 'ai') return conversation.operational_status === 'AI_ACTIVE' || (!isBotPaused(conversation) && conversation.queue_status !== 'resolved');
    if (queueFilter === 'human') return conversation.operational_status === 'HUMAN_ACTIVE' || isBotPaused(conversation);
    if (queueFilter === 'waiting_customer') return conversation.queue_status === 'waiting_customer';
    if (queueFilter === 'waiting_restaurant') return conversation.operational_status === 'WAITING_RESTAURANT';
    if (queueFilter === 'resolved') return conversation.queue_status === 'resolved';
    if (queueFilter === 'archived') return conversation.operational_status === 'ARCHIVED';
    return conversation.queue_status !== 'resolved' && conversation.queue_status !== 'waiting_customer';
  });

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-emerald-900/10 bg-gradient-to-r from-[#075e54] to-[#128c7e] px-5 py-3 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><MessageSquare size={21} /> WhatsApp</h1>
            <p className="text-xs text-white/80">Atendimento em tempo real · {operatorName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={aiSettings.enabled ? 'bg-lime-400 text-emerald-950' : 'bg-red-100 text-red-700'}>
              {aiSettings.enabled ? 'IA ativa' : 'IA pausada'}
            </Badge>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-[#f1f4ef] p-1 md:grid-cols-5">
          <TabsTrigger value="conversations" className="flex items-center gap-2">
            <MessageSquare size={16} />
            Conversas ({conversations.length})
          </TabsTrigger>
          <TabsTrigger value="customers" className="flex items-center gap-2">
            <Users size={16} />
            Clientes ({customers.length})
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings size={16} />
            Configuração
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <Activity size={16} />
            Indicadores
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <Activity size={16} />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversations" className="mt-2">

      <div className={`grid min-h-[640px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-230px)] lg:grid-cols-[360px_minmax(0,1fr)] ${contextCollapsed ? '' : 'xl:grid-cols-[360px_minmax(0,1fr)_300px]'}`}>
        {/* Lista de Conversas */}
        <Card className={`${selectedConversation ? 'hidden lg:block' : 'block'} overflow-hidden rounded-none border-0 border-r border-slate-200 shadow-none`}>
          <CardHeader className="border-b bg-[#f0f2f5] px-4 pb-3 pt-3">
            <CardTitle className="flex items-center justify-between gap-2 text-lg">
              <span className="flex items-center gap-2"><Inbox className="text-[#128c7e]" size={21} /> Caixa de entrada</span>
              <Badge className="rounded-full bg-[#e8f8ef] text-[#075e54] hover:bg-[#e8f8ef]">{queueCounts.open} pendentes</Badge>
            </CardTitle>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Pesquisar ou começar nova conversa" className="h-10 rounded-lg border-0 bg-white pl-9 shadow-none" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex gap-2 overflow-x-auto border-b bg-slate-50/70 p-3 text-xs">
              {([
                ['all', 'Todas', queueCounts.all],
                ['open', 'Novas', queueCounts.open],
                ['mine', 'Minhas', queueCounts.mine],
                ['unread', 'Não lidas', conversations.filter((item) => Number(item.unread_count || 0) > 0).length],
                ['ai', 'IA', conversations.filter((item) => item.operational_status === 'AI_ACTIVE').length],
                ['human', 'Humano', conversations.filter((item) => item.operational_status === 'HUMAN_ACTIVE').length],
                ['waiting_restaurant', 'Aguardando restaurante', conversations.filter((item) => item.operational_status === 'WAITING_RESTAURANT').length],
                ['waiting_customer', 'Aguardando cliente', queueCounts.waiting_customer],
                ['resolved', 'Resolvidas', queueCounts.resolved],
                ['archived', 'Arquivadas', conversations.filter((item) => item.operational_status === 'ARCHIVED').length],
              ] as const).map(([value, label, count]) => (
                <button key={value} type="button" onClick={() => setQueueFilter(value)} className={`shrink-0 rounded-full border px-3 py-2 font-bold transition ${queueFilter === value ? 'border-[#075e54] bg-[#075e54] text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-[#25d366] hover:text-[#075e54]'}`}>
                  {label} ({count})
                </button>
              ))}
            </div>
            <div className="h-[calc(100vh-388px)] min-h-[470px] overflow-y-auto bg-white">
              {visibleConversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  <MessageSquare className="mx-auto h-8 w-8 mb-2" />
                  <p>Nenhuma conversa nesta fila.</p>
                </div>
              ) : (
                visibleConversations.map((conversation) => {
                  const minutes = waitingMinutes(conversation);
                  const priorityClass = minutes >= 5 ? '!border-l-red-500' : minutes >= 2 ? '!border-l-amber-400' : '!border-l-emerald-500';
                  return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`w-full border-0 border-b border-l-4 border-slate-100 bg-white p-3.5 text-left transition hover:bg-[#f5f6f6] ${priorityClass} ${
                      selectedConversation === conversation.id ? 'bg-[#f0f2f5]' : ''
                    }`}
                    onClick={() => setSelectedConversation(conversation.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{conversation.customer_name}</p>
                        <p className="max-w-[205px] truncate text-sm text-[#667781]">{conversation.last_message || conversation.customer_phone}</p>
                        {conversation.assigned_operator_name ? <p className="mt-1 text-xs font-semibold text-[#075e54]">Com {conversation.assigned_operator_name}</p> : null}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {Number(conversation.unread_count || 0) > 0 ? <Badge className="bg-red-500 text-white">{conversation.unread_count} nova(s)</Badge> : null}
                        {conversation.queue_status !== 'resolved' && conversation.queue_status !== 'waiting_customer' ? (
                          <Badge variant="outline" className={minutes >= 5 ? 'border-red-300 bg-red-50 text-red-700' : minutes >= 2 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}>
                            <Clock3 className="mr-1 h-3 w-3" />{formatWaitingDuration(minutes)}
                          </Badge>
                        ) : null}
                        {conversation.bot_paused && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                            Robô pausado
                          </Badge>
                        )}
                        {conversation.ai_status && (
                          <Badge variant="outline" className={conversation.human_required ? 'border-red-300 bg-red-50 text-red-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}>
                            {conversation.human_required ? 'Humano' : conversation.ai_status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(conversation.updated_at || conversation.created_at).toLocaleDateString()}
                    </p>
                  </button>
                );})
              )}
            </div>
          </CardContent>
        </Card>

        {/* Chat */}
        <Card className={`${!selectedConversation ? 'hidden lg:block' : 'block'} min-w-0 overflow-hidden rounded-none border-0 shadow-none`}>
          <CardHeader className="border-b bg-[#f0f2f5] px-4 py-2.5">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <button type="button" aria-label="Voltar às conversas" className="lg:hidden" onClick={() => setSelectedConversation(null)}><ChevronLeft size={22} /></button>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#dfe3e5] text-[#54656f]"><User size={20} /></span>
                <span><span className="block text-base">{selectedConv?.customer_name || 'Selecione uma conversa'}</span>{selectedConv ? <span className="block text-[11px] font-normal text-[#667781]">{selectedConv.customer_phone} · {isBotPaused(selectedConv) ? 'atendimento humano' : 'robô ativo'}</span> : null}</span>
                {selectedConv?.operational_status ? <Badge variant="outline" className="hidden bg-white text-[10px] font-semibold text-[#008069] sm:inline-flex">{operationalStatusLabels[selectedConv.operational_status] || selectedConv.operational_status}</Badge> : null}
              </span>
              {selectedConv && (
                <span className="flex flex-wrap gap-2">
                  {selectedConv.assigned_operator_id !== operatorId && selectedConv.queue_status !== 'resolved' ? (
                    <Button type="button" size="sm" className="rounded-xl bg-[#075e54] text-white hover:bg-[#064c44]" onClick={() => void takeConversation(selectedConv).catch((error) => toast({ title: 'Não foi possível assumir', description: error.message, variant: 'destructive' }))}>
                      <UserCheck size={16} />Assumir atendimento
                    </Button>
                  ) : null}
                  {selectedConv.queue_status !== 'resolved' ? (
                    <Button type="button" variant="outline" size="sm" className="rounded-xl border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" onClick={() => setConversationToResolve(selectedConv)}><CheckCircle2 size={16} />Resolver</Button>
                  ) : null}
                  {isBotPaused(selectedConv) ? <Button type="button" variant="outline" size="sm" onClick={() => toggleBotPause(selectedConv.id, false)} className="rounded-lg border-slate-200 text-slate-600"><PlayCircle size={16} />Voltar para IA</Button> : (
                    <span className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-semibold text-slate-600">
                      {[15, 30, 60].map((minutes) => <button key={minutes} type="button" className="rounded-md px-2 py-1.5 hover:bg-amber-50" onClick={() => toggleBotPause(selectedConv.id, true, minutes)}>{minutes}m</button>)}
                      <button type="button" className="rounded-md px-2 py-1.5 hover:bg-amber-50" onClick={() => toggleBotPause(selectedConv.id, true, minutesUntilTomorrow())}>Até amanhã</button>
                      <button type="button" className="rounded-md px-2 py-1.5 hover:bg-amber-50" onClick={() => toggleBotPause(selectedConv.id, true, null)}>Sem prazo</button>
                    </span>
                  )}
                  <button type="button" aria-label={contextCollapsed ? 'Mostrar dados do cliente' : 'Ocultar dados do cliente'} className="hidden rounded-full p-2 text-[#54656f] hover:bg-slate-200 xl:inline-flex" onClick={() => setContextCollapsed((value) => !value)}>{contextCollapsed ? <PanelRightOpen size={19} /> : <PanelRightClose size={19} />}</button>
                  {notificationPermission === 'default' ? <button type="button" onClick={() => void enableIncomingAlerts()} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600">Ativar alertas</button> : null}
                  <button type="button" aria-label="Abrir dados do cliente e pedido" className="rounded-full p-2 text-[#54656f] hover:bg-slate-200 xl:hidden" onClick={() => setMobileContextOpen(true)}><PanelRightOpen size={19} /></button>
                  <MoreVertical size={19} className="text-[#54656f]" />
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-[#efeae2] p-0">
            {selectedConversation ? (
              <div className="flex h-[calc(100vh-293px)] min-h-[576px] flex-col">
                {/* Mensagens */}
                <div ref={messagesListRef} className="flex-1 space-y-1.5 overflow-y-auto bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,.65)_0_1px,transparent_1.5px)] bg-[length:18px_18px] px-4 py-5">
                  {hasOlderMessages ? <div className="flex justify-center pb-2"><Button type="button" variant="outline" size="sm" disabled={loadingOlderMessages} onClick={() => void loadOlderMessages()} className="rounded-full border-[#d1d7db] bg-white text-xs text-[#54656f] shadow-sm">{loadingOlderMessages ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Clock3 className="mr-1 h-3.5 w-3.5" />}Carregar mensagens anteriores</Button></div> : null}
                  {messages.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                      <MessageSquare className="mx-auto h-8 w-8 mb-2" />
                      <p>Nenhuma mensagem ainda</p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender === 'bot' || message.sender === 'agent' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[82%] px-2.5 py-1.5 rounded-lg ${
                            message.sender === 'bot' || message.sender === 'agent'
                              ? message.sender === 'agent' ? 'bg-[#d9fdd3] text-slate-900 shadow-sm' : 'bg-[#cfeee8] text-slate-900 shadow-sm'
                              : 'border border-white bg-white text-slate-900 shadow-sm'
                          }`}
                        >
                          {message.sender === 'bot' ? <p className="mb-0.5 text-[10px] font-bold text-[#008069]">POP Agente</p> : null}
                          {isPossiblePaymentReceipt(message) ? <p className="mb-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">Possível comprovante de pagamento — confirme somente pelo PopPay</p> : null}
                          {message.quoted_message_id ? <p className="mb-1 border-l-2 border-[#00a884] bg-black/5 px-2 py-1 text-[10px] text-slate-500">Em resposta a uma mensagem anterior</p> : null}
                          {message.media_url && ['image', 'sticker'].includes(String(message.message_type)) ? <a href={message.media_url} target="_blank" rel="noreferrer"><img src={message.media_url} alt={message.media_name || 'Imagem recebida'} className="mb-1 max-h-72 w-full rounded-md object-contain" loading="lazy" /></a> : null}
                          {message.media_url && message.message_type === 'video' ? <video src={message.media_url} controls preload="metadata" className="mb-1 max-h-72 w-full rounded-md" /> : null}
                          {message.media_url && message.message_type === 'audio' ? <audio src={message.media_url} controls preload="metadata" className="mb-1 h-10 w-[260px] max-w-full" /> : null}
                          {message.media_url && message.message_type === 'document' ? <a href={message.media_url} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/5 p-2 hover:bg-black/10"><FileText className="h-6 w-6" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{message.media_name || 'Documento'}</span><span className="text-[10px] text-slate-500">{formatFileSize(message.media_size)}</span></span><Download className="h-4 w-4" /></a> : null}
                          {message.message_type === 'location' && message.content.includes('http') ? <a href={message.content.slice(message.content.indexOf('http'))} target="_blank" rel="noreferrer" className="block rounded bg-black/5 p-2 text-sm font-semibold text-[#008069] hover:underline"><MapPin className="mr-1 inline h-4 w-4" />Abrir localização compartilhada</a> : <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>}
                          {message.transcription ? <p className="mt-1 border-t border-black/5 pt-1 text-xs italic text-slate-600">{message.transcription}</p> : null}
                          <p className="mt-0.5 flex items-center justify-end gap-1 text-right text-[10px] text-slate-500">{new Date(message.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{message.sender !== 'customer' ? message.delivery_status === 'read' ? <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" /> : message.delivery_status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5" /> : message.delivery_status === 'sending' ? <Clock3 className="h-3 w-3" /> : <Check className="h-3.5 w-3.5" /> : null}</p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesBottomRef} />
                </div>

                {/* Input de mensagem */}
                <div className="bg-[#f0f2f5] px-2.5 pb-2.5 pt-1.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={loadingCopilot} onClick={() => void askCopilot()} className="h-7 rounded-full border-violet-200 bg-violet-50 px-3 text-[11px] font-bold text-violet-700 hover:bg-violet-100"><Sparkles className={`mr-1 h-3.5 w-3.5 ${loadingCopilot ? 'animate-pulse' : ''}`} />Copiloto</Button>
                    <span className="text-[10px] text-[#667781]">Analisa e sugere; nunca envia sozinho.</span>
                  </div>
                  {copilotSuggestion ? <div className="mb-2 rounded-xl border border-violet-200 bg-white p-3 text-xs shadow-sm"><div className="flex items-start justify-between gap-2"><div><strong className="text-violet-800">Resumo</strong><p className="mt-0.5 text-slate-600">{copilotSuggestion.summary}</p></div><button type="button" aria-label="Ignorar sugestão" onClick={() => setCopilotSuggestion(null)}><X className="h-4 w-4 text-slate-400" /></button></div>{copilotSuggestion.alert ? <p className="mt-2 rounded bg-amber-50 p-1.5 text-amber-800">{copilotSuggestion.alert}</p> : null}<p className="mt-2 rounded bg-violet-50 p-2 text-slate-700">{copilotSuggestion.suggestedReply}</p>{copilotSuggestion.possibleOrder.length ? <p className="mt-2 text-slate-600"><strong>Possível pedido:</strong> {copilotSuggestion.possibleOrder.join(' · ')}</p> : null}<div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => { setNewMessage(copilotSuggestion.suggestedReply); setCopilotSuggestion(null); }} className="h-7 bg-violet-700 text-xs hover:bg-violet-800">Usar resposta</Button>{copilotSuggestion.possibleOrder.length ? <Button type="button" size="sm" variant="outline" onClick={() => createOrderFromConversation(copilotSuggestion.possibleOrder)} className="h-7 text-xs">Montar no PDV</Button> : null}</div></div> : null}
                  <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
                    <button type="button" onClick={prepareMenuMessage} className="shrink-0 rounded-full bg-[#d9fdd3] px-2.5 py-1 text-[11px] font-bold text-[#075e54]"><Utensils className="mr-1 inline h-3 w-3" />Cardápio</button>
                    <button type="button" onClick={() => createOrderFromConversation()} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#075e54]"><ShoppingBag className="mr-1 inline h-3 w-3" />Criar pedido</button>
                    <button type="button" disabled={generatingCharge} onClick={() => void generatePixCharge()} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#075e54] disabled:opacity-50"><WalletCards className="mr-1 inline h-3 w-3" />{generatingCharge ? 'Gerando PIX...' : 'Cobrar'}</button>
                    <button type="button" onClick={prepareDeliveryMessage} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#075e54]"><Truck className="mr-1 inline h-3 w-3" />Entrega</button>
                  </div>
                  <div className="mb-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
                    {operatorQuickReplies.map((reply) => <button key={reply} type="button" onClick={() => setNewMessage(reply)} className="shrink-0 rounded-full border border-[#d1d7db] bg-white px-2.5 py-1 text-[11px] font-medium text-[#3b4a54] hover:border-[#00a884] hover:text-[#008069]">{reply}</button>)}
                  </div>
                  {suggestedQuickReplies.length ? <div className="mb-1.5 overflow-hidden rounded-lg border border-[#d1d7db] bg-white shadow-lg">{suggestedQuickReplies.map((reply) => <button key={reply.id} type="button" onClick={() => applyQuickReply(reply)} className="flex w-full items-start gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-[#f0f2f5]"><strong className="text-xs text-[#008069]">{reply.shortcut}</strong><span className="line-clamp-2 text-xs text-[#54656f]">{reply.content}</span></button>)}</div> : null}
                  <div className="flex items-end gap-2">
                  <button type="button" aria-label="Adicionar emoji" onClick={() => setNewMessage((value) => `${value}${value ? ' ' : ''}🙂`)} className="mb-1 grid h-10 w-10 place-items-center rounded-full text-[#54656f] hover:bg-slate-200"><Smile size={22} /></button>
                  <input ref={mediaInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,application/pdf,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void sendMediaFile(file); }} />
                  <button type="button" disabled={uploadingMedia || recordingAudio} aria-label="Anexar arquivo" onClick={() => mediaInputRef.current?.click()} className="mb-1 hidden h-10 w-10 place-items-center rounded-full text-[#54656f] hover:bg-slate-200 disabled:opacity-40 sm:grid"><Paperclip size={21} /></button>
                  <Textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="min-h-[44px] flex-1 resize-none rounded-xl border-0 bg-white focus-visible:ring-0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  {newMessage.trim() ? <Button aria-label="Enviar mensagem" disabled={sendingMessage || uploadingMedia} onClick={sendMessage} className="h-11 w-11 self-end rounded-full bg-[#25d366] p-0 text-[#075e54] hover:bg-[#20c45b]">
                    {sendingMessage ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                  </Button> : <Button type="button" aria-label={recordingAudio ? 'Parar e enviar áudio' : 'Gravar áudio'} disabled={uploadingMedia} onClick={() => void toggleAudioRecording()} className={`h-11 w-11 self-end rounded-full p-0 ${recordingAudio ? 'animate-pulse bg-red-500 text-white hover:bg-red-600' : 'bg-[#25d366] text-[#075e54] hover:bg-[#20c45b]'}`}>{recordingAudio ? <Square size={15} fill="currentColor" /> : <Mic size={19} />}</Button>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[460px] text-gray-500">
                <div className="text-center">
                  <MessageSquare className="mx-auto h-12 w-12 mb-4" />
                  <p>Selecione uma conversa para começar</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {!contextCollapsed || mobileContextOpen ? (
          <aside className={`${mobileContextOpen ? 'fixed inset-y-0 right-0 z-50 block w-[min(92vw,360px)] shadow-2xl' : 'hidden'} overflow-y-auto border-l border-slate-200 bg-white xl:static xl:z-auto xl:block xl:w-auto xl:shadow-none`}>
            {selectedConv ? (
              <div>
                <div className="sticky top-0 z-10 flex justify-end border-b bg-white p-2 xl:hidden"><button type="button" aria-label="Fechar dados do cliente e pedido" onClick={() => setMobileContextOpen(false)} className="rounded-full p-2 text-[#54656f] hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
                <div className="border-b px-5 py-6 text-center">
                  <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#dfe3e5] text-[#667781]"><User size={36} /></div>
                  <h2 className="mt-3 font-semibold text-[#111b21]">{selectedConv.customer_name}</h2>
                  <p className="text-sm text-[#667781]">+{selectedConv.customer_phone}</p>
                </div>
                <div className="space-y-4 border-b p-4 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#008069]">Dados do cliente</p>
                  <div className="flex items-start gap-3 text-[#3b4a54]"><Phone className="mt-0.5 h-4 w-4" /><span>{selectedCustomer?.phone || selectedConv.customer_phone}</span></div>
                  <div className="flex items-start gap-3 text-[#3b4a54]"><MapPin className="mt-0.5 h-4 w-4" /><span>{selectedCustomer?.address || recentOrders[0]?.customer_address || 'Endereço ainda não informado'}</span></div>
                  <div className="flex items-start gap-3 text-[#3b4a54]"><UserCheck className="mt-0.5 h-4 w-4" /><span>{selectedConv.assigned_operator_name || 'Atendimento ainda não assumido'}</span></div>
                  {staff.length ? <label className="block"><span className="mb-1 block text-xs font-semibold text-[#667781]">Transferir atendimento</span><select value={selectedConv.assigned_operator_id || ''} onChange={(event) => void transferConversation(selectedConv, event.target.value).catch((error) => toast({ title: 'Não foi possível transferir', description: error.message, variant: 'destructive' }))} className="h-9 w-full rounded-lg border border-[#d1d7db] bg-white px-2 text-sm"><option value="">Selecione um operador</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : null}
                  {selectedCustomer ? <div><span className="mb-1.5 block text-xs font-semibold text-[#667781]">Tags do CRM</span><div className="flex flex-wrap gap-1">{Array.from(new Set([...['VIP', 'Novo cliente', 'Reclamação', 'Delivery', 'Inativo', 'Lead'], ...(Array.isArray(selectedCustomer.tags) ? selectedCustomer.tags : [])])).map((tag) => { const active = Array.isArray(selectedCustomer.tags) && selectedCustomer.tags.includes(tag); return <button key={tag} type="button" onClick={() => void toggleCustomerTag(tag)} className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${active ? 'border-[#00a884] bg-[#d9fdd3] text-[#075e54]' : 'border-slate-200 text-slate-500'}`}>{tag}</button>; })}</div><div className="mt-2 flex gap-1"><Input value={customTag} onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addCustomCustomerTag(); } }} placeholder="Nova tag" className="h-8 text-xs" /><Button type="button" size="icon" className="h-8 w-8 shrink-0 bg-[#00a884]" disabled={!customTag.trim()} onClick={() => void addCustomCustomerTag()} aria-label="Adicionar tag"><Plus className="h-4 w-4" /></Button></div></div> : null}
                </div>
                <div className="p-4">
                  <div className="mb-3 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-[#008069]">Pedidos recentes</p><ShoppingBag className="h-4 w-4 text-[#008069]" /></div>
                  <Button type="button" size="sm" onClick={() => createOrderFromConversation()} className="mb-3 w-full bg-[#00a884] text-white hover:bg-[#008f72]"><ShoppingBag className="mr-2 h-4 w-4" />Criar pedido no PDV</Button>
                  {recentOrders.length ? <div className="space-y-2">{recentOrders.map((order) => (
                    <div key={order.id} className="rounded-lg bg-[#f0f2f5] p-3 text-xs">
                      <div className="flex justify-between gap-2"><strong>#{order.order_number}</strong><span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(order.total || 0))}</span></div>
                      <p className="mt-1 capitalize text-[#667781]">{order.status} · {new Date(order.created_at).toLocaleDateString('pt-BR')}</p>
                      <button type="button" onClick={() => repeatOrderInPdv(order)} className="mt-2 font-semibold text-[#008069] hover:underline">Revisar e repetir no PDV</button>
                    </div>
                  ))}</div> : <p className="rounded-lg bg-[#f7f8fa] p-3 text-xs text-[#667781]">Nenhum pedido encontrado para este número.</p>}
                  {recentOrders[0] ? <div className="mt-3 grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" disabled={generatingCharge} onClick={() => void generatePixCharge()} className="border-emerald-200 text-xs text-emerald-800"><WalletCards className="mr-1 h-3.5 w-3.5" />Cobrar PIX</Button><Button type="button" size="sm" variant="outline" onClick={prepareDeliveryMessage} className="border-emerald-200 text-xs text-emerald-800"><Truck className="mr-1 h-3.5 w-3.5" />Enviar status</Button></div> : null}
                  {paymentCheckout ? <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">Pagamento: {paymentCheckout.status === 'PAID' ? 'Pago' : paymentCheckout.status === 'FAILED' ? 'Falhou' : 'Aguardando confirmação'}</p> : null}
                  {deliveryAssignment ? <div className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-900"><strong>Entrega: {deliveryAssignment.status}</strong>{deliveryAssignment.driver_name ? <p>{deliveryAssignment.driver_name}{deliveryAssignment.driver_phone ? ` · ${deliveryAssignment.driver_phone}` : ''}</p> : null}</div> : null}
                </div>
                {selectedCustomer ? <div className="border-t p-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#008069]">Endereços</p><div className="space-y-1.5">{customerAddresses.map((address) => <button key={address.id} type="button" onClick={() => setNewMessage(`Confirma a entrega em ${address.address}${address.neighborhood ? `, ${address.neighborhood}` : ''}?`)} className="w-full rounded-lg bg-[#f7f8fa] p-2 text-left text-xs"><strong>{address.label}</strong><span className="block text-[#667781]">{address.address}</span></button>)}</div><div className="mt-2 flex gap-1"><Input value={newAddress} onChange={(event) => setNewAddress(event.target.value)} placeholder="Novo endereço" className="h-8 text-xs" /><Button type="button" size="icon" className="h-8 w-8 shrink-0 bg-[#00a884]" disabled={!newAddress.trim()} onClick={() => void addCustomerAddress()} aria-label="Salvar endereço"><Plus className="h-4 w-4" /></Button></div></div> : null}
                <div className="border-t p-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#008069]">Notas internas</p>
                  <Textarea value={internalNoteDraft} onChange={(event) => setInternalNoteDraft(event.target.value)} placeholder="Visível apenas para a equipe" rows={2} className="resize-none text-xs" />
                  <Button type="button" size="sm" variant="outline" disabled={!internalNoteDraft.trim()} onClick={() => void saveInternalNote()} className="mt-2 w-full border-[#00a884] text-[#008069]">Salvar nota</Button>
                  <div className="mt-3 space-y-2">{internalNotes.map((note) => <div key={note.id} className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-950"><p>{note.content}</p><p className="mt-1 text-[10px] text-amber-800/70">{note.created_by_name} · {new Date(note.created_at).toLocaleString('pt-BR')}</p></div>)}</div>
                </div>
                {conversationEvents.length ? <div className="border-t p-4"><p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#008069]">Histórico do atendimento</p><div className="space-y-2 border-l-2 border-[#d9fdd3] pl-3">{conversationEvents.map((event) => <div key={event.id} className="text-xs"><p className="text-[#3b4a54]">{event.description}</p><p className="text-[10px] text-[#8696a0]">{new Date(event.created_at).toLocaleString('pt-BR')}</p></div>)}</div></div> : null}
              </div>
            ) : <div className="grid h-full place-items-center p-6 text-center text-sm text-[#667781]">Selecione uma conversa para ver o contexto do cliente.</div>}
          </aside>
        ) : null}
      </div>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={20} />
                Clientes Cadastrados ({customers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Busca e filtros */}
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Buscar por nome ou telefone..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button 
                  variant="outline" 
                  onClick={selectedCustomers.length === filteredCustomers.length ? clearSelection : selectAllCustomers}
                >
                  {selectedCustomers.length === filteredCustomers.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </Button>
              </div>

              {/* Lista de clientes */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredCustomers.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Users className="mx-auto h-8 w-8 mb-2" />
                    <p>Nenhum cliente encontrado</p>
                  </div>
                ) : (
                  filteredCustomers.map((customer) => (
                    <div
                      key={customer.id}
                      className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                        selectedCustomers.includes(customer.id) ? 'bg-blue-50 border-blue-200' : ''
                      }`}
                      onClick={() => toggleCustomerSelection(customer.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          <p className="text-sm text-gray-500">{customer.phone}</p>
                          {customer.address && (
                            <p className="text-xs text-gray-400">{customer.address}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400">
                            Cadastrado em {new Date(customer.created_at).toLocaleDateString()}
                          </p>
                          {selectedCustomers.includes(customer.id) && (
                            <Badge variant="default" className="mt-1">Selecionado</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Mensagem em massa */}
              {selectedCustomers.length > 0 && (
                <div className="mt-6 p-4 border rounded-lg bg-blue-50">
                  <div className="flex items-center gap-2 mb-2">
                    <Mail size={16} className="text-blue-600" />
                    <span className="font-medium text-blue-800">
                      Preparar campanha para {selectedCustomers.length} cliente(s)
                    </span>
                  </div>
                  <Textarea
                    value={massMessage}
                    onChange={(e) => setMassMessage(e.target.value)}
                    placeholder="Digite sua mensagem..."
                    className="mb-2"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button onClick={sendMassMessage} disabled={!massMessage.trim()}>
                      <Send size={16} className="mr-2" />
                      Revisar envio seguro
                    </Button>
                    <Button variant="outline" onClick={clearSelection}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles size={20} />
                  Cérebro do POP AI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold">Nome do atendente</span>
                    <Input
                      value={aiSettings.assistant_name}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, assistant_name: e.target.value }))}
                      placeholder="POP AI"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold">Tom de voz</span>
                    <Input
                      value={aiSettings.tone}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, tone: e.target.value }))}
                      placeholder="simples, vendedor, divertido..."
                    />
                  </label>
                </div>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Saudação inicial</span>
                  <Textarea
                    value={aiSettings.welcome_message}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, welcome_message: e.target.value }))}
                    placeholder="Olá! Como posso te ajudar hoje?"
                    rows={3}
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-2 block">
                    <span className="text-sm font-semibold">Estilo de atendimento</span>
                    <Textarea
                      value={aiSettings.service_style}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, service_style: e.target.value }))}
                      placeholder="Ex: atendimento rápido, simpático, informal, chamando o cliente pelo nome quando souber."
                      rows={4}
                    />
                  </label>

                  <label className="space-y-2 block">
                    <span className="text-sm font-semibold">Fluxo ideal de pedido</span>
                    <Textarea
                      value={aiSettings.order_flow}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, order_flow: e.target.value }))}
                      placeholder="Ex: primeiro enviar cardápio, depois confirmar retirada/entrega, forma de pagamento e nome."
                      rows={4}
                    />
                  </label>
                </div>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Mensagem fora de horário</span>
                  <Textarea
                    value={aiSettings.out_of_hours_message}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, out_of_hours_message: e.target.value }))}
                    placeholder="Agora estamos fechados, mas posso deixar seu pedido encaminhado."
                    rows={3}
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-2 block">
                    <span className="text-sm font-semibold">Regras de entrega</span>
                    <Textarea
                      value={aiSettings.delivery_rules}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, delivery_rules: e.target.value }))}
                      placeholder="Ex: atende até 5km, taxa depende do bairro, não prometer prazo exato sem confirmação."
                      rows={4}
                    />
                  </label>

                  <label className="space-y-2 block">
                    <span className="text-sm font-semibold">Regras de pagamento</span>
                    <Textarea
                      value={aiSettings.payment_rules}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, payment_rules: e.target.value }))}
                      placeholder="Ex: aceitar Pix, dinheiro e cartão; perguntar troco quando for dinheiro."
                      rows={4}
                    />
                  </label>
                </div>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Como recomendar produtos e combos</span>
                  <Textarea
                    value={aiSettings.menu_recommendation_rules}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, menu_recommendation_rules: e.target.value }))}
                    placeholder="Ex: sugerir combos para família, bebidas com pastel, adicionais no açaí, produtos em destaque primeiro."
                    rows={3}
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Transferência para humano</span>
                  <Textarea
                    value={aiSettings.human_transfer_message}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, human_transfer_message: e.target.value }))}
                    rows={2}
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Quando chamar atendente humano</span>
                  <Textarea
                    value={aiSettings.human_handoff_rules}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, human_handoff_rules: e.target.value }))}
                    placeholder="Ex: reclamações, pedido atrasado, cancelamento, cliente irritado, dúvidas fiscais, alteração de pedido já enviado."
                    rows={3}
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Regras específicas do restaurante</span>
                  <Textarea
                    value={aiSettings.specific_rules}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, specific_rules: e.target.value }))}
                    placeholder="Ex: nunca oferecer entrega fora do bairro X; priorizar combo família; pedir ponto da carne..."
                    rows={5}
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-sm font-semibold">Coisas que o bot nunca deve responder/prometer</span>
                  <Textarea
                    value={aiSettings.forbidden_responses}
                    onChange={(e) => setAiSettings(prev => ({ ...prev, forbidden_responses: e.target.value }))}
                    placeholder="Uma regra por linha. Ex: não prometer entrega em 20 minutos; não dar desconto sem autorização."
                    rows={4}
                  />
                </label>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="rounded-lg border p-4">
                    <span className="text-sm font-semibold">IA ativa</span>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={aiSettings.enabled}
                        onChange={(e) => setAiSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="h-5 w-5 accent-green-600"
                      />
                      <span className="text-sm text-gray-600">{aiSettings.enabled ? 'Atendendo' : 'Pausada'}</span>
                    </div>
                  </label>
                  <label className="rounded-lg border p-4">
                    <span className="text-sm font-semibold">Upsell inteligente</span>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={aiSettings.upsell_enabled}
                        onChange={(e) => setAiSettings(prev => ({ ...prev, upsell_enabled: e.target.checked }))}
                        className="h-5 w-5 accent-green-600"
                      />
                      <span className="text-sm text-gray-600">{aiSettings.upsell_enabled ? 'Ligado' : 'Desligado'}</span>
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold">Memória da conversa</span>
                    <Input
                      type="number"
                      min={10}
                      max={80}
                      value={aiSettings.max_history_messages}
                      onChange={(e) => setAiSettings(prev => ({ ...prev, max_history_messages: Number(e.target.value || 30) }))}
                    />
                  </label>
                </div>

                <Button onClick={saveAiSettings} disabled={savingAiSettings} className="gap-2">
                  {savingAiSettings ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar POP AI
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-lg">Respostas rápidas</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Input value={quickReplyShortcut} onChange={(event) => setQuickReplyShortcut(event.target.value)} placeholder="Atalho: /entrega" />
                  <Textarea value={quickReplyContent} onChange={(event) => setQuickReplyContent(event.target.value)} placeholder="Mensagem. Use {{cliente_nome}}, {{link_cardapio}}, {{pedido_numero}}..." rows={4} />
                  <Button type="button" onClick={() => void saveQuickReply()} disabled={!quickReplyShortcut.trim() || !quickReplyContent.trim()} className="w-full bg-[#00a884] hover:bg-[#008f72]"><Plus className="mr-2 h-4 w-4" />Salvar resposta</Button>
                  <div className="space-y-2">{quickReplies.map((reply) => <div key={reply.id} className="flex items-start gap-2 rounded-lg border p-2"><button type="button" onClick={() => setQuickReplyContent(reply.content)} className="min-w-0 flex-1 text-left"><strong className="block text-xs text-[#008069]">{reply.shortcut}</strong><span className="line-clamp-2 text-xs text-slate-500">{reply.content}</span></button><button type="button" aria-label={`Excluir ${reply.shortcut}`} onClick={() => void deleteQuickReply(reply.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button></div>)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Central integrada</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="rounded-lg bg-emerald-50 p-3 text-emerald-800">Atendimento em tempo real, mídia, áudio, CRM, pedidos, PopPay e entrega usam os módulos reais do PopSystem.</div>
                  <div className="rounded-lg bg-orange-50 p-3 text-orange-800">Quando o humano responde, a IA é pausada para impedir respostas simultâneas.</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="flex justify-end"><label className="flex items-center gap-2 text-sm font-semibold text-slate-600">Período<select value={dashboardPeriod} onChange={(event) => setDashboardPeriod(Number(event.target.value) as 1 | 7 | 30)} className="h-9 rounded-md border border-slate-200 bg-white px-3 font-normal"><option value={1}>Hoje</option><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option></select></label></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Conversas', dashboardMetrics.conversations],
              ['Não atribuídas', dashboardMetrics.unassigned],
              ['Em atendimento', dashboardMetrics.active],
              ['Resolvidas', dashboardMetrics.resolved],
              ['Primeira resposta média', dashboardMetrics.averageFirstResponseSeconds ? `${Math.floor(dashboardMetrics.averageFirstResponseSeconds / 60)}m ${dashboardMetrics.averageFirstResponseSeconds % 60}s` : '-'],
              ['Tempo médio atendimento', dashboardMetrics.averageHandlingSeconds ? `${Math.floor(dashboardMetrics.averageHandlingSeconds / 60)}m` : '-'],
              ['Pedidos', dashboardMetrics.orders],
              ['Conversão', `${dashboardMetrics.conversion}%`],
              ['Vendas vinculadas', new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dashboardMetrics.revenue)],
              ['Ticket médio', new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dashboardMetrics.averageTicket)],
              ['Resolvidas pela IA', dashboardMetrics.aiResolved],
              ['Transferidas ao humano', dashboardMetrics.transferredToHuman],
              ['Sem resposta', dashboardMetrics.abandoned],
            ].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-[#075e54]">{value}</p></CardContent></Card>)}
          </div>
          <Card>
            <CardHeader><CardTitle>Atendimento por operador — hoje</CardTitle></CardHeader>
            <CardContent>
              {dashboardMetrics.operators.length ? <div className="divide-y">{dashboardMetrics.operators.map((operatorMetric) => <div key={operatorMetric.name} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto_auto_auto]"><strong>{operatorMetric.name}</strong><span>{operatorMetric.conversations} atendimento(s)</span><span>{operatorMetric.orders} pedido(s)</span><span className="text-emerald-700">{operatorMetric.conversion}% conversão</span></div>)}</div> : <p className="text-sm text-slate-500">Nenhum atendimento no período.</p>}
            </CardContent>
          </Card>
          <p className="text-xs text-slate-500">Os indicadores usam somente conversas e pedidos reais registrados hoje. Nenhuma preferência ou conversão é estimada pela IA.</p>
        </TabsContent>

        <TabsContent value="logs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Activity size={20} />
                  Logs do POP AI
                </span>
                <Button variant="outline" size="sm" onClick={fetchAiLogs} className="gap-2">
                  <RefreshCw size={16} className={loadingAiLogs ? 'animate-spin' : ''} />
                  Atualizar
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {aiLogs.length === 0 ? (
                <div className="py-10 text-center text-gray-500">
                  <Activity className="mx-auto mb-3 h-8 w-8" />
                  <p>Nenhum log do POP AI ainda.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[620px] overflow-y-auto">
                  {aiLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border bg-white p-4">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Badge variant={log.error ? 'destructive' : 'outline'}>{log.action}</Badge>
                        <span className="text-xs text-gray-500">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      {log.error && <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">{log.error}</p>}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                        <pre className="max-h-44 overflow-auto rounded bg-slate-50 p-3">{JSON.stringify(log.input || {}, null, 2)}</pre>
                        <pre className="max-h-44 overflow-auto rounded bg-emerald-50 p-3">{JSON.stringify(log.output || {}, null, 2)}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog open={Boolean(conversationToResolve)} onOpenChange={(open) => { if (!open && !resolvingConversation) setConversationToResolve(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver atendimento</DialogTitle>
            <DialogDescription>Escolha o motivo para manter o histórico operacional correto.</DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm font-semibold">Motivo
            <select value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-normal">
              <option>Atendimento concluído</option>
              <option>Pedido realizado</option>
              <option>Dúvida respondida</option>
              <option>Cliente não respondeu</option>
              <option>Cancelamento solicitado</option>
              <option>Contato indevido ou spam</option>
            </select>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={resolvingConversation} onClick={() => setConversationToResolve(null)}>Cancelar</Button>
            <Button type="button" disabled={resolvingConversation} onClick={() => void confirmResolution()} className="bg-[#00a884] hover:bg-[#008f72]">{resolvingConversation ? 'Resolvendo...' : 'Confirmar resolução'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppChatbot;
