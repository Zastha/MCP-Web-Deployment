import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY
    });
  }

  // system: string con el prompt de sistema (contexto + whitelist policy).
  //         Se pasa como campo separado a la API — nunca como mensaje user.
  async sendMessage(messages, tools = [], system = '') {
    try {
      const response = await this.client.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 8096,
        system: system.trim() || undefined,
        tools: tools.length > 0 ? tools : undefined,
        messages
      });

      return response;
    } catch (error) {
      logger.error('Claude API error:', {
        message: error.message,
        status: error.status,
        type: error.error?.type
      });
      throw error;
    }
  }
}

export const claudeService = new ClaudeService();