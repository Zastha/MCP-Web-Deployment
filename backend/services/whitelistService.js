import { MongoClient } from 'mongodb';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

const WHITELIST_CACHE_TTL_MS = 60_000;

let mongoClient = null;
let cachedDomains = null;
let cacheTimestamp = 0;

function getFallbackDomainsFromEnv() {
  if (!env.WHITELIST_DOMAINS?.trim()) {
    return [];
  }

  const domains = env.WHITELIST_DOMAINS
    .split(',')
    .map((value) => normalizeHostname(value))
    .filter(Boolean);

  return [...new Set(domains)];
}

function normalizeHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;

  return hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

function extractHostname(urlValue) {
  if (typeof urlValue !== 'string' || !urlValue.trim()) {
    return null;
  }

  try {
    const normalizedUrl = /^https?:\/\//i.test(urlValue)
      ? urlValue
      : `https://${urlValue}`;

    const hostname = new URL(normalizedUrl).hostname;
    return normalizeHostname(hostname);
  } catch {
    return null;
  }
}

function matchesWhitelistedDomain(hostname, whitelistDomains) {
  if (!hostname) return false;

  return whitelistDomains.some((allowedDomain) => {
    return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`);
  });
}

function extractUrlHostnamesFromText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }

  const urlPattern = /https?:\/\/[^\s)\]"'<>]+/gi;
  const matches = text.match(urlPattern) || [];

  return matches
    .map((value) => extractHostname(value))
    .filter(Boolean);
}

function extractHostnamesFromPayload(payload) {
  const text = typeof payload === 'string'
    ? payload
    : JSON.stringify(payload ?? {});

  return [...new Set(extractUrlHostnamesFromText(text))];
}

async function getMongoClient() {
  if (!env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI no está configurado para enforcement de Whitelist. ' +
      'Configura MONGODB_URI o define WHITELIST_DOMAINS en .env.'
    );
  }

  if (mongoClient) {
    return mongoClient;
  }

  mongoClient = new MongoClient(env.MONGODB_URI);
  await mongoClient.connect();
  return mongoClient;
}

async function fetchWhitelistedDomainsFromDatabase() {
  const client = await getMongoClient();
  const db = client.db(env.MONGODB_DB_NAME);
  const collection = db.collection(env.MONGODB_WHITELIST_COLLECTION);

  const whitelistRecords = await collection
    .find({}, { projection: { url: 1 } })
    .toArray();

  const domains = whitelistRecords
    .map((item) => extractHostname(item?.url))
    .filter(Boolean);

  return [...new Set(domains)];
}

async function getWhitelistedDomains() {
  const cacheIsFresh =
    Array.isArray(cachedDomains) &&
    Date.now() - cacheTimestamp < WHITELIST_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return cachedDomains;
  }

  let domains = [];

  if (env.MONGODB_URI) {
    domains = await fetchWhitelistedDomainsFromDatabase();
  } else {
    domains = getFallbackDomainsFromEnv();
  }

  if (domains.length === 0) {
    throw new Error(
      'Whitelist sin dominios: no se pudieron cargar desde MongoDB ni desde WHITELIST_DOMAINS.'
    );
  }

  cachedDomains = domains;
  cacheTimestamp = Date.now();

  return domains;
}

async function validateUrlsAgainstWhitelist(payload, options = {}) {
  const { strict = true } = options;

  const textItems = Array.isArray(payload)
    ? payload
    : [payload];

  const hostnames = [
    ...new Set(textItems.flatMap((item) => extractUrlHostnamesFromText(item)))
  ];

  if (hostnames.length === 0) {
    return {
      ok: true,
      checkedHostnames: [],
      blockedHostnames: [],
      whitelistedDomains: []
    };
  }

  const whitelistedDomains = await getWhitelistedDomains();

  if (strict && whitelistedDomains.length === 0) {
    throw new Error(
      `No hay dominios en ${env.MONGODB_DB_NAME}.${env.MONGODB_WHITELIST_COLLECTION}. Enforcement bloqueado.`
    );
  }

  const blockedHostnames = hostnames.filter(
    (hostname) => !matchesWhitelistedDomain(hostname, whitelistedDomains)
  );

  if (blockedHostnames.length > 0) {
    logger.warn('Whitelist enforcement bloqueó hostnames no permitidos:', blockedHostnames);
  }

  return {
    ok: blockedHostnames.length === 0,
    checkedHostnames: hostnames,
    blockedHostnames,
    whitelistedDomains
  };
}

function clearWhitelistCache() {
  cachedDomains = null;
  cacheTimestamp = 0;
}

export const whitelistService = {
  validateUrlsAgainstWhitelist,
  getWhitelistedDomains,
  clearWhitelistCache,
  extractHostnamesFromPayload
};
