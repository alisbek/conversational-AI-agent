const config = require('../config');

function serializeError(error) {
  if (!error) {
    return undefined;
  }

  return {
    message: error.message,
    name: error.name,
    code: error.code,
    status: error.response?.status,
    stack: error.stack
  };
}

function createBaseEntry(level, event, context) {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    service: config.logging.serviceName || 'conversational-ai-agent',
    ...context
  };
}

function log(level, event, context = {}) {
  const entry = createBaseEntry(level, event, context);
  const output = JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
}

function info(event, context = {}) {
  log('info', event, context);
}

function warn(event, context = {}) {
  log('warn', event, context);
}

function error(event, err, context = {}) {
  log('error', event, { ...context, error: serializeError(err) });
}

function debug(event, context = {}) {
  if ((config.logging.level || '').toLowerCase() === 'debug') {
    log('debug', event, context);
  }
}

module.exports = {
  log,
  info,
  warn,
  error,
  debug,
  serializeError
};
