import OpenAI from 'openai';
import { env } from '../config/environment.js';

class OpenAIService {
  constructor() {
    if (!env.OPENAI_API_KEY) {
      console.warn('⚠️  OpenAI API key no configurada');
      return;
    }
    
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }

  async sendMessage(messages, tools = []) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key no configurada');
    }

    // Convertir mensajes al formato de OpenAI
    const openaiMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await this.client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: openaiMessages,
      tools: tools.length > 0 ? this.convertToolsToOpenAI(tools) : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    });

    // Convertir respuesta al formato unificado
    return {
      content: [{
        type: 'text',
        text: response.choices[0].message.content || ''
      }],
      stop_reason: response.choices[0].finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      tool_calls: response.choices[0].message.tool_calls || []
    };
  }

  convertToolsToOpenAI(mcpTools) {
    return mcpTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
  }
}

export const openaiService = new OpenAIService();