const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveChatProvider,
  validateClientSettings,
} = require("../lib/client-settings");

const providers = {
  groq: { key: "", keyName: "GROQ_API_KEY", model: "groq-model" },
  nvidia: { key: "server-nvidia-key", keyName: "NVIDIA_API_KEY", model: "nvidia-model" },
};

test("validates supported client settings and trims keys", () => {
  assert.deepEqual(
    validateClientSettings({
      chatProvider: "groq",
      apiSource: "browser",
      chatApiKey: " groq-key ",
      fishAudioApiKey: " fish-key ",
      nvidiaVoiceApiKey: " nvidia-key ",
      sttApiKey: " stt-key ",
      tavilyApiKey: " tavily-key ",
    }),
    {
      apiSource: "browser",
      chatProvider: "groq",
      chatApiKey: "groq-key",
      fishAudioApiKey: "fish-key",
      nvidiaVoiceApiKey: "nvidia-key",
      sttApiKey: "stt-key",
      tavilyApiKey: "tavily-key",
    },
  );
});

test("validates bounded browser-local note data", () => {
  const note = { id: "note-id", title: "Idea", text: "Draw a moon", createdAt: "2025-01-01T00:00:00.000Z" };
  assert.deepEqual(validateClientSettings({ notes: [note] }).notes, [note]);
  assert.throws(() => validateClientSettings({ notes: [{ ...note, text: "x".repeat(1001) }] }), /valid ID, title, text/);
  assert.throws(() => validateClientSettings({ notes: Array(21).fill(note) }), /at most 20/);
});

test("rejects invalid provider names, key types, and oversized keys", () => {
  assert.throws(() => validateClientSettings({ chatProvider: "custom" }), /supported chat provider/);
  assert.throws(() => validateClientSettings({ apiSource: "unknown" }), /Server .env or Personal keys/);
  assert.throws(() => validateClientSettings({ chatApiKey: 123 }), /must be text/);
  assert.throws(() => validateClientSettings({ sttApiKey: "x".repeat(2049) }), /at most 2048/);
  assert.throws(() => validateClientSettings([]), /must be an object/);
});

test("uses the server provider only in env mode", () => {
  assert.deepEqual(resolveChatProvider({ apiSource: "env", chatProvider: "groq", chatApiKey: "browser-key" }, providers, "nvidia"), {
    name: "nvidia",
    key: "server-nvidia-key",
    keyName: "NVIDIA_API_KEY",
    model: "nvidia-model",
  });
  assert.equal(resolveChatProvider({}, providers, "nvidia").key, "server-nvidia-key");
});

test("personal mode requires its own key and uses the env-defined provider model", () => {
  assert.deepEqual(resolveChatProvider({ apiSource: "browser", chatProvider: "groq", chatApiKey: "personal-key" }, providers, "nvidia"), {
    name: "groq",
    key: "personal-key",
    keyName: "GROQ_API_KEY",
    model: "groq-model",
  });
  assert.throws(
    () => resolveChatProvider({ apiSource: "browser", chatProvider: "nvidia" }, providers, "nvidia"),
    /Enter your NVIDIA_API_KEY in Personal setup/,
  );
});
