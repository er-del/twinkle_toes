const MAX_ACTION_QUERY_CHARS = 200;

const DEVICE_ACTION_TOOL = {
  type: "function",
  function: {
    name: "open_approved_app",
    description:
      "Prepare a user-tap link for YouTube, Spotify, Gmail, or a Google web search when the person explicitly asks to open/search/play something. This only shows an action button; it does not launch anything. Never claim the app opened before the person taps it.",
    parameters: {
      type: "object",
      properties: {
        app: {
          type: "string",
          enum: ["youtube", "spotify", "gmail", "chrome_search"],
        },
        query: {
          type: "string",
          description: "Optional requested video or music; required for a web search, at most 200 characters.",
        },
      },
      required: ["app"],
      additionalProperties: false,
    },
  },
};

function createDeviceAction(value) {
  const args = typeof value === "string" ? JSON.parse(value) : value;
  const app = args?.app;
  if (args?.query !== undefined && typeof args.query !== "string") {
    throw new Error("The app action query must be text.");
  }
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!["youtube", "spotify", "gmail", "chrome_search"].includes(app)) {
    throw new Error("Only YouTube, Spotify, Gmail, and Chrome web search are supported.");
  }
  if ((!query && app === "chrome_search") || query.length > MAX_ACTION_QUERY_CHARS) {
    throw new Error(`The app action query must be ${app === "chrome_search" ? "1" : "0"} to ${MAX_ACTION_QUERY_CHARS} characters.`);
  }

  const destinations = {
    youtube: query
      ? {
          label: `Search YouTube for “${query}”`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        }
      : { label: "Open YouTube", url: "https://www.youtube.com/" },
    spotify: query
      ? {
          label: `Search Spotify for “${query}”`,
          url: `https://open.spotify.com/search/${encodeURIComponent(query)}`,
        }
      : { label: "Open Spotify", url: "https://open.spotify.com/" },
    gmail: { label: "Open Gmail", url: "https://mail.google.com/" },
    chrome_search: {
      label: `Search the web for “${query}”`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    },
  };
  const destination = destinations[app];
  return {
    title: destination.label,
    url: destination.url,
  };
}

module.exports = { DEVICE_ACTION_TOOL, createDeviceAction };
