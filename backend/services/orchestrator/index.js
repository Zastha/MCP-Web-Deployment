/**
 * orchestrator/index.js
 *
 * Entry point público del orquestador. Es el único archivo de este directorio
 * que el resto de la aplicación importa directamente.
 */

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

  // Paso 1 — truncar mensajes assistant demasiado largos
  const truncated = conversationHistory.map((msg) => {
    if (
      msg.role === 'assistant' &&
      typeof msg.content === 'string' &&
      msg.content.length > MAX_MSG_CHARS
    ) {
      return {
        ...msg,
        content: msg.content.slice(0, MAX_MSG_CHARS) + '... [respuesta truncada para optimizar contexto]'
      };
    }
    return msg;
  });

  // Paso 2 — conservar solo los últimos MAX_HISTORY_TURNS turnos
  // Un turno = 2 mensajes (user + assistant). Tomamos los últimos N*2 mensajes.
  const maxMessages = MAX_HISTORY_TURNS * 2;
  if (truncated.length > maxMessages) {
    return truncated.slice(truncated.length - maxMessages);
  }

  return truncated;
}

/**
 * Procesa un mensaje del usuario y devuelve la respuesta del LLM.
 */
export async function processUserMessage(
  userMessage,
  conversationHistory = [],
  provider = 'claude',
  contextKey,
  options = {}
) {
  try {
    const { onStatus } = options;

    emitStatus(onStatus, 'preparing', 'Preparando proveedor y contexto');

    const llmService     = getLLMService(provider);
    const isFirstMessage = !Array.isArray(conversationHistory) || conversationHistory.length === 0;

    const {
      effectiveContextKey,
      systemPrompt,
      cachedResult
    } = await prepareContext({
      provider,
      contextKey,
      userMessage,
      conversationHistory,
      isFirstMessage,
      onStatus
    });

    // Si el backend encontró un cache hit en MongoDB, devolver directamente
    // sin gastar tokens en llamar al LLM
    if (cachedResult) {
      logger.info(`Cache hit para provider ${provider} — devolviendo resultado cacheado`);
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
    emitStatus(onStatus, 'history_sanitized',
      `Historial: ${safeHistory.length} mensajes (${conversationHistory.length} originales)`
    );

    const messages = buildConversationMessages(safeHistory, userMessage);

    const allTools =
      provider === 'claude'  ? mcpService.getToolsForClaude()  :
      provider === 'openai'  ? mcpService.getToolsForOpenAI()  :
      provider === 'gemini'  ? mcpService.getToolsForGemini()  :
      mcpService.getAvailableTools();

    // La heurística conversacional solo aplica a Claude, que tiene el
    // sistema de clasificación A/B en su system prompt y decide por sí mismo
    // si usar tools o no.
    // OpenAI y Gemini siempre reciben las tools — sin ellas no saben
    // que los MCPs existen y responden desde su conocimiento base.
    const looksConversational =
      provider === 'claude' &&
      userMessage.trim().length < 60 &&
      !/\b(tasa|ingreso|pib|inflacion|precio|dato|estadistica|promedio|trimestre|a[\xf1n]o|2024|2025|porcentaje|salario|empleo|desempleo|pobreza|indice)\b/i
        .test(userMessage);

    const tools = looksConversational ? [] : allTools;

    emitStatus(onStatus, 'provider_processing', `Consultando ${provider}`);

    let response;

    try {
      response = tools.length > 0
        ? await runToolLoop({ llmService, messages, tools, provider, systemPrompt, onStatus })
        : await llmService.sendMessage(messages, [], systemPrompt);

    } catch (error) {
      const isSchemaError =
        tools.length > 0 &&
        typeof error?.message === 'string' &&
        (
          error.message.includes('input_schema') ||
          error.message.includes('JSON schema is invalid') ||
          error.message.includes('tools.') ||
          error.message.includes('Invalid schema for function') ||
          error.message.includes('invalid_function_parameters') ||
          (error.status === 400 && error.message.includes('function'))
        );

      const isRateLimit =
        error?.status === 429 ||
        error?.message?.includes('rate_limit') ||
        error?.message?.includes('429');

      const isOverloaded =
        error?.status === 529 ||
        error?.message?.includes('overloaded') ||
        error?.message?.includes('529');

      if (isRateLimit || isOverloaded) {
        // Para rate limit, respetar el retry-after del header (default 65s)
        // Para overload, esperar 10 segundos
        const waitSeconds = isRateLimit ? 65 : 10;
        logger.warn(`API limitada (${isRateLimit ? '429' : '529'}). Esperando ${waitSeconds}s antes de reintentar...`);
        emitStatus(onStatus, 'provider_retry',
          isRateLimit
            ? `Limite de tokens alcanzado — reintentando en ${waitSeconds}s...`
            : `API saturada — reintentando en ${waitSeconds}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
        response = tools.length > 0
          ? await runToolLoop({ llmService, messages, tools, provider, systemPrompt, onStatus })
          : await llmService.sendMessage(messages, [], systemPrompt);
        return {
          text: extractTextFromLLMResponse(response),
          provider,
          conversationId: null,
          contextKey: effectiveContextKey,
          contextApplied: Boolean(isFirstMessage && systemPrompt)
        };
      }

      if (!isSchemaError) {
        throw error;
      }

      logger.warn('Schema de tools MCP rechazado por el provider. Reintentando sin tools...');
      emitStatus(onStatus, 'provider_retry', 'Reintentando sin tools');
      response = await llmService.sendMessage(messages, [], systemPrompt);
    }

    const responseText = extractTextFromLLMResponse(response);

    logger.info(`Response from ${provider}:`, responseText);
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