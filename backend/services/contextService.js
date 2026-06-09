import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { env }    from '../config/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultContextFilePath = path.resolve(__dirname, '../config/chatContexts.json');

let cachedContexts = null;
let cachedPath = null;

function normalizeKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}

function normalizeContextValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;

  if (Array.isArray(value)) {
    const lines = value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines.join('\n') : null;
  }

  if (typeof value === 'object') {
    const candidates = [value.instructions, value.prompt, value.content, value.text];
    for (const candidate of candidates) {
      const normalized = normalizeContextValue(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

function resolveEnvPlaceholders(text) {
  if (typeof text !== 'string') return text;

  const placeholders = {
    MONGODB_URI:     env.MONGODB_URI     || '',
    MONGODB_DB_NAME: env.MONGODB_DB_NAME || '',
  };

  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(placeholders, key)) {
      if (!placeholders[key]) {
        logger.warn(`contextService: placeholder {{${key}}} viene vacío en el entorno`);
      }
      return placeholders[key];
    }
    return match;
  });
}

function buildContextMap(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('El archivo de contextos debe ser un objeto JSON estructurado.');
  }

  const contexts = {};
  for (const [rawKey, value] of Object.entries(parsed)) {
    const contextText = normalizeContextValue(value);
    if (!contextText) continue;

    contexts[rawKey] = contextText;
    const normalizedAlias = normalizeKey(rawKey);
    if (normalizedAlias && !contexts[normalizedAlias]) {
      contexts[normalizedAlias] = contextText;
    }
  }

  const firstKey = Object.keys(contexts)[0];
  if (!contexts.default && firstKey) contexts.default = contexts[firstKey];
  if (!contexts.default) throw new Error('No se encontró ningún contexto base válido.');

  return contexts;
}

async function loadContexts(filePath = defaultContextFilePath) {
  if (cachedContexts && cachedPath === filePath) {
    return cachedContexts;
  }

  logger.info(`📋 contextService: Cargando archivo de contextos → ${filePath}`);
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const contexts = buildContextMap(parsed);

  cachedContexts = contexts;
  cachedPath = filePath;
  return contexts;
}

export async function getInitialContext(contextKey = 'default', filePath) {
  try {
    const contexts = await loadContexts(filePath);
    const normalizedKey = normalizeKey(contextKey);

    const selectedContext = contexts[contextKey] ?? contexts[normalizedKey] ?? contexts.default;
    const rawContext = normalizeContextValue(selectedContext);
    const resolved = resolveEnvPlaceholders(rawContext);

    logger.info(`📋 contextService: Inyectando contexto dinámico para llave="${contextKey}"`);
    return resolved;
  } catch (error) {
    logger.warn(`No se pudo procesar el contexto inicial: ${error.message}`);
    return null;
  }
}

function clearContextCache() {
  cachedContexts = null;
  cachedPath = null;
}

export const contextService = {
  getInitialContext,
  clearContextCache
};