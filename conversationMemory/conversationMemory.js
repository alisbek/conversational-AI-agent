const { QdrantClient } = require('@qdrant/js-client-rest');
const { analyzeText } = require('../nlp/nlp');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

let qdrant;
let collectionInitialized = false;
const CONVERSATION_COLLECTION = 'conversations';
const MAX_CONTEXT_TOKENS = 4000;
const MAX_RELEVANT_MESSAGES = 10;

function getQdrantClient() {
  if (!qdrant) {
    qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      checkCompatibility: false
    });
  }
  return qdrant;
}

async function initConversationMemory() {
  const qdrantClient = getQdrantClient();
  const vectorSize = parseInt(process.env.QDRANT_VECTOR_SIZE) || 768;
  
  try {
    await withRetry(
      () => qdrantClient.getCollection(CONVERSATION_COLLECTION),
      { operationName: 'qdrant.conversations.getCollection' }
    );
  } catch (error) {
    await withRetry(
      () => qdrantClient.createCollection(CONVERSATION_COLLECTION, {
        vectors: { size: vectorSize, distance: 'Cosine' }
      }),
      { operationName: 'qdrant.conversations.createCollection' }
    );
    logger.info('qdrant.collection.created', { collection: CONVERSATION_COLLECTION, vectorSize });
  }
  
  collectionInitialized = true;
}

async function storeMessage(sessionId, role, content, metadata = {}) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(content);
  
  let embedding = parsed.embedding;
  
  if (!embedding || embedding.length === 0) {
    logger.warn('conversation.embedding.fallback', {
      reason: 'llm_embedding_unavailable',
      scope: 'storeMessage'
    });
    embedding = generateFallbackEmbedding(content, parseInt(process.env.QDRANT_VECTOR_SIZE) || 768);
  }
  
  const messageId = `${sessionId}-${Date.now()}`;
  
  await withRetry(
    () => qdrantClient.upsert(CONVERSATION_COLLECTION, {
      points: [{
        id: hashToNumber(messageId),
        vector: embedding,
        payload: {
          sessionId,
          messageId,
          role,
          content,
          timestamp: new Date().toISOString(),
          tokenCount: estimateTokens(content),
          intents: parsed.intents?.map(i => i.intent) || [],
          topics: parsed.semantic?.topics || [],
          sentiment: parsed.sentiment?.label || 'neutral',
          ...metadata
        }
      }]
    }),
    { operationName: 'qdrant.conversations.upsert' }
  );
  
  return {
    messageId,
    sessionId,
    role,
    content,
    stored: true
  };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.split(/\s+/).length * 1.3);
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

function generateFallbackEmbedding(text, size) {
  const hash = simpleHash(text);
  const embedding = new Array(size);
  for (let i = 0; i < size; i++) {
    embedding[i] = Math.sin(hash * (i + 1)) * 0.1;
  }
  return embedding;
}

function hashToNumber(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

async function getRecentMessages(sessionId, limit = 20) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  
  try {
    const results = await withRetry(
      () => qdrantClient.scroll(CONVERSATION_COLLECTION, {
        limit: limit * 10,
        with_payload: true,
        with_vector: false
      }),
      { operationName: 'qdrant.conversations.scroll_recent' }
    );
    
    const messages = results.points
      .filter(p => p.payload?.sessionId === sessionId)
      .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp))
      .slice(0, limit)
      .reverse()
      .map(p => ({
        messageId: p.payload.messageId,
        role: p.payload.role,
        content: p.payload.content,
        timestamp: p.payload.timestamp,
        tokenCount: p.payload.tokenCount,
        intents: p.payload.intents,
        topics: p.payload.topics,
        sentiment: p.payload.sentiment
      }));
    
    return messages;
  } catch (error) {
    logger.error('conversation.recent_messages.failed', error, { sessionId, limit });
    return [];
  }
}

async function getRelevantContext(sessionId, query, options = {}) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  const parsed = await analyzeText(query);
  
  let embedding = parsed.embedding;
  if (!embedding || embedding.length === 0) {
    logger.warn('conversation.embedding.fallback', {
      reason: 'llm_embedding_unavailable',
      scope: 'getRelevantContext'
    });
    embedding = generateFallbackEmbedding(query, parseInt(process.env.QDRANT_VECTOR_SIZE) || 768);
  }
  
  const maxTokens = options.maxTokens || MAX_CONTEXT_TOKENS;
  const maxMessages = options.maxMessages || MAX_RELEVANT_MESSAGES;
  
  try {
    const results = await withRetry(
      () => qdrantClient.search(CONVERSATION_COLLECTION, {
        vector: embedding,
        limit: maxMessages * 3,
        with_payload: true
      }),
      { operationName: 'qdrant.conversations.search_relevant' }
    );
    
    const sessionMessages = results
      .filter(r => r.payload?.sessionId === sessionId)
      .sort((a, b) => b.score - a.score);
    
    const otherSessionMessages = results
      .filter(r => r.payload?.sessionId !== sessionId)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.floor(maxMessages / 2));
    
    const allRelevant = [...sessionMessages, ...otherSessionMessages];
    
    const context = [];
    let totalTokens = 0;
    
    for (const msg of allRelevant) {
      const tokens = msg.payload?.tokenCount || estimateTokens(msg.payload?.content);
      if (totalTokens + tokens <= maxTokens && context.length < maxMessages) {
        context.push({
          role: msg.payload.role,
          content: msg.payload.content,
          score: msg.score,
          timestamp: msg.payload.timestamp,
          topics: msg.payload.topics,
          intents: msg.payload.intents
        });
        totalTokens += tokens;
      }
    }
    
    context.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return {
      context,
      totalTokens,
      messageCount: context.length
    };
  } catch (error) {
    logger.error('conversation.relevant_context.failed', error, { sessionId });
    return {
      context: [],
      totalTokens: 0,
      messageCount: 0
    };
  }
}

