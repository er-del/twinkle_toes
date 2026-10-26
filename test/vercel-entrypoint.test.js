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
    process.env.API_KEY_SOURCE = "env";
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.NVIDIA_MODEL = "";
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
  assert.equal(JSON.parse(responses[0].body).defaultApiSource, "env");
  assert.equal(JSON.parse(responses[0].body).chat.configured, true);
  assert.equal(JSON.parse(responses[0].body).chat.personalKeysOnly, false);
  assert.equal(
    JSON.parse(responses[0].body).chat.providers.find((item) => item.name === "nvidia").model,
    "deepseek-ai/deepseek-v4.1-flash"
  );
  assert.equal(responses[1].status, 400);
  assert.match(JSON.parse(responses[1].body).error, /session ID/);
  assert.equal(responses[2].status, 503);
  assert.match(JSON.parse(responses[2].body).error, /valid client IP/);
});

test("uses configured environment keys for Vercel chat, speech, and transcription", () => {
  const script = `
    process.env.VERCEL = "1";
    process.env.API_KEY_SOURCE = "env";
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.FISH_AUDIO_API_KEY = "test-fish-key";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    const rateScopes = [];
    let fishRequests = [];
    let chatRequest;
    let currentAbortTimeoutMs;
    let chatRequestTimeoutMs;
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) => {
      currentAbortTimeoutMs = milliseconds;
      return nativeTimeout(60_000);
    };
    let fishUpstreamEnded = false;
    let firstAudioWrittenBeforeUpstreamEnd = false;
    global.fetch = async (url, options = {}) => {
      const address = String(url);
      if (address.endsWith("/pipeline")) {
        const commands = JSON.parse(options.body);
        return { ok: true, json: async () => commands.map(() => ({ result: "OK" })) };
      }
      if (address === "https://redis.example") {
        const command = JSON.parse(options.body);
        if (command[0] === "EVAL") {
          rateScopes.push(command[4]);
          return { ok: true, json: async () => ({ result: [1, 1] }) };
        }
        if (command[0] === "GET") return { ok: true, json: async () => ({ result: null }) };
        if (command[0] === "HGETALL") return { ok: true, json: async () => ({ result: [] }) };
        return { ok: true, json: async () => ({ result: "OK" }) };
      }
      if (address.includes("/v1/audio/transcriptions")) {
        return { ok: true, json: async () => ({ text: "hello there", language: "en" }) };
      }
      if (address.includes("api.fish.audio")) {
        fishRequests.push(JSON.parse(options.body));
        fishUpstreamEnded = false;
        return {
          ok: true,
          headers: { get: (name) => name === "content-type" ? "audio/mpeg" : null },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              setTimeout(() => {
                fishUpstreamEnded = true;
                controller.enqueue(new Uint8Array([2, 3]));
                controller.close();
              }, 25);
            }
          })
        };
      }
      if (address.includes("api.groq.com/openai/v1/chat/completions")) {
        chatRequest = JSON.parse(options.body);
        chatRequestTimeoutMs = options.signal ? currentAbortTimeoutMs : 0;
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "[happy] Hello there." } }] })
        };
      }
      throw new Error("Unexpected external request.");
    };
    const { Readable } = require("node:stream");
    const handler = require("./api/[...path].js");
    const session = "a8c0020e-3d49-44fb-aab6-d4ea807eb328";
    function request(path, body, contentType = "application/json") {
      return new Promise((resolve) => {
        const req = Readable.from(body ? [body] : []);
        req.method = "POST";
        req.url = path;
        req.headers = {
          host: "localhost",
          "content-type": contentType,
          "x-vercel-forwarded-for": "203.0.113.50",
          ...(path === "/api/chat" ? { "x-twinkle-session": session } : {})
        };
        const res = {
          headersSent: false,
          headers: {},
          chunks: [],
          setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
          writeHead(status, headers = {}) {
            this.statusCode = status;
            Object.entries(headers).forEach(([name, value]) => { this.headers[name.toLowerCase()] = value; });
            this.headersSent = true;
          },
          write(value) {
            this.chunks.push(Buffer.from(value));
            if (path === "/api/speech" && this.chunks.length === 1) {
              firstAudioWrittenBeforeUpstreamEnd = !fishUpstreamEnded;
            }
            return true;
          },
          end(value) {
            if (value) this.chunks.push(Buffer.from(value));
            resolve({
              status: this.statusCode,
              headers: this.headers,
              body: Buffer.concat(this.chunks).toString()
            });
          }
        };
        handler(req, res);
      });
    }
    (async () => {
      const chat = await request("/api/chat", JSON.stringify({
        message: "Say hello",
        settings: { apiSource: "env" }
      }));
      const speech = await request("/api/speech", JSON.stringify({
        text: "Hello there",
        settings: { apiSource: "env" }
      }));
      const hindiSpeech = await request("/api/speech", JSON.stringify({
        text: "नमस्ते",
        settings: { apiSource: "env" }
      }));
      const transcription = await request(
        "/api/transcribe",
        Buffer.from([1, 2, 3]),
        "audio/webm"
      );
      console.log("RESULT=" + JSON.stringify({
        chat,
        speech: { status: speech.status, contentType: speech.headers["content-type"], body: speech.body },
        hindiSpeech: { status: hindiSpeech.status, contentType: hindiSpeech.headers["content-type"], body: hindiSpeech.body },
        transcription,
        rateScopes,
        fishRequests,
        chatTools: chatRequest.tools.map((tool) => tool.function.name),
        chatRequestTimeoutMs,
        firstAudioWrittenBeforeUpstreamEnd
      }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1" },
    timeout: 8000,
  });

  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.split(/\r?\n/).find((line) => line.startsWith("RESULT="));
  assert.ok(output, result.stdout);
  const {
    chat,
    speech,
    hindiSpeech,
    transcription,
    rateScopes,
    fishRequests,
    chatTools,
    chatRequestTimeoutMs,
    firstAudioWrittenBeforeUpstreamEnd
  } = JSON.parse(output.slice("RESULT=".length));
  assert.equal(chat.status, 200);
  assert.equal(JSON.parse(chat.body).reply, "Hello there.");
  assert.equal(speech.status, 200);
  assert.equal(speech.contentType, "audio/mpeg");
  assert.equal(speech.body.length, 3);
  assert.equal(hindiSpeech.status, 200);
  assert.equal(hindiSpeech.body.length, 3);
  assert.deepEqual(fishRequests.map(({ latency }) => latency), ["balanced", "balanced"]);
  assert.ok(!chatTools.includes("web_search"));
  assert.equal(chatRequestTimeoutMs, 25_000);
  assert.equal(firstAudioWrittenBeforeUpstreamEnd, true);
  assert.equal(transcription.status, 200);
  assert.equal(JSON.parse(transcription.body).text, "hello there");
  assert.deepEqual(rateScopes.map((key) => key.split(":")[2]).sort(), ["chat", "speech", "speech", "transcribe"]);
});

test("polls room events through the configured Vercel store", () => {
  const script = `
    process.env.VERCEL = "1";
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    global.fetch = async () => ({ ok: true, json: async () => ({ result: [] }) });
    const { Readable } = require("node:stream");
    const handler = require("./api/[...path].js");
    const req = Readable.from([]);
    req.method = "GET";
    req.url = "/api/events?since=0";
    req.headers = {
      host: "localhost",
      "x-twinkle-session": "a8c0020e-3d49-44fb-aab6-d4ea807eb328"
    };
    const res = {
      headersSent: false,
      setHeader() {},
      writeHead(status) { this.statusCode = status; this.headersSent = true; },
      end(body) {
        console.log(JSON.stringify({ status: this.statusCode, body: JSON.parse(String(body)) }));
      }
    };
    handler(req, res);
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1" },
    timeout: 5000,
  });

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events, []);
  assert.equal(response.body.cursor, "0");
  assert.equal(response.body.pollIntervalMs, 2500);
});
