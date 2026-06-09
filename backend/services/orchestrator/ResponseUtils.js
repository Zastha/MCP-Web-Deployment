
export function emitStatus(onStatus, status, details) {
  if (typeof onStatus === 'function') {
    onStatus(status, details);
  }
}


export function extractTextFromLLMResponse(response) {
  if (typeof response === 'string') {
    return response;
  }

  if (response?.content && Array.isArray(response.content)) {
    const textParts = response.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('\n\n');
    }
  }

  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text;
  }

  return 'No se recibió contenido de texto del proveedor.';
}

export function stringifyToolResult(result) {
  if (typeof result === 'string') {
    return result;
  }

  if (result?.content && Array.isArray(result.content)) {
    const textParts = result.content
      .map((item) => {
        if (typeof item?.text === 'string') return item.text;
        if (typeof item === 'string') return item;
        return null;
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function tryParseJson(text) {
  if (typeof text !== 'string') {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}