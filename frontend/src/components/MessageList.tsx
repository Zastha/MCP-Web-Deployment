import type{ Message } from '../types/chat';
import './MessageList.css';

/*Component for displaying the list of messages in the chat interface.
Receives an array of messages as props and renders them in a styled format.
Handles both user and assistant messages, showing the role and content of each message.
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