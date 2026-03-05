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

## Usage

Start the agent with:

```powershell
npm start
```

It will print a start message; extend the modules and integrate with VSCode/third-party services as needed.

## Qdrant

The project is prepared to use Qdrant at `http://localhost:6333/` for context storage. You can use the `qdrant-client` package once you configure it.

## Next steps

* Implement real NLP, cloud integration, and VSCode extension logic
* Add GitHub or Azure Pipelines for CI/CD
* Write tests

---

This scaffold can be used as a starting point; adapt as your agent evolves.