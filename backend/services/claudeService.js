import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/environment.js';

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY
    });
  }

  async sendMessage(messages, tools = []) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      tools: tools.length > 0 ? tools : undefined,
      messages: messages
    });

    return response;
  }
}

export const claudeService = new ClaudeService();