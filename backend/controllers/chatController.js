import crypto from 'node:crypto';
import { processUserMessage } from '../services/orchestratorService.js';
import { requestStatusService } from '../services/requestStatusService.js';
import { logger } from '../utils/logger.js';

export async function sendMessage(req, res, next) {
  try {
    const { 
      message, 
      conversationHistory = [],
      provider = 'claude',
      contextKey,
      requestId: providedRequestId
    } = req.body;

    const requestId =
      typeof providedRequestId === 'string' && providedRequestId.trim()
        ? providedRequestId.trim()
        : crypto.randomUUID();

    requestStatusService.setStatus(requestId, 'received', 'Solicitud recibida');
    
    logger.info(`Message type: ${typeof message}, value:`, message);
    
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: `Message must be a string, received: ${typeof message}`,
        received: message
      });
    }
    
    logger.info(`Received message for ${provider}:`, message);
    
    const response = await processUserMessage(
      message,
      conversationHistory,
      provider,
      contextKey,
      {
        requestId,
        onStatus: (status, details) => requestStatusService.setStatus(requestId, status, details)
      }
    );
    
    logger.info('Sending response:', response); // ← Debug
    
    res.json({
      success: true,
      data: {
        response: response.text,
        conversationId: response.conversationId,
        provider: response.provider,
        contextKey: response.contextKey,
        contextApplied: response.contextApplied,
        requestId
      }
    });

    requestStatusService.complete(requestId, 'Respuesta enviada');
  } catch (error) {
    const requestId = req.body?.requestId;
    if (typeof requestId === 'string' && requestId.trim()) {
      requestStatusService.fail(requestId.trim(), error?.message);
    }

    next(error);
  }
}

export function getMessageStatus(req, res) {
  const { requestId } = req.params;

  if (!requestId) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: 'requestId es requerido'
    });
  }

  const status = requestStatusService.getStatus(requestId);

  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Not Found',
      message: 'No se encontró estado para ese requestId'
    });
  }

  return res.json({
    success: true,
    data: status
  });
}