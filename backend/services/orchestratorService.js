import { getLLMService } from './llmFactory.js';
import { mcpService } from './mcpService.js';
import { contextService } from './contextService.js';
import { whitelistService } from './whitelistService.js';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

function extractTextFromLLMResponse(response) {
  if (typeof response === 'string') {
    return response;
  }

  if (response?.content && Array.isArray(response.content)) {
    const textParts = response.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('\n\n');
    }
  }

  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text;
  }

  return 'No se recibió contenido de texto del proveedor.';
}

function buildInitialContextMessage(contextText) {
  return {
    role: 'user',
    content: [
      'CONTEXTO INICIAL DEL SISTEMA (NO lo repitas textualmente al usuario):',
      contextText,
      'Usa este contexto como guía para responder esta conversación.'
    ].join('\n\n')
  };
}

function buildWhitelistPolicyMessage(whitelistedDomains) {
  const maxDomainsToShow = 120;
  const visibleDomains = whitelistedDomains.slice(0, maxDomainsToShow);
  const hiddenCount = Math.max(whitelistedDomains.length - visibleDomains.length, 0);

  return {
    role: 'user',
    content: [
      'POLITICA DE ENFORCEMENT WHITELIST (OBLIGATORIA):',
      'Solo puedes consultar y citar fuentes dentro de estos dominios permitidos.',
      'Si una fuente no pertenece a esta lista, debes rechazarla como no autorizada.',
      '',
      'DOMINIOS_PERMITIDOS:',
      ...visibleDomains.map((domain) => `- ${domain}`),
      hiddenCount > 0 ? `- ... y ${hiddenCount} dominios adicionales` : null
    ].filter(Boolean).join('\n')
  };
}

function resolveContextKey(provider, contextKey) {
  if (typeof contextKey === 'string' && contextKey.trim()) {
    return contextKey.trim();
  }

  if (['claude', 'openai', 'gemini'].includes(provider)) {
    return 'webscraper-mcp';
  }

  return 'default';
}

function emitStatus(onStatus, status, details) {
  if (typeof onStatus === 'function') {
    onStatus(status, details);
  }
}

function extractToolUses(response) {
  const toolUses = [];

  if (response?.content && Array.isArray(response.content)) {
    const contentToolUses = response.content
      .filter((part) => part?.type === 'tool_use' && typeof part.name === 'string')
      .map((part) => ({
        id: part.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        name: part.name,
        input: part.input || {}
      }));

    toolUses.push(...contentToolUses);
  }

  if (response?.tool_calls && Array.isArray(response.tool_calls)) {
    const openAIToolUses = response.tool_calls
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall) => {
        let parsedArgs = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }

        return {
          id: toolCall.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          name: toolCall.function.name,
          input: parsedArgs
        };
      });

    toolUses.push(...openAIToolUses);
  }

  return toolUses;
}

