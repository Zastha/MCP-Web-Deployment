import crypto from 'node:crypto';
import { processUserMessage } from '../services/orchestrator/index.js';
import { requestStatusService } from '../services/requestStatusService.js';
import { logger } from '../utils/logger.js';

/**
 * POST /api/chat/message
 *
 * Arquitectura async — no bloquea el HTTP request mientras procesa.
 *
 * Flujo:
 *   1. Valida el mensaje
 *   2. Registra el requestId en el store con status 'queued'
 *   3. Responde INMEDIATAMENTE al frontend con { requestId }
 *   4. Lanza processUserMessage en background (sin await en el response)
 *   5. Cuando termina, guarda el resultado en requestStatusService
 *
 * El frontend hace polling a:
 *   GET /status/:id  → para ver el progreso paso a paso
 *   GET /result/:id  → para recoger la respuesta cuando status === 'completed'
 */
export async function sendMessage(req, res, next) {
  const {
    message,
    conversationHistory = [],
    provider    = 'claude',
    contextKey,
    requestId:  providedRequestId
  } = req.body;

  const requestId =
    typeof providedRequestId === 'string' && providedRequestId.trim()
      ? providedRequestId.trim()
      : crypto.randomUUID();

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      success: false,
      error:   'Message must be a non-empty string',
      received: message
    });
  }

  logger.info(`[${requestId}] Received message for ${provider}:`, message);

  requestStatusService.setStatus(requestId, 'queued', 'Solicitud en cola');

  res.json({
    success: true,
    data: { requestId }
  });


  setImmediate(async () => {
    try {
      requestStatusService.setStatus(requestId, 'processing', 'Iniciando procesamiento');

      const result = await processUserMessage(
        message,
        conversationHistory,
        provider,
        contextKey,
        {
          requestId,
          onStatus: (status, details) =>
            requestStatusService.setStatus(requestId, status, details)
        }
      );

      logger.info(`[${requestId}] Completed. Provider: ${provider}`);

      // Guardar resultado completo para que el frontend lo recoja
      requestStatusService.complete(requestId, {
        response:       result.text,
        conversationId: result.conversationId,
        provider:       result.provider,
        contextKey:     result.contextKey,
        contextApplied: result.contextApplied,
        requestId
      });

    } catch (error) {
      logger.error(`[${requestId}] Error in background processing:`, {
        message: error.message,
        stack:   error.stack
      });

      requestStatusService.fail(requestId, error?.message || 'Error desconocido');
    }
  });
}

/**
 * GET /api/chat/status/:requestId
 *
 * Devuelve el estado actual del proceso (sin el resultado).
 * El frontend hace polling aquí cada 700ms para mostrar el log de pasos.
 */
export function getMessageStatus(req, res) {
  const { requestId } = req.params;

  if (!requestId) {
    return res.status(400).json({
      success: false,
      error:   'Validation Error',
      message: 'requestId es requerido'
    });
  }

  const status = requestStatusService.getStatus(requestId);

  if (!status) {
    return res.status(404).json({
      success: false,
      error:   'Not Found',
      message: 'No se encontró estado para ese requestId'
    });
  }

  return res.json({ success: true, data: status });
}

/**
 * GET /api/chat/result/:requestId
 *
 * Devuelve el resultado final cuando el proceso completó.
 * El frontend llama aquí UNA SOLA VEZ cuando detecta status === 'completed'.
 *
 * Respuestas posibles:
 *   - status: 'completed' + result: { response, provider, ... }
 *   - status: 'failed'    + error: 'mensaje de error'
 *   - status: 'processing'         → el proceso aún no terminó
 *   - 404                          → requestId no existe o ya expiró
 */
export function getMessageResult(req, res) {
  const { requestId } = req.params;

  if (!requestId) {
    return res.status(400).json({
      success: false,
      error:   'Validation Error',
      message: 'requestId es requerido'
    });
  }

  const entry = requestStatusService.getResult(requestId);

  if (!entry) {
    return res.status(404).json({
      success: false,
      error:   'Not Found',
      message: 'No se encontró resultado para ese requestId'
    });
  }

  return res.json({ success: true, data: entry });
}