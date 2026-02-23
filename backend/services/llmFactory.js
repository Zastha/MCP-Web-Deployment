import { claudeService } from './claudeService.js';
import { openaiService } from './openaiService.js';
import { geminiService } from './geminiService.js';

export function getLLMService(provider) {
  switch (provider) {
    case 'claude':
      return claudeService;
    case 'openai':
      return openaiService;
    case 'gemini':
      return geminiService;
    default:
      throw new Error(`Provider desconocido: ${provider}`);
  }
}