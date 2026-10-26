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
      chatApiKey: " groq-key ",
      fishAudioApiKey: " fish-key ",
      nvidiaVoiceApiKey: " nvidia-key ",
      sttApiKey: " stt-key ",
    }),
    {
      chatProvider: "groq",
      chatApiKey: "groq-key",
      fishAudioApiKey: "fish-key",
      nvidiaVoiceApiKey: "nvidia-key",
      sttApiKey: "stt-key",
    },
  );
});

test("rejects invalid provider names, key types, and oversized keys", () => {
  assert.throws(() => validateClientSettings({ chatProvider: "custom" }), /supported chat provider/);
  assert.throws(() => validateClientSettings({ chatApiKey: 123 }), /must be text/);
  assert.throws(() => validateClientSettings({ sttApiKey: "x".repeat(2049) }), /at most 2048/);
  assert.throws(() => validateClientSettings([]), /must be an object/);
});

test("resolves a browser key without replacing other providers' server settings", () => {
  assert.deepEqual(resolveChatProvider({ chatProvider: "groq", chatApiKey: "browser-key" }, providers, "nvidia"), {
    name: "groq",
    key: "browser-key",
    keyName: "GROQ_API_KEY",
    model: "groq-model",
  });
  assert.equal(resolveChatProvider({}, providers, "nvidia").key, "server-nvidia-key");
  assert.throws(() => resolveChatProvider({ chatProvider: "groq" }, providers, "nvidia"), /Add a GROQ_API_KEY/);
});
