const assert = require("node:assert/strict");
const test = require("node:test");

const { recentMessages, rememberTurn } = require("../lib/chat-memory");

test("keeps the latest four complete conversation turns", () => {
  const history = [];
  for (let turn = 1; turn <= 5; turn++) {
    rememberTurn(history, `user ${turn}`, `assistant ${turn}`);
  }

  assert.deepEqual(recentMessages(history), [
    { role: "user", content: "user 2" },
    { role: "assistant", content: "assistant 2" },
    { role: "user", content: "user 3" },
    { role: "assistant", content: "assistant 3" },
    { role: "user", content: "user 4" },
    { role: "assistant", content: "assistant 4" },
    { role: "user", content: "user 5" },
    { role: "assistant", content: "assistant 5" },
  ]);
});

test("bounds message size and returns a separate context array", () => {
  const history = [];
  rememberTurn(history, "u".repeat(1100), "a".repeat(1100));
  const context = recentMessages(history);

  assert.equal(context[0].content.length, 1000);
  assert.equal(context[1].content.length, 1000);
  context.pop();
  assert.equal(history.length, 2);
});
