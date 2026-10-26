const assert = require("node:assert/strict");
const test = require("node:test");

const {
  IDLE_AFTER_MS,
  SLEEPY_AFTER_MS,
  restingMoodFor,
} = require("../public/idle-mood");

test("uses the idle expression after a short period without activity", () => {
  assert.equal(restingMoodFor(0), null);
  assert.equal(restingMoodFor(IDLE_AFTER_MS - 1), null);
  assert.equal(restingMoodFor(IDLE_AFTER_MS), "idle");
});

test("changes to sleepy after an extended idle period", () => {
  assert.equal(restingMoodFor(SLEEPY_AFTER_MS - 1), "idle");
  assert.equal(restingMoodFor(SLEEPY_AFTER_MS), "sleepy");
  assert.equal(restingMoodFor(SLEEPY_AFTER_MS * 2), "sleepy");
});
