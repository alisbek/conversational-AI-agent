const vscode = require('vscode');
const axios = require('axios');
const path = require('path');

let apiUrl = 'http://localhost:3000';
let sessionId = 'vscode-local';

function getApiUrl() {
  return vscode.workspace.getConfiguration('aiAgent').get('apiUrl') || apiUrl;
}

function getSessionId() {
  return vscode.workspace.getConfiguration('aiAgent').get('sessionId') || sessionId;
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

function createWebviewPanel(context) {
  const panel = vscode.window.createWebviewPanel(
    'aiAgentChat',
    'AI Agent Chat',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; margin: 0; }
    .messages { height: calc(100vh - 120px); overflow-y: auto; }
    .message { margin-bottom: 12px; padding: 8px 12px; border-radius: 6px; }
    .user { background: var(--vscode-editor-selectionBackground); }
    .assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-focusBorder); }
    .input-area { display: flex; gap: 8px; margin-top: 10px; }
    input { flex: 1; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    button { padding: 8px 16px; cursor: pointer; }
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
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesDiv.appendChild(div);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    async function send() {
      const content = input.value.trim();
      if (!content) return;
      addMessage('user', content);
      input.value = '';
      sendBtn.disabled = true;
      try {
        vscode.postMessage({ type: 'ask', content });
      } catch (e) {
        addMessage('assistant', 'Error: ' + e.message);
      }
      sendBtn.disabled = false;
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });

    window.addEventListener('message', event => {
      if (event.data.type === 'response') {
        addMessage('assistant', event.data.content);
      } else if (event.data.type === 'error') {
        addMessage('assistant', 'Error: ' + event.data.message);
      }
    });
  </script>
</body>
</html>`;

  panel.webview.html = html;

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'ask') {
      try {
        const response = await callApi('/api/chat', {
          sessionId: getSessionId(),
          message: message.content
        });
        panel.webview.postMessage({ type: 'response', content: response.assistantMessage || 'No response' });
      } catch (error) {
        panel.webview.postMessage({ type: 'error', message: error.message });
      }
    }
  });

  return panel;
}

function activate(context) {
  const chatPanel = createWebviewPanel(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('aiAgent.startChat', () => {
      chatPanel.reveal();
    }),

    vscode.commands.registerCommand('aiAgent.askAboutCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor');
        return;
      }
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      const response = await callApi('/api/chat', {
        sessionId: getSessionId(),
        message: `Explain this code:\\n\\n${selectedText}`
      });
      vscode.window.showInformationMessage(response.assistantMessage);
    }),

    vscode.commands.registerCommand('aiAgent.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      if (!text) {
        const response = await callApi('/api/chat', {
          sessionId: getSessionId(),
          message: 'Explain the current file'
        });
        chatPanel.reveal();
        chatPanel.webview.postMessage({ type: 'response', content: response.assistantMessage });
        return;
      }
      const response = await callApi('/api/chat', {
        sessionId: getSessionId(),
        message: `Explain this code:\`\`\`\\n${text}\\n\`\`\``
      });
      chatPanel.reveal();
      chatPanel.webview.postMessage({ type: 'response', content: response.assistantMessage });
    }),

    vscode.commands.registerCommand('aiAgent.refactorCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText(editor.selection);
      if (!text) {
        vscode.window.showInformationMessage('Select code to refactor');
        return;
      }
      const response = await callApi('/api/chat', {
        sessionId: getSessionId(),
        message: `Refactor this code:\`\`\`\\n${text}\\n\`\`\``
      });
      chatPanel.reveal();
      chatPanel.webview.postMessage({ type: 'response', content: response.assistantMessage });
    })
  );

  vscode.window.showInformationMessage('AI Agent ready. Run "AI Agent: Start Chat" or use the sidebar.');
}

function deactivate() {}

module.exports = { activate, deactivate };
