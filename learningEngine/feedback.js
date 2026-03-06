const {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  generateFallbackEmbedding,
  hashToNumber,
  VECTOR_SIZE
} = require('./base');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const FEEDBACK_COLLECTION = 'feedback';

async function initFeedbackCollection() {
  const qdrantClient = getQdrantClient();
  
  try {
    await withRetry(
      () => qdrantClient.getCollection(FEEDBACK_COLLECTION),
      { operationName: 'qdrant.feedback.getCollection' }
    );
  } catch (error) {
    await withRetry(
      () => qdrantClient.createCollection(FEEDBACK_COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
      }),
      { operationName: 'qdrant.feedback.createCollection' }
    );
    logger.info('qdrant.collection.created', { collection: FEEDBACK_COLLECTION });
  }
}

async function submitFeedback(feedback) {
  await initFeedbackCollection();
  
  const qdrantClient = getQdrantClient();
  const { responseId, type, rating, note, sessionId } = feedback;
  
  const feedbackId = `fb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fullText = `${type} ${note || ''} ${rating || ''}`;
  const embedding = generateFallbackEmbedding(fullText, VECTOR_SIZE);
  
  await withRetry(
    () => qdrantClient.upsert(FEEDBACK_COLLECTION, {
      points: [{
        id: hashToNumber(feedbackId),
        vector: embedding,
        payload: {
          feedbackId,
          responseId: responseId || '',
          type,
          rating,
          note: note || '',
          sessionId: sessionId || '',
          createdAt: new Date().toISOString()
        }
      }]
    }),
    { operationName: 'qdrant.feedback.upsert' }
  );
  
  logger.info('feedback.submitted', { feedbackId, type, rating });
  
  return { feedbackId, success: true };
}

async function markFailed(experienceId, reason) {
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
  const newOutcome = 'failed';
  const newConfidence = Math.max(0.1, payload.confidence - 0.3);
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.experiences, {
      points: [{
        id,
        vector: payload.vector || generateFallbackEmbedding(payload.problem, VECTOR_SIZE),
        payload: {
          ...payload,
          outcome: newOutcome,
          confidence: newConfidence,
          failureReason: reason,
          lastUsedAt: new Date().toISOString()
        }
      }]
    }),
    { operationName: 'qdrant.experiences.markFailed' }
  );
  
  logger.info('experience.marked_failed', { experienceId, reason });
  
  return { success: true, outcome: newOutcome, confidence: newConfidence };
}

async function getRecentFeedback(limit = 50) {
  await initFeedbackCollection();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(FEEDBACK_COLLECTION, {
      limit,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.feedback.scroll' }
  );
  
  return results.points
    .sort((a, b) => new Date(b.payload.createdAt) - new Date(a.payload.createdAt))
    .map(p => p.payload);
}

async function getFeedbackStats() {
  await initFeedbackCollection();
  
  const qdrantClient = getQdrantClient();
  
  const results = await withRetry(
    () => qdrantClient.scroll(FEEDBACK_COLLECTION, {
      limit: 1000,
      with_payload: true,
      with_vector: false
    }),
    { operationName: 'qdrant.feedback.scroll' }
  );
  
  const feedbacks = results.points.map(p => p.payload);
  
  const stats = {
    total: feedbacks.length,
    positive: feedbacks.filter(f => f.type === 'positive').length,
    negative: feedbacks.filter(f => f.type === 'negative').length,
    neutral: feedbacks.filter(f => f.type === 'neutral').length,
    averageRating: 0
  };
  
  const ratings = feedbacks.filter(f => f.rating != null).map(f => f.rating);
  if (ratings.length > 0) {
    stats.averageRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  }
  
  return stats;
}

module.exports = {
  submitFeedback,
  markFailed,
  getRecentFeedback,
  getFeedbackStats
};