async function buildContextWindow(sessionId, query, options = {}) {
  const maxTokens = options.maxTokens || MAX_CONTEXT_TOKENS;
  
  const [recentMessages, relevantContext] = await Promise.all([
    getRecentMessages(sessionId, 10),
    getRelevantContext(sessionId, query, { maxTokens: Math.floor(maxTokens * 0.6) })
  ]);
  
  const recentSet = new Set(recentMessages.map(m => m.messageId));
  const uniqueRelevant = relevantContext.context.filter(m => !recentSet.has(m.messageId));
  
  const allMessages = [...recentMessages, ...uniqueRelevant];
  
  allMessages.sort((a, b) => {
    const timeA = new Date(a.timestamp);
    const timeB = new Date(b.timestamp);
    return timeA - timeB;
  });
  
  const window = [];
  let totalTokens = 0;
  
  for (const msg of allMessages) {
    const tokens = msg.tokenCount || estimateTokens(msg.content);
    if (totalTokens + tokens <= maxTokens) {
      window.push(msg);
      totalTokens += tokens;
    } else {
      break;
    }
  }
  
  return {
    messages: window,
    totalTokens,
    messageCount: window.length,
    recentCount: recentMessages.length,
    relevantCount: uniqueRelevant.length
  };
}

async function getSessionStats(sessionId) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  
  try {
    const results = await withRetry(
      () => qdrantClient.scroll(CONVERSATION_COLLECTION, {
        limit: 1000,
        with_payload: true,
        with_vector: false
      }),
      { operationName: 'qdrant.conversations.scroll_stats' }
    );
    
    const sessionMessages = results.points.filter(p => p.payload?.sessionId === sessionId);
    
    const stats = {
      totalMessages: sessionMessages.length,
      userMessages: 0,
      assistantMessages: 0,
      totalTokens: 0,
      intents: {},
      topics: {},
      sentimentBreakdown: { positive: 0, negative: 0, neutral: 0 },
      oldestMessage: null,
      newestMessage: null
    };
    
    const timestamps = [];
    
    for (const msg of sessionMessages) {
      const payload = msg.payload;
      
      if (payload.role === 'user') stats.userMessages++;
      else if (payload.role === 'assistant') stats.assistantMessages++;
      
      stats.totalTokens += payload.tokenCount || 0;
      
      if (payload.intents) {
        for (const intent of payload.intents) {
          stats.intents[intent] = (stats.intents[intent] || 0) + 1;
        }
      }
      
      if (payload.topics) {
        for (const topic of payload.topics) {
          stats.topics[topic] = (stats.topics[topic] || 0) + 1;
        }
      }
      
      if (payload.sentiment) {
        stats.sentimentBreakdown[payload.sentiment]++;
      }
      
      if (payload.timestamp) {
        timestamps.push(new Date(payload.timestamp));
      }
    }
    
    if (timestamps.length > 0) {
      stats.oldestMessage = new Date(Math.min(...timestamps)).toISOString();
      stats.newestMessage = new Date(Math.max(...timestamps)).toISOString();
    }
    
    return stats;
  } catch (error) {
    logger.error('conversation.session_stats.failed', error, { sessionId });
    return null;
  }
}

async function pruneOldMessages(sessionId, keepLast = 50) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  
  try {
    const results = await withRetry(
      () => qdrantClient.scroll(CONVERSATION_COLLECTION, {
        limit: 1000,
        with_payload: true,
        with_vector: false
      }),
      { operationName: 'qdrant.conversations.scroll_prune' }
    );
    
    const sessionMessages = results.points
      .filter(p => p.payload?.sessionId === sessionId)
      .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp));
    
    if (sessionMessages.length <= keepLast) {
      return { pruned: 0, kept: sessionMessages.length };
    }
    
    const toDelete = sessionMessages.slice(keepLast);
    const idsToDelete = toDelete.map(m => hashToNumber(m.payload.messageId));
    
    if (idsToDelete.length > 0) {
      await withRetry(
        () => qdrantClient.delete(CONVERSATION_COLLECTION, {
          points: idsToDelete
        }),
        { operationName: 'qdrant.conversations.delete_prune' }
      );
    }
    
    return {
      pruned: toDelete.length,
      kept: keepLast
    };
  } catch (error) {
    logger.error('conversation.prune.failed', error, { sessionId, keepLast });
    return { pruned: 0, error: error.message };
  }
}

module.exports = {
  initConversationMemory,
  storeMessage,
  getRecentMessages,
  getRelevantContext,
  buildContextWindow,
  getSessionStats,
  pruneOldMessages,
  estimateTokens
};