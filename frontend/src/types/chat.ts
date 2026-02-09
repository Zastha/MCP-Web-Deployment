"Typescript interfaces for chat application responses and messages." 
"Defines the structure of messages exchanged between the user and the assistant," 
"as well as the expected format of API responses and errors."
"V.1.0.0"
"08/02/2026"
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface ChatResponse {
  success: boolean;
  data: {
    response: string;
    conversationId: string;
  };
}

export interface ApiError {
  success: false;
  error: string;
  message: string;
}