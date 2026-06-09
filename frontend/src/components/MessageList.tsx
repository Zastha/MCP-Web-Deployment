import type{ Message } from '../types/chat';
import './MessageList.css';

/*Componente mostrando la lista de mensajes en la interfaz de chat 
V.1.0.0
08/02/2026*/

interface MessageListProps {
  messages: Message[];
}

export default function MessageList({ messages }: MessageListProps) {
  return (
    <div className="message-list">
      {messages.length === 0 ? (
        <div className="empty-state">
          <p>👋 ¡Hola! ¿En qué puedo ayudarte?</p>
        </div>
      ) : (
        messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.role}`}
          >
            <div className="message-header">
              <span className="message-role">
                {message.role === 'user' ? '👤 Tú' : '🤖 Asistente'}
              </span>
              {message.timestamp && (
                <span className="message-time">
                  {message.timestamp.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="message-content">
              {message.content}
            </div>
          </div>
        ))
      )}
    </div>
  );
}