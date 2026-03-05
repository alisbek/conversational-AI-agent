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

  // initialize modules if needed
  // e.g. await vscodeIntegration.init();
}

main().catch(err => {
  console.error('agent failed:', err);
  process.exit(1);
});