const https = require('https');
const config = require('../config');
const logger = require('../utils/logger');

const PROVIDERS = {
  azure: {
    name: 'Azure',
    env: 'AZURE_SUBSCRIPTION_ID',
    statusEndpoint: 'https://management.azure.com/'
  },
  aws: {
    name: 'AWS',
    env: 'AWS_REGION',
    statusEndpoint: 'https://sts.amazonaws.com/'
  },
  gcp: {
    name: 'GCP',
    env: 'GOOGLE_CLOUD_PROJECT',
    statusEndpoint: 'https://cloudresourcemanager.googleapis.com/'
  }
};

function getConfiguredProviders() {
  const providerValues = {
    AZURE_SUBSCRIPTION_ID: config.cloud.azureSubscriptionId,
    AWS_REGION: config.cloud.awsRegion,
    GOOGLE_CLOUD_PROJECT: config.cloud.gcpProject
  };

  return Object.entries(PROVIDERS)
    .filter(([, provider]) => Boolean(providerValues[provider.env]))
    .map(([id, provider]) => ({ id, name: provider.name, configured: true }));
}

function getActiveProvider() {
  const explicitProvider = config.cloud.provider;
  if (explicitProvider && PROVIDERS[explicitProvider]) {
    return explicitProvider;
  }

  const configured = getConfiguredProviders();
  if (configured.length > 0) {
    return configured[0].id;
  }

  return null;
}

function checkEndpointReachable(url) {
  return new Promise(resolve => {
    const request = https.request(url, { method: 'HEAD', timeout: 4000 }, response => {
      resolve({ reachable: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode });
    });

    request.on('error', () => resolve({ reachable: false, statusCode: null }));
    request.on('timeout', () => {
      request.destroy();
      resolve({ reachable: false, statusCode: null });
    });

    request.end();
  });
}

async function getCloudStatus(providerId = getActiveProvider()) {
  if (!providerId || !PROVIDERS[providerId]) {
    return {
      provider: null,
      configuredProviders: getConfiguredProviders(),
      healthy: false,
      message: 'No cloud provider is configured. Set CLOUD_PROVIDER or provider-specific environment variables.'
    };
  }

  const provider = PROVIDERS[providerId];
  const endpoint = await checkEndpointReachable(provider.statusEndpoint);

  return {
    provider: providerId,
    configured: Boolean(getConfiguredProviders().some(p => p.id === providerId)),
    healthy: endpoint.reachable,
    statusCode: endpoint.statusCode,
    statusEndpoint: provider.statusEndpoint
  };
}

async function executeCloudAction(action, payload = {}, providerId = getActiveProvider()) {
  const status = await getCloudStatus(providerId);
  if (!status.provider) {
    return {
      success: false,
      action,
      provider: null,
      message: status.message
    };
  }

  const supportedActions = new Set(['deploy', 'status', 'list-resources']);
  if (!supportedActions.has(action)) {
    return {
      success: false,
      action,
      provider: status.provider,
      message: `Unsupported action: ${action}`
    };
  }

  if (action === 'status') {
    return { success: true, action, provider: status.provider, data: status };
  }

  return {
    success: true,
    action,
    provider: status.provider,
    data: {
      simulated: true,
      payload,
      note: 'Action pipeline is ready. Connect provider SDK/CLI for real execution.'
    }
  };
}

async function init() {
  const configuredProviders = getConfiguredProviders();
  const activeProvider = getActiveProvider();

  logger.info('cloud.integration.initialized', {
    configuredProviders: configuredProviders.map(provider => provider.id)
  });

  return {
    activeProvider,
    configuredProviders,
    availableProviders: Object.keys(PROVIDERS)
  };
}

module.exports = {
  init,
  getCloudStatus,
  executeCloudAction,
  getConfiguredProviders,
  getActiveProvider
};