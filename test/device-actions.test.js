const assert = require("node:assert/strict");
const test = require("node:test");

const { DEVICE_ACTION_TOOL, createDeviceAction } = require("../lib/device-actions");

test("offers only the approved browser actions", () => {
  assert.deepEqual(
    DEVICE_ACTION_TOOL.function.parameters.properties.app.enum,
    ["youtube", "spotify", "gmail", "chrome_search"],
  );
});

test("builds YouTube, Spotify, and web-search links from encoded queries", () => {
  const youtube = createDeviceAction({ app: "youtube", query: "cats & dogs" });
  assert.equal(
    youtube.url,
    "https://www.youtube.com/results?search_query=cats%20%26%20dogs",
  );

  const spotify = createDeviceAction({ app: "spotify", query: "Daft Punk" });
  assert.equal(spotify.url, "https://open.spotify.com/search/Daft%20Punk");

  const search = createDeviceAction({ app: "chrome_search", query: "weather today" });
  assert.equal(search.url, "https://www.google.com/search?q=weather%20today");
});

test("prepares a Gmail link", () => {
  assert.deepEqual(createDeviceAction({ app: "gmail" }), {
    title: "Open Gmail",
    url: "https://mail.google.com/",
  });
});

test("opens the home page for YouTube or Spotify without a search query", () => {
  assert.equal(createDeviceAction({ app: "youtube" }).url, "https://www.youtube.com/");
  assert.equal(createDeviceAction({ app: "spotify" }).url, "https://open.spotify.com/");
});

test("rejects unknown apps, empty web searches, and oversized queries", () => {
  assert.throws(() => createDeviceAction({ app: "powershell", query: "anything" }), /Only YouTube/);
  assert.throws(() => createDeviceAction({ app: "chrome_search", query: " " }), /query must be/);
  assert.throws(() => createDeviceAction({ app: "youtube", query: 123 }), /must be text/);
  assert.throws(() => createDeviceAction({ app: "spotify", query: "x".repeat(201) }), /query must be/);
});

test("parses valid model tool arguments and rejects malformed JSON", () => {
  assert.equal(
    createDeviceAction('{"app":"spotify","query":"ambient"}').url,
    "https://open.spotify.com/search/ambient",
  );
  assert.throws(() => createDeviceAction("{not json"), SyntaxError);
});
