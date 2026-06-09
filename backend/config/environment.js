import dotenv from 'dotenv';

dotenv.config();

export const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY:    process.env.OPENAI_API_KEY,
  GOOGLE_API_KEY:    process.env.GOOGLE_API_KEY,

  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  OPENAI_MODEL:    process.env.OPENAI_MODEL    || 'gpt-4o',
  GEMINI_MODEL:    process.env.GEMINI_MODEL    || 'gemini-2.5-flash',

  MONGODB_URI:                  process.env.MONGODB_URI,
  MONGODB_DB_NAME:              process.env.MONGODB_DB_NAME              || 'MCP-Server',
  MONGODB_WHITELIST_COLLECTION: process.env.MONGODB_WHITELIST_COLLECTION || 'Whitelisted',

  WHITELIST_DOMAINS:            process.env.WHITELIST_DOMAINS            || '',
  WHITELIST_ENFORCEMENT_ENABLED: process.env.WHITELIST_ENFORCEMENT_ENABLED !== 'false',
  MAX_SUBDOMAINS_PER_REQUEST:   Number(process.env.MAX_SUBDOMAINS_PER_REQUEST || 3),

  PORT:     process.env.PORT     || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};


if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GOOGLE_API_KEY) {
  console.error('❌ ERROR: No hay ninguna API key configurada');
  console.error('Por favor configura al menos una en .env');
  process.exit(1);
}

console.log('✅ API Keys configuradas:');
console.log(`  - Claude: ${env.ANTHROPIC_API_KEY ? '✓' : '✗'} (modelo: ${env.ANTHROPIC_MODEL})`);
console.log(`  - OpenAI: ${env.OPENAI_API_KEY    ? '✓' : '✗'} (modelo: ${env.OPENAI_MODEL})`);
console.log(`  - Gemini: ${env.GOOGLE_API_KEY    ? '✓' : '✗'} (modelo: ${env.GEMINI_MODEL})`);