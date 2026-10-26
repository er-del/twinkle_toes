const EVENT_KEY = "twinkle-toes:events";
const HISTORY_KEY = "twinkle-toes:conversation";
const STATE_KEY = "twinkle-toes:state";
const TIMER_KEY = "twinkle-toes:timers";
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATA_TTL_SECONDS = 30 * 24 * 60 * 60;

function isConfigured(env = process.env) {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

async function command(args, env = process.env) {
  if (!isConfigured(env)) {
    throw Object.assign(new Error("Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel."), {
      statusCode: 503,
    });
  }
  const response = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Upstash Redis returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.error) throw new Error(`Upstash Redis request failed: ${result.error}`);
  return result.result;
}

async function getJson(key, fallback, env) {
  const result = await command(["GET", key], env);
  if (result === null) return fallback;
  try {
    return JSON.parse(result);
  } catch {
    throw new Error(`Stored application data for ${key} is invalid JSON.`);
  }
}

async function setJson(key, value, env) {
  await command(["SET", key, JSON.stringify(value), "EX", String(DATA_TTL_SECONDS)], env);
}

async function getState(key, fallback, env) {
  const values = await command(["HGETALL", key], env);
  if (!values || (Array.isArray(values) ? !values.length : !Object.keys(values).length)) return fallback;
  const state = {};
  const entries = Array.isArray(values)
    ? Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]])
    : Object.entries(values);
  for (const [name, value] of entries) {
    try {
      state[name] = JSON.parse(value);
    } catch {
      throw new Error("Stored application state in Upstash Redis is invalid JSON.");
    }
  }
  return state;
}

async function setState(key, state, env) {
  const entries = Object.entries(state);
  if (entries.length) {
    await command([
      "HSET",
      key,
      ...entries.flatMap(([name, value]) => [name, JSON.stringify(value)]),
    ], env);
  }
  await command(["EXPIRE", key, String(DATA_TTL_SECONDS)], env);
}

async function appendEvent(event, env, key = EVENT_KEY) {
  const serialized = JSON.stringify(event);
  await command(["LPUSH", key, serialized], env);
  await command(["LTRIM", key, "0", "99"], env);
  await command(["EXPIRE", key, String(DATA_TTL_SECONDS)], env);
}

async function getEventBatch(id, env, key = EVENT_KEY) {
  const rows = await command(["LRANGE", key, "0", "99"], env);
  const events = rows.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      throw new Error("An application event in Upstash Redis is invalid JSON.");
    }
  }).reverse();
  if (!id) return { events: [], cursor: events.at(-1)?.id || "0", reset: false };
  if (id === "0") return { events, cursor: events.at(-1)?.id || "0", reset: false };
  const cursor = events.findIndex((event) => event.id === id);
  return {
    events: cursor < 0 ? [] : events.slice(cursor + 1),
    cursor: events.at(-1)?.id || "0",
    reset: cursor < 0,
  };
}

async function addTimer(timer, env, key = TIMER_KEY) {
  const serialized = JSON.stringify(timer);
  await command(["LPUSH", key, serialized], env);
  await command(["LTRIM", key, "0", "99"], env);
  await command(["EXPIRE", key, String(DATA_TTL_SECONDS)], env);
}

async function dueTimers(now = Date.now(), env = process.env, key = TIMER_KEY) {
  const rows = await command(["LRANGE", key, "0", "99"], env);
  return rows.map((row) => {
    try {
      return { serialized: row, timer: JSON.parse(row) };
    } catch {
      throw new Error("A timer in Upstash Redis is invalid JSON.");
    }
  }).filter(({ timer }) => Number.isFinite(timer.dueAt) && timer.dueAt <= now);
}

async function claimTimerCompletion(id, env, key = `twinkle-toes:timer-complete:${id}`) {
  return (await command(["SET", key, "1", "NX", "EX", "86400"], env)) === "OK";
}

async function removeTimer(serialized, env, key = TIMER_KEY) {
  await command(["LREM", key, "1", serialized], env);
}

function forSession(sessionId, env = process.env) {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw Object.assign(new Error("A valid browser session ID is required."), { statusCode: 400 });
  }
  const prefix = `twinkle-toes:${sessionId}:`;
  return {
    addTimer: (timer) => addTimer(timer, env, `${prefix}${TIMER_KEY}`),
    appendEvent: (event) => appendEvent(event, env, `${prefix}${EVENT_KEY}`),
    claimTimerCompletion: (id) => claimTimerCompletion(id, env, `${prefix}timer-complete:${id}`),
    dueTimers: (now) => dueTimers(now, env, `${prefix}${TIMER_KEY}`),
    getEventBatch: (id) => getEventBatch(id, env, `${prefix}${EVENT_KEY}`),
    getHistory: () => getJson(`${prefix}${HISTORY_KEY}`, [], env),
    getState: (fallback) => getState(`${prefix}${STATE_KEY}`, fallback, env),
    removeTimer: (serialized) => removeTimer(serialized, env, `${prefix}${TIMER_KEY}`),
    setHistory: (history) => setJson(`${prefix}${HISTORY_KEY}`, history, env),
    setState: (state) => setState(`${prefix}${STATE_KEY}`, state, env),
  };
}

module.exports = {
  forSession,
  isConfigured,
};
