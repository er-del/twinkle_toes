const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("uses Vercel's Other preset so browser assets remain static", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "public");
});

test("loads the Vercel function entrypoint without starting a local listener", () => {
  const result = spawnSync(process.execPath, [
    "-e",
    `const handler = require("./api/[...path].js"); if (typeof handler !== "function") process.exit(1); console.log("handler ready");`,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1" },
    timeout: 5000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /handler ready/);
});

test("serves status and refuses unscoped shared-state requests on Vercel", () => {
  const script = `
    process.env.VERCEL = "1";
    process.env.UPSTASH_REDIS_REST_URL = "";
    process.env.UPSTASH_REDIS_REST_TOKEN = "";
    const { Readable } = require("node:stream");
    const handler = require("./api/[...path].js");
    let completed = 0;
    const responses = [];
    function request(path, method = "GET", headers = {}, body = "") {
      const req = Readable.from(body ? [body] : []);
      req.method = method;
      req.url = path;
      req.headers = { host: "localhost", ...headers };
      const res = {
        headersSent: false,
        setHeader() {},
        writeHead(status) { this.statusCode = status; this.headersSent = true; },
        end(body) {
          responses.push({ status: this.statusCode, body: String(body || "") });
          if (++completed === 3) {
            console.log(JSON.stringify(responses));
            process.exit(0);
          }
        }
      };
      handler(req, res);
    }
    request("/api/status");
    request("/api/events");
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    global.fetch = async (_url, options) => {
      const command = JSON.parse(options.body)[0];
      return { ok: true, json: async () => ({ result: command === "HGETALL" ? [] : "OK" }) };
    };
    request("/api/chat", "POST", {
      "content-type": "application/json",
      "x-twinkle-session": "a8c0020e-3d49-44fb-aab6-d4ea807eb328"
    }, JSON.stringify({ message: "hello", settings: { apiSource: "env" } }));
    setTimeout(() => process.exit(1), 3000);
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1" },
    timeout: 5000,
  });

  assert.equal(result.status, 0, result.stderr);
  const responses = JSON.parse(result.stdout.trim());
  assert.equal(responses[0].status, 200);
  assert.equal(JSON.parse(responses[0].body).chat.personalKeysOnly, true);
  assert.equal(responses[1].status, 400);
  assert.match(JSON.parse(responses[1].body).error, /session ID/);
  assert.equal(responses[2].status, 403);
  assert.match(JSON.parse(responses[2].body).error, /Personal keys/);
});
