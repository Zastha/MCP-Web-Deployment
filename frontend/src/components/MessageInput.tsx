import React, { useState } from 'react';
import type { SubmitEventHandler, KeyboardEvent } from 'react';
import './MessageInput.css';

interface MessageInputProps {
  onSendMessage: (message: string) => void;
  disabled: boolean;
}

/*Component for the message input area in the chat interface.
Provides a textarea for the user to type their message and a button to send it.
Handles form submission and keyboard events for sending messages.
V.1.0.0
08/02/2026*/
export default function MessageInput({ onSendMessage, disabled }: MessageInputProps) {
  const [input, setInput] = useState('');

  const sendMessage = () => {
    if (input.trim() && !disabled) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <form className="message-input-form" onSubmit={handleSubmit}>
      <textarea
        className="message-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe tu mensaje... (Enter para enviar, Shift+Enter para nueva línea)"
        disabled={disabled}
        rows={3}
      />
      <button
        type="submit"
        className="send-button"
        disabled={disabled || !input.trim()}
      >
        {disabled ? '⏳' : '📤'} Enviar
      </button>
    </form>
  );
}