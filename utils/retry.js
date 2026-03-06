const logger = require('./logger');

const DEFAULT_RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);

function isRetryableError(error) {
  if (!error) {
    return false;
  }

  const status = error.response?.status;
  if (typeof status === 'number' && DEFAULT_RETRYABLE_STATUS.has(status)) {
    return true;
  }

  if (typeof error.code === 'string' && DEFAULT_RETRYABLE_CODES.has(error.code)) {
    return true;
  }

  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('connection reset') ||
    message.includes('connection refused') ||
    message.includes('socket hang up')
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(operation, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 250,
    maxDelayMs = 5000,
    operationName = 'operation',
    shouldRetry = isRetryableError
  } = options;

  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt <= retries && shouldRetry(error);
      if (!canRetry) {
        throw error;
      }

      const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(backoff * 0.2)));
      const delayMs = backoff + jitter;

      logger.warn('retry.attempt', {
        operation: operationName,
        attempt,
        retries,
        delayMs,
        errorMessage: error.message,
        errorCode: error.code,
        status: error.response?.status
      });

      await sleep(delayMs);
    }
  }
}

module.exports = {
  withRetry,
  isRetryableError
};
