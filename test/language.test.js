const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectLanguage,
  normalizeLanguage,
  replyMatchesLanguage,
  resolveLanguage,
} = require("../lib/language");

test("detects Hindi from Devanagari", () => {
  assert.equal(detectLanguage("नमस्ते, आप कैसे हैं?"), "hi");
});

test("detects English from Latin letters", () => {
  assert.equal(detectLanguage("Hello, how are you?"), "en");
});

test("treats mixed text with any Devanagari as Hindi", () => {
  assert.equal(detectLanguage("मुझे coffee पसंद है"), "hi");
});

test("marks other writing systems as unsupported", () => {
  assert.equal(detectLanguage("Привет, как дела?"), "other");
  assert.equal(detectLanguage("你好，你好吗？"), "other");
});

test("marks common non-English Latin phrases as unsupported", () => {
  assert.equal(detectLanguage("Bonjour, comment vas-tu?"), "other");
  assert.equal(detectLanguage("Hola, ¿cómo estás?"), "other");
  assert.equal(detectLanguage("Comment on this sentence."), "en");
});

test("recognises romanised Hindi", () => {
  assert.equal(detectLanguage("namaste, aap kaise hain?"), "hi");
  assert.equal(detectLanguage("mera naam Twinkle Toes hai"), "hi");
});

test("defaults to English for empty or non-linguistic text", () => {
  assert.equal(detectLanguage(""), "en");
  assert.equal(detectLanguage("12345"), "en");
});

test("normalizes provider language codes", () => {
  assert.equal(normalizeLanguage("hi-IN"), "hi");
  assert.equal(normalizeLanguage("Hindi"), "hi");
  assert.equal(normalizeLanguage("English"), "en");
  assert.equal(normalizeLanguage("fr"), "other");
  assert.equal(normalizeLanguage(""), "");
});

test("uses the detected words and script over a conflicting speech language code", () => {
  assert.equal(resolveLanguage("hi", "namaste"), "hi");
  assert.equal(resolveLanguage("fr", "Bonjour"), "other");
  assert.equal(resolveLanguage("", "नमस्ते"), "hi");
  assert.equal(resolveLanguage("", "Bonjour, comment vas-tu?"), "other");
  assert.equal(resolveLanguage("en", "नमस्ते"), "hi");
  assert.equal(resolveLanguage("en", "Bonjour, ça va?"), "other");
  assert.equal(resolveLanguage("hi", "Hello, how are you?"), "en");
  assert.equal(resolveLanguage("en", "Kya haal hai?"), "hi");
  assert.equal(resolveLanguage("hi", "Mujhe Hindi pasand hai"), "hi");
  assert.equal(resolveLanguage("hi", "I need some help"), "en");
  assert.equal(resolveLanguage("hi", "What happened today?"), "en");
  assert.equal(resolveLanguage("hi", "12345"), "hi");
});

test("accepts only the requested reply language", () => {
  assert.equal(replyMatchesLanguage("नमस्ते, आप कैसे हैं?", "hi"), true);
  assert.equal(replyMatchesLanguage("Hello, how are you?", "hi"), false);
  assert.equal(replyMatchesLanguage("मैं ठीक हूँ, thank you!", "hi"), false);
  assert.equal(replyMatchesLanguage("मैं Twinkle Toes हूँ।", "hi"), true);
  assert.equal(replyMatchesLanguage("Hello, how are you?", "en"), true);
  assert.equal(replyMatchesLanguage("नमस्ते", "en"), false);
  assert.equal(replyMatchesLanguage("Bonjour, ça va?", "en"), false);
  assert.equal(replyMatchesLanguage("नमस्ते, bonjour", "hi"), false);
  assert.equal(replyMatchesLanguage("नमस्ते 你好", "hi"), false);
  assert.equal(replyMatchesLanguage("Hello привет", "en"), false);
  assert.equal(replyMatchesLanguage("I can only speak English and Hindi.", "other"), true);
});
