const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

test("falls back to browser speech when streamed audio playback errors", () => {
  const source = fs.readFileSync("public/app.js", "utf8");
  const start = source.indexOf("  function startBrowserSpeech(");
  const end = source.indexOf("  async function playSpeechResponse(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const harness = `
    let speechGeneration = 1;
    let speechAbort = { aborted: false, abort() { this.aborted = true; } };
    let browserUtterance = null;
    let audioPlayback = null;
    let speech = null;
    const notes = [];
    const spoken = [];
    const revoked = [];
    const window = { speechSynthesis: { speak: (utterance) => spoken.push(utterance) } };
    class SpeechSynthesisUtterance {
      constructor(text) { this.text = text; }
    }
    const URL = { revokeObjectURL: (url) => revoked.push(url) };
    function setNote(message) { notes.push(message); }
    function finishSpeech() {}
    ${source.slice(start, end)}
    globalThis.result = {
      attachAudio,
      get browserUtterance() { return browserUtterance; },
      get speechAbort() { return speechAbort; },
      notes,
      spoken,
      revoked,
      setPlayback(audio) {
        audioPlayback = audio;
        speech = { src: "blob:audio" };
      }
    };
  `;
  const context = vm.createContext({});
  vm.runInContext(harness, context);
  const audio = { src: "blob:audio", pause() {}, onended: null, onerror: null };
  context.result.setPlayback(audio);
  context.result.attachAudio(audio, 1, "नमस्ते");
  audio.onerror();

  assert.equal(context.result.spoken.length, 1);
  assert.equal(context.result.spoken[0].text, "नमस्ते");
  assert.equal(context.result.spoken[0].lang, "hi-IN");
  assert.match(context.result.notes[0], /Audio playback failed/);
  assert.deepEqual(Array.from(context.result.revoked), ["blob:audio"]);
  assert.equal(context.result.speechAbort, null);
});
