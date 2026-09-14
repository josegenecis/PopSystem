import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/utils/invokeEdgeFunction';
import { formatBRL } from '@/lib/currency';

export interface AgentCommandResult {
  success: boolean;
  message: string;
  metadata?: any;
}

export type SupportChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

export async function cancelAgentBackgroundJob(userId: string, jobId: string): Promise<AgentCommandResult> {
  try {
    if (!String(userId || '').trim() || !String(jobId || '').trim()) {
      return { success: false, message: 'Job inválido para cancelamento.' };
    }

    const { data, status } = await invokeEdgeFunction('ai-agent', {
      userId,
      command: 'cancelar job em segundo plano',
      cancelJobId: jobId
    });

    if (status === 200 && data?.success) {
      return {
        success: true,
        message: data.message || 'Cancelamento solicitado.',
        metadata: data.metadata || {}
      };
    }

    return {
      success: false,
      message: String(data?.error || data?.message || 'Não consegui cancelar este job agora.')
    };
  } catch (error: any) {
    return {
      success: false,
      message: String(error?.message || 'Não consegui cancelar este job agora.')
    };
  }
}

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  is_active: boolean;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  expense_date: string;
  receipt_url?: string;
  user_id: string;
  created_at: string;
}

// Expense categories for validation
const EXPENSE_CATEGORIES = [
  'alimentação',
  'transporte', 
  'insumos',
  'outros',
  'aluguel',
  'água',
  'luz',
  'gás',
  'manutenção',
  'marketing',
  'equipamentos'
];

const isMissingProductImagesCommand = (command: string) => {
  const text = String(command || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    /produtos?.{0,40}sem imagem/.test(text) &&
    /(gerar|gere|criar|crie|fazer|preencher|colocar|adicionar).{0,50}imagens?/.test(text)
  ) || /imagens?.{0,50}produtos?.{0,50}sem imagem/.test(text);
};

/**
 * Process natural language commands and execute deterministic tasks
 */
export async function processAgentCommand(
  command: string,
  userId: string,
  imageBase64?: string,
  conversationHistory: SupportChatHistoryMessage[] = [],
  operatorId?: string,
): Promise<AgentCommandResult> {
  try {
    if (!String(userId || '').trim()) {
      return { success: false, message: 'Faça login para usar o assistente.' };
    }

    // Log the command for tracking
    await logAgentActivity(userId, 'command_received', imageBase64 ? `${command} [Imagem Anexada]` : command);

    // 1. Tentar processar via Edge Function (AI Agent)
    let edgeFailureMsg: string | null = null;
    try {
        console.log('[AgentService] Enviando para Edge Function ai-agent...');
        const payload: any = {
            command: command,
            userId: userId,
            conversationHistory,
            operatorId: operatorId || undefined,
        };
        
        if (imageBase64) {
            payload.imageBase64 = imageBase64;
        }

        const { data, status } = await invokeEdgeFunction('ai-agent', payload);

        if (status === 200 && data && data.success) {
            await logAgentActivity(userId, 'ai_command_success', `IA: ${data.message.substring(0, 50)}...`);
            return {
                success: true,
                message: data.message,
                metadata: {
                  ...(data.metadata || {}),
                  tool_results: data.tool_results
                }
            };
        }

        const edgeMsg = String(data?.error || data?.message || 'Falha ao executar no agente.');
        edgeFailureMsg = edgeMsg;
        await logAgentActivity(userId, 'ai_command_error', edgeMsg.substring(0, 120));
    } catch (edgeError) {
        console.error('[AgentService] Erro na Edge Function:', edgeError);
        edgeFailureMsg = String((edgeError as any)?.message || 'Falha ao executar no agente.');
    }

    // 2. Fallback local apenas para o proprietário sem sessão de operador.
    // Operadores devem passar pelo servidor, onde suas permissões são verificadas.
    if (operatorId) {
      return {
        success: false,
        message: edgeFailureMsg
          ? `Não consegui concluir agora: ${edgeFailureMsg}`
          : 'Não consegui concluir agora. Tente novamente em instantes.',
      };
    }

    // 3. Fallback: Processamento Local (Regex Legacy)
    console.log('[AgentService] Usando fallback local...');
    const normalizedCommand = command.toLowerCase().trim();

    if (isMissingProductImagesCommand(command)) {
      return {
        success: false,
        message: edgeFailureMsg
          ? `Não consegui iniciar a geração de imagens agora: ${edgeFailureMsg}`
          : 'Não consegui iniciar a geração de imagens agora.'
      };
    }

    if (isIngredientDisableCommand(normalizedCommand)) {
      return await handleIngredientDisable(normalizedCommand, userId);
    } else if (isExpenseRegistrationCommand(normalizedCommand)) {
      return await handleExpenseRegistration(normalizedCommand, userId);
    } else if (isIngredientQueryCommand(normalizedCommand)) {
      return await handleIngredientQuery(normalizedCommand, userId);
    } else if (isHelpCommand(normalizedCommand)) {
      return await handleHelpCommand();
    } else {
      // Se a Edge Function falhou E o regex não pegou, retornamos erro amigável
      return {
        success: false,
        message: edgeFailureMsg
          ? `A IA está temporariamente indisponível: ${edgeFailureMsg}. Tente comandos simples como "Desativar [ingrediente]" ou "Lançar despesa".`
          : 'Não reconheci este comando. Tente "ajuda" para ver exemplos.'
      };
    }
  } catch (error: any) {
    console.error('Error processing agent command:', error);
    await logAgentActivity(userId, 'command_error', command, { error: error.message });
    
    return {
      success: false,
      message: 'Erro ao processar comando. Tente novamente.'
    };
  }
}

