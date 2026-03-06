const {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  generateFallbackEmbedding,
  hashToNumber,
  estimateTokens,
  VECTOR_SIZE
} = require('./base');
const { analyzeText } = require('../nlp/nlp');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

async function storeExperience(experience) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const { problem, solution, code, language, outcome = 'success', tags = [] } = experience;
  
  const fullText = `${problem} ${solution} ${code || ''}`;
  const parsed = await analyzeText(fullText);
  
  let embedding = parsed.embedding;
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(fullText, VECTOR_SIZE);
  }
  
  const experienceId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.experiences, {
      points: [{
        id: hashToNumber(experienceId),
        vector: embedding,
        payload: {
          experienceId,
          problem,
          solution,
          code: code || '',
          language: language || 'unknown',
          outcome,
          tags,
          timesUsed: 0,
          rating: null,
          confidence: 0.5,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          intents: parsed.intents?.map(i => i.intent) || [],
          topics: parsed.semantic?.topics || []
        }
      }]
    }),
    { operationName: 'qdrant.experiences.upsert' }
  );
  
  logger.info('experience.stored', { experienceId, language, outcome });
  
  return { experienceId, success: true };
}

async function getProvenSolutions(query, language, minConfidence = 0.7) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(query);
  
  let embedding = parsed.embedding;
  if (!embedding || embedding.length === 0) {
    embedding = generateFallbackEmbedding(query, VECTOR_SIZE);
  }
  
  const results = await withRetry(
    () => qdrantClient.search(COLLECTIONS.experiences, {
      vector: embedding,
      limit: 20,
      with_payload: true
    }),
    { operationName: 'qdrant.experiences.search' }
  );
  
  return results
    .filter(r => {
      const payload = r.payload;
      const langMatch = !language || payload.language === language;
      const confMatch = payload.confidence >= minConfidence;
      return langMatch && confMatch;
    })
    .sort((a, b) => b.payload.confidence - a.payload.confidence)
    .map(r => ({
      experienceId: r.payload.experienceId,
      problem: r.payload.problem,
      solution: r.payload.solution,
      code: r.payload.code,
      language: r.payload.language,
      outcome: r.payload.outcome,
      confidence: r.payload.confidence,
      timesUsed: r.payload.timesUsed,
      rating: r.payload.rating,
      tags: r.payload.tags,
      score: r.score
    }));
}

async function trackUsage(experienceId) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(experienceId);
  
  const result = await withRetry(
    () => qdrantClient.retrieve(COLLECTIONS.experiences, {
      ids: [id],
      with_payload: true
    }),
    { operationName: 'qdrant.experiences.retrieve' }
  );
  
  if (result.length === 0) return { success: false, reason: 'not_found' };
  
  const payload = result[0].payload;
  const newTimesUsed = (payload.timesUsed || 0) + 1;
  const usageMultiplier = Math.min(1.5, 1 + Math.log10(newTimesUsed));
  const newConfidence = Math.min(1, payload.confidence * usageMultiplier);
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.experiences, {
      points: [{
        id,
        vector: payload.vector || generateFallbackEmbedding(payload.problem, VECTOR_SIZE),
        payload: {
          ...payload,
          timesUsed: newTimesUsed,
          confidence: newConfidence,
          lastUsedAt: new Date().toISOString()
        }
      }]
    }),
    { operationName: 'qdrant.experiences.updateUsage' }
  );
  
  return { success: true, timesUsed: newTimesUsed, confidence: newConfidence };
}

async function rateExperience(experienceId, rating) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(experienceId);
  
  const result = await withRetry(
    () => qdrantClient.retrieve(COLLECTIONS.experiences, {
      ids: [id],
      with_payload: true
    }),
    { operationName: 'qdrant.experiences.retrieve' }
  );
  
  if (result.length === 0) return { success: false, reason: 'not_found' };
  
  const payload = result[0].payload;
  const currentRating = payload.rating;
  const newRating = currentRating 
    ? (currentRating * 0.7 + rating * 0.3)
    : rating;
  
  const successRate = payload.outcome === 'success' ? 1 : (payload.outcome === 'partial' ? 0.5 : 0);
  const newConfidence = Math.min(1, newRating * successRate * 1.2);
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.experiences, {
      points: [{
        id,
        vector: payload.vector || generateFallbackEmbedding(payload.problem, VECTOR_SIZE),
        payload: {
          ...payload,
          rating: newRating,
          confidence: newConfidence,
          lastUsedAt: new Date().toISOString()
        }
      }]
    }),
    { operationName: 'qdrant.experiences.updateRating' }
  );
  
  return { success: true, rating: newRating, confidence: newConfidence };
}

async function getExperiencesByLanguage(language) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(COLLECTIONS.experiences, {
      limit: 1000,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.experiences.scroll' }
  );
  
  return results.points
    .filter(p => p.payload.language === language)
    .map(p => p.payload);
}

async function getAllExperiences(limit = 100) {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(COLLECTIONS.experiences, {
      limit,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.experiences.scroll' }
  );
  
  return results.points.map(p => p.payload);
}

module.exports = {
  storeExperience,
  getProvenSolutions,
  trackUsage,
  rateExperience,
  getExperiencesByLanguage,
  getAllExperiences
};
