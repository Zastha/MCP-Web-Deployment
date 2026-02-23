import type { LLMProvider } from '../types/chat';
import './ProviderSelector.css';
/*Component for selecting the language model provider in the chat interface.
Displays buttons for each available provider and allows the user to switch between them.
Handles the selection state and communicates changes back to the parent component.
V.1.0.0
08/02/2026
*/
interface ProviderSelectorProps {
  selected: LLMProvider;
  onChange: (provider: LLMProvider) => void;
  disabled?: boolean;
}

const providers = [
  { id: 'claude' as LLMProvider, name: 'Claude', icon: '🤖', color: '#8B5CF6' },
  { id: 'openai' as LLMProvider, name: 'ChatGPT', icon: '🟢', color: '#10A37F' },
  { id: 'gemini' as LLMProvider, name: 'Gemini', icon: '✨', color: '#4285F4' },
];

export default function ProviderSelector({ selected, onChange, disabled }: ProviderSelectorProps) {
  return (
    <div className="provider-selector">
      {providers.map((provider) => (
        <button
          key={provider.id}
          className={`provider-button ${selected === provider.id ? 'active' : ''}`}
          onClick={() => onChange(provider.id)}
          disabled={disabled}
          style={{
            borderColor: selected === provider.id ? provider.color : 'transparent',
          }}
          title={provider.name}
        >
          <span className="provider-icon">{provider.icon}</span>
          <span className="provider-name">{provider.name}</span>
        </button>
      ))}
    </div>
  );
}