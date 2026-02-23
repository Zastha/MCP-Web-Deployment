const STATUS_TTL_MS = 5 * 60 * 1000;

class RequestStatusService {
  constructor() {
    this.store = new Map();
  }

  setStatus(requestId, status, details = null) {
    if (!requestId) return;

    this.store.set(requestId, {
      requestId,
      status,
      details,
      updatedAt: new Date().toISOString()
    });
  }

  getStatus(requestId) {
    const value = this.store.get(requestId);
    if (!value) {
      return null;
    }

    return value;
  }

  complete(requestId, details = null) {
    this.setStatus(requestId, 'completed', details);
    this.scheduleCleanup(requestId);
  }

  fail(requestId, errorMessage) {
    this.setStatus(requestId, 'failed', errorMessage || 'unknown error');
    this.scheduleCleanup(requestId);
  }

  scheduleCleanup(requestId) {
    setTimeout(() => {
      this.store.delete(requestId);
    }, STATUS_TTL_MS);
  }
}

export const requestStatusService = new RequestStatusService();
