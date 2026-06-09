import OpenAI from 'openai';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

class OpenAIService {
  constructor() {
    if (!env.OPENAI_API_KEY) {
      console.warn('⚠️  OpenAI API key no configurada');
      return;
    }

    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });

    logger.success('OpenAI service initialized');
  }

  /**
   * Envía mensajes a la API de OpenAI y devuelve la respuesta en el
   * formato unificado que espera el orquestador.
   */
  async sendMessage(messages, tools = [], system = '') {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key no configurada');
    }

    try {
      const systemWithTools = this.buildSystemPromptWithTools(system, tools);

      // OpenAI no tiene campo `system` separado — va como primer mensaje
      const systemMessages = systemWithTools?.trim()
        ? [{ role: 'system', content: systemWithTools.trim() }]
        : [];

      const openaiMessages = [
        ...systemMessages,
        ...messages.map((msg) => ({
          role:    msg.role,
          content: msg.content
        }))
      ];

      const response = await this.client.chat.completions.create({
        model:       env.OPENAI_MODEL,
        messages:    openaiMessages,
        tools:       tools.length > 0 ? this.convertToolsToOpenAI(tools) : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        max_tokens:  8096,
      });

      const choice     = response.choices[0];
      const message    = choice.message;
      const finishReason = choice.finish_reason;
      const hasToolCalls = finishReason === 'tool_calls' ||
                           (message.tool_calls && message.tool_calls.length > 0);

      // CRITICO: cuando OpenAI quiere usar tools, message.content es null.
      // El orquestador necesita content[] — devolver vacío cuando hay tool calls,
      // texto cuando es respuesta final.
      // Si devolvemos [{type:'text', text: null}], extractTextFromLLMResponse
      // devuelve vacío y el orquestador piensa que el modelo no respondió nada.
      return {
        content: hasToolCalls
          ? []   
          : [{ type: 'text', text: message.content || '' }],
        stop_reason: hasToolCalls ? 'tool_use' : 'end_turn',
        tool_calls:  message.tool_calls || []
      };

    } catch (error) {
      logger.error('OpenAI API error:', {
        message: error.message,
        status:  error.status,
        type:    error.type
      });

      if (error.status === 401) {
        throw new Error('API key de OpenAI inválida');
      } else if (error.status === 429) {
        throw new Error('Límite de uso de OpenAI excedido. Intenta de nuevo más tarde.');
      } else if (error.status === 404) {
        throw new Error('Modelo de OpenAI no disponible');
      }

      throw error;
    }
  }

  buildSystemPromptWithTools(system, tools) {
    const baseSystem = typeof system === 'string' ? system.trim() : '';

    if (!Array.isArray(tools) || tools.length === 0) {
      return baseSystem;
    }

    const toolLines = tools
      .filter((tool) => typeof tool?.name === 'string' && tool.name.trim())
      .map((tool) => `- ${tool.name}: ${tool.description || 'Sin descripción'}`);

    const toolContext = [
      'HERRAMIENTAS DISPONIBLES:',
      ...toolLines,
      '',
      'Instrucciones:',
      '- Si el usuario pregunta por tus herramientas, enumera solo las herramientas disponibles arriba.',
      '- Si una herramienta es útil para responder, úsala antes de contestar.',
      '- No inventes herramientas que no estén en esta lista.'
    ].join('\n');

    return baseSystem
      ? `${baseSystem}\n\n${toolContext}`
      : toolContext;
  }


   // Convierte tool definitions del formato MCP al formato de OpenAI.

  convertToolsToOpenAI(mcpTools) {
    return mcpTools
      .filter((tool) => typeof tool?.name === 'string' && tool.name.trim())
      .map((tool) => ({
        type: 'function',
        function: {
          name:        tool.name,
          description: tool.description || '',
          parameters:  this.normalizeSchemaForOpenAI(tool.inputSchema || {})
        }
      }));
  }

  /**
   * Normaliza el schema JSON para OpenAI.
   *
   * OpenAI es más estricto que Anthropic con los schemas:
   * - No acepta $schema, $id, definitions (solo $defs)
   * - Requiere que type sea string, no array
   * - No acepta nullable — usar anyOf con null en su lugar
   */
  normalizeSchemaForOpenAI(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { type: 'object', properties: {} };
    }

    const clean = JSON.parse(JSON.stringify(schema));

    const normalizeNode = (node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return node;
      }

      const result = { ...node };

      delete result.$schema;
      delete result.$id;
      delete result.id;
      delete result.definitions;

      if (typeof result.exclusiveMinimum === 'boolean') {
        if (result.exclusiveMinimum === true && typeof result.minimum === 'number') {
          result.exclusiveMinimum = result.minimum;
          delete result.minimum;
        } else {
          delete result.exclusiveMinimum;
        }
      }

      if (typeof result.exclusiveMaximum === 'boolean') {
        if (result.exclusiveMaximum === true && typeof result.maximum === 'number') {
          result.exclusiveMaximum = result.maximum;
          delete result.maximum;
        } else {
          delete result.exclusiveMaximum;
        }
      }

      if (Array.isArray(result.type)) {
        result.type = result.type[0] || 'object';
      }

      if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
        const normalizedProperties = {};
        for (const [key, value] of Object.entries(result.properties)) {
          normalizedProperties[key] = normalizeNode(value);
        }
        result.properties = normalizedProperties;
      }

      if (result.items && typeof result.items === 'object') {
        result.items = normalizeNode(result.items);
      }

      if (result.additionalProperties && typeof result.additionalProperties === 'object') {
        result.additionalProperties = normalizeNode(result.additionalProperties);
      }

      if (result.$defs && typeof result.$defs === 'object') {
        const normalizedDefs = {};
        for (const [key, value] of Object.entries(result.$defs)) {
          normalizedDefs[key] = normalizeNode(value);
        }
        result.$defs = normalizedDefs;
      }

      for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(result[keyword])) {
          result[keyword] = result[keyword].map(normalizeNode);
        }
      }

      if (result.not && typeof result.not === 'object') {
        result.not = normalizeNode(result.not);
      }

      return result;
    };

    const normalized = normalizeNode(clean);

    if (typeof normalized.type !== 'string' && !Array.isArray(normalized.type)) {
      normalized.type = 'object';
    }

    if (normalized.type === 'object' && (typeof normalized.properties !== 'object' || Array.isArray(normalized.properties))) {
      normalized.properties = {};
    }

    return normalized;
  }
}

export const openaiService = new OpenAIService();