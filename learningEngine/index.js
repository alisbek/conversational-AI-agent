const {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  VECTOR_SIZE,
  generateFallbackEmbedding,
  simpleHash,
  hashToNumber,
  estimateTokens
} = require('./base');

const experienceStore = require('./experienceStore');
const userProfile = require('./userProfile');
const patternStore = require('./patternStore');
const feedback = require('./feedback');
const insightExtractor = require('./insightExtractor');

async function init() {
  await initCollections();
  console.log('Learning Engine initialized');
}

module.exports = {
  init,
  experienceStore,
  userProfile,
  patternStore,
  feedback,
  insightExtractor,
  COLLECTIONS,
  VECTOR_SIZE,
  generateFallbackEmbedding,
  simpleHash,
  hashToNumber,
  estimateTokens
};
