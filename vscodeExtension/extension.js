const vscode = require('vscode');
const axios = require('axios');

function getApiUrl() {
  return vscode.workspace.getConfiguration('aiAgent').get('apiUrl') || 'http://localhost:3000';
}

function getSessionId() {
  return vscode.workspace.getConfiguration('aiAgent').get('sessionId') || 'vscode-local';
}

async function callApi(endpoint, data) {
  const url = `${getApiUrl()}${endpoint}`;
  try {
    const response = await axios.post(url, data, { timeout: 60000 });
    return response.data;
  } catch (error) {
    vscode.window.showErrorMessage(`AI Agent: ${error.message}`);
    throw error;
  }
}

function getChatHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; margin: 0; background: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
    .messages { height: calc(100vh - 80px); overflow-y: auto; padding-bottom: 8px; }
    .message { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; font-size: 13px; }
    .user { background: var(--vscode-editor-selectionBackground); }
    .assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); }
    .input-area { display: flex; gap: 6px; position: fixed; bottom: 10px; left: 10px; right: 10px; }
    input { flex: 1; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size: 13px; }
    button { padding: 6px 12px; cursor: pointer; border: none; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 4px; font-size: 13px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .thinking { opacity: 0.6; font-style: italic; }
  </style>
</head>
<body>
  <div class="messages" id="messages"></div>
  <div class="input-area">
    <input type="text" id="input" placeholder="Ask something..." />
    <button id="send">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const messagesDiv = document.getElementById('messages');

    function addMessage(role, content) {
      // Remove any "thinking" indicator
      const thinking = document.querySelector('.thinking');
      if (thinking) thinking.remove();
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function showThinking() {
      const div = document.createElement('div');
      div.className = 'message assistant thinking';
      div.textContent = 'Thinking...';
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function send() {
      const content = input.value.trim();
      if (!content) return;
      addMessage('user', content);
      input.value = '';
      sendBtn.disabled = true;
      showThinking();
      vscode.postMessage({ type: 'ask', content });
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });

    window.addEventListener('message', event => {
      sendBtn.disabled = false;
      if (event.data.type === 'response') {
        addMessage('assistant', event.data.content);
      } else if (event.data.type === 'error') {
        addMessage('assistant', 'Error: ' + event.data.message);
      }
    });
  </script>
</body>
</html>`;
}

class ChatViewProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getChatHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ask') {
        try {
          const response = await callApi('/api/chat', {
            sessionId: getSessionId(),
            message: message.content
          });
          webviewView.webview.postMessage({
            type: 'response',
            content: response.assistantMessage || 'No response'
          });
        } catch (error) {
          webviewView.webview.postMessage({ type: 'error', message: error.message });
        }
      }
    });
  }

  postMessage(msg) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }
}

function activate(context) {
  const chatProvider = new ChatViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aiAgentChat', chatProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),

    vscode.commands.registerCommand('aiAgent.startChat', () => {
      // Focus the sidebar view
      vscode.commands.executeCommand('aiAgentChat.focus');
    }),

    vscode.commands.registerCommand('aiAgent.askAboutCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }
      const text = editor.document.getText(editor.selection);
      if (!text) {
        vscode.window.showInformationMessage('Select code first');
        return;
      }
      await vscode.commands.executeCommand('aiAgentChat.focus');
      try {
        const response = await callApi('/api/chat', {
          sessionId: getSessionId(),
          message: `Explain this code:\n\n${text}`
        });
        chatProvider.postMessage({ type: 'response', content: response.assistantMessage });
      } catch (_) { /* error already shown by callApi */ }
    }),

    vscode.commands.registerCommand('aiAgent.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      await vscode.commands.executeCommand('aiAgentChat.focus');
      try {
        const message = text
          ? `Explain this code:\n\`\`\`\n${text}\n\`\`\``
          : 'Explain the current file';
        const response = await callApi('/api/chat', {
          sessionId: getSessionId(),
          message
        });
        chatProvider.postMessage({ type: 'response', content: response.assistantMessage });
      } catch (_) { /* error already shown by callApi */ }
    }),

    vscode.commands.registerCommand('aiAgent.refactorCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      if (!text) {
        vscode.window.showInformationMessage('Select code to refactor');
        return;
      }
      await vscode.commands.executeCommand('aiAgentChat.focus');
      try {
        const response = await callApi('/api/chat', {
          sessionId: getSessionId(),
          message: `Refactor this code:\n\`\`\`\n${text}\n\`\`\``
        });
        chatProvider.postMessage({ type: 'response', content: response.assistantMessage });
      } catch (_) { /* error already shown by callApi */ }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
