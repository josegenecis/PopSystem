export type PopAiConversationStatus =
  | 'ai_active'
  | 'human_required'
  | 'human_active'
  | 'waiting_customer'
  | 'waiting_payment'
  | 'order_confirmed'
  | 'closed';

export type PopAiMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface PopAiSettings {
  id?: string;
  restaurant_id: string;
  enabled: boolean;
  assistant_name: string;
  tone: string;
  welcome_message?: string | null;
  out_of_hours_message?: string | null;
  human_transfer_message: string;
  upsell_enabled: boolean;
  max_history_messages: number;
  human_handoff_timeout_minutes?: number;
  auto_resume_human_handoff?: boolean;
  forbidden_responses?: string[];
  specific_rules?: string | null;
  ai_hours?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PopAiConversation {
  id: string;
  restaurant_id: string;
  customer_id?: string | null;
  phone: string;
  status: PopAiConversationStatus;
  ai_enabled: boolean;
  owner?: 'AI' | 'HUMAN' | 'HYBRID';
  current_state?: string;
  last_human_message_at?: string | null;
  ai_resume_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PopAiCustomer {
  id: string;
  name: string;
  phone: string;
  total_orders?: number;
  average_ticket?: number;
  last_order_at?: string | null;
  last_order_id?: string | null;
  preferences?: Record<string, unknown>;
  tags?: string[];
}

export interface PopAiIncomingMessage {
  supabase: any;
  restaurantId: string;
  instanceName: string;
  customerPhone: string;
  text: string;
  media?: any;
  providerMessageId?: string | null;
  messageType?: string | null;
  quotedProviderMessageId?: string | null;
  persistedInbound?: {
    conversationId: string;
    conversation?: any;
    messageId?: string;
  } | null;
}

export interface PopAiEngineResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  details?: unknown;
  conversationId?: string;
  aiConversationId?: string;
  replyText?: string;
  status?: PopAiConversationStatus;
}
