/**
 * mongoDataService.js
 *
 * Consultas directas a MongoDB para inyectar datos en el system prompt de OpenAI/Gemini.
 * Usa el LLM activo para determinar similaridad semántica entre prompts del cache.
 */

import { MongoClient } from 'mongodb';
import { env }         from '../config/environment.js';
import { logger }      from '../utils/logger.js';


let mongoClient = null;

async function getClient() {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI no configurado');

  if (mongoClient) return mongoClient;

  mongoClient = new MongoClient(env.MONGODB_URI);
  await mongoClient.connect();
  logger.info('mongoDataService: conexion establecida');
  return mongoClient;
}

async function findDocuments(collection, filter = {}, projection = {}, limit = 25) {
  try {
    const client = await getClient();
    const db     = client.db(env.MONGODB_DB_NAME);
    return await db.collection(collection)
      .find(filter, { projection })
      .limit(limit)
      .toArray();
  } catch (error) {
    if (error.message?.includes('topology') || error.message?.includes('connection')) {
      logger.warn('mongoDataService: reconectando...');
      mongoClient = null;
      const client = await getClient();
      const db     = client.db(env.MONGODB_DB_NAME);
      return await db.collection(collection)
        .find(filter, { projection })
        .limit(limit)
        .toArray();
    }
    throw error;
  }
}

// ── Similaridad semántica via LLM ──────────────────────────────────────────

/**
 * Usa el LLM del provider activo para determinar si dos prompts son
 * semánticamente equivalentes — es decir, si buscan el mismo dato.
 *
 * Usa el modelo más pequeño disponible para minimizar costo y latencia:
 *   claude  → claude-haiku-4-5-20251001
 *   openai  → gpt-4o-mini
 *   gemini  → gemini-2.5-flash

 */
async function checkSemanticSimilarity(queryPrompt, cachedPrompt, provider) {
  const systemPrompt = [
    'Eres un evaluador de similaridad semantica para queries de datos economicos.',
    'Tu unica tarea es determinar si dos preguntas buscan exactamente el mismo dato.',
    '',
    'Criterios para considerar SIMILAR (score >= 0.85):',
    '  - Mismo indicador economico (ingreso, tasa, porcentaje, etc.)',
    '  - Mismo grupo poblacional o categoria',
    '  - Mismo periodo de tiempo (año, trimestre)',
    '  - Mismo ambito geografico si se especifica',
    '',
    'Criterios para considerar DIFERENTE (score < 0.85):',
    '  - Diferente grupo poblacional (afrodescendientes vs discapacidad)',
    '  - Diferente periodo de tiempo',
    '  - Diferente indicador aunque el tema sea similar',
    '',
    'Responde UNICAMENTE con JSON valido, sin texto adicional:',
    '{ "similar": true/false, "score": 0.0-1.0, "reason": "explicacion breve" }'
  ].join('\n');

  const userMessage = [
    'Query actual del usuario:',
    `"${queryPrompt}"`,
    '',
    'Prompt almacenado en cache:',
    `"${cachedPrompt}"`,
    '',
    '¿Son semanticamente equivalentes? Responde solo con JSON.'
  ].join('\n');

  try {
    let responseText = '';

    if (provider === 'claude') {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }]
      });
      responseText = response.content[0]?.text || '';

    } else if (provider === 'openai') {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      const response = await client.chat.completions.create({
        model:      'gpt-4o-mini',
        max_tokens: 150,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage }
        ]
      });
      responseText = response.choices[0]?.message?.content || '';

    } else if (provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(
        `${systemPrompt}\n\n${userMessage}`
      );
      responseText = result.response.text() || '';
    }

    // Limpiar posibles markdown fences del JSON
    const clean = responseText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    logger.info(
      `mongoDataService: similarity check | score=${parsed.score} | ` +
      `similar=${parsed.similar} | reason="${parsed.reason}"`
    );

    return parsed;

  } catch (error) {
    logger.warn(`mongoDataService: similarity check failed: ${error.message}`);
    // En caso de error, asumir no similar para evitar falsos positivos
    return { similar: false, score: 0, reason: 'error en evaluacion' };
  }
}

// ── Consultas del workflow ─────────────────────────────────────────────────

/**
 * Busca en Record si existe un resultado cacheado semánticamente equivalente.
 * Usa el LLM del provider activo para evaluar la similaridad.
 *
 * Estrategia en dos pasos:
 *   1. Filtro rápido por regex (candidatos) — evita llamar al LLM para cada doc
 *   2. Evaluación semántica por LLM para cada candidato
 */
