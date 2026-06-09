/**
 * requestStatusService.js
 * Gestiona el estado y resultado de requests asincrónicos.
 */

const STATUS_TTL_MS = 10 * 60 * 1000; // 10 minutos para que el frontend recoja el resultado

class RequestStatusService {
  constructor() {
    this.store = new Map();
  }

  setStatus(requestId, status, details = null) {
    if (!requestId) return;

    const existing = this.store.get(requestId) || {};
    this.store.set(requestId, {
      ...existing,
      requestId,
      status,
      details,
      updatedAt: new Date().toISOString()
    });
  }

  
   // Marca el request como completado y guarda el resultado final.

  complete(requestId, result) {
    if (!requestId) return;

    this.store.set(requestId, {
      requestId,
      status:   'completed',
      details:  'Respuesta lista',
      result,
      error:    null,
      updatedAt: new Date().toISOString()
    });

    this.scheduleCleanup(requestId);
  }

  /**
   * Marca el request como fallido y guarda el mensaje de error.
   */
  fail(requestId, errorMessage) {
    if (!requestId) return;

    this.store.set(requestId, {
      requestId,
      status:   'failed',
      details:  errorMessage || 'Error desconocido',
      result:   null,
      error:    errorMessage || 'Error desconocido',
      updatedAt: new Date().toISOString()
    });

    this.scheduleCleanup(requestId);
  }

  // ── Lectura ────────────────────────────────────────────────────────────────

  /**
   * Devuelve solo el estado actual — sin el resultado.
   * Usado por GET /status/:id para el polling de progreso en tiempo real.
   */
  getStatus(requestId) {
    const entry = this.store.get(requestId);
    if (!entry) return null;

    return {
      requestId: entry.requestId,
      status:    entry.status,
      details:   entry.details,
      updatedAt: entry.updatedAt
    };
  }

  /**
   * Devuelve el resultado final cuando el proceso completó.
   * Usado por GET /result/:id.
   * Devuelve null si aún no completó o si el requestId no existe.
   */
  getResult(requestId) {
    const entry = this.store.get(requestId);
    if (!entry) return null;

    return {
      requestId: entry.requestId,
      status:    entry.status,
      result:    entry.result  || null,
      error:     entry.error   || null,
      updatedAt: entry.updatedAt
    };
  }


  scheduleCleanup(requestId) {
    setTimeout(() => {
      this.store.delete(requestId);
    }, STATUS_TTL_MS);
  }
}

export const requestStatusService = new RequestStatusService();