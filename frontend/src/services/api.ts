import axios from 'axios';
import type { Message, ChatResponse, ApiError } from '../types/chat';

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
08/02/2026*/
export async function sendMessage(
  message: string,
  conversationHistory: Message[] = []
): Promise<ChatResponse> {
  try {
    const response = await apiClient.post<ChatResponse>('/chat/message', {
      message,
      conversationHistory,
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

export default apiClient;