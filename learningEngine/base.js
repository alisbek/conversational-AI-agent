const { QdrantClient } = require('@qdrant/js-client-rest');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const config = require('../config');

let qdrant;
let collectionsInitialized = false;

const COLLECTIONS = {
  experiences: 'experiences',
  userProfile: 'user_profile',
  patterns: 'patterns'
};

const VECTOR_SIZE = config.qdrant.knowledgeVectorSize || 384;

function getQdrantClient() {
  if (!qdrant) {
    qdrant = new QdrantClient({
      url: config.qdrant.url,
      checkCompatibility: config.qdrant.checkCompatibility
    });
  }
  return qdrant;
}

async function initCollections() {
  if (collectionsInitialized) return;
  
  const qdrantClient = getQdrantClient();
  
  for (const [name, collectionName] of Object.entries(COLLECTIONS)) {
    try {
      await withRetry(
        () => qdrantClient.getCollection(collectionName),
        { operationName: `qdrant.${name}.getCollection` }
      );
      logger.info(`qdrant.collection.exists`, { collection: collectionName });
    } catch (error) {
      await withRetry(
        () => qdrantClient.createCollection(collectionName, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
        }),
        { operationName: `qdrant.${name}.createCollection` }
      );
      logger.info(`qdrant.collection.created`, { collection: collectionName, vectorSize: VECTOR_SIZE });
    }
  }
  
  collectionsInitialized = true;
}

function generateFallbackEmbedding(text, size = VECTOR_SIZE) {
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

function hashToNumber(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

module.exports = {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  VECTOR_SIZE,
  generateFallbackEmbedding,
  simpleHash,
  hashToNumber,
  estimateTokens
};
