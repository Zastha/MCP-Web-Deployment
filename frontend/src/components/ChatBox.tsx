import { useState, useRef, useEffect } from 'react';
import type { Message } from '../types/chat';
import { sendMessage } from '../services/api';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import './ChatBox.css';

/*Main component for the chat interface.
Manages the state of the conversation, including messages, loading status, and errors.
Handles sending messages to the backend and updating the UI accordingly.
V.1.0.0
08/02/2026*/
export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setError(null);

    try {
      const response = await sendMessage(content, messages);

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Error al conectar con el servidor';
      console.error('Error al enviar mensaje:', err);
      setError(errorMessage);

      // Mensaje de error visible para el usuario
      const assistantErrorMessage: Message = {
        role: 'assistant',
        content: `❌ Error: ${errorMessage || 'No se pudo procesar tu mensaje. Intenta de nuevo.'}`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantErrorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = () => {
    if (confirm('¿Deseas limpiar la conversación?')) {
      setMessages([]);
      setError(null);
    }
  };

  return (
    <div className="chat-box">
      <div className="chat-header">
        <h1>🤖 Chat con Claude + MCP</h1>
        <button
          onClick={handleClearChat}
          className="clear-button"
          disabled={loading || messages.length === 0}
        >
          🗑️ Limpiar
        </button>
      </div>

      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

      <div className="messages-container">
        <MessageList messages={messages} />
        {loading && (
          <div className="loading-indicator">
            <div className="typing-animation">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p>Claude está pensando...</p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput
        onSendMessage={handleSendMessage}
        disabled={loading}
      />
    </div>
  );
}