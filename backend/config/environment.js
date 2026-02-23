import dotenv from 'dotenv';

dotenv.config();

export const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'MCP-Server',
  MONGODB_WHITELIST_COLLECTION: process.env.MONGODB_WHITELIST_COLLECTION || 'Whitelisted',
  WHITELIST_DOMAINS: process.env.WHITELIST_DOMAINS || '',
  WHITELIST_ENFORCEMENT_ENABLED: process.env.WHITELIST_ENFORCEMENT_ENABLED !== 'false',
  MAX_SUBDOMAINS_PER_REQUEST: Number(process.env.MAX_SUBDOMAINS_PER_REQUEST || 3),
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};

// Validar que al menos una API key esté configurada
if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GOOGLE_API_KEY) {
  console.error('❌ ERROR: No hay ninguna API key configurada');
  console.error('Por favor configura al menos una API key en .env');
  process.exit(1);
}

console.log('✅ API Keys configuradas:');
console.log(`  - Claude: ${env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
console.log(`  - OpenAI: ${env.OPENAI_API_KEY ? '✓' : '✗'}`);
console.log(`  - Gemini: ${env.GOOGLE_API_KEY ? '✓' : '✗'}`);