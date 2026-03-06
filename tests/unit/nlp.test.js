jest.mock('axios', () => ({
  create: jest.fn()
}));

jest.mock('../../utils/retry', () => ({
  withRetry: async operation => operation()
}));

jest.mock('../../config', () => ({
  logging: {
    level: 'debug',
    serviceName: 'test-service'
  },
  llm: {
    apiKey: '',
    baseUrl: 'http://localhost:11434',
    chatModel: 'test-chat-model',
    embeddingModel: 'test-embedding-model',
    provider: 'openai-compatible',
    requestTimeoutMs: 1000
  }
}));

const axios = require('axios');

describe('nlp.analyzeText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts heuristics and merges semantic insights', async () => {
    const post = jest.fn(async (url) => {
      if (url === '/api/chat') {
        return {
          data: {
            message: {
              content: JSON.stringify({
                summary: 'Cloud deployment request.',
                intents: [{ intent: 'cloud_ops', confidence: 0.9 }],
                entities: [{ type: 'service', value: 'Azure' }],
                topics: ['deployment']
              })
            }
          }
        };
      }

      if (url === '/api/embeddings') {
        return {
          data: {
            embedding: [0.1, 0.2, 0.3]
          }
        };
      }

      throw new Error(`unexpected endpoint: ${url}`);
    });

    axios.create.mockReturnValue({ post });

    const { analyzeText } = require('../../nlp/nlp');
    const result = await analyzeText('Please deploy this Azure service and summarize status.');

    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.intents.some(intent => intent.intent === 'cloud_ops')).toBe(true);
    expect(result.semantic.summary).toBe('Cloud deployment request.');
    expect(result.embeddingDimensions).toBe(3);
    expect(result.entities.some(entity => entity.type === 'service')).toBe(true);
  });

  it('handles embedding failures gracefully', async () => {
    const post = jest.fn(async (url) => {
      if (url === '/api/chat') {
        return {
          data: {
            message: {
              content: JSON.stringify({
                summary: 'Fallback summary.',
                intents: [],
                entities: [],
                topics: []
              })
            }
          }
        };
      }

      if (url === '/api/embeddings') {
        throw new Error('embedding endpoint down');
      }

      throw new Error(`unexpected endpoint: ${url}`);
    });

    axios.create.mockReturnValue({ post });

    const { analyzeText } = require('../../nlp/nlp');
    const result = await analyzeText('Refactor this code quickly.');

    expect(result.embedding).toBeNull();
    expect(result.semantic.summary).toBe('Fallback summary.');
    expect(result.intents.some(intent => intent.intent === 'refactor')).toBe(true);
  });
});
