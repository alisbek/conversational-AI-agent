// knowledge graph stub (uses Qdrant for vector storage)

const { analyzeText } = require('../nlp/nlp');
const { QdrantClient } = require('@qdrant/js-client-rest');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

let qdrant;
let collectionInitialized = false;
let vectorSize = 384;

function getQdrantClient() {
  if (!qdrant) {
    qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      checkCompatibility: false
    });
  }

  return qdrant;
}

async function init() {
  const qdrantClient = getQdrantClient();
  const config = process.env.QDRANT_VECTOR_SIZE ? parseInt(process.env.QDRANT_VECTOR_SIZE) : vectorSize;
  vectorSize = config;
  
  try {
    await withRetry(
      () => qdrantClient.getCollection('knowledge'),
      { operationName: 'qdrant.knowledge.getCollection' }
    );
    logger.info('qdrant.collection.exists', { collection: 'knowledge' });
  } catch (error) {
    await withRetry(
      () => qdrantClient.createCollection('knowledge', {
        vectors: { size: vectorSize, distance: 'Cosine' }
      }),
      { operationName: 'qdrant.knowledge.createCollection' }
    );
    logger.info('qdrant.collection.created', { collection: 'knowledge', vectorSize });
  }
  
  collectionInitialized = true;
}

async function getKnowledgeGraph(data) {
  if (!collectionInitialized) {
    await init();
  }
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(data);

  let embedding = parsed.embedding;
  
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(data, vectorSize);
    logger.warn('knowledge.embedding.fallback', {
      reason: 'llm_embedding_unavailable',
      vectorSize
    });
  }

  if (embedding && embedding.length > 0) {
    await withRetry(
      () => qdrantClient.upsert('knowledge', {
        points: [{
          id: Date.now(),
          vector: embedding,
          payload: {
            text: data,
            summary: parsed.semantic?.summary,
            intents: parsed.intents,
            topics: parsed.semantic?.topics,
            created_at: new Date().toISOString()
          }
        }]
      }),
      { operationName: 'qdrant.knowledge.upsert' }
    );
  }

  return {
    nodes: parsed.tokens.map((t, i) => ({ id: i, value: t })),
    edges: [],
    embeddingStored: Boolean(embedding),
    summary: parsed.semantic?.summary
  };
}

function generateFallbackEmbedding(text, size) {
  const hash = simpleHash(text);
  const embedding = new Array(size);
  for (let i = 0; i < size; i++) {
    embedding[i] = Math.sin(hash * (i + 1)) * 0.1;
  }
  return embedding;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash) / 2147483647;
}

async function searchContext(query, limit = 5) {
  if (!collectionInitialized) {
    await init();
  }
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(query);
  
  let embedding = parsed.embedding;
  
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(query, vectorSize);
  }

  if (!embedding) {
    return [];
  }

  try {
    const results = await withRetry(
      () => qdrantClient.search('knowledge', {
        vector: embedding,
        limit,
        with_payload: true
      }),
      { operationName: 'qdrant.knowledge.search' }
    );
    
    return results.map(r => ({
      id: r.id,
      score: r.score,
      text: r.payload?.text,
      summary: r.payload?.summary,
      topics: r.payload?.topics
    }));
  } catch (e) {
    logger.error('qdrant.knowledge.search_failed', e, { limit });
    return [];
  }
}

module.exports = { getKnowledgeGraph, searchContext, init };