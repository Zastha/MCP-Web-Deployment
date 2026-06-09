import { getLLMService }               from '../llmFactory.js';
import { mcpService }                  from '../mcpService.js';
import { logger }                      from '../../utils/logger.js';
import { prepareContext }              from './contextBuilder.js';
import { buildConversationMessages }   from './messageBuilder.js';
import { runToolLoop }                 from './toolLoop.js';
import { emitStatus, extractTextFromLLMResponse } from './responseUtils.js';

const MAX_MSG_CHARS    = 800;   
const MAX_HISTORY_TURNS = 6;    

function sanitizeHistory(conversationHistory) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return [];
  }

  const truncated = conversationHistory.map((msg) => {
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > MAX_MSG_CHARS) {
      return {
        ...msg,
        content: msg.content.slice(0, MAX_MSG_CHARS) + '... [respuesta truncada para optimizar contexto]'
      };
    }
    return msg;
  });

  const maxMessages = MAX_HISTORY_TURNS * 2;
  if (truncated.length > maxMessages) {
    return truncated.slice(truncated.length - maxMessages);
  }
  return truncated;
}

async function executeWithRetry(fn, onStatus) {
  try {
    return await fn();
  } catch (error) {
    const isRateLimit = error?.status === 429 || error?.message?.includes('rate_limit') || error?.message?.includes('429');
    const isOverloaded = error?.status === 529 || error?.message?.includes('overloaded') || error?.message?.includes('529');

    if (isRateLimit || isOverloaded) {
      const waitSeconds = isRateLimit ? 65 : 10;
      logger.warn(`[Orchestrator] API saturada (${error.status || '529'}). Esperando ${waitSeconds}s...`);
      emitStatus(onStatus, 'provider_retry', `Servidor saturado. Reintentando en ${waitSeconds}s...`);
      
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      return await fn(); // Segundo intento limpio
    }
    throw error;
  }
}

export async function processUserMessage(userMessage, conversationHistory = [], provider = 'claude', contextKey, options = {}) {
  try {
    const { onStatus } = options;
    emitStatus(onStatus, 'preparing', 'Preparando proveedor y contexto');

    const llmService     = getLLMService(provider);
    const isFirstMessage = !Array.isArray(conversationHistory) || conversationHistory.length === 0;

    const { effectiveContextKey, systemPrompt, cachedResult } = await prepareContext({
      provider,
      contextKey,
      userMessage,
      conversationHistory,
      isFirstMessage,
      onStatus
    });

    if (cachedResult) {
      logger.info(`Cache hit para provider ${provider} — devolviendo resultado`);
      const cachedText = [
        `**Dato encontrado en cache:**`,
        `${cachedResult.resumen_analitico || ''}`,
        ``,
        `**Datos:** ${JSON.stringify(cachedResult.datos_recolectados, null, 2)}`,
        `**Fuente:** ${(cachedResult.links_exactos || []).join(', ')}`,
      ].join('\n');

      return {
        text:           cachedText,
        provider,
        conversationId: null,
        contextKey:     effectiveContextKey,
        contextApplied: true,
      };
    }

    const safeHistory = sanitizeHistory(conversationHistory);
    const messages = buildConversationMessages(safeHistory, userMessage);

    const allTools =
      provider === 'claude'  ? mcpService.getToolsForClaude()  :
      provider === 'openai'  ? mcpService.getToolsForOpenAI()  :
      provider === 'gemini'  ? mcpService.getToolsForGemini()  :
      mcpService.getAvailableTools();

    const looksConversational =
      provider === 'claude' &&
      userMessage.trim().length < 60 &&
      !/\b(tasa|ingreso|pib|inflacion|precio|dato|estadistica|promedio|trimestre|a[\xf1n]o|2024|2025|porcentaje|salario|empleo|desempleo|pobreza)\b/i.test(userMessage);

    const tools = looksConversational ? [] : allTools;
    emitStatus(onStatus, 'provider_processing', `Consultando ${provider}`);

    let response;
    try {
      if (tools.length > 0) {
        // Corre el ToolLoop de forma directa. Los reintentos de red granulares 
        // pertenecen a las llamadas internas del loop o de los servicios específicos.
        response = await runToolLoop({ llmService, messages, tools, provider, systemPrompt, onStatus });
      } else {
        response = await executeWithRetry(() => llmService.sendMessage(messages, [], systemPrompt), onStatus);
      }
    } catch (error) {
      const isSchemaError = error.message?.includes('input_schema') || error.message?.includes('schema') || error.message?.includes('function');
      if (tools.length > 0 && isSchemaError) {
        logger.warn('Schema de tools MCP rechazado. Reintentando de forma segura sin herramientas...');
        emitStatus(onStatus, 'provider_retry', 'Reintentando sin herramientas por conflicto de Schema');
        response = await llmService.sendMessage(messages, [], systemPrompt);
      } else {
        throw error;
      }
    }

    const responseText = extractTextFromLLMResponse(response);
    emitStatus(onStatus, 'finalizing', 'Procesando respuesta final');

    return {
      text:           responseText,
      provider,
      conversationId: null,
      contextKey:     effectiveContextKey,
      contextApplied: Boolean(isFirstMessage && systemPrompt)
    };
  } catch (error) {
    logger.error('Error in orchestrator:', error);
    throw error;
  }
}