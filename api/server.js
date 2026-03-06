const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');
const { analyzeText } = require('../nlp/nlp');
const { getKnowledgeGraph, searchContext } = require('../knowledgeGraph/knowledgeGraph');
const {
  storeMessage,
  buildContextWindow,
  getSessionStats,
  pruneOldMessages
} = require('../conversationMemory/conversationMemory');
const logger = require('../utils/logger');
const config = require('../config');

const app = express();
const PORT = config.app.port || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await analyzeText(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { message, context, sessionId: incomingSessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const sessionId = incomingSessionId || randomUUID();
    const useConversationMemory = context?.useConversationMemory !== false;

    let contextResults = [];
    if (context?.useKnowledgeGraph) {
      contextResults = await searchContext(message, context.limit || 5);
    }

    let conversationContext = {
      messages: [],
      totalTokens: 0,
      messageCount: 0,
      recentCount: 0,
      relevantCount: 0
    };

    if (useConversationMemory) {
      conversationContext = await buildContextWindow(sessionId, message, {
        maxTokens: context?.maxContextTokens || config.conversation.maxContextTokens
      });

      await storeMessage(sessionId, 'user', message, {
        source: 'api.chat',
        contextMessageCount: conversationContext.messageCount
      });
    }

    const analysis = await analyzeText(message);

    const assistantMessage = analysis.semantic?.summary ||
      `Detected intents: ${analysis.intents.map(i => i.intent).join(', ') || 'none'}`;

    if (useConversationMemory) {
      await storeMessage(sessionId, 'assistant', assistantMessage, {
        source: 'api.chat',
        generated: true,
        intents: analysis.intents?.map(intent => intent.intent) || []
      });

      if (context?.autoPrune) {
        await pruneOldMessages(sessionId, context?.keepLastMessages || config.conversation.defaultPruneKeepLast);
      }
    }
    
    const response = {
      sessionId,
      message,
      assistantMessage,
      analysis: {
        intents: analysis.intents,
        entities: analysis.entities,
        sentiment: analysis.sentiment,
        summary: analysis.semantic?.summary
      },
      context: {
        knowledgeGraph: contextResults,
        conversationWindow: conversationContext
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
    logger.error('api.chat.failed', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/conversation/stats', async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const stats = await getSessionStats(sessionId);
    res.json({ sessionId, stats });
  } catch (error) {
    logger.error('api.conversation.stats.failed', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/conversation/prune', async (req, res) => {
  try {
    const { sessionId, keepLast } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const result = await pruneOldMessages(sessionId, keepLast || config.conversation.defaultPruneKeepLast);
    res.json({ sessionId, ...result });
  } catch (error) {
    logger.error('api.conversation.prune.failed', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/knowledge', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await getKnowledgeGraph(text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/knowledge/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'q (query) is required' });
    }
    const results = await searchContext(q, parseInt(limit) || 5);
    res.json({ query: q, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/search-context', async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'q (query) is required' });
    }
    const results = await searchContext(q, parseInt(limit) || 5);
    res.json({ query: q, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function start() {
  app.listen(PORT, () => {
    logger.info('api.server.started', {
      url: `http://localhost:${PORT}`,
      endpoints: [
        'GET /health',
        'POST /analyze',
        'POST /chat',
        'POST /knowledge',
        'GET /knowledge/search',
        'GET /search-context',
        'GET /conversation/stats',
        'POST /conversation/prune'
      ]
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
