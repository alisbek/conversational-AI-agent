// entry point for the conversational AI agent

const nlp = require('./nlp/nlp');
const knowledgeGraph = require('./knowledgeGraph/knowledgeGraph');
const refactoringAssistant = require('./refactoringAssistant/refactoringAssistant');
const documentationGenerator = require('./documentationGenerator/documentationGenerator');
const lookupService = require('./lookupService/lookupService');
const gitCommitHelper = require('./gitCommitHelper/gitCommitHelper');
const vscodeIntegration = require('./vscodeIntegration/vscodeIntegration');
const cloudIntegration = require('./cloudIntegration/cloudIntegration');

async function main() {
  console.log('starting conversational AI agent');

  const startupText = process.env.AGENT_STARTUP_TEXT || 'Analyze and summarize this repository for cloud readiness.';

  const [nlpResult, cloudInfo, vscodeInfo, kgInfo] = await Promise.all([
    nlp.analyzeText(startupText),
    cloudIntegration.init(),
    vscodeIntegration.init(),
    knowledgeGraph.init()
  ]);

  console.log(`nlp ready (tokens: ${nlpResult.tokenCount}, intents: ${nlpResult.intents.map(intent => intent.intent).join(', ') || 'none'})`);
  console.log(`semantic nlp (enabled: ${nlpResult.semantic.enabled}, embedding dims: ${nlpResult.embeddingDimensions || 0}, model: ${nlpResult.semantic.model})`);
  console.log(`knowledge graph ready`);
  console.log(`cloud ready (active provider: ${cloudInfo.activeProvider || 'none'})`);
  console.log(`vscode ready (commands: ${vscodeInfo.commandCount})`);

  const testData = 'This is a test document about cloud deployment with Azure and Kubernetes.';
  const stored = await knowledgeGraph.getKnowledgeGraph(testData);
  console.log(`knowledge graph stored: ${stored.embeddingStored}, nodes: ${stored.nodes.length}`);

  const searchResults = await knowledgeGraph.searchContext('Azure deployment');
  console.log(`knowledge graph search: ${searchResults.length} results`);
}

main().catch(err => {
  console.error('agent failed:', err);
  process.exit(1);
});