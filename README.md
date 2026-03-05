# Conversational AI Agent

This repository contains a minimal scaffold for a conversational AI agent intended to run alongside VSCode and support .NET/cloud development.

## Structure

- `index.js` – entry point
- `nlp/` – simple natural language processing stubs
- `knowledgeGraph/` – knowledge graph utilities (connects to Qdrant)
- `refactoringAssistant/` – code refactoring helpers
- `documentationGenerator/` – documentation helper
- `lookupService/` – general lookup service
- `gitCommitHelper/` – git commit helper
- `vscodeIntegration/` – placeholder for VSCode extension logic
- `cloudIntegration/` – placeholder for Azure/AWS/GCP integrations

## Setup

```powershell
cd d:\repo\ai\conversational-AI-agent
npm install
```

## Prerequisites

- **Ollama** - Run locally at `http://localhost:11434`
  - Chat model: `ollama pull minimax-m2.5:cloud` (or any model)
  - Embedding model: Same model is used for both (set `LLM_EMBEDDING_MODEL` if different)
- **Qdrant** - Run locally at `http://localhost:6333` (optional, for context storage)

## Usage

Start the agent with:

```powershell
npm start
```

It initializes NLP, cloud integration, and VSCode integration modules and prints readiness info.

Optional environment variables:

- `LLM_BASE_URL` – Ollama URL (default: `http://localhost:11434`)
- `LLM_CHAT_MODEL` – Chat model (default: `minimax-m2.5:cloud`)
- `LLM_EMBEDDING_MODEL` – Embedding model (optional, same as chat model by default)
- `QDRANT_URL` – Qdrant URL (default: `http://localhost:6333`)
- `QDRANT_VECTOR_SIZE` – Vector size for embeddings (default: 384)

## Qdrant

The project uses Qdrant at `http://localhost:6333/` for context storage. When semantic NLP is enabled via Ollama, generated embedding vectors are stored in Qdrant for semantic search and context retrieval.

## Next steps

* Connect NLP to an embedding/LLM service for semantic understanding
* Connect cloud actions to provider SDKs/CLI for real deployments
* Convert VSCode integration hooks into a packaged VS Code extension
* Add GitHub or Azure Pipelines for CI/CD
* Write tests

---

This scaffold can be used as a starting point; adapt as your agent evolves.