function stringifyToolResult(result) {
  if (typeof result === 'string') {
    return result;
  }

  if (result?.content && Array.isArray(result.content)) {
    const textParts = result.content
      .map((item) => {
        if (typeof item?.text === 'string') return item.text;
        if (typeof item === 'string') return item;
        return null;
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function buildToolSummaryMessage(toolUses) {
  return {
    role: 'assistant',
    content: `Llamé ${toolUses.length} tool(s): ${toolUses.map((toolUse) => toolUse.name).join(', ')}`
  };
}

function buildToolResultUserMessage(toolResults) {
  return {
    role: 'user',
    content: toolResults
      .map((result) => {
        const status = result.is_error ? 'ERROR' : 'OK';
        return `Resultado Tool [${status}] ${result.name}:\n${result.content}`;
      })
      .join('\n\n')
  };
}

async function runToolLoop({ llmService, messages, tools, onStatus, provider }) {
  const MAX_TOOL_ITERATIONS = 8;
  const visitedHostnames = new Set();
  const maxSubdomainsPerRequest = Number.isFinite(env.MAX_SUBDOMAINS_PER_REQUEST)
    ? Math.max(1, env.MAX_SUBDOMAINS_PER_REQUEST)
    : 3;

  let response = await llmService.sendMessage(messages, tools);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const toolUses = extractToolUses(response);

    if (toolUses.length === 0) {
      return response;
    }

    emitStatus(onStatus, 'tool_executing', `Ejecutando ${toolUses.length} herramienta(s)`);

    const toolResults = [];

    for (const toolUse of toolUses) {
      emitStatus(onStatus, 'tool_call', `Tool: ${toolUse.name}`);

      const hostnamesInArgs = whitelistService.extractHostnamesFromPayload(toolUse.input || {});

      for (const hostname of hostnamesInArgs) {
        visitedHostnames.add(hostname);
      }

      if (visitedHostnames.size > maxSubdomainsPerRequest) {
        throw new Error(
          `Enforcement Subdominios: se excedió el límite de ${maxSubdomainsPerRequest} subdominios por request. ` +
          `Visitados: ${Array.from(visitedHostnames).join(', ')}`
        );
      }

      try {
        const toolResult = await mcpService.callTool(toolUse.name, toolUse.input || {});
        toolResults.push({
          name: toolUse.name,
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: stringifyToolResult(toolResult)
        });
      } catch (error) {
        toolResults.push({
          name: toolUse.name,
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error ejecutando tool ${toolUse.name}: ${error.message}`,
          is_error: true
        });
      }
    }

    if (provider === 'claude') {
      messages.push({
        role: 'assistant',
        content: response.content
      });

      messages.push({
        role: 'user',
        content: toolResults.map(({ tool_use_id, content, is_error }) => ({
          type: 'tool_result',
          tool_use_id,
          content,
          ...(is_error ? { is_error: true } : {})
        }))
      });
    } else {
      messages.push(buildToolSummaryMessage(toolUses));
      messages.push(buildToolResultUserMessage(toolResults));
    }

    emitStatus(onStatus, 'provider_processing', 'Procesando resultados de tools');
    response = await llmService.sendMessage(messages, tools);
  }

  throw new Error('Se excedió el máximo de iteraciones de tools MCP.');
}

export async function processUserMessage(userMessage, conversationHistory = [], provider = 'claude', contextKey, options = {}) {
  try {
    const { onStatus } = options;

    emitStatus(onStatus, 'preparing', 'Preparando proveedor y contexto');

    const llmService = getLLMService(provider);
    const effectiveContextKey = resolveContextKey(provider, contextKey);
    let whitelistedDomains = [];

    if (['claude', 'openai', 'gemini'].includes(provider) && env.WHITELIST_ENFORCEMENT_ENABLED) {
      emitStatus(onStatus, 'whitelist_loading', 'Cargando dominios permitidos');
      whitelistedDomains = await whitelistService.getWhitelistedDomains();

      if (whitelistedDomains.length === 0) {
        throw new Error('Enforcement Whitelist: la colección Whitelisted está vacía o no disponible.');
      }

      emitStatus(onStatus, 'whitelist_validating', 'Validando URLs contra Whitelisted');
      const validation = await whitelistService.validateUrlsAgainstWhitelist([
        userMessage,
        ...conversationHistory.map((message) => message?.content).filter(Boolean)
      ]);

      if (!validation.ok) {
        throw new Error(
          `Enforcement Whitelist: URL no permitida detectada (${validation.blockedHostnames.join(', ')}). ` +
          'Solo se permiten fuentes incluidas en la colección Whitelisted.'
        );
      }
    }

    const isFirstMessage = !Array.isArray(conversationHistory) || conversationHistory.length === 0;
    emitStatus(onStatus, 'context_loading', 'Cargando contexto inicial');
    const initialContext = isFirstMessage
      ? await contextService.getInitialContext(effectiveContextKey)
      : null;
    
    // ✓ Formatea los mensajes para Claude
    const messages = [
      ...conversationHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      })),
      {
        role: 'user',
        content: userMessage
      }
    ];

    if (initialContext) {
      messages.unshift(buildInitialContextMessage(initialContext));
    }

    if (['claude', 'openai', 'gemini'].includes(provider) && env.WHITELIST_ENFORCEMENT_ENABLED && whitelistedDomains.length > 0 && isFirstMessage) {
      messages.unshift(buildWhitelistPolicyMessage(whitelistedDomains));
    }

    const tools =
      provider === 'claude'
        ? mcpService.getToolsForClaude()
        : mcpService.getAvailableTools();

    let response;
    try {
      emitStatus(onStatus, 'provider_processing', `Consultando ${provider}`);
      if (tools.length > 0) {
        response = await runToolLoop({ llmService, messages, tools, onStatus, provider });
      } else {
        response = await llmService.sendMessage(messages, tools);
      }
    } catch (error) {
      const shouldRetryWithoutTools =
        tools.length > 0 &&
        typeof error?.message === 'string' &&
        (error.message.includes('input_schema') ||
          error.message.includes('JSON schema is invalid') ||
          error.message.includes('tools.'));

      if (!shouldRetryWithoutTools) {
        throw error;
      }

      logger.warn('Claude rechazó el schema de tools MCP. Reintentando sin tools...');
      emitStatus(onStatus, 'provider_retry', 'Reintentando proveedor sin tools');
      response = await llmService.sendMessage(messages, []);
    }

    const responseText = extractTextFromLLMResponse(response);

    logger.info(`Response from ${provider}:`, responseText);

    emitStatus(onStatus, 'finalizing', 'Procesando respuesta final');

    return {
      text: responseText,
      provider,
      conversationId: null,
      contextKey: effectiveContextKey,
      contextApplied: Boolean(isFirstMessage && initialContext)
    };
  } catch (error) {
    logger.error('Error in orchestrator:', error);
    throw error;
  }
}