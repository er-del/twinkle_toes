const assert = require("node:assert/strict");
const test = require("node:test");

const { MAX_QUERY_LENGTH, MAX_RESULTS, cleanSearchQuery, searchWeb, shouldForceSearch } = require("../lib/web-search");

function stubFetch(t, handler) {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = handler;
}

test("searches Tavily keyless by default and trims results", async (t) => {
  let request;
  stubFetch(t, async (url, options) => {
    request = { url, options };
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "  Example   result  ",
            url: "https://example.com/page",
            content: "  Useful\ninformation.  ",
          },
          { title: "Missing content", url: "https://example.com/empty" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const result = await searchWeb(" latest node version ", { apiKey: "" });

  assert.equal(request.url, "https://api.tavily.com/search");
  assert.equal(request.options.headers["X-Tavily-Access-Mode"], "keyless");
  assert.equal(request.options.headers.Authorization, undefined);
  const body = JSON.parse(request.options.body);
  assert.equal(body.query, "latest node version");
  assert.equal(body.max_results, MAX_RESULTS);
  assert.deepEqual(result, {
    query: "latest node version",
    results: [
      {
        title: "Example result",
        url: "https://example.com/page",
        content: "Useful information.",
      },
    ],
  });
});

test("uses an API key when one is configured", async (t) => {
  let request;
  stubFetch(t, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const result = await searchWeb("weather tomorrow", { apiKey: "tvly-test-key" });

  assert.equal(request.options.headers.Authorization, "Bearer tvly-test-key");
  assert.equal(request.options.headers["X-Tavily-Access-Mode"], undefined);
  assert.deepEqual(result.results, []);
});

test("surfaces Tavily errors", async (t) => {
  stubFetch(t, async () =>
    new Response(JSON.stringify({ detail: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await assert.rejects(
    () => searchWeb("anything"),
    /Web search returned HTTP 429: Rate limit exceeded/,
  );
});

test("forces search for explicit and time-sensitive questions", () => {
  assert.equal(shouldForceSearch("Please search the web for the latest Node.js release."), true);
  assert.equal(shouldForceSearch("What is the latest Python version?"), true);
  assert.equal(shouldForceSearch("Hello Twinkle Toes!"), false);
  assert.equal(shouldForceSearch("I had a rough day."), false);
  assert.equal(shouldForceSearch("I am currently sad."), false);
});

test("strips polite search wording from forced queries", () => {
  assert.equal(
    cleanSearchQuery("Please search the web for the latest Node.js release version."),
    "the latest Node.js release version.",
  );
  assert.equal(cleanSearchQuery("Can you look up the weather in Mumbai?"), "the weather in Mumbai?");
  assert.equal(
    cleanSearchQuery("What is the latest Python version?"),
    "What is the latest Python version?",
  );
  assert.equal(cleanSearchQuery("Please search the web"), "Please search the web");
});

test("rejects empty and oversized queries without a request", async (t) => {
  stubFetch(t, async () => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(() => searchWeb("   "), /Web search query must be/);
  await assert.rejects(
    () => searchWeb("x".repeat(MAX_QUERY_LENGTH + 1)),
    /Web search query must be/,
  );
});
