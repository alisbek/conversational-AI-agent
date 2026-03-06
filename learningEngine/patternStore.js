const {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  generateFallbackEmbedding,
  hashToNumber,
  VECTOR_SIZE
} = require('./base');
const { analyzeText } = require('../nlp/nlp');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

async function storePattern(pattern) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const { patternName, description, codeTemplate, language, whenToUse = [], examples = [] } = pattern;
  
  const fullText = `${patternName} ${description} ${codeTemplate || ''} ${whenToUse.join(' ')}`;
  const parsed = await analyzeText(fullText);
  
  let embedding = parsed.embedding;
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(fullText, VECTOR_SIZE);
  }
  
  const patternId = `pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.patterns, {
      points: [{
        id: hashToNumber(patternId),
        vector: embedding,
        payload: {
          patternId,
          patternName,
          description: description || '',
          codeTemplate: codeTemplate || '',
          language: language || 'unknown',
          whenToUse,
          examples,
          provenCount: 0,
          confidence: 0.5,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          topics: parsed.semantic?.topics || []
        }
      }]
    }),
    { operationName: 'qdrant.patterns.upsert' }
  );
  
  logger.info('pattern.stored', { patternId, patternName, language });
  
  return { patternId, success: true };
}

async function searchPatterns(query, language, limit = 10) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(query);
  
  let embedding = parsed.embedding;
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(query, VECTOR_SIZE);
  }
  
  const results = await withRetry(
    () => qdrantClient.search(COLLECTIONS.patterns, {
      vector: embedding,
      limit: limit * 2,
      with_payload: true
    }),
    { operationName: 'qdrant.patterns.search' }
  );
  
  return results
    .filter(r => !language || r.payload.language === language)
    .sort((a, b) => b.payload.confidence - a.payload.confidence)
    .slice(0, limit)
    .map(r => ({
      patternId: r.payload.patternId,
      patternName: r.payload.patternName,
      description: r.payload.description,
      codeTemplate: r.payload.codeTemplate,
      language: r.payload.language,
      whenToUse: r.payload.whenToUse,
      examples: r.payload.examples,
      provenCount: r.payload.provenCount,
      confidence: r.payload.confidence,
      score: r.score
    }));
}

async function getPatternById(patternId) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(patternId);
  
  const result = await withRetry(
    () => qdrantClient.retrieve(COLLECTIONS.patterns, {
      ids: [id],
      with_payload: true
    }),
    { operationName: 'qdrant.patterns.retrieve' }
  );
  
  return result.length > 0 ? result[0].payload : null;
}

async function trackPatternUsage(patternId) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(patternId);
  
  const result = await withRetry(
    () => qdrantClient.retrieve(COLLECTIONS.patterns, {
      ids: [id],
      with_payload: true
    }),
    { operationName: 'qdrant.patterns.retrieve' }
  );
  
  if (result.length === 0) return { success: false };
  
  const payload = result[0].payload;
  const newProvenCount = (payload.provenCount || 0) + 1;
  const newConfidence = Math.min(1, 0.5 + (newProvenCount * 0.05));
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.patterns, {
      points: [{
        id,
        vector: payload.vector || generateFallbackEmbedding(payload.patternName, VECTOR_SIZE),
        payload: {
          ...payload,
          provenCount: newProvenCount,
          confidence: newConfidence,
          lastUsedAt: new Date().toISOString()
        }
      }]
    }),
    { operationName: 'qdrant.patterns.updateUsage' }
  );
  
  return { success: true, provenCount: newProvenCount };
}

async function getPatternsByLanguage(language) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(COLLECTIONS.patterns, {
      limit: 1000,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.patterns.scroll' }
  );
  
  return results.points
    .filter(p => p.payload.language === language)
    .sort((a, b) => b.payload.confidence - a.payload.confidence)
    .map(p => p.payload);
}

async function getAllPatterns(limit = 100) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(COLLECTIONS.patterns, {
      limit,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.patterns.scroll' }
  );
  
  return results.points
    .sort((a, b) => b.payload.confidence - a.payload.confidence)
    .map(p => p.payload);
}

module.exports = {
  storePattern,
  searchPatterns,
  getPatternById,
  trackPatternUsage,
  getPatternsByLanguage,
  getAllPatterns
};