export async function processSupportChat(command: string, userId: string, conversationHistory: SupportChatHistoryMessage[] = []): Promise<AgentCommandResult> {
  const { data, status } = await invokeEdgeFunction('ai-agent', {
    command,
    userId,
    conversationHistory,
    supportMode: true
  });

  if (status === 200 && data && data.success) {
    return { success: true, message: data.message, metadata: { tool_results: data.tool_results } };
  }
  return { success: false, message: data?.error || data?.message || 'Não foi possível responder agora.' };
}

// ... (Existing regex functions renamed to processLocalAgentCommand or kept as helpers)

// Helper to execute disabling directly with AI params
async function executeDisableIngredient(ingredientName: string, userId: string, aiReply: string): Promise<AgentCommandResult> {
  try {
    const { data: ingredients, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .ilike('name', `%${ingredientName}%`);

    if (error) throw error;

    if (!ingredients || ingredients.length === 0) {
      return {
        success: false,
        message: `Não encontrei nenhum ingrediente ativo chamado "${ingredientName}".`
      };
    }

    const ingredientIds = ingredients.map(ing => ing.id);
    await supabase
      .from('ingredients')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', ingredientIds);

    await logAgentActivity(userId, 'ingredient_disable', `IA: Desativado(s) ${ingredients.length} ingrediente(s): ${ingredients.map(ing => ing.name).join(', ')}`);

    return {
      success: true,
      message: aiReply || `✅ ${ingredients.length} ingrediente(s) desativado(s): ${ingredients.map(ing => ing.name).join(', ')}`,
      metadata: { action: 'ingredient_disable', count: ingredients.length }
    };
  } catch (e: any) {
    return { success: false, message: `Erro: ${e.message}` };
  }
}

async function executeRegisterExpense(amount: number, category: string, description: string, userId: string, aiReply: string): Promise<AgentCommandResult> {
  try {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, message: 'Valor inválido. A despesa deve ser maior que zero.' };
    }
     const expense: Omit<Expense, 'id' | 'created_at'> = {
      description: description,
      amount: amount,
      category: category.toLowerCase(),
      expense_date: new Date().toISOString().split('T')[0],
      user_id: userId
    };

    await supabase.from('expenses').insert(expense);
    await logAgentActivity(userId, 'expense_register', `IA: Despesa registrada: ${formatBRL(amount)}`);

    return {
      success: true,
      message: aiReply || `✅ Despesa registrada: ${formatBRL(amount)} em ${category}`,
      metadata: { action: 'expense_register' }
    };
  } catch (e: any) {
    return { success: false, message: `Erro: ${e.message}` };
  }
}

/**
 * Legacy local processing (Fallback)
 */
