import { contextService }    from '../contextService.js';
import { whitelistService }  from '../whitelistService.js';
import { env }               from '../../config/environment.js';
import { emitStatus }        from './responseUtils.js';
import { loadWorkflowData }  from '../mongoDataService.js';


const SUPPORTED_PROVIDERS = ['claude', 'openai', 'gemini'];

const MAX_WHITELIST_DOMAINS_IN_PROMPT = 120;

const EXTERNAL_DATA_REQUEST_RE = /\b(ingreso|ingresos|transferencia|transferencias|porcentaje|porcentual|estad[íi]stic|dato|datos|tasa|pib|inflaci[óo]n|promedio|salario|empleo|desempleo|pobreza|censo|urbanas?|rural|localidades?|anual|anuales|2016|2024|webscraping|scraping|whitelisted|bootstrap)\b/i;

function resolveContextKey(provider, contextKey) {
  if (typeof contextKey === 'string' && contextKey.trim()) {
    return contextKey.trim();
  }

  // Cada provider tiene su propio contexto optimizado:
  //   claude   → webscraper-mcp    (clasificación A/B, workflow JSON, multimodal)
  //   openai   → webscraper-openai (instrucciones de acción directa, más corto)
  //   gemini   → webscraper-openai (mismo formato que OpenAI por ahora)
  if (provider === 'claude')  return 'webscraper-mcp';
  if (provider === 'openai')  return 'webscraper-openai';
  if (provider === 'gemini')  return 'webscraper-gemini';  

  return 'default';
}


function buildSystemPrompt(contextText, whitelistedDomains = []) {
  const parts = [];

  if (contextText) {
    parts.push(
      'CONTEXTO INICIAL DEL SISTEMA (NO lo repitas textualmente al usuario):',
      contextText,
      'Usa este contexto como guía para responder esta conversación.'
    );
  }

  if (whitelistedDomains.length > 0) {
    const visible = whitelistedDomains.slice(0, MAX_WHITELIST_DOMAINS_IN_PROMPT);
    const hidden  = Math.max(whitelistedDomains.length - visible.length, 0);

    parts.push(
      '',
      'POLITICA DE ENFORCEMENT WHITELIST (OBLIGATORIA):',
      'Solo puedes consultar y citar fuentes dentro de estos dominios permitidos.',
      'Si una fuente no pertenece a esta lista, debes rechazarla como no autorizada.',
      '',
      'DOMINIOS_PERMITIDOS:',
      ...visible.map((d) => `- ${d}`),
      ...(hidden > 0 ? [`- ... y ${hidden} dominios adicionales`] : [])
    );
  }

  return parts.join('\n');
}

function shouldLoadDetailedContext(provider, userMessage, isFirstMessage) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    return false;
  }

  // OpenAI y Gemini NO mantienen el system prompt entre turnos de conversacion.
  // A diferencia de Claude, donde el system prompt persiste en la sesion,
  // OpenAI requiere que se envie en cada request como mensaje role:'system'.
  // Sin esto, el modelo pierde su identidad y contexto en el segundo mensaje.
  if (provider === 'openai' || provider === 'gemini') {
    return true;
  }

  // Claude mantiene el contexto entre turnos — solo se necesita en el primero
  // o cuando el usuario hace una solicitud de datos externa.
  if (isFirstMessage) {
    return true;
  }

  return typeof userMessage === 'string' && EXTERNAL_DATA_REQUEST_RE.test(userMessage);
}


async function loadAndValidateWhitelist(userMessage, conversationHistory, onStatus) {
  if (!env.WHITELIST_ENFORCEMENT_ENABLED) {
    return [];
  }

  emitStatus(onStatus, 'whitelist_loading', 'Cargando dominios permitidos');
  const whitelistedDomains = await whitelistService.getWhitelistedDomains();

  if (whitelistedDomains.length === 0) {
    throw new Error(
      'Enforcement Whitelist: la colección Whitelisted está vacía o no disponible.'
    );
  }

  emitStatus(onStatus, 'whitelist_validating', 'Validando URLs contra Whitelisted');

  const textsToValidate = [
    userMessage,
    ...conversationHistory.map((msg) => msg?.content).filter(Boolean)
  ];

  const validation = await whitelistService.validateUrlsAgainstWhitelist(textsToValidate);

  if (!validation.ok) {
    throw new Error(
      `Enforcement Whitelist: URL no permitida detectada (${validation.blockedHostnames.join(', ')}). ` +
      'Solo se permiten fuentes incluidas en la colección Whitelisted.'
    );
  }

  return whitelistedDomains;
}


