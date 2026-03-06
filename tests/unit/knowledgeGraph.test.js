jest.mock('../../utils/retry', () => ({
  withRetry: async operation => operation()
}));

jest.mock('../../config', () => ({
  logging: {
    level: 'debug',
    serviceName: 'test-service'
  },
  qdrant: {
    url: 'http://localhost:6333',
    checkCompatibility: false,
    knowledgeVectorSize: 4
  }
}));

jest.mock('../../nlp/nlp', () => ({
  analyzeText: jest.fn()
}));

const mockQdrantState = {
  getCollection: jest.fn(),
  createCollection: jest.fn(),
  upsert: jest.fn(),
  search: jest.fn()
};

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn(() => mockQdrantState)
}));

const { analyzeText } = require('../../nlp/nlp');

describe('knowledgeGraph', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQdrantState.getCollection.mockResolvedValue({});
    mockQdrantState.createCollection.mockResolvedValue({});
    mockQdrantState.upsert.mockResolvedValue({});
    mockQdrantState.search.mockResolvedValue([
      {
        id: 1,
        score: 0.91,
        payload: { text: 'Azure deployment', summary: 'summary', topics: ['azure'] }
      }
    ]);
  });

  it('stores knowledge graph payload in qdrant', async () => {
    analyzeText.mockResolvedValue({
      tokens: ['azure', 'deploy'],
      embedding: [0.2, 0.4, 0.6, 0.8],
      intents: [{ intent: 'cloud_ops' }],
      semantic: { summary: 'Deploy to Azure', topics: ['azure'] }
    });

    const { getKnowledgeGraph } = require('../../knowledgeGraph/knowledgeGraph');
    const result = await getKnowledgeGraph('Deploy to Azure');

    expect(result.embeddingStored).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(mockQdrantState.upsert).toHaveBeenCalledTimes(1);
  });

  it('searches context using vector similarity', async () => {
    analyzeText.mockResolvedValue({
      tokens: ['azure'],
      embedding: [0.1, 0.2, 0.3, 0.4],
      intents: [],
      semantic: { summary: null, topics: [] }
    });

    const { searchContext } = require('../../knowledgeGraph/knowledgeGraph');
    const results = await searchContext('Azure', 3);

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Azure deployment');
    expect(mockQdrantState.search).toHaveBeenCalledWith('knowledge', expect.objectContaining({ limit: 3 }));
  });
});
