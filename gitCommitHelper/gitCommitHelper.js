const { exec } = require('child_process');
const axios = require('axios');

function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'http://localhost:11434';
  const chatModel = process.env.LLM_CHAT_MODEL || 'minimax-m2.5:cloud';
  
  const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');
  
  return {
    enabled: true,
    apiKey: apiKey || 'dummy',
    baseUrl,
    chatModel,
    provider: isOllama ? 'ollama' : (process.env.LLM_PROVIDER || 'openai-compatible'),
    isOllama
  };
}

function getLlmHttpClient(config) {
  const clientConfig = {
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: 120000
  };
  
  if (!config.isOllama && config.apiKey && config.apiKey !== 'dummy') {
    clientConfig.headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  return axios.create(clientConfig);
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

async function getGitDiff() {
  try {
    const stagedDiff = await execCommand('git diff --cached');
    const unstagedDiff = await execCommand('git diff');
    return { stagedDiff, unstagedDiff };
  } catch (error) {
    throw new Error(`Failed to get git diff: ${error.message}`);
  }
}

async function getGitStatus() {
  try {
    const status = await execCommand('git status --porcelain');
    return status.split('\n').filter(Boolean).map(line => {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3);
      return { status, file };
    });
  } catch (error) {
    throw new Error(`Failed to get git status: ${error.message}`);
  }
}

async function generateCommitMessage(diffs, status) {
  const config = getLlmConfig();
  const client = getLlmHttpClient(config);
  
  const changesSummary = status.map(s => `${s.status} ${s.file}`).join('\n');
  
  const prompt = `Analyze the following git changes and generate a concise, meaningful commit message following conventional commit format.

Return a JSON object with this structure:
{
  "type": "feat|fix|refactor|docs|test|chore|style|perf",
  "scope": "optional scope",
  "subject": "brief description in imperative mood",
  "body": "optional longer description",
  "breaking": boolean
}

Changed files:
${changesSummary}

Diff summary:
${diffs.stagedDiff || diffs.unstagedDiff || 'No changes'}

Constraints:
- Return valid JSON only, no markdown
- Use imperative mood for subject (e.g., "add feature" not "added feature")
- Keep subject under 72 characters
- Type should reflect the nature of changes (feat for new features, fix for bugs, refactor for code changes, etc.)
- Only include body if changes need explanation
- Set breaking to true only if this is a breaking change`;

  let response;
  
  if (config.isOllama) {
    response = await client.post('/api/chat', {
      model: config.chatModel,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are a git commit message generator. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    const content = response.data?.message?.content;
    if (!content) {
      return null;
    }
    
    try {
      const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return null;
    }
  }
  
  response = await client.post('/chat/completions', {
    model: config.chatModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a git commit message generator. Always respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ]
  });

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

function formatCommitMessage(commitInfo) {
  if (!commitInfo) {
    return 'chore: update files';
  }
  
  let message = commitInfo.type;
  if (commitInfo.scope) {
    message += `(${commitInfo.scope})`;
  }
  if (commitInfo.breaking) {
    message += '!';
  }
  message += `: ${commitInfo.subject}`;
  
  if (commitInfo.body) {
    message += `\n\n${commitInfo.body}`;
  }
  
  if (commitInfo.breaking) {
    message += '\n\nBREAKING CHANGE: This commit introduces breaking changes';
  }
  
  return message;
}

async function gitCommitHelper(customMessage = null) {
  try {
    const status = await getGitStatus();
    
    if (status.length === 0) {
      return { success: false, message: 'No changes to commit' };
    }
    
    const diffs = await getGitDiff();
    
    if (!diffs.stagedDiff && !diffs.unstagedDiff) {
      return { success: false, message: 'No staged or unstaged changes' };
    }
    
    let commitMessage;
    
    if (customMessage) {
      commitMessage = customMessage;
    } else {
      const commitInfo = await generateCommitMessage(diffs, status);
      commitMessage = formatCommitMessage(commitInfo);
    }
    
    if (!diffs.stagedDiff && diffs.unstagedDiff) {
      await execCommand('git add -A');
    }
    
    const result = await execCommand(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
    
    return {
      success: true,
      message: commitMessage,
      output: result,
      files: status
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function suggestCommitMessage() {
  try {
    const status = await getGitStatus();
    
    if (status.length === 0) {
      return { success: false, message: 'No changes to commit' };
    }
    
    const diffs = await getGitDiff();
    const commitInfo = await generateCommitMessage(diffs, status);
    const commitMessage = formatCommitMessage(commitInfo);
    
    return {
      success: true,
      message: commitMessage,
      details: commitInfo,
      files: status
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { gitCommitHelper, suggestCommitMessage, getGitDiff, getGitStatus };