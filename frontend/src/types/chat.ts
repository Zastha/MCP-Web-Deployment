/*Typescript interfaces for chat application responses and messages.
Defines the structure of messages exchanged between the user and the assistant,
as well as the expected format of API responses and errors. 
V.1.0.0
08/02/2026
Added LLMProvider type to specify which language model provider is being used in the chat interactions.
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