const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isPlainObject(target)) {
    return source;
  }

  const merged = { ...target };

  for (const [key, value] of Object.entries(source || {})) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return fallback;
}

function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const configDir = __dirname;

  const baseConfig = readJsonIfExists(path.join(configDir, 'config.json'));
  const envConfig = readJsonIfExists(path.join(configDir, `${nodeEnv}.json`));

  const merged = deepMerge(baseConfig, envConfig);

  const llmApiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || merged.llm?.apiKey || '';
  const llmBaseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || merged.llm?.baseUrl;
  const llmChatModel = process.env.LLM_CHAT_MODEL || merged.llm?.chatModel;
  const llmEmbeddingModel = process.env.LLM_EMBEDDING_MODEL || merged.llm?.embeddingModel || llmChatModel;

  const envOverrides = {
    app: {
      port: toNumber(process.env.PORT, merged.app?.port),
      startupText: process.env.AGENT_STARTUP_TEXT || merged.app?.startupText
    },
    logging: {
      level: process.env.LOG_LEVEL || merged.logging?.level,
      serviceName: process.env.LOG_SERVICE_NAME || merged.logging?.serviceName
    },
    llm: {
      apiKey: llmApiKey,
      baseUrl: llmBaseUrl,
      chatModel: llmChatModel,
      embeddingModel: llmEmbeddingModel,
      provider: process.env.LLM_PROVIDER || merged.llm?.provider,
      requestTimeoutMs: toNumber(process.env.LLM_REQUEST_TIMEOUT_MS, merged.llm?.requestTimeoutMs),
      longRequestTimeoutMs: toNumber(process.env.LLM_LONG_REQUEST_TIMEOUT_MS, merged.llm?.longRequestTimeoutMs)
    },
    qdrant: {
      url: process.env.QDRANT_URL || merged.qdrant?.url,
      checkCompatibility: toBoolean(process.env.QDRANT_CHECK_COMPATIBILITY, merged.qdrant?.checkCompatibility),
      knowledgeVectorSize: toNumber(
        process.env.QDRANT_KNOWLEDGE_VECTOR_SIZE || process.env.QDRANT_VECTOR_SIZE,
        merged.qdrant?.knowledgeVectorSize
      ),
      conversationVectorSize: toNumber(
        process.env.QDRANT_CONVERSATION_VECTOR_SIZE || process.env.QDRANT_VECTOR_SIZE,
        merged.qdrant?.conversationVectorSize
      )
    },
    cloud: {
      provider: process.env.CLOUD_PROVIDER || merged.cloud?.provider,
      azureSubscriptionId: process.env.AZURE_SUBSCRIPTION_ID || merged.cloud?.azureSubscriptionId,
      awsRegion: process.env.AWS_REGION || merged.cloud?.awsRegion,
      gcpProject: process.env.GOOGLE_CLOUD_PROJECT || merged.cloud?.gcpProject
    },
    conversation: {
      maxContextTokens: toNumber(process.env.CONVERSATION_MAX_CONTEXT_TOKENS, merged.conversation?.maxContextTokens),
      maxRelevantMessages: toNumber(process.env.CONVERSATION_MAX_RELEVANT_MESSAGES, merged.conversation?.maxRelevantMessages),
      defaultPruneKeepLast: toNumber(process.env.CONVERSATION_DEFAULT_PRUNE_KEEP_LAST, merged.conversation?.defaultPruneKeepLast)
    }
  };

  const finalConfig = deepMerge(merged, envOverrides);
  finalConfig.nodeEnv = nodeEnv;
  return finalConfig;
}

const config = loadConfig();

module.exports = config;
