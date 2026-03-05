const { EventEmitter } = require('events');

const state = {
  initialized: false,
  commandRegistry: new Map(),
  eventBus: new EventEmitter(),
  lastOpenedFile: null
};

function registerCommand(name, handler) {
  if (!name || typeof handler !== 'function') {
    throw new Error('registerCommand requires a command name and handler function.');
  }

  state.commandRegistry.set(name, handler);
}

async function executeCommand(name, ...args) {
  const handler = state.commandRegistry.get(name);
  if (!handler) {
    throw new Error(`Command not found: ${name}`);
  }

  return handler(...args);
}

function listCommands() {
  return [...state.commandRegistry.keys()].sort();
}

function onFileOpened(filePath) {
  state.lastOpenedFile = filePath;
  state.eventBus.emit('fileOpened', { filePath, openedAt: new Date().toISOString() });
}

function on(eventName, listener) {
  state.eventBus.on(eventName, listener);
}

function getSessionContext() {
  return {
    initialized: state.initialized,
    inVSCode: Boolean(process.env.VSCODE_PID),
    commandCount: state.commandRegistry.size,
    lastOpenedFile: state.lastOpenedFile
  };
}

async function init() {
  if (state.initialized) {
    return getSessionContext();
  }

  registerCommand('agent.ping', async () => ({ ok: true, ts: Date.now() }));
  registerCommand('agent.openFileContext', async filePath => {
    onFileOpened(filePath);
    return { ok: true, filePath };
  });

  state.initialized = true;
  console.log(`vscode integration initialized (inVSCode: ${Boolean(process.env.VSCODE_PID)})`);

  return getSessionContext();
}

module.exports = {
  init,
  on,
  registerCommand,
  executeCommand,
  listCommands,
  onFileOpened,
  getSessionContext
};