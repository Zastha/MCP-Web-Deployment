import { mcpService }                from '../mcpService.js';
import { whitelistService }          from '../whitelistService.js';
import { env }                       from '../../config/environment.js';
import { emitStatus, stringifyToolResult } from './responseUtils.js';
import { normalizeToolResultForClaude }    from './imageUtils.js';
import { extractToolUses, appendToolResultsToMessages } from './messageBuilder.js';


const MAX_TOOL_ITERATIONS = 8;

function resolveMaxSubdomains() {
  return Number.isFinite(env.MAX_SUBDOMAINS_PER_REQUEST)
    ? Math.max(1, env.MAX_SUBDOMAINS_PER_REQUEST)
    : 3;
}

function enforceSubdomainLimit(visitedHostnames, toolInput, maxSubdomains) {
  const hostnames = whitelistService.extractHostnamesFromPayload(toolInput || {});

  for (const hostname of hostnames) {
    visitedHostnames.add(hostname);
  }

  if (visitedHostnames.size > maxSubdomains) {
    throw new Error(
      `Enforcement Subdominios: se excedió el límite de ${maxSubdomains} subdominios por request. ` +
      `Visitados: ${Array.from(visitedHostnames).join(', ')}`
    );
  }
}

function isRecordCollectionFind(toolUse) {
  if (toolUse?.name !== 'find') {
    return false;
  }

  const payload = JSON.stringify(toolUse?.input ?? {});
  return /"collection"\s*:\s*"Record"|"collection"\s*:\s*\{[^}]*"Record"|\bRecord\b/i.test(payload);
}

function isListCollectionsTool(toolUse) {
  return toolUse?.name === 'list-collections';
}

function isEmptyMongoFindResult(toolResult) {
  const rawText = stringifyToolResult(toolResult).trim();

  if (!rawText) {
    return true;
  }

  try {
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed)) {
      return parsed.length === 0;
    }

    if (parsed && typeof parsed === 'object') {
      const candidates = [parsed.documents, parsed.items, parsed.results, parsed.data, parsed.content];

      for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) {
          return false;
        }

        if (Array.isArray(candidate) && candidate.length === 0) {
          return true;
        }
      }

      if (typeof parsed.count === 'number') {
        return parsed.count === 0;
      }

      if (typeof parsed.total === 'number') {
        return parsed.total === 0;
      }
    }
  } catch {
    // Si no es JSON, seguimos con heurísticas de texto.
  }

  return /\b(no\s+se\s+encontraron|sin\s+resultados|0\s+documentos|\[\s*\]|\{\s*\})\b/i.test(rawText);
}

function isEmptyListCollectionsResult(toolResult) {
  const rawText = stringifyToolResult(toolResult).trim();

  if (!rawText) {
    return true;
  }

  try {
    const parsed = JSON.parse(rawText);

    if (Array.isArray(parsed)) {
      return parsed.length === 0;
    }

    if (parsed && typeof parsed === 'object') {
      const candidates = [parsed.collections, parsed.items, parsed.results, parsed.data, parsed.content];

      for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) {
          return false;
        }

        if (Array.isArray(candidate) && candidate.length === 0) {
          return true;
        }
      }
    }
  } catch {
    // Si no es JSON, seguimos con heurísticas de texto.
  }

  return /\b(no\s+hay\s+colecciones|sin\s+colecciones|0\s+colecciones|\[\s*\]|\{\s*\})\b/i.test(rawText);
}

function buildExplicitEmptyRecordInstruction(toolResult) {
  const rawText = stringifyToolResult(toolResult).trim();

  return [
    'BOOTSTRAP RESULT: La consulta a Record no devolvio documentos relevantes.',
    'ACCION OBLIGATORIA: continuar inmediatamente con Fase 1 de webscraping / extraccion externa.',
    'Siguiente paso recomendado: usar Whitelisted para ordenar fuentes candidatas y luego aplicar la herramienta de scraping adecuada (Puppeteer, PDF Reader, PDF Vision, Mistral OCR o CSV Editor segun la fuente).',
    'PROHIBIDO: pedir al usuario que suba un archivo si la consulta puede resolverse con fuentes externas ya registradas.',
    '',
    'Detalle original del tool:',
    rawText || 'Sin detalle adicional del tool.'
  ].join('\n');
}

