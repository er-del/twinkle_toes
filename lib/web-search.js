// Web search is an optional tool the model can call when its own knowledge is not enough.
const TAVILY_URL = "https://api.tavily.com/search";
const MAX_QUERY_LENGTH = 400;
const MAX_RESULTS = 4;
const MAX_SNIPPET_LENGTH = 700;
const FORCE_SEARCH_PATTERN = /\b(latest|newest|current|currently|today|tonight|tomorrow|yesterday|news|release|price|cost|weather|forecast|score|scores|who won|election|stock|schedule)\b/i;
const SEARCH_REQUEST_PREFIX = /^\s*(?:(?:please|hey|okay|ok)[,\s]+)*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:search|look\s+up|check)(?:\s+(?:the\s+)?(?:web|internet|online))?(?:\s+(?:for|about))?[:\s]*/i;

function shouldForceSearch(message) {
  if (typeof message !== "string") return false;
  return /\b(search|look up)\b/i.test(message) ||
    (message.includes("?") && FORCE_SEARCH_PATTERN.test(message));
}

function cleanSearchQuery(message) {
  const original = cleanText(message, MAX_QUERY_LENGTH);
  const cleaned = cleanText(original.replace(SEARCH_REQUEST_PREFIX, ""), MAX_QUERY_LENGTH);
  return cleaned || original;
}

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web for current or factual information that may be newer than your training data. Use it for news, prices, schedules, releases, sports, weather, or any fact you are unsure about. Do not use it for greetings, feelings, or opinions. Never put private personal information in the query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A short, specific search query, at most 400 characters.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

function cleanText(value, limit) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

async function searchWeb(query, { apiKey = process.env.TAVILY_API_KEY } = {}) {
  const cleanQuery = typeof query === "string" ? query.replace(/\s+/g, " ").trim() : "";
  if (!cleanQuery || cleanQuery.length > MAX_QUERY_LENGTH) {
    throw new Error(`Web search query must be 1 to ${MAX_QUERY_LENGTH} characters.`);
  }

  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : { "X-Tavily-Access-Mode": "keyless" }),
    },
    body: JSON.stringify({
      query: cleanQuery,
      search_depth: "basic",
      max_results: MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const detail = cleanText(result.detail || result.error || result.message, 200);
    throw new Error(`Web search returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }

  const result = await response.json().catch(() => ({}));
  const results = (Array.isArray(result.results) ? result.results : [])
    .map((item) => ({
      title: cleanText(item?.title, 200),
      url: cleanText(item?.url, 500),
      content: cleanText(item?.content, MAX_SNIPPET_LENGTH),
    }))
    .filter((item) => item.title && item.url && item.content)
    .slice(0, MAX_RESULTS);

  return { query: cleanQuery, results };
}

module.exports = { MAX_QUERY_LENGTH, MAX_RESULTS, WEB_SEARCH_TOOL, cleanSearchQuery, searchWeb, shouldForceSearch };
