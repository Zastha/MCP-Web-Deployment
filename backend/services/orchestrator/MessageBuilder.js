export function buildConversationMessages(conversationHistory, userMessage) {
  const historyMessages = (Array.isArray(conversationHistory) ? conversationHistory : [])
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));

  return [
    ...historyMessages,
    { role: 'user', content: userMessage }
  ];
}

export function extractToolUses(response) {
  const toolUses = [];

  if (response?.content && Array.isArray(response.content)) {
    const claudeToolUses = response.content
      .filter((part) => part?.type === 'tool_use' && typeof part.name === 'string')
      .map((part) => ({
        id:    part.id || generateToolId(),
        name:  part.name,
        input: part.input || {}
      }));
    toolUses.push(...claudeToolUses);
  }

  if (response?.tool_calls && Array.isArray(response.tool_calls)) {
    const openAIToolUses = response.tool_calls
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall) => ({
        id:    toolCall.id || generateToolId(),
        name:  toolCall.function.name,
        input: safeParseArguments(toolCall.function.arguments)
      }));
    toolUses.push(...openAIToolUses);
  }

  return toolUses;
}

function generateToolId() {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeParseArguments(argumentsStr) {
  if (!argumentsStr) return {};
  try {
    return typeof argumentsStr === 'string' ? JSON.parse(argumentsStr) : argumentsStr;
  } catch {
    return {};
  }
}

export function appendToolResultsToMessages({ messages, provider, response, toolUses, toolResults }) {
  if (provider === 'claude') {
    messages.push({
      role: 'assistant',
      content: response.content
    });

    messages.push({
      role: 'user',
      content: toolResults.map(({ tool_use_id, content, is_error }) => ({
        type: 'tool_result',
        tool_use_id,
        content,
        ...(is_error ? { is_error: true } : {})
      }))
    });
  } else {
    messages.push({
      role: 'assistant',
      content: response.content?.[0]?.text || null,
      tool_calls: response.tool_calls || []
    });

    toolResults.forEach((result, index) => {
      const toolUse = toolUses[index];
      messages.push({
        role: 'tool',
        tool_call_id: toolUse?.id || result.tool_use_id,
        name: toolUse?.name || result.name,
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
      });
    });
  }
}