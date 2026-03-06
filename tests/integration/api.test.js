const request = require('supertest');

jest.mock('../../config', () => ({
  app: { port: 3000 },
  logging: {
    level: 'debug',
    serviceName: 'test-service'
  },
  llm: {
    requestTimeoutMs: 1000
  },
  conversation: {
    maxContextTokens: 1200,
    defaultPruneKeepLast: 100
  }
}));

jest.mock('../../nlp/nlp', () => ({
  analyzeText: jest.fn(async text => ({
    intents: [{ intent: 'summarize', confidence: 1 }],
    entities: [],
    sentiment: { label: 'neutral', score: 0 },
    semantic: { summary: `Summary for: ${text}` }
  }))
}));

jest.mock('../../knowledgeGraph/knowledgeGraph', () => ({
  getKnowledgeGraph: jest.fn(),
  searchContext: jest.fn(async () => [{ id: 11, score: 0.8, text: 'stored context' }])
}));

const mockConversationMemory = {
  storeMessage: jest.fn(async () => ({ stored: true })),
  buildContextWindow: jest.fn(async () => ({
    messages: [{ role: 'user', content: 'previous message', tokenCount: 5 }],
    totalTokens: 5,
    messageCount: 1,
    recentCount: 1,
    relevantCount: 0
  })),
  getSessionStats: jest.fn(async () => ({ totalMessages: 2 })),
  pruneOldMessages: jest.fn(async () => ({ pruned: 0, kept: 2 }))
};

jest.mock('../../conversationMemory/conversationMemory', () => mockConversationMemory);

describe('API integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns health status', async () => {
    const { app } = require('../../api/server');
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('stores chat history and returns context window', async () => {
    const { app } = require('../../api/server');
    const response = await request(app)
      .post('/chat')
      .send({
        sessionId: 'session-1',
        message: 'Summarize deployment options',
        context: {
          useConversationMemory: true,
          useKnowledgeGraph: true,
          autoPrune: true
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe('session-1');
    expect(response.body.context.conversationWindow.messageCount).toBe(1);
    expect(response.body.context.knowledgeGraph).toHaveLength(1);
    expect(mockConversationMemory.storeMessage).toHaveBeenCalledTimes(2);
    expect(mockConversationMemory.pruneOldMessages).toHaveBeenCalledTimes(1);
  });
});
