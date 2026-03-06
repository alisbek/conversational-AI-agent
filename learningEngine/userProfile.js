const {
  initCollections,
  getQdrantClient,
  COLLECTIONS,
  generateFallbackEmbedding,
  hashToNumber,
  VECTOR_SIZE
} = require('./base');
const { analyzeText } = require('../nlp/nlp');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

const USER_ID = 'local-user';

const DEFAULT_PROFILE = {
  userId: USER_ID,
  codingStyle: {
    preferAsync: true,
    bracesStyle: 'allman',
    indentation: 'spaces',
    semicolons: true
  },
  preferredLanguages: [],
  expertiseLevel: {},
  projectPatterns: {},
  communicationStyle: 'concise',
  learnedPatterns: [],
  frustrations: [],
  goals: [],
  updatedAt: new Date().toISOString()
};

async function getUserProfile() {
  await initCollections();
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(USER_ID);
  
  try {
    const result = await withRetry(
      () => qdrantClient.retrieve(COLLECTIONS.userProfile, {
        ids: [id],
        with_payload: true
      }),
      { operationName: 'qdrant.userProfile.retrieve' }
    );
    
    if (result.length > 0) {
      return result[0].payload;
    }
    
    await createDefaultProfile();
    return DEFAULT_PROFILE;
  } catch (error) {
    logger.error('userProfile.get.failed', error);
    return DEFAULT_PROFILE;
  }
}

async function createDefaultProfile() {
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(USER_ID);
  const embedding = generateFallbackEmbedding('user profile', VECTOR_SIZE);
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.userProfile, {
      points: [{
        id,
        vector: embedding,
        payload: DEFAULT_PROFILE
      }]
    }),
    { operationName: 'qdrant.userProfile.create' }
  );
  
  logger.info('userProfile.created', { userId: USER_ID });
}

async function updateUserProfile(updates) {
  await initCollections();
  
  const currentProfile = await getUserProfile();
  
  const updatedProfile = {
    ...currentProfile,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  const qdrantClient = getQdrantClient();
  const id = hashToNumber(USER_ID);
  const embedding = generateFallbackEmbedding(JSON.stringify(updatedProfile), VECTOR_SIZE);
  
  await withRetry(
    () => qdrantClient.upsert(COLLECTIONS.userProfile, {
      points: [{
        id,
        vector: embedding,
        payload: updatedProfile
      }]
    }),
    { operationName: 'qdrant.userProfile.update' }
  );
  
  logger.info('userProfile.updated', { userId: USER_ID, fields: Object.keys(updates) });
  
  return updatedProfile;
}

async function addPreferredLanguage(language) {
  const profile = await getUserProfile();
  const preferredLanguages = [...new Set([...profile.preferredLanguages, language])];
  return updateUserProfile({ preferredLanguages });
}

async function setExpertiseLevel(language, level) {
  const profile = await getUserProfile();
  const expertiseLevel = { ...profile.expertiseLevel, [language]: level };
  return updateUserProfile({ expertiseLevel });
}

async function addLearnedPattern(pattern) {
  const profile = await getUserProfile();
  const learnedPatterns = [...new Set([...profile.learnedPatterns, pattern])];
  return updateUserProfile({ learnedPatterns });
}

async function addFrustration(frustration) {
  const profile = await getUserProfile();
  const frustrations = [...new Set([...profile.frustrations, frustration])];
  return updateUserProfile({ frustrations });
}

async function addGoal(goal) {
  const profile = await getUserProfile();
  const goals = [...new Set([...profile.goals, goal])];
  return updateUserProfile({ goals });
}

async function updateFromInteraction(message, response, action) {
  const profile = await getUserProfile();
  const parsed = await analyzeText(message);
  const responseParsed = await analyzeText(response);
  
  const languages = [...parsed.semantic?.topics || [], ...responseParsed.semantic?.topics || []]
    .filter(t => ['csharp', 'typescript', 'python', 'lua', 'javascript', 'golang', 'rust'].includes(t.toLowerCase()));
  
  if (languages.length > 0) {
    await addPreferredLanguage(languages[0]);
  }
  
  if (action === 'code_accepted' || action === 'code_copied') {
    const patterns = responseParsed.semantic?.topics || [];
    for (const pattern of patterns) {
      await addLearnedPattern(pattern);
    }
  }
  
  return profile;
}

async function getUserPreferences(context = {}) {
  const profile = await getUserProfile();
  
  return {
    style: profile.codingStyle,
    preferredLanguages: profile.preferredLanguages,
    communicationStyle: profile.communicationStyle,
    learnedPatterns: profile.learnedPatterns,
    expertiseLevel: profile.expertiseLevel
  };
}

module.exports = {
  getUserProfile,
  updateUserProfile,
  addPreferredLanguage,
  setExpertiseLevel,
  addLearnedPattern,
  addFrustration,
  addGoal,
  updateFromInteraction,
  getUserPreferences,
  DEFAULT_PROFILE
};
