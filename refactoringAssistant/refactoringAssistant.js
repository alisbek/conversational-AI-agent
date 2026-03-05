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

async function refactorCode(code, options = {}) {
  const config = getLlmConfig();
  const client = getLlmHttpClient(config);
  
  const prompt = `You are an expert code refactoring assistant. Analyze the following code and provide refactoring suggestions.

Return a JSON object with this exact structure:
{
  "summary": "Brief summary of code analysis",
  "issues": [
    {
      "type": "complexity|duplication|naming|performance|maintainability",
      "severity": "low|medium|high",
      "line": number,
      "description": "Description of the issue"
    }
  ],
  "refactorings": [
    {
      "type": "extract_method|rename|optimize|simplify|restructure",
      "description": "What to refactor",
      "originalCode": "Original code snippet",
      "refactoredCode": "Refactored code snippet",
      "benefits": ["benefit1", "benefit2"]
    }
  ],
  "refactoredCode": "Complete refactored version if major changes suggested, or null if only minor suggestions"
}

Constraints:
- Return valid JSON only, no markdown formatting
- Be specific and actionable
- Focus on meaningful improvements, not style preferences
- Provide complete refactored code only if changes are significant

Code to analyze:
\`\`\`
${code}
\`\`\``;

  let response;
  
  if (config.isOllama) {
    response = await client.post('/api/chat', {
      model: config.chatModel,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are an expert code refactoring assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    const content = response.data?.message?.content;
    if (!content) {
      return { summary: 'No response from LLM', issues: [], refactorings: [], refactoredCode: null };
    }
    
    try {
      const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return { 
        summary: 'Failed to parse LLM response', 
        issues: [], 
        refactorings: [], 
        refactoredCode: null,
        error: e.message,
        rawResponse: content
      };
    }
  }
  
  response = await client.post('/chat/completions', {
    model: config.chatModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert code refactoring assistant. Always respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ]
  });

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    return { summary: 'No response from LLM', issues: [], refactorings: [], refactoredCode: null };
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    return { 
      summary: 'Failed to parse LLM response', 
      issues: [], 
      refactorings: [], 
      refactoredCode: null,
      error: e.message,
      rawResponse: content
    };
  }
}

async function applyRefactoring(code, refactoringType) {
  const result = await refactorCode(code, { focus: refactoringType });
  
  if (result.refactoredCode) {
    return {
      success: true,
      originalCode: code,
      refactoredCode: result.refactoredCode,
      changes: result.refactorings,
      summary: result.summary
    };
  }
  
  return {
    success: false,
    message: 'No significant refactoring suggested',
    suggestions: result.refactorings,
    summary: result.summary
  };
}

module.exports = { refactorCode, applyRefactoring };