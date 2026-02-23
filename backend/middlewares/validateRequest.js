export function validateRequest(req, res, next) {
  const { message, provider, contextKey, requestId } = req.body;

  // Validar que el mensaje existe y no está vacío
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'El campo "message" es requerido',
    });
  }

  if (typeof message !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'El campo "message" debe ser un string',
    });
  }

  if (message.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'El mensaje no puede estar vacío',
    });
  }

  if (message.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'El mensaje es demasiado largo (máximo 10,000 caracteres)',
    });
  }

  // Validar provider si está presente
  if (provider && !['claude', 'openai', 'gemini'].includes(provider)) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'Provider inválido. Debe ser: claude, openai, o gemini',
    });
  }

  if (contextKey !== undefined) {
    if (typeof contextKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'contextKey debe ser un string',
      });
    }

    if (contextKey.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'contextKey es demasiado largo (máximo 100 caracteres)',
      });
    }
  }

  if (requestId !== undefined) {
    if (typeof requestId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'requestId debe ser un string',
      });
    }

    if (requestId.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'requestId es demasiado largo (máximo 100 caracteres)',
      });
    }
  }

  // Validar conversationHistory si existe
  if (req.body.conversationHistory) {
    if (!Array.isArray(req.body.conversationHistory)) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'conversationHistory debe ser un array',
      });
    }

    // Validar cada mensaje en el historial
    for (const msg of req.body.conversationHistory) {
      if (!msg.role || !msg.content) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Cada mensaje debe tener "role" y "content"',
        });
      }

      if (!['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'El role debe ser "user" o "assistant"',
        });
      }

      if (typeof msg.content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'El content de cada mensaje debe ser un string',
        });
      }
    }

    // Limitar tamaño del historial
    if (req.body.conversationHistory.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'El historial de conversación es demasiado largo (máximo 100 mensajes)',
      });
    }
  }

  // Si todo está bien, continuar
  next();
}

export default validateRequest;