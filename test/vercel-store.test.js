const assert = require("node:assert/strict");
const test = require("node:test");

const store = require("../lib/vercel-store");

test("requires Upstash REST credentials", async () => {
  await assert.rejects(
    store.forSession("a8c0020e-3d49-44fb-aab6-d4ea807eb328", {}).getState({}),
    { message: /UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/ },
  );
});

test("stores JSON and reads events after a cursor through the Redis REST API", async (t) => {
  const originalFetch = global.fetch;
  const commands = [];
  const events = [
    { id: "event-2", name: "assistant", data: { reply: "Hello" } },
    { id: "event-1", name: "user-message", data: { text: "Hi" } },
  ];
  global.fetch = async (_url, options) => {
    const args = JSON.parse(options.body);
    commands.push(args);
    let result = "OK";
    if (args[0] === "HGETALL") result = { expression: "\"idle\"" };
    if (args[0] === "LRANGE") result = events.map(JSON.stringify);
    return { ok: true, json: async () => ({ result }) };
  };
  t.after(() => { global.fetch = originalFetch; });
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
  };

  const sessionStore = store.forSession("a8c0020e-3d49-44fb-aab6-d4ea807eb328", env);
  assert.deepEqual(await sessionStore.getState({}), { expression: "idle" });
  assert.deepEqual(await sessionStore.getEventBatch("event-1"), {
    events: [events[0]],
    cursor: "event-2",
    reset: false,
  });
  assert.deepEqual(await sessionStore.getEventBatch("0"), {
    events: [...events].reverse(),
    cursor: "event-2",
    reset: false,
  });
  await sessionStore.setHistory([{ role: "user", content: "Hi" }]);
  assert.deepEqual(commands.map(([command]) => command), ["HGETALL", "LRANGE", "LRANGE", "SET"]);
  assert.ok(commands.every(([, key]) => key.includes("a8c0020e-3d49-44fb-aab6-d4ea807eb328")));
  assert.deepEqual(commands[3].slice(-2), ["EX", "2592000"]);
});

test("rejects malformed room IDs rather than forming arbitrary Redis keys", () => {
  assert.throws(() => store.forSession("../unscoped"), /valid browser session ID/);
});
