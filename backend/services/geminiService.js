import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/environment.js';
import { logger } from '../utils/logger.js';

class GeminiService {
  constructor() {
    if (!env.GOOGLE_API_KEY) {
      console.warn('⚠️  Google API key no configurada');
      return;
    }
    
    this.client = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
    logger.success('Gemini service initialized');
  }

  async sendMessage(messages, tools = []) {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('Google API key no configurada');
    }

    try {
      // Convertir herramientas MCP al formato de Gemini
      const geminiTools = this.convertMCPToolsToGemini(tools);
      
      // Configurar el modelo con las herramientas
      const modelConfig = {
        model: 'gemini-2.5-flash',
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.7,
        },
      };

      // Si hay herramientas, agregarlas
      if (geminiTools.length > 0) {
        modelConfig.tools = [{ functionDeclarations: geminiTools }];
      }

      const model = this.client.getGenerativeModel(modelConfig);

      // Construir el prompt con contexto de herramientas
      let prompt = this.buildPromptWithContext(messages, tools);

      // Generar respuesta
      const result = await model.generateContent(prompt);
      const response = result.response;
      
      // Verificar si Gemini quiere usar una herramienta
      const functionCalls = this.extractFunctionCalls(response);
      
      if (functionCalls.length > 0) {
        // Gemini quiere usar herramientas
        return {
          content: functionCalls.map(fc => ({
            type: 'tool_use',
            id: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: fc.name,
            input: fc.args
          })),
          stop_reason: 'tool_use'
        };
      }

      // Respuesta normal sin herramientas
      return {
        content: [{
          type: 'text',
          text: response.text()
        }],
        stop_reason: 'end_turn'
      };
    } catch (error) {
      logger.error('Gemini API Error:', {
        message: error.message,
        status: error.status,
      });

      if (error.message?.includes('404')) {
        throw new Error('Modelo de Gemini no disponible');
      } else if (error.message?.includes('API key')) {
        throw new Error('API key de Gemini inválida');
      } else if (error.message?.includes('quota')) {
        throw new Error('Límite de uso de Gemini excedido');
      }
      
      throw error;
    }
  }

  convertMCPToolsToGemini(mcpTools) {
    if (!mcpTools || mcpTools.length === 0) return [];

    return mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      parameters: this.convertSchemaToGeminiFormat(tool.inputSchema || {})
    }));
  }

  convertSchemaToGeminiFormat(schema) {
    // Gemini espera un formato específico para parameters
    return {
      type: 'object',
      properties: schema.properties || {},
      required: schema.required || []
    };
  }

  buildPromptWithContext(messages, tools) {
    let prompt = '';

    // Agregar contexto de herramientas disponibles
    if (tools && tools.length > 0) {
      prompt += 'Tienes acceso a las siguientes herramientas (MCPs):\n\n';
      tools.forEach(tool => {
        prompt += `- ${tool.name}: ${tool.description}\n`;
      });
      prompt += '\nPuedes usar estas herramientas cuando sea necesario para responder mejor.\n\n';
    }

    // Agregar historial de conversación
    messages.forEach(msg => {
      if (msg.role === 'user') {
        prompt += `Usuario: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        prompt += `Asistente: ${msg.content}\n`;
      }
    });

    return prompt;
  }

  extractFunctionCalls(response) {
    // Gemini puede devolver function calls en el response
    const functionCalls = [];
    
    try {
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        const content = candidate.content;
        if (content && content.parts) {
          for (const part of content.parts) {
            if (part.functionCall) {
              functionCalls.push({
                name: part.functionCall.name,
                args: part.functionCall.args
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Error extracting function calls from Gemini response', error);
    }

    return functionCalls;
  }
}

export const geminiService = new GeminiService();