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
    return JSON.parse(argumentsStr);
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
      content: `Llamé ${toolUses.length} tool(s): ${toolUses.map((t) => t.name).join(', ')}`
    });

    messages.push({
      role: 'user',
      content: toolResults
        .map((result) => {
          const status = result.is_error ? 'ERROR' : 'OK';
          return `Resultado Tool [${status}] ${result.name}:\n${result.content}`;
        })
        .join('\n\n')
    });
  }
}