/**
 * Orquesta la preparación completa del contexto para una request.
 *
 * Pasos que ejecuta:
 *   1. Resuelve la context key según provider y preferencia del cliente
 *   2. Carga y valida la whitelist (solo si es el primer mensaje y enforcement activo)
 *   3. Carga el texto de contexto desde chatContexts.json
 *   4. Construye el system prompt combinando contexto + whitelist
 */
export async function prepareContext({
  provider,
  contextKey,
  userMessage,
  conversationHistory,
  isFirstMessage,
  onStatus
}) {
  const effectiveContextKey = resolveContextKey(provider, contextKey);

  // Inyeccion directa de datos MongoDB
  // El backend consulta MongoDB y pasa los resultados como texto en el system
  // prompt. 
  if (provider === 'openai' || provider === 'gemini') {
    emitStatus(onStatus, 'context_loading', 'Cargando contexto y datos de MongoDB');

    const [initialContext, workflowData] = await Promise.all([
      contextService.getInitialContext(effectiveContextKey),
      loadWorkflowData(userMessage, provider),
    ]);

    // Si hay cache hit, marcar en el status para que el frontend lo muestre
    if (workflowData.cachedResult) {
      emitStatus(onStatus, 'cache_hit', 'Resultado encontrado en cache');
    } else {
      emitStatus(onStatus, 'cache_miss', `${workflowData.whitelisted.length} fuentes disponibles`);
    }

    // System prompt = instrucciones del contexto + datos pre-cargados de MongoDB
    const systemPrompt = [
      'CONTEXTO INICIAL DEL SISTEMA (NO lo repitas textualmente al usuario):',
      initialContext || '',
      '',
      workflowData.contextBlock,
    ].join('');

    return {
      effectiveContextKey,
      systemPrompt,
      whitelistedDomains: workflowData.whitelisted.map((s) => s.url).filter(Boolean),
      cachedResult: workflowData.cachedResult,
    };
  }

  const isDataRequest = isFirstMessage ||
    (typeof userMessage === 'string' && EXTERNAL_DATA_REQUEST_RE.test(userMessage));

  if (!isDataRequest) {
    emitStatus(onStatus, 'context_loading', 'Cargando contexto inicial');
    const initialContext = await contextService.getInitialContext(effectiveContextKey);
    return {
      effectiveContextKey,
      systemPrompt: initialContext
        ? `CONTEXTO INICIAL DEL SISTEMA (NO lo repitas textualmente al usuario):
${initialContext}`
        : '',
      whitelistedDomains: [],
      cachedResult: null,
    };
  }

  emitStatus(onStatus, 'context_loading', 'Cargando contexto y datos de MongoDB');

  const [initialContext, workflowData] = await Promise.all([
    contextService.getInitialContext(effectiveContextKey),
    loadWorkflowData(userMessage, provider),
  ]);

  if (workflowData.cachedResult) {
    emitStatus(onStatus, 'cache_hit', 'Resultado encontrado en cache');
  } else {
    emitStatus(onStatus, 'cache_miss', `${workflowData.whitelisted.length} fuentes disponibles`);
  }

  const systemPrompt = [
    'CONTEXTO INICIAL DEL SISTEMA (NO lo repitas textualmente al usuario):',
    initialContext || '',
    '',
    workflowData.contextBlock,
  ].join('');
  return {
    effectiveContextKey,
    systemPrompt,
    whitelistedDomains: workflowData.whitelisted.map((s) => s.url).filter(Boolean),
    cachedResult: workflowData.cachedResult,
  };
}