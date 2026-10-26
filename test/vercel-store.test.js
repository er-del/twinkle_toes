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

test("pipelines state and events, and applies server-key rate limits", async (t) => {
  const originalFetch = global.fetch;
  const requests = [];
  let rateCount = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (String(url).endsWith("/pipeline")) {
      return { ok: true, json: async () => body.map(() => ({ result: "OK" })) };
    }
    if (body[0] === "EVAL") {
      rateCount++;
      return { ok: true, json: async () => ({ result: [rateCount, 1] }) };
    }
    throw new Error(`Unexpected Redis command: ${body[0]}`);
  };
  t.after(() => { global.fetch = originalFetch; });
  const env = {
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-token",
  };
  const sessionStore = store.forSession("a8c0020e-3d49-44fb-aab6-d4ea807eb328", env);

  await sessionStore.setState({ expression: "idle" });
  await sessionStore.appendEvent({ id: "event-1", name: "assistant", data: {} });
  assert.deepEqual(requests[0].body.map(([name]) => name), ["HSET", "EXPIRE"]);
  assert.deepEqual(requests[1].body.map(([name]) => name), ["LPUSH", "LTRIM", "EXPIRE"]);
  assert.ok(requests.every(({ url }) => String(url).endsWith("/pipeline")));

  const ipHash = "a".repeat(64);
  assert.deepEqual(await store.consumeRateLimit("chat", ipHash, 1, 10, env), {
    allowed: true,
    minute: 1,
    hour: 1,
  });
  assert.deepEqual(await store.consumeRateLimit("chat", ipHash, 1, 10, env), {
    allowed: false,
    minute: 2,
    hour: 1,
  });
});

test("rejects malformed room IDs rather than forming arbitrary Redis keys", () => {
  assert.throws(() => store.forSession("../unscoped"), /valid browser session ID/);
});
