import axios from 'axios';
import type {
  Message,
  ChatResponse,
  ChatStatusResponse,
  ApiError,
  LLMProvider
} from '../types/chat';

/*API client — arquitectura async con polling.
V.2.0.0
08/06/2026 - Cambio de arquitectura: POST /message responde inmediatamente
             con requestId. El resultado se recoge con GET /result/:id
             cuando el polling detecta status === 'completed'.
             Elimina el timeout de scraping largo.*/

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  // 15 segundos para las llamadas HTTP individuales — el procesamiento
  // ya no ocurre en esta llamada, solo el registro del request
  timeout: 15000,
});

export async function sendMessage(
  message: string,
  conversationHistory: Message[] = [],
  provider: LLMProvider = 'claude',
  contextKey?: string,
  requestId?: string
): Promise<{ requestId: string }> {
  try {
    const formattedHistory = conversationHistory.map(({ role, content }) => ({
      role,
      content,
    }));

    const response = await apiClient.post<{ success: boolean; data: { requestId: string } }>(
      '/chat/message',
      { message, conversationHistory: formattedHistory, provider, contextKey, requestId }
    );

    return { requestId: response.data.data.requestId };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const apiError: ApiError = {
        success: false,
        error:   error.response?.data?.error   || 'Error de red',
        message: error.response?.data?.message || 'No se pudo conectar con el servidor',
      };
      throw apiError;
    }
    throw error;
  }
}


export async function getMessageStatus(requestId: string): Promise<ChatStatusResponse> {
  const response = await apiClient.get<ChatStatusResponse>(
    `/chat/status/${encodeURIComponent(requestId)}`
  );
  return response.data;
}


export interface MessageResult {
  success: boolean;
  data: {
    requestId:  string;
    status:     string;
    result:     ChatResponse['data'] | null;
    error:      string | null;
    updatedAt:  string;
  };
}

export async function getMessageResult(requestId: string): Promise<MessageResult> {
  const response = await apiClient.get<MessageResult>(
    `/chat/result/${encodeURIComponent(requestId)}`
  );
  return response.data;
}

export default apiClient;