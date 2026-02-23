import axios from 'axios';
import type { Message, ChatResponse, ChatStatusResponse, ApiError, LLMProvider } from '../types/chat';

const API_BASE_URL = 'http://localhost:3000/api';

/*API client for sending messages to the backend chat service.
Handles the communication with the server, including error handling and response parsing.
V.1.0.0
08/02/2026*/
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, 
});

/*Function to send a message to the chat API.
Accepts the user's message and the conversation history, then sends a POST request to the backend.
Returns a promise that resolves with the chat response or rejects with an API error.
V.1.0.0"
08/02/2026
Added provider parameter to specify which language model provider to use for the chat response.
v.1.1.0
20/02/2026
*/
export async function sendMessage(
  message: string,
  conversationHistory: Message[] = [],
  provider: LLMProvider = 'claude',
  contextKey?: string,
  requestId?: string
): Promise<ChatResponse> {
  try {
    // ✓ Convierte Message[] a formato que espera el backend
    const formattedHistory = conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
      // ← Solo role y content, sin timestamp
    }));

    const response = await apiClient.post<ChatResponse>('/chat/message', {
      message,
      conversationHistory: formattedHistory,
      provider,
      contextKey,
      requestId,
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const apiError: ApiError = {
        success: false,
        error: error.response?.data?.error || 'Error de red',
        message: error.response?.data?.message || 'No se pudo conectar con el servidor',
      };
      throw apiError;
    }
    throw error;
  }
}

export async function getMessageStatus(requestId: string): Promise<ChatStatusResponse> {
  const response = await apiClient.get<ChatStatusResponse>(`/chat/status/${encodeURIComponent(requestId)}`);
  return response.data;
}

export default apiClient;