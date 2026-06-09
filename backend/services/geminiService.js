import { GoogleGenerativeAI } from '@google/generative-ai';
import { env }    from '../config/environment.js';
import { logger } from '../utils/logger.js';

class GeminiService {
  constructor() {
    if (!env.GOOGLE_API_KEY) {
      console.warn('⚠️  Google API key no configurada');
      return;
    }

    this.client = new GoogleGenerativeAI(env.GOOGLE_API_KEY, {
      apiVersion: 'v1beta'
    });
    logger.success(`Gemini service initialized (model: ${env.GEMINI_MODEL})`);
  }

  async sendMessage(messages, tools = [], system = '') {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('Google API key no configurada');
    }

    try {
      const geminiTools = this.convertMCPToolsToGemini(tools);

      // Configurar el modelo con system prompt y tools
      const modelConfig = {
        model: env.GEMINI_MODEL,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature:     0.7,
        },
      };

      // Gemini 2.5 ignora systemInstruction cuando entra en conflicto con su
      // identidad entrenada. La solución es inyectar el contexto como un par
      // user/model al inicio del historial — Gemini respeta el few-shot
      // mucho mejor que las instrucciones de sistema.
      // systemInstruction se mantiene como respaldo adicional.
      if (system?.trim()) {
        modelConfig.systemInstruction = { parts: [{ text: system.trim() }] };
      }

      if (geminiTools.length > 0) {
        modelConfig.tools = [{ functionDeclarations: geminiTools }];
      }

      const model = this.client.getGenerativeModel(modelConfig);

      // Separar el último mensaje (el actual) del historial previo
      const history    = messages.slice(0, -1);
      const lastMsg    = messages[messages.length - 1];

      // Convertir historial al formato de Gemini
      // Los mensajes assistant se convierten a role:'model'
      const geminiHistory = this.convertHistoryToGemini(history);

      // Inyectar el contexto como par user/model al inicio del historial.
      // Esto establece la identidad del agente de forma que Gemini respeta.
      const identityShot = system?.trim() ? [
        {
          role: 'user',
          parts: [{ text: 'Cuál es tu rol y qué puedes hacer en esta sesión?' }]
        },
        {
          role: 'model',
          parts: [{ text: `Entendido. Mi rol en esta sesión es el siguiente:\n\n${system.trim()}\n\nEstaré siguiendo estas instrucciones en todas mis respuestas.` }]
        }
      ] : [];

      const chat = model.startChat({ history: [...identityShot, ...geminiHistory] });

      const userText = typeof lastMsg?.content === 'string'
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content || '');

      const result   = await chat.sendMessage(userText);
      const response = result.response;

      const functionCalls = this.extractFunctionCalls(response);

      if (functionCalls.length > 0) {
        return {
          content: functionCalls.map((fc) => ({
            type:  'tool_use',
            id:    `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name:  fc.name,
            input: fc.args || {}
          })),
          stop_reason: 'tool_use',
          _chat: chat,
          _functionCalls: functionCalls,
        };
      }

      return {
        content: [{
          type: 'text',
          text: response.text()
        }],
        stop_reason: 'end_turn',
      };

    } catch (error) {
      logger.error('Gemini API Error:', {
        message: error.message,
        status:  error.status,
      });

      if (error.message?.includes('404') || error.message?.includes('not found')) {
        throw new Error(`Modelo de Gemini no disponible: ${env.GEMINI_MODEL}`);
      } else if (error.message?.includes('API key') || error.message?.includes('API_KEY')) {
        throw new Error('API key de Gemini inválida');
      } else if (error.message?.includes('quota') || error.message?.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('Límite de uso de Gemini excedido. Intenta de nuevo más tarde.');
      } else if (error.message?.includes('SAFETY')) {
        throw new Error('Respuesta bloqueada por filtros de seguridad de Gemini');
      }

      throw error;
    }
  }

  async sendToolResults(previousResponse, toolResults) {
    const chat           = previousResponse._chat;
    const functionCalls  = previousResponse._functionCalls;

    if (!chat || !functionCalls) {
      throw new Error('Gemini: no hay contexto de chat para enviar tool results');
    }

    // Construir las function responses en el formato que espera Gemini
    const functionResponseParts = functionCalls.map((fc, i) => ({
      functionResponse: {
        name:     fc.name,
        response: {
          result: toolResults[i]?.content ?? 'Sin resultado'
        }
      }
    }));

    const result   = await chat.sendMessage(functionResponseParts);
    const response = result.response;

    // Verificar si Gemini quiere más tools
    const newFunctionCalls = this.extractFunctionCalls(response);

    if (newFunctionCalls.length > 0) {
      return {
        content: newFunctionCalls.map((fc) => ({
          type:  'tool_use',
          id:    `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name:  fc.name,
          input: fc.args || {}
        })),
        stop_reason: 'tool_use',
        _chat,
        _functionCalls: newFunctionCalls,
      };
    }

    return {
      content: [{
        type: 'text',
        text: response.text()
      }],
      stop_reason: 'end_turn',
    };
  }



  
//Convierte el historial del orquestador al formato de Gemini.
   
  convertHistoryToGemini(history) {
    return history
      .filter((msg) => typeof msg.content === 'string' && msg.content.trim())
      .map((msg) => ({
        role:  msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
  }

  /**
   * Convierte tool definitions del formato MCP al formato de Gemini.
   * Gemini es muy estricto con los schemas — simplifica al mínimo necesario.
   */
  convertMCPToolsToGemini(mcpTools) {
    if (!mcpTools || mcpTools.length === 0) return [];

    return mcpTools
      .filter((tool) => typeof tool?.name === 'string' && tool.name.trim())
      .map((tool) => ({
        name:        tool.name.replace(/-/g, '_'), // Gemini no acepta guiones en nombres
        description: tool.description || '',
        parameters:  this.simplifySchemaForGemini(tool.inputSchema || {})
      }));
  }


   // Simplifica un JSON Schema para Gemini.
  
  simplifySchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    const result = {
      type: 'object',
      properties: {}
    };

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (value && typeof value === 'object') {
          const prop = {};
          if (value.type)        prop.type        = Array.isArray(value.type) ? value.type[0] : value.type;
          if (value.description) prop.description = value.description;
          if (value.enum)        prop.enum        = value.enum;
          if (value.items)       prop.items       = { type: value.items?.type || 'string' };
          if (value.properties)  prop.properties  = this.simplifySchemaForGemini(value).properties;
          result.properties[key] = prop;
        }
      }
    }

    if (Array.isArray(schema.required) && schema.required.length > 0) {
      result.required = schema.required;
    }

    return result;
  }

  extractFunctionCalls(response) {
    const calls = [];

    try {
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part.functionCall) {
            calls.push({
              name: part.functionCall.name,
              args: part.functionCall.args || {}
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Gemini: error extracting function calls', error.message);
    }

    return calls;
  }
}

export const geminiService = new GeminiService();