async function processLocalAgentCommand(command: string, userId: string): Promise<AgentCommandResult> {
    // ... (Old processAgentCommand logic here)
    const normalizedCommand = command.toLowerCase().trim();
    if (isIngredientDisableCommand(normalizedCommand)) {
      return await handleIngredientDisable(normalizedCommand, userId);
    } else if (isExpenseRegistrationCommand(normalizedCommand)) {
      return await handleExpenseRegistration(normalizedCommand, userId);
    } else if (isIngredientQueryCommand(normalizedCommand)) {
      return await handleIngredientQuery(normalizedCommand, userId);
    } else if (isHelpCommand(normalizedCommand)) {
      return await handleHelpCommand();
    } else {
      return {
        success: false,
        message: 'Não entendi. (Modo Offline)'
      };
    }
}


/**
 * Check if command is for disabling ingredients
 */
function isIngredientDisableCommand(command: string): boolean {
  const patterns = [
    /desativar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /desabilitar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /remover\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /tirar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i
  ];
  
  return patterns.some(pattern => pattern.test(command));
}

/**
 * Handle ingredient disable command
 */
async function handleIngredientDisable(command: string, userId: string): Promise<AgentCommandResult> {
  const patterns = [
    /desativar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /desabilitar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /remover\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i,
    /tirar\s+(.+?)\s*(?:de\s+)?(?:todos\s+os\s+)?produtos?/i
  ];
  
  let ingredientName = '';
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      ingredientName = match[1].trim();
      break;
    }
  }
  
  if (!ingredientName) {
    return {
      success: false,
      message: 'Não consegui identificar o ingrediente. Tente: "Desativar carne de sol de todos os produtos"'
    };
  }

  try {
    // Find ingredients matching the name (fuzzy search)
    const { data: ingredients, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .ilike('name', `%${ingredientName}%`);

    if (error) throw error;

    if (!ingredients || ingredients.length === 0) {
      return {
        success: false,
        message: `Nenhum ingrediente ativo encontrado com o nome "${ingredientName}"`
      };
    }

    // Disable all matching ingredients
    const ingredientIds = ingredients.map(ing => ing.id);
    const { error: updateError } = await supabase
      .from('ingredients')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', ingredientIds);

    if (updateError) throw updateError;

    // Log the action
    await logAgentActivity(userId, 'ingredient_disable', `Desativado(s) ${ingredients.length} ingrediente(s): ${ingredients.map(ing => ing.name).join(', ')}`);

    return {
      success: true,
      message: `✅ ${ingredients.length} ingrediente(s) desativado(s) com sucesso: ${ingredients.map(ing => ing.name).join(', ')}`,
      metadata: {
        action: 'ingredient_disable',
        count: ingredients.length,
        ingredients: ingredients.map(ing => ing.name)
      }
    };
  } catch (error) {
    console.error('Error disabling ingredients:', error);
    return {
      success: false,
      message: `Erro ao desativar ingrediente "${ingredientName}": ${error.message}`
    };
  }
}

/**
 * Check if command is for expense registration
 */
function isExpenseRegistrationCommand(command: string): boolean {
  const patterns = [
    /lançar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /registrar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /adicionar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /despesa\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i
  ];
  
  return patterns.some(pattern => pattern.test(command));
}

/**
 * Handle expense registration command
 */
