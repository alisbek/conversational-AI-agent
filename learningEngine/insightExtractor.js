const { analyzeText } = require('../nlp/nlp');
const { getLlmConfig, getLlmHttpClient } = require('../nlp/nlp');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const {
  storeExperience,
  trackUsage
} = require('./experienceStore');
const {
  storePattern,
  trackPatternUsage
} = require('./patternStore');
const {
  addLearnedPattern,
  updateFromInteraction
} = require('./userProfile');

const DEFAULT_LLM_CONFIG = {
  enabled: true,
  baseUrl: 'http://localhost:11434',
  chatModel: 'qwen2.5-coder:3b',
  embeddingModel: 'nomic-embed-text',
  provider: 'ollama',
  isOllama: true
};

async function extractInsights(data) {
  const llmConfig = { ...DEFAULT_LLM_CONFIG, ...getLlmConfig() };
  const client = getLlmHttpClient(llmConfig);
  
  const prompt = `Analyze this interaction and extract structured learning data.
Return ONLY valid JSON with this exact structure:
{
  "tags": ["tag1", "tag2"],
  "pattern": "pattern name if applicable",
  "whenToUse": ["use case 1"],
  "problemType": "classification",
  "solutionType": "fix|approach|pattern",
  "language": "programming language",
  "confidence": 0.5-1.0,
  "shouldStoreAsExperience": true|false,
  "shouldStoreAsPattern": true|false,
  "genericExplanation": "why this worked (1-2 sentences)"
}

Interaction:
User: ${data.userMessage}
Assistant: ${data.assistantResponse}
${data.code ? `Code: ${data.code}` : ''}

Respond with valid JSON only.`;

  try {
    let response;
    
    if (llmConfig.isOllama) {
      response = await withRetry(
        () => client.post('/api/chat', {
          model: llmConfig.chatModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You are a code analysis assistant that extracts learning insights.' },
            { role: 'user', content: prompt }
          ],
          stream: false
        }),
        { operationName: 'llm.insight.ollama' }
      );
      const content = response.data?.message?.content;
      if (!content) return null;
      
      try {
        const cleaned = content.replace(/^```json\n?/, '').replace(/```$/, '').trim();
        return JSON.parse(cleaned);
      } catch (parseError) {
        logger.warn('insight.parse_failed', { error: parseError.message });
        return null;
      }
    }
    
    response = await withRetry(
      () => client.post('/chat/completions', {
        model: llmConfig.chatModel,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a code analysis assistant that extracts learning insights.' },
          { role: 'user', content: prompt }
        ]
      }),
      { operationName: 'llm.insight.openai' }
    );
    
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) return null;
    
    return JSON.parse(content);
  } catch (error) {
    logger.error('insight.extraction_failed', error);
    return null;
  }
}

async function learnFromInteraction(interaction) {
  const { userMessage, assistantResponse, code, sessionId, action } = interaction;
  
  const insights = await extractInsights({
    userMessage,
    assistantResponse,
    code
  });
  
  if (!insights) {
    logger.warn('insight.extraction_failed_no_insights', { sessionId });
    return { success: false, reason: 'extraction_failed' };
  }
  
  const results = {
    insights,
    stored: {
      experience: false,
      pattern: false,
      profile: false
    }
  };
  
  if (insights.shouldStoreAsExperience) {
    try {
      await storeExperience({
        problem: userMessage,
        solution: assistantResponse,
        code: code || '',
        language: insights.language || 'unknown',
        outcome: 'success',
        tags: insights.tags || []
      });
      results.stored.experience = true;
    } catch (error) {
      logger.error('insight.store_experience_failed', error);
    }
  }
  
  if (insights.shouldStoreAsPattern && insights.pattern) {
    try {
      await storePattern({
        patternName: insights.pattern,
        description: insights.genericExplanation || '',
        codeTemplate: code || '',
        language: insights.language || 'unknown',
        whenToUse: insights.whenToUse || [],
        examples: [userMessage]
      });
      results.stored.pattern = true;
    } catch (error) {
      logger.error('insight.store_pattern_failed', error);
    }
  }
  
  if (action) {
    try {
      await updateFromInteraction(userMessage, assistantResponse, action);
      results.stored.profile = true;
    } catch (error) {
      logger.error('insight.update_profile_failed', error);
    }
  }
  
  logger.info('insight.learned', {
    sessionId,
    hasInsights: !!insights,
    stored: results.stored
  });
  
  return {
    success: true,
    insights,
    stored: results.stored
  };
}

async function autoLearnFromCode(code, context) {
  if (!code || code.length < 50) {
    return { success: false, reason: 'code_too_short' };
  }
  
  const prompt = `Analyze this code snippet and extract pattern information.
Return ONLY valid JSON:
{
  "patternName": "name of the pattern",
  "description": "what it does",
  "language": "programming language",
  "whenToUse": ["use case 1", "use case 2"],
  "isGenericPattern": true|false
}

Code:
${code.slice(0, 2000)}

Respond with JSON only.`;

  const llmConfig = { ...DEFAULT_LLM_CONFIG, ...getLlmConfig() };
  const client = getLlmHttpClient(llmConfig);
  
  try {
    let response;
    
    if (llmConfig.isOllama) {
      response = await withRetry(
        () => client.post('/api/chat', {
          model: llmConfig.chatModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: 'You analyze code and extract reusable patterns.' },
            { role: 'user', content: prompt }
          ],
          stream: false
        }),
        { operationName: 'llm.code_pattern.ollama' }
      );
      const content = response.data?.message?.content;
      if (!content) return { success: false };
      
      const parsed = JSON.parse(content.replace(/^```json\n?/, '').replace(/```$/, '').trim());
      
      if (parsed.isGenericPattern) {
        await storePattern({
          patternName: parsed.patternName,
          description: parsed.description,
          codeTemplate: code,
          language: parsed.language || 'unknown',
          whenToUse: parsed.whenToUse || [],
          examples: [context || '']
        });
        
        await addLearnedPattern(parsed.patternName);
        
        return { success: true, type: 'pattern', name: parsed.patternName };
      }
      
      return { success: true, type: 'code_stored', language: parsed.language };
    }
    
    return { success: false, reason: 'ollama_only' };
  } catch (error) {
    logger.error('insight.autoLearn_failed', error);
    return { success: false, reason: error.message };
  }
}

module.exports = {
  extractInsights,
  learnFromInteraction,
  autoLearnFromCode
};