async function findCachedResult(userMessage, provider) {
  try {
    // Paso 1 — candidatos por regex rápido sobre palabras no genéricas
    const GENERIC = new Set([
      'cual', 'fue', 'el', 'la', 'los', 'las', 'que', 'con', 'por',
      'ingreso', 'ingresos', 'monetario', 'promedio', 'trimestral',
      'personas', 'persona', 'datos', 'dato', 'valor', 'porcentaje',
      'nacional', 'mexico', 'año', 'anos', 'periodo', 'sobre', 'entre',
    ]);

    const specificWords = userMessage
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !GENERIC.has(w))
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);

    if (specificWords.length === 0) return null;

    const filter = specificWords.length > 1
      ? { $or: specificWords.map((w) => ({ prompt: { $regex: w, $options: 'i' } })) }
      : { prompt: { $regex: specificWords[0], $options: 'i' } };

    const candidates = await findDocuments(
      'Record',
      filter,
      { prompt: 1, datos_recolectados: 1, resumen_analitico: 1, links_exactos: 1, timestamp: 1 },
      10
    );

    if (candidates.length === 0) {
      logger.info('mongoDataService: no hay candidatos en cache');
      return null;
    }

    logger.info(`mongoDataService: ${candidates.length} candidatos en cache — evaluando con LLM`);

    // Paso 2 — evaluación semántica por LLM para cada candidato
    for (const candidate of candidates) {
      const result = await checkSemanticSimilarity(
        userMessage,
        candidate.prompt,
        provider
      );

      if (result.similar && result.score >= 0.85) {
        logger.info(`mongoDataService: CACHE HIT — score=${result.score}`);
        return candidate;
      }
    }

    logger.info('mongoDataService: ningún candidato superó el umbral de similaridad');
    return null;

  } catch (error) {
    logger.warn(`mongoDataService: error en findCachedResult: ${error.message}`);
    return null;
  }
}

async function getWhitelistedSources() {
  try {
    return await findDocuments(
      'Whitelisted',
      {},
      { url: 1, giro_sitio: 1, tema_contenido: 1, descripcion_datos: 1, anio_estudio: 1 },
      50
    );
  } catch (error) {
    logger.warn(`mongoDataService: error cargando Whitelisted: ${error.message}`);
    return [];
  }
}

async function getBlacklistedSources() {
  try {
    return await findDocuments(
      'Blacklisted',
      {},
      { url: 1, scope: 1, query_especifica: 1, motivo: 1 },
      50
    );
  } catch (error) {
    logger.warn(`mongoDataService: error cargando Blacklisted: ${error.message}`);
    return [];
  }
}

/**
 * Carga todos los datos del workflow e inyecta en el system prompt.
 * Ahora recibe el provider para usar el LLM correcto en la similaridad.
 */
export async function loadWorkflowData(userMessage, provider = 'claude') {
  logger.info(`mongoDataService: cargando datos del workflow para provider=${provider}`);

  // Primero cargar Whitelisted y Blacklisted en paralelo
  // La búsqueda de cache se hace después porque necesita el LLM
  const [whitelisted, blacklisted] = await Promise.all([
    getWhitelistedSources(),
    getBlacklistedSources(),
  ]);

  // Cache lookup con evaluación semántica por LLM
  const cachedResult = await findCachedResult(userMessage, provider);

  logger.info(
    `mongoDataService: cache=${cachedResult ? 'HIT' : 'MISS'} | ` +
    `whitelisted=${whitelisted.length} | blacklisted=${blacklisted.length}`
  );

  // Ordenar Whitelisted por año descendente
  const sortedWhitelisted = [...whitelisted].sort((a, b) => {
    const yearA = parseInt(a.anio_estudio) || 0;
    const yearB = parseInt(b.anio_estudio) || 0;
    return yearB - yearA;
  });

  // Construir bloque de texto para el system prompt
  const lines = [
    '════════════════════════════════════════',
    'DATOS PRE-CARGADOS DEL SISTEMA (NO inventar ni modificar)',
    '════════════════════════════════════════',
    '',
  ];

  if (cachedResult) {
    lines.push(
      '⚡ CACHE HIT — Ya existe un resultado para esta query:',
      `  Prompt: ${cachedResult.prompt}`,
      `  Datos: ${JSON.stringify(cachedResult.datos_recolectados)}`,
      `  Fuente: ${(cachedResult.links_exactos || []).join(', ')}`,
      `  Resumen: ${cachedResult.resumen_analitico || ''}`,
      '',
      '→ ACCION: Devuelve este dato al usuario directamente. NO hagas scraping.',
      ''
    );
  } else {
    lines.push('✗ CACHE: Sin resultados previos equivalentes. Proceder con scraping.', '');
  }

  lines.push('FUENTES AUTORIZADAS (Whitelisted) — ordenadas de más reciente a más antigua:');
  if (sortedWhitelisted.length === 0) {
    lines.push('  (ninguna fuente disponible)');
  } else {
    sortedWhitelisted.forEach((src, i) => {
      lines.push(
        `  ${i + 1}. URL: ${src.url}`,
        `     Tema: ${src.tema_contenido || src.giro_sitio || ''}`,
        `     Año: ${src.anio_estudio || 'N/A'}`,
        `     Datos: ${src.descripcion_datos || ''}`,
      );
    });
  }
  lines.push('');

  const blockedUrls = blacklisted.map((b) => b.url).filter(Boolean);
  if (blockedUrls.length > 0) {
    lines.push(
      'FUENTES BLOQUEADAS (Blacklisted) — NO usar estas URLs:',
      ...blockedUrls.map((u) => `  - ${u}`),
      ''
    );
  }

  lines.push(
    '════════════════════════════════════════',
    'INSTRUCCION: Usa SOLO las URLs de Fuentes Autorizadas.',
    'Empieza por la URL #1 (mas reciente) y avanza si no encuentras el dato.',
    '════════════════════════════════════════',
  );

  return {
    cachedResult,
    whitelisted: sortedWhitelisted,
    blacklisted,
    contextBlock: lines.join('\n'),
  };
}