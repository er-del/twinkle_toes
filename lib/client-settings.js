const CHAT_PROVIDERS = ["groq", "nvidia", "opencode-zen"];
const MAX_API_KEY_LENGTH = 2048;

function validateClientSettings(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Settings must be an object."), { statusCode: 400 });
  }

  const settings = {};
  if (value.chatProvider !== undefined) {
    if (!CHAT_PROVIDERS.includes(value.chatProvider)) {
      throw Object.assign(new Error("Choose a supported chat provider."), { statusCode: 400 });
    }
    settings.chatProvider = value.chatProvider;
  }

  for (const field of ["chatApiKey", "fishAudioApiKey", "nvidiaVoiceApiKey", "sttApiKey"]) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].length > MAX_API_KEY_LENGTH) {
      throw Object.assign(new Error(`${field} must be text of at most ${MAX_API_KEY_LENGTH} characters.`), {
        statusCode: 400,
      });
    }
    settings[field] = value[field].trim();
  }
  return settings;
}

function resolveChatProvider(settings, providers, defaultProviderName) {
  const name = settings.chatProvider || defaultProviderName;
  const configuredProvider = providers[name];
  if (!configuredProvider) {
    throw new Error("The selected chat provider is unavailable.");
  }
  const key = settings.chatApiKey || configuredProvider.key;
  if (!key) {
    throw new Error(`Add a ${configuredProvider.keyName} in Setup to use ${name}.`);
  }
  return { name, ...configuredProvider, key };
}

module.exports = { CHAT_PROVIDERS, resolveChatProvider, validateClientSettings };
