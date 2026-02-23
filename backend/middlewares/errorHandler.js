import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  // Log del error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
  });

  // Error de validación
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: err.message,
      details: err.details || null,
    });
  }

  // Error de API key inválida (Anthropic, OpenAI, Gemini)
  if (err.message?.includes('API key') || err.status === 401) {
    return res.status(401).json({
      success: false,
      error: 'Authentication Error',
      message: 'API key inválida o no configurada',
    });
  }

  // Error de rate limit
  if (err.status === 429 || err.message?.includes('rate limit')) {
    return res.status(429).json({
      success: false,
      error: 'Rate Limit Exceeded',
      message: 'Has excedido el límite de requests. Intenta de nuevo más tarde.',
    });
  }

  // Error de timeout
  if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    return res.status(504).json({
      success: false,
      error: 'Timeout Error',
      message: 'La solicitud tardó demasiado tiempo. Intenta de nuevo.',
    });
  }

  // Error de conexión MCP
  if (err.message?.includes('MCP') || err.message?.includes('tool')) {
    return res.status(503).json({
      success: false,
      error: 'MCP Error',
      message: 'Error al conectar con los servicios MCP: ' + err.message,
    });
  }

  // Error de enforcement de whitelist
  if (err.message?.includes('Whitelist')) {
    return res.status(403).json({
      success: false,
      error: 'Whitelist Enforcement',
      message: err.message,
    });
  }

  // Error de provider no soportado
  if (err.message?.includes('Provider') || err.message?.includes('desconocido')) {
    return res.status(400).json({
      success: false,
      error: 'Invalid Provider',
      message: err.message,
    });
  }

  // Error genérico del servidor
  const statusCode = err.statusCode || err.status || 500;
  
  res.status(statusCode).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' 
      ? err.message 
      : 'Ocurrió un error en el servidor. Intenta de nuevo.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export default errorHandler;