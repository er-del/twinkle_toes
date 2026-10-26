const CHAT_PROVIDERS = ["groq", "nvidia", "opencode-zen"];
const MAX_API_KEY_LENGTH = 2048;
const MAX_NOTES = 20;

function validateNotes(value) {
  if (!Array.isArray(value) || value.length > MAX_NOTES) {
    throw Object.assign(new Error(`Notes must be a list of at most ${MAX_NOTES} items.`), { statusCode: 400 });
  }
  return value.map((note) => {
    if (!note || typeof note !== "object" || Array.isArray(note) ||
        typeof note.id !== "string" || !note.id.trim() || note.id.length > 40 ||
        typeof note.title !== "string" || !note.title.trim() || note.title.length > 80 ||
        typeof note.text !== "string" || !note.text.trim() || note.text.length > 1000 ||
        typeof note.createdAt !== "string" || note.createdAt.length > 40) {
      throw Object.assign(new Error("Each note must have a valid ID, title, text, and timestamp."), {
        statusCode: 400,
      });
    }
    return {
      id: note.id,
      title: note.title,
      text: note.text,
      createdAt: note.createdAt,
    };
  });
}

function validateClientSettings(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Settings must be an object."), { statusCode: 400 });
  }

  const settings = {};
  if (value.apiSource !== undefined) {
    if (!["env", "browser"].includes(value.apiSource)) {
      throw Object.assign(new Error("Choose Server .env or Personal keys."), { statusCode: 400 });
    }
    settings.apiSource = value.apiSource;
  }
  if (value.chatProvider !== undefined) {
    if (!CHAT_PROVIDERS.includes(value.chatProvider)) {
      throw Object.assign(new Error("Choose a supported chat provider."), { statusCode: 400 });
    }
    settings.chatProvider = value.chatProvider;
  }

  for (const field of ["chatApiKey", "fishAudioApiKey", "nvidiaVoiceApiKey", "sttApiKey", "tavilyApiKey"]) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].length > MAX_API_KEY_LENGTH) {
      throw Object.assign(new Error(`${field} must be text of at most ${MAX_API_KEY_LENGTH} characters.`), {
        statusCode: 400,
      });
    }
    settings[field] = value[field].trim();
  }
  if (value.notes !== undefined) settings.notes = validateNotes(value.notes);
  return settings;
}

function resolveChatProvider(settings, providers, defaultProviderName) {
  const apiSource = settings.apiSource || "env";
  const name = apiSource === "env" ? defaultProviderName : settings.chatProvider || defaultProviderName;
  const configuredProvider = providers[name];
  if (!configuredProvider) {
    throw new Error("The selected chat provider is unavailable.");
  }
  const key = apiSource === "env" ? configuredProvider.key : settings.chatApiKey;
  if (!key) {
    throw new Error(
      apiSource === "env"
        ? `Add ${configuredProvider.keyName} to the server .env file to use ${name}.`
        : `Enter your ${configuredProvider.keyName} in Personal setup to use ${name}.`,
    );
  }
  return { name, ...configuredProvider, key };
}

module.exports = { CHAT_PROVIDERS, resolveChatProvider, validateClientSettings };
