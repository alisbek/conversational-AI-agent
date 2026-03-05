const express = require('express');
const cors = require('cors');
const { analyzeText } = require('../nlp/nlp');
const { getKnowledgeGraph, searchContext } = require('../knowledgeGraph/knowledgeGraph');

const app = express();
const PORT = process.env.PORT || 3000;

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
    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    let contextResults = [];
    if (context?.useKnowledgeGraph) {
      contextResults = await searchContext(message, context.limit || 5);
    }

    const analysis = await analyzeText(message);
    
    const response = {
      message,
      analysis: {
        intents: analysis.intents,
        entities: analysis.entities,
        sentiment: analysis.sentiment,
        summary: analysis.semantic?.summary
      },
      context: contextResults,
      timestamp: new Date().toISOString()
    };

    res.json(response);
  } catch (error) {
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
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`Endpoints:`);
    console.log(`  GET  /health           - Health check`);
    console.log(`  POST /analyze          - Analyze text`);
    console.log(`  POST /chat             - Chat with context`);
    console.log(`  POST /knowledge        - Store knowledge`);
    console.log(`  GET  /knowledge/search - Search knowledge`);
    console.log(`  GET  /search-context   - Search context (alias)`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
