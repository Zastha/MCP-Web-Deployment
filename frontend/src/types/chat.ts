/* Interfaces de TypeScript para respuestas y mensajes de la aplicación de chat.
Define la estructura de los mensajes intercambiados entre el usuario y el asistente,
como well como el formato esperado de las respuestas de la API y los errores.
V.1.0.0
08/02/2026
Agregado el tipo LLMProvider para especificar qué proveedor de modelo de lenguaje se está utilizando en las interacciones del chat.
v.1.1.0
20/02/2026
*/
export type LLMProvider = 'claude' | 'gemini' | 'openai';
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface ChatRequest {
  message: string;
  conversationHistory: Message[];
  provider: LLMProvider; 
  contextKey?: string;
  requestId?: string;
}

export interface ChatResponse {
  success: boolean;
  data: {
    response: string;
    conversationId: string;
    provider: LLMProvider;
    contextKey?: string;
    contextApplied?: boolean;
    requestId?: string;
  };
}

export interface ChatStatusResponse {
  success: boolean;
  data: {
    requestId: string;
    status: string;
    details: string | null;
    updatedAt: string;
  };
}

export interface ApiError {
  success: false;
  error: string;
  message: string;
}