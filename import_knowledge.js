const axios = require('axios');

const qdrantUrl = 'http://localhost:6333';

const knowledgePoints = [
  {
    id: 1,
    vector: Array.from({length: 384}, (_, i) => Math.sin(i * 0.1) * 0.3 + 0.5),
    payload: {
      text: "conversational AI agent for VSCode and cloud development",
      summary: "A minimal scaffold for a conversational AI agent intended to run alongside VSCode and support .NET/cloud development",
      topics: "NLP,Ollama,Qdrant,VSCode,cloud",
      type: "project_overview"
    }
  },
  {
    id: 2,
    vector: Array.from({length: 384}, (_, i) => Math.cos(i * 0.1) * 0.3 + 0.5),
    payload: {
      text: "Ollama LLM integration at localhost:11434 with minimax-m2.5:cloud model",
      summary: "Local LLM service using Ollama with remote minimax-m2.5:cloud model",
      topics: "Ollama,LLM,AI,minimax",
      type: "llm_config"
    }
  },
  {
    id: 3,
    vector: Array.from({length: 384}, (_, i) => Math.sin(i * 0.2) * 0.3 + 0.5),
    payload: {
      text: "Qdrant vector database at localhost:6333 for context storage",
      summary: "Vector database for semantic search and context storage with 384-dimensional embeddings",
      topics: "Qdrant,vector database,embeddings",
      type: "vector_store"
    }
  },
  {
    id: 4,
    vector: Array.from({length: 384}, (_, i) => Math.cos(i * 0.2) * 0.3 + 0.5),
    payload: {
      text: "NLP module with intents entities keywords sentiment analysis",
      summary: "Natural language processing module that extracts intents entities keywords and sentiment using heuristic and semantic methods",
      topics: "NLP,intents,entities,sentiment",
      type: "nlp_module"
    }
  },
  {
    id: 5,
    vector: Array.from({length: 384}, (_, i) => Math.sin(i * 0.15) * 0.3 + 0.5),
    payload: {
      text: "Module structure: nlp, knowledgeGraph, refactoringAssistant, documentationGenerator, lookupService, gitCommitHelper, vscodeIntegration, cloudIntegration",
      summary: "8 main modules for conversational AI agent functionality",
      topics: "modules,architecture",
      type: "module_structure"
    }
  }
];

async function main() {
  try {
    await axios.put(`${qdrantUrl}/collections/knowledge/points`, {
      points: knowledgePoints
    });
    console.log('Points upserted successfully');
    
    const count = await axios.post(`${qdrantUrl}/collections/knowledge/points/count`, {});
    console.log('Total points:', count.data.result.count);
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
  }
}

main();
