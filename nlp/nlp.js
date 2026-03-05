const axios = require('axios');

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'if',
  'in', 'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or', 's', 'such', 't',
  'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'to',
  'was', 'will', 'with', 'you', 'your'
]);

const POSITIVE_WORDS = new Set([
  'good', 'great', 'excellent', 'improve', 'fast', 'clean', 'stable', 'success'
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'slow', 'bug', 'error', 'fail', 'failed', 'issue', 'broken', 'problem'
]);

const INTENT_RULES = [
  { intent: 'explain_code', patterns: [/explain|understand|what does/i] },
  { intent: 'summarize', patterns: [/summari[sz]e|overview|tl;dr/i] },
  { intent: 'refactor', patterns: [/refactor|clean up|optimi[sz]e|improve code/i] },
  { intent: 'generate_docs', patterns: [/document|docs|readme|comment/i] },
  { intent: 'git_commit', patterns: [/commit|git message|changelog/i] },
  { intent: 'cloud_ops', patterns: [/deploy|cloud|azure|aws|gcp|kubernetes|serverless/i] }
];

const DEFAULT_LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
const DEFAULT_CHAT_MODEL = process.env.LLM_CHAT_MODEL || 'minimax-m2.5:cloud';
const DEFAULT_EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || 'minimax-m2.5:cloud';

function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_LLM_BASE_URL;
  const chatModel = process.env.LLM_CHAT_MODEL || DEFAULT_CHAT_MODEL;
  const embeddingModel = process.env.LLM_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

  const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');

  return {
    enabled: true,
    apiKey: apiKey || 'dummy',
    baseUrl,
    chatModel,
    embeddingModel,
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
    timeout: 60000
  };
  
  if (!config.isOllama && config.apiKey && config.apiKey !== 'dummy') {
    clientConfig.headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  return axios.create(clientConfig);
}

function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  if (!text) {
    return [];
  }

  const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9'_\-/]*/g);
  return matches || [];
}

function splitSentences(text) {
  if (!text) {
    return [];
  }

  return text
    .split(/[.!?]+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function extractKeywords(tokens, maxKeywords = 10) {
  const frequencies = new Map();

  for (const token of tokens) {
    if (STOP_WORDS.has(token) || token.length < 3) {
      continue;
    }

    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxKeywords)
    .map(([word, frequency]) => ({ word, frequency }));
}

function detectSentiment(tokens) {
  let score = 0;

  for (const token of tokens) {
    if (POSITIVE_WORDS.has(token)) {
      score += 1;
    }
    if (NEGATIVE_WORDS.has(token)) {
      score -= 1;
    }
  }

  let label = 'neutral';
  if (score > 1) {
    label = 'positive';
  } else if (score < -1) {
    label = 'negative';
  }

  return { label, score };
}

function detectIntents(text) {
  const matches = [];

  for (const rule of INTENT_RULES) {
    const hits = rule.patterns.filter(pattern => pattern.test(text)).length;
    if (hits > 0) {
      matches.push({ intent: rule.intent, confidence: Math.min(1, hits / rule.patterns.length) });
    }
  }

  return matches.sort((left, right) => right.confidence - left.confidence);
}

function extractEntities(text) {
  const entities = [];
  const urls = text.match(/https?:\/\/[^\s]+/gi) || [];
  const filePaths = text.match(/(?:[a-zA-Z]:\\|\.\/|\.\.\/)[^\s'"`]+/g) || [];
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];

  urls.forEach(value => entities.push({ type: 'url', value }));
  filePaths.forEach(value => entities.push({ type: 'file_path', value }));
  emails.forEach(value => entities.push({ type: 'email', value }));

  return entities;
}

function mergeIntents(heuristicIntents, semanticIntents) {
  const merged = new Map();

  for (const intent of heuristicIntents) {
    merged.set(intent.intent, { intent: intent.intent, confidence: intent.confidence, source: 'heuristic' });
  }

  for (const intent of semanticIntents) {
    if (!intent || !intent.intent) {
      continue;
    }

    const existing = merged.get(intent.intent);
    const normalized = {
      intent: intent.intent,
      confidence: typeof intent.confidence === 'number' ? intent.confidence : 0.5,
      source: 'llm'
    };

    if (!existing || normalized.confidence > existing.confidence) {
      merged.set(intent.intent, normalized);
    }
  }

  return [...merged.values()].sort((left, right) => right.confidence - left.confidence);
}

async function getEmbedding(text, config) {
  const client = getLlmHttpClient(config);
  
  if (config.isOllama) {
    const response = await client.post('/api/embeddings', {
      model: config.embeddingModel,
      prompt: text
    });
    return response.data?.embedding || null;
  }
  
  const response = await client.post('/embeddings', {
    model: config.embeddingModel,
    input: text
  });

  return response.data?.data?.[0]?.embedding || null;
}

async function getSemanticInsights(text, config) {
  const client = getLlmHttpClient(config);
  
  const prompt = `Analyze the user text and return strict JSON with this shape:
{
  "summary": string,
  "intents": [{"intent": string, "confidence": number}],
  "entities": [{"type": string, "value": string}],
  "topics": string[]
}
Constraints:
- Return valid JSON only, no markdown.
- Keep summary to one sentence.
- Confidence is a number from 0 to 1.`;

  let response;
  
  if (config.isOllama) {
    response = await client.post('/api/chat', {
      model: config.chatModel,
      temperature: 0,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: text }
      ],
      stream: false
    });
    const content = response.data?.message?.content;
    if (!content) {
      return null;
    }
    try {
      const cleaned = content.replace(/^```json\n?/, '').replace(/```$/, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  
  response = await client.post('/chat/completions', {
    model: config.chatModel,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: text }
    ]
  });

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function analyzeText(text) {
  const llmConfig = getLlmConfig();
  const normalizedText = normalizeText(text);
  const tokens = tokenize(normalizedText);
  const sentences = splitSentences(normalizedText);
  const keywords = extractKeywords(tokens);
  const sentiment = detectSentiment(tokens);
  const heuristicIntents = detectIntents(normalizedText);
  const heuristicEntities = extractEntities(normalizedText);

  let semantic = null;
  let embedding = null;
  let semanticError = null;

  if (llmConfig.enabled && normalizedText) {
    try {
      const [semanticInsights, initialEmbedding] = await Promise.all([
        getSemanticInsights(normalizedText, llmConfig),
        getEmbedding(normalizedText, llmConfig).catch(e => {
          console.error('Embedding generation failed:', e.message);
          return null;
        })
      ]);

      embedding = initialEmbedding;
      semantic = semanticInsights;
    } catch (error) {
      semanticError = error.message;
    }
  }

  const intents = mergeIntents(heuristicIntents, semantic?.intents || []);
  const entities = [...heuristicEntities, ...(semantic?.entities || [])];

  return {
    originalText: text || '',
    normalizedText,
    tokens,
    tokenCount: tokens.length,
    sentenceCount: sentences.length,
    sentences,
    keywords,
    intents,
    sentiment,
    entities,
    semantic: {
      provider: llmConfig.provider,
      enabled: llmConfig.enabled,
      model: llmConfig.chatModel,
      embeddingModel: llmConfig.embeddingModel,
      summary: semantic?.summary || null,
      topics: semantic?.topics || [],
      error: semanticError
    },
    embedding,
    embeddingDimensions: Array.isArray(embedding) ? embedding.length : 0
  };
}

module.exports = {
  analyzeText
};