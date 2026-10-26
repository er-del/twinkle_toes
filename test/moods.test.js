const assert = require("node:assert/strict");
const test = require("node:test");

const { ensureMoodTag, parseMood } = require("../lib/moods");

test("reads a plain mood tag", () => {
  assert.deepEqual(parseMood("[happy] Hello there!"), { mood: "happy", reply: "Hello there!" });
});

test("reads mood labels and markdown wrappers", () => {
  assert.deepEqual(parseMood("[[mood:angry]] That is unfair."), {
    mood: "angry",
    reply: "That is unfair.",
  });
  assert.deepEqual(parseMood("**[sad]** I am sorry."), { mood: "sad", reply: "I am sorry." });
});

test("is case insensitive", () => {
  assert.deepEqual(parseMood("[CuRiOuS] Tell me more."), { mood: "curious", reply: "Tell me more." });
});

test("strips an unknown leading tag instead of speaking it", () => {
  assert.deepEqual(parseMood("[laughs] That was funny."), { mood: "happy", reply: "That was funny." });
});

test("strips a stray mood tag from the spoken text", () => {
  assert.deepEqual(parseMood("I can only speak English and Hindi. [curious] How are you?"), {
    mood: "curious",
    reply: "I can only speak English and Hindi. How are you?",
  });
});

test("turns a bare leading mood word into a tag", () => {
  assert.equal(ensureMoodTag("thinking मैं ठीक हूँ।"), "[thinking] मैं ठीक हूँ।");
  assert.equal(ensureMoodTag("[happy] नमस्ते"), "[happy] नमस्ते");
  assert.equal(ensureMoodTag("सोच रहा हूँ।"), "सोच रहा हूँ।");
});

test("falls back to the tone of the reply when there is no tag", () => {
  assert.deepEqual(parseMood("I am sorry you had a rough day."), {
    mood: "sad",
    reply: "I am sorry you had a rough day.",
  });
  assert.deepEqual(parseMood("Hello!"), { mood: "idle", reply: "Hello!" });
  assert.equal(parseMood("This is complete chaos; my head is spinning.").mood, "dizzy");
});

test("recognises Hindi mood words without a tag", () => {
  assert.deepEqual(parseMood("मुझे बहुत गुस्सा आ रहा है।"), {
    mood: "angry",
    reply: "मुझे बहुत गुस्सा आ रहा है।",
  });
  assert.equal(parseMood("मैं खुश हूँ!").mood, "happy");
});