async function handleExpenseRegistration(command: string, userId: string): Promise<AgentCommandResult> {
  const patterns = [
    /lançar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /registrar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /adicionar\s+despesa\s+de\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i,
    /despesa\s+r?\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:para\s+)?(.+)?/i
  ];
  
  let amount = 0;
  let category = '';
  
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      amount = parseFloat(match[1]);
      category = match[2] ? match[2].trim().toLowerCase() : '';
      break;
    }
  }
  
  if (amount <= 0) {
    return {
      success: false,
      message: 'Não consegui identificar o valor da despesa. Tente: "Lançar despesa de R$ 150,00 para alimentação"'
    };
  }

  // Validate category
  let validatedCategory = category;
  if (!validatedCategory || !EXPENSE_CATEGORIES.includes(validatedCategory)) {
    // Try to extract category from command context
    if (command.includes('alimentação') || command.includes('comida')) {
      validatedCategory = 'alimentação';
    } else if (command.includes('transporte') || command.includes('gasolina')) {
      validatedCategory = 'transporte';
    } else if (command.includes('insumo') || command.includes('material')) {
      validatedCategory = 'insumos';
    } else {
      validatedCategory = 'outros';
    }
  }

  // Generate description from command
  const description = command
    .replace(/lançar|registrar|adicionar/gi, '')
    .replace(/despesa\s+de\s+r?\$?\s?\d+(?:\.\d{1,2})?/gi, '')
    .replace(/para\s+\w+/gi, '')
    .trim() || `Despesa de ${formatBRL(amount)}`;

  try {
    const expense: Omit<Expense, 'id' | 'created_at'> = {
      description: description.charAt(0).toUpperCase() + description.slice(1),
      amount: amount,
      category: validatedCategory,
      expense_date: new Date().toISOString().split('T')[0], // Today's date
      user_id: userId
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(expense)
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await logAgentActivity(userId, 'expense_register', `Despesa registrada: ${formatBRL(amount)} para ${validatedCategory}`);

    return {
      success: true,
      message: `✅ Despesa registrada com sucesso: ${formatBRL(amount)} para ${validatedCategory}`,
      metadata: {
        action: 'expense_register',
        expense: data
      }
    };
  } catch (error) {
    console.error('Error registering expense:', error);
    return {
      success: false,
      message: `Erro ao registrar despesa: ${error.message}`
    };
  }
}

/**
 * Check if command is for querying ingredients
 */
function isIngredientQueryCommand(command: string): boolean {
  const patterns = [
    /mostrar\s+ingredientes?/i,
    /listar\s+ingredientes?/i,
    /ver\s+ingredientes?/i,
    /ingredientes?\s+ativos?/i,
    /quantos\s+ingredientes?/i
  ];
  
  return patterns.some(pattern => pattern.test(command));
}

/**
 * Handle ingredient query command
 */
async function handleIngredientQuery(command: string, userId: string): Promise<AgentCommandResult> {
  try {
    const { data: ingredients, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    if (!ingredients || ingredients.length === 0) {
      return {
        success: true,
        message: 'Nenhum ingrediente ativo encontrado.'
      };
    }

    const ingredientList = ingredients.map(ing => 
      `• ${ing.name} (${ing.category}) - ${formatBRL(ing.price)}/${ing.unit}`
    ).join('\n');

    return {
      success: true,
      message: `📋 Ingredientes ativos (${ingredients.length}):\n${ingredientList}`,
      metadata: {
        action: 'ingredient_query',
        count: ingredients.length,
        ingredients: ingredients
      }
    };
  } catch (error) {
    console.error('Error querying ingredients:', error);
    return {
      success: false,
      message: `Erro ao buscar ingredientes: ${error.message}`
    };
  }
}

/**
 * Check if command is for help
 */
function isHelpCommand(command: string): boolean {
  const patterns = [
    /ajuda/i,
    /help/i,
    /comandos/i,
    /o\s+que\s+você\s+faz/i,
    /como\s+usar/i
  ];
  
  return patterns.some(pattern => pattern.test(command));
}

/**
 * Handle help command
 */
async function handleHelpCommand(): Promise<AgentCommandResult> {
  return {
    success: true,
    message: `🤖 **Comandos disponíveis:**

**Controle de Ingredientes:**
• "Desativar [ingrediente] de todos os produtos"
• "Mostrar ingredientes ativos"

**Lançamento de Despesas:**
• "Lançar despesa de R$ [valor] para [categoria]"
• Categorias: alimentação, transporte, insumos, outros

**Exemplos:**
• "Desativar carne de sol de todos os produtos"
• "Lançar despesa de R$ 150,00 para alimentação"
• "Mostrar ingredientes ativos"`
  };
}

/**
 * Log agent activity for audit purposes
 */
async function logAgentActivity(userId: string, actionType: string, description: string, metadata?: any) {
  try {
    await supabase.from('agent_activity_logs').insert({
      user_id: userId,
      action_type: actionType,
      description: description,
      metadata: metadata || {},
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error logging agent activity:', error);
  }
}