function buildExplicitEmptyCollectionsInstruction(toolResult) {
  const rawText = stringifyToolResult(toolResult).trim();

  return [
    'BOOTSTRAP RESULT: No hay colecciones disponibles o list-collections devolvio vacio.',
    'ACCION OBLIGATORIA: continuar inmediatamente con Fase 1 de webscraping / extraccion externa.',
    'Siguiente paso recomendado: usar Whitelisted para ordenar fuentes candidatas y luego aplicar la herramienta de scraping adecuada (Puppeteer, PDF Reader, PDF Vision, Mistral OCR o CSV Editor segun la fuente).',
    'PROHIBIDO: pedir al usuario una coleccion, archivo o cadena de conexion adicional cuando la fuente esperada es externa.',
    '',
    'Detalle original del tool:',
    rawText || 'Sin detalle adicional del tool.'
  ].join('\n');
}


async function executeAndNormalizeTool(toolUse, provider) {
  try {
    const toolResult = await mcpService.callTool(toolUse.name, toolUse.input || {});
    const shouldForceScrapingFallback =
      (isRecordCollectionFind(toolUse) && isEmptyMongoFindResult(toolResult)) ||
      (isListCollectionsTool(toolUse) && isEmptyListCollectionsResult(toolResult));

    const fallbackInstruction = isListCollectionsTool(toolUse)
      ? buildExplicitEmptyCollectionsInstruction(toolResult)
      : buildExplicitEmptyRecordInstruction(toolResult);

    if (provider === 'claude') {
      const normalized = await normalizeToolResultForClaude(toolResult);
      return {
        name:        toolUse.name,
        type:        'tool_result',
        tool_use_id: toolUse.id,
        content:     shouldForceScrapingFallback
          ? fallbackInstruction
          : normalized.content,
        ...(normalized.is_error ? { is_error: true } : {})
      };
    }

    return {
      name:        toolUse.name,
      type:        'tool_result',
      tool_use_id: toolUse.id,
      content:     shouldForceScrapingFallback
        ? fallbackInstruction
        : stringifyToolResult(toolResult)
    };

  } catch (error) {
    return {
      name:        toolUse.name,
      type:        'tool_result',
      tool_use_id: toolUse.id,
      content:     `Error ejecutando tool ${toolUse.name}: ${error.message}`,
      is_error:    true
    };
  }
}


 
export async function runToolLoop({
  llmService,
  messages,
  tools,
  provider,
  systemPrompt = '',
  onStatus
}) {
  const maxSubdomains    = resolveMaxSubdomains();
  const visitedHostnames = new Set();

  // Primera llamada — incluye el system prompt
  let response = await llmService.sendMessage(messages, tools, systemPrompt);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const toolUses = extractToolUses(response);

    if (toolUses.length === 0) {
      return response;
    }

    emitStatus(onStatus, 'tool_executing', `Ejecutando ${toolUses.length} herramienta(s)`);

    // Ejecutar cada tool call en secuencia
    const toolResults = [];

    for (const toolUse of toolUses) {
      emitStatus(onStatus, 'tool_call', `Tool: ${toolUse.name}`);

      enforceSubdomainLimit(visitedHostnames, toolUse.input, maxSubdomains);

      const toolResult = await executeAndNormalizeTool(toolUse, provider);
      toolResults.push(toolResult);
    }

    appendToolResultsToMessages({ messages, provider, response, toolUses, toolResults });

    emitStatus(onStatus, 'provider_processing', 'Procesando resultados de tools');

    // Gemini mantiene el contexto del chat en el objeto response._chat.
    // Usar sendToolResults para enviar los function responses en el formato
    // nativo de Gemini — si se usa sendMessage normal, Gemini pierde el
    // contexto de las function calls y entra en bucle infinito.
    if (provider === 'gemini' && typeof llmService.sendToolResults === 'function' && response._chat) {
      response = await llmService.sendToolResults(response, toolResults);
    } else {
      response = await llmService.sendMessage(messages, tools);
    }
  }

  throw new Error('Se excedió el máximo de iteraciones de tools MCP.');
}