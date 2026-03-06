const { QdrantClient } = require('@qdrant/js-client-rest');
const { analyzeText } = require('../nlp/nlp');

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
    await qdrantClient.getCollection(CONVERSATION_COLLECTION);
  } catch {
    await qdrantClient.createCollection(CONVERSATION_COLLECTION, {
      vectors: { size: vectorSize, distance: 'Cosine' }
    });
    console.log(`Conversation memory collection created with vector size ${vectorSize}`);
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
    console.warn('No embedding generated for message, using fallback');
    const hash = simpleHash(content);
    const size = parseInt(process.env.QDRANT_VECTOR_SIZE) || 768;
    embedding = new Array(size);
    for (let i = 0; i < size; i++) {
      embedding[i] = Math.sin(hash * (i + 1)) * 0.1;
    }
  }
  
  const messageId = `${sessionId}-${Date.now()}`;
  
  await qdrantClient.upsert(CONVERSATION_COLLECTION, {
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
  });
  
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
    const results = await qdrantClient.scroll(CONVERSATION_COLLECTION, {
      limit: limit * 10,
      with_payload: true,
      with_vector: false
    });
    
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
    console.error('Error retrieving recent messages:', error.message);
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
    console.warn('No embedding for query, using fallback');
    const hash = simpleHash(query);
    const size = parseInt(process.env.QDRANT_VECTOR_SIZE) || 768;
    embedding = new Array(size);
    for (let i = 0; i < size; i++) {
      embedding[i] = Math.sin(hash * (i + 1)) * 0.1;
    }
  }
  
  const maxTokens = options.maxTokens || MAX_CONTEXT_TOKENS;
  const maxMessages = options.maxMessages || MAX_RELEVANT_MESSAGES;
  
  try {
    const results = await qdrantClient.search(CONVERSATION_COLLECTION, {
      vector: embedding,
      limit: maxMessages * 3,
      with_payload: true
    });
    
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
    console.error('Error retrieving relevant context:', error.message);
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
    const results = await qdrantClient.scroll(CONVERSATION_COLLECTION, {
      limit: 1000,
      with_payload: true,
      with_vector: false
    });
    
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
    console.error('Error getting session stats:', error.message);
    return null;
  }
}

async function pruneOldMessages(sessionId, keepLast = 50) {
  if (!collectionInitialized) {
    await initConversationMemory();
  }
  
  const qdrantClient = getQdrantClient();
  
  try {
    const results = await qdrantClient.scroll(CONVERSATION_COLLECTION, {
      limit: 1000,
      with_payload: true,
      with_vector: false
    });
    
    const sessionMessages = results.points
      .filter(p => p.payload?.sessionId === sessionId)
      .sort((a, b) => new Date(b.payload.timestamp) - new Date(a.payload.timestamp));
    
    if (sessionMessages.length <= keepLast) {
      return { pruned: 0, kept: sessionMessages.length };
    }
    
    const toDelete = sessionMessages.slice(keepLast);
    const idsToDelete = toDelete.map(m => hashToNumber(m.payload.messageId));
    
    if (idsToDelete.length > 0) {
      await qdrantClient.delete(CONVERSATION_COLLECTION, {
        points: idsToDelete
      });
    }
    
    return {
      pruned: toDelete.length,
      kept: keepLast
    };
  } catch (error) {
    console.error('Error pruning old messages:', error.message);
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