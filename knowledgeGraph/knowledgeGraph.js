// knowledge graph stub (uses Qdrant for vector storage)

const { analyzeText } = require('../nlp/nlp');
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

async function getKnowledgeGraph(data) {
  // simple tokenization then store as vectors
  const parsed = await analyzeText(data);
  const vectors = parsed.tokens.map((t, i) => ({ id: i, vector: [t.length] }));

  // ensure collection exists
  await qdrant.collections.create({
    collection_name: 'knowledge',
    vectors: { size: 1, distance: 'Cosine' }
  }).catch(() => {});

  // upsert
  await qdrant.points.upsert({
    collection_name: 'knowledge',
    points: vectors
  });

  return {
    nodes: parsed.tokens.map((t, i) => ({ id: i, value: t })),
    edges: []
  };
}

module.exports = { getKnowledgeGraph };