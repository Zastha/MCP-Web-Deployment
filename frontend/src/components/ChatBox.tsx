import { useState, useRef, useEffect } from 'react';
import type { LLMProvider, Message } from '../types/chat';
import { sendMessage, getMessageStatus, getMessageResult } from '../services/api';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import ProviderSelector from './ProviderSelector';
import './ChatBox.css';

/*ChatBox — arquitectura async con polling completo.
V.2.0.0
08/06/2026 - POST /message responde con requestId inmediatamente.
             Polling de /status para pasos en tiempo real.
             Polling de /result cuando status=completed para recoger respuesta.
             Sin timeout — funciona para scraping de cualquier duración.*/

const STATUS_LABELS: Record<string, string> = {
  queued:              '📋 En cola...',
  processing:          '⚙️  Iniciando procesamiento...',
  preparing:           '⚙️  Preparando contexto...',
  whitelist_loading:   '🔒 Cargando dominios permitidos...',
  whitelist_validating:'🔒 Validando fuentes...',
  context_loading:     '📋 Cargando contexto del agente...',
  history_sanitized:   '🧹 Optimizando historial...',
  provider_processing: '🤖 Consultando modelo...',
  tool_executing:      '🔧 Ejecutando herramientas MCP...',
  tool_call:           '⚡ Llamando tool...',
  provider_retry:      '🔄 Reintentando...',
  finalizing:          '✅ Finalizando respuesta...',
  completed:           '✅ Respuesta lista',
};

function formatStepLabel(status: string, details: string | null): string {
  const label = STATUS_LABELS[status];
  if (label) return label;
  if (details?.trim()) return `⚡ ${details}`;
  return `⚡ ${status}`;
}

// Intervalo de polling en ms
const POLL_INTERVAL_MS = 700;

// Máximo de tiempo esperando resultado después de 'completed' (10 seg)
//const MAX_RESULT_WAIT_MS = 10_000;

export default function ChatBox() {
  const [messages, setMessages]               = useState<Message[]>([]);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>('claude');
  const [stepLog, setStepLog]                 = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stepLogEndRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    stepLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stepLog]);

  const handleSendMessage = async (content: string) => {
    setLoading(true);
    setError(null);
    setStepLog(['📋 Enviando solicitud...']);

    // Agregar mensaje del usuario inmediatamente
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      // Paso 1 — registrar el request, recibir requestId inmediatamente
      const { requestId } = await sendMessage(
        content, messages, selectedProvider
      );

      // Paso 2 — polling de progreso + detección de completion
      const assistantResponse = await pollUntilComplete(requestId);

      // Paso 3 — agregar respuesta al chat
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantResponse,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : (err as { message?: string })?.message || 'Error al conectar con el servidor';

      console.error('Error:', err);
      setError(errorMessage);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ Error: ${errorMessage}`, timestamp: new Date() }
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => setStepLog([]), 3000);
    }
  };

  /**
   * Hace polling de /status cada 700ms y muestra el log de pasos.
   * Cuando detecta status === 'completed' o 'failed', llama a /result
   * y devuelve el texto de la respuesta.
   *
   * No tiene timeout — espera indefinidamente hasta que el backend responda.
   * El usuario siempre ve qué está pasando gracias al step log.
   */
  const pollUntilComplete = (requestId: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const seenStatuses = new Set<string>();
      let resultFetched  = false;

      const interval = setInterval(async () => {
        try {
          const statusResponse = await getMessageStatus(requestId);
          const { status, details } = statusResponse.data;

          // Agregar al log solo si es un paso nuevo
          const stepKey = `${status}:${details ?? ''}`;
          if (!seenStatuses.has(stepKey)) {
            seenStatuses.add(stepKey);
            setStepLog((prev) => [...prev, formatStepLabel(status, details)]);
          }

          // Cuando completa o falla, recoger el resultado
          if ((status === 'completed' || status === 'failed') && !resultFetched) {
            resultFetched = true;
            clearInterval(interval);

            // Pequeña espera para asegurar que complete() ya escribió el resultado
            await new Promise((r) => setTimeout(r, 300));

            try {
              const resultResponse = await getMessageResult(requestId);
              const { status: finalStatus, result, error: resultError } = resultResponse.data;

              if (finalStatus === 'failed' || resultError) {
                reject(new Error(resultError || 'El proceso falló'));
                return;
              }

              if (result?.response) {
                resolve(result.response);
              } else {
                reject(new Error('Respuesta vacía del servidor'));
              }
            } catch (resultErr) {
              reject(resultErr);
            }
          }

        } catch {
          // El request puede no existir aún en los primeros ticks — ignorar
        }
      }, POLL_INTERVAL_MS);
    });
  };

  const handleClearChat = () => {
    if (confirm('¿Deseas limpiar la conversación?')) {
      setMessages([]);
      setError(null);
      setStepLog([]);
    }
  };

  const providerLabel =
    selectedProvider === 'claude'  ? 'Claude'   :
    selectedProvider === 'openai'  ? 'ChatGPT'  : 'Gemini';

  return (
    <div className="chat-box">
      <div className="chat-header">
        <h1>🤖 Chat Multi-LLM + MCP</h1>
        <div className="header-actions">
          <ProviderSelector
            selected={selectedProvider}
            onChange={setSelectedProvider}
            disabled={loading}
          />
          <button
            onClick={handleClearChat}
            className="clear-button"
            disabled={loading || messages.length === 0}
          >
            🗑️ Limpiar
          </button>
        </div>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      <div className="messages-container">
        <MessageList messages={messages} />

        {loading && (
          <div className="loading-indicator">
            <div className="typing-animation">
              <span></span><span></span><span></span>
            </div>
            <div className="loading-content">
              <p className="loading-title">{providerLabel} está trabajando...</p>
              {stepLog.length > 0 && (
                <div className="step-log">
                  {stepLog.map((step, i) => (
                    <div
                      key={i}
                      className={`step-entry ${i === stepLog.length - 1 ? 'step-active' : 'step-done'}`}
                    >
                      {step}
                    </div>
                  ))}
                  <div ref={stepLogEndRef} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSendMessage={handleSendMessage} disabled={loading} />
    </div>
  );
}
