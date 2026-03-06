// entry point for the conversational AI agent

const nlp = require('./nlp/nlp');
const knowledgeGraph = require('./knowledgeGraph/knowledgeGraph');
const refactoringAssistant = require('./refactoringAssistant/refactoringAssistant');
const documentationGenerator = require('./documentationGenerator/documentationGenerator');
const lookupService = require('./lookupService/lookupService');
const gitCommitHelper = require('./gitCommitHelper/gitCommitHelper');
const vscodeIntegration = require('./vscodeIntegration/vscodeIntegration');
const cloudIntegration = require('./cloudIntegration/cloudIntegration');
const config = require('./config');
const logger = require('./utils/logger');

async function main() {
  logger.info('agent.starting', { env: config.nodeEnv });

  const startupText = config.app.startupText;

  const [nlpResult, cloudInfo, vscodeInfo, kgInfo] = await Promise.all([
    nlp.analyzeText(startupText),
    cloudIntegration.init(),
    vscodeIntegration.init(),
    knowledgeGraph.init()
  ]);

  logger.info('agent.ready.nlp', {
    tokens: nlpResult.tokenCount,
    intents: nlpResult.intents.map(intent => intent.intent),
    semanticEnabled: nlpResult.semantic.enabled,
    embeddingDimensions: nlpResult.embeddingDimensions || 0,
    model: nlpResult.semantic.model
  });
  logger.info('agent.ready.knowledge_graph');
  logger.info('agent.ready.cloud', { activeProvider: cloudInfo.activeProvider || 'none' });
  logger.info('agent.ready.vscode', { commandCount: vscodeInfo.commandCount });

  const testData = 'This is a test document about cloud deployment with Azure and Kubernetes.';
  const stored = await knowledgeGraph.getKnowledgeGraph(testData);
  logger.info('agent.knowledge_graph.stored', {
    embeddingStored: stored.embeddingStored,
    nodes: stored.nodes.length
  });

  const searchResults = await knowledgeGraph.searchContext('Azure deployment');
  logger.info('agent.knowledge_graph.search_completed', { results: searchResults.length });
}

main().catch(err => {
  logger.error('agent.failed', err);
  process.exit(1);
});