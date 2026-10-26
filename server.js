const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { isIP } = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createHash, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const qr = require("qrcode-terminal");

const { MOODS, ensureMoodTag, parseMood } = require("./lib/moods");
const { recentMessages, rememberTurn } = require("./lib/chat-memory");
const { BOT_NAME, buildSystemPrompt } = require("./lib/persona");
const {
  detectLanguage,
  normalizeLanguage,
  replyMatchesLanguage,
  resolveLanguage,
} = require("./lib/language");
const { MAX_QUERY_LENGTH, WEB_SEARCH_TOOL, cleanSearchQuery, searchWeb, shouldForceSearch } = require("./lib/web-search");
const { DEVICE_ACTION_TOOL, createDeviceAction } = require("./lib/device-actions");
const { TOOL_DEFINITIONS, executeTool } = require("./lib/companion-tools");
const { runToolConversation } = require("./lib/tool-calling");
const { resolveChatProvider, validateClientSettings } = require("./lib/client-settings");
const vercelStore = require("./lib/vercel-store");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CHAT_BODY_BYTES = 128 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_CHARS = 4000;
const expressionList = MOODS;
const expressions = new Set(expressionList);
const motionList = ["float", "dance"];
const isVercel = Boolean(process.env.VERCEL);
const requestContext = new AsyncLocalStorage();

function loadEnvFile() {
  if (process.env.VERCEL) return;
  const filename = path.join(ROOT, ".env");
  if (!fs.existsSync(filename)) return;

  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnvFile();

const webSearchEnabled = !["0", "false", "off"].includes(
  String(process.env.WEB_SEARCH_ENABLED || "1").toLowerCase(),
);
const tavilyApiKey = process.env.TAVILY_API_KEY || "";
function currentSystemPrompt(language = "") {
  return buildSystemPrompt({
    moods: expressionList,
    webSearch: webSearchEnabled,
    currentDate: new Date().toLocaleDateString("en-CA"),
    language,
  });
}

const providers = {
  groq: {
    key: process.env.GROQ_API_KEY,
    keyName: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
  nvidia: {
    key: process.env.NVIDIA_API_KEY,
    keyName: "NVIDIA_API_KEY",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
  },
  "opencode-zen": {
    key: process.env.OPENCODE_ZEN_API_KEY,
    keyName: "OPENCODE_ZEN_API_KEY",
    url: "https://opencode.ai/inference/openai/v1/chat/completions",
    model: process.env.OPENCODE_ZEN_MODEL || "deepseek-v4.1-flash",
  },
};

const providerName = (process.env.AI_PROVIDER || "groq").toLowerCase();
const provider = providers[providerName];
const configuredApiSource = String(process.env.API_KEY_SOURCE || "env").toLowerCase();
if (!["env", "browser"].includes(configuredApiSource)) {
  throw new Error('API_KEY_SOURCE must be "env" or "browser".');
}
const aiEnabled = !["0", "false", "off"].includes(String(process.env.AI_ENABLED || "1").toLowerCase());
if (aiEnabled && !provider) {
  throw new Error(`Unknown AI_PROVIDER "${providerName}". Choose groq, nvidia, or opencode-zen.`);
}
const defaultApiSource = configuredApiSource === "env" && !provider?.key
  ? "browser"
  : configuredApiSource;
const SERVER_KEY_RATE_LIMITS = {
  chat: { perMinute: 10, perHour: 100 },
  speech: { perMinute: 20, perHour: 200 },
  transcribe: { perMinute: 10, perHour: 100 },
};
const port = Number.parseInt(process.env.PORT || "3000", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a number from 1 to 65535.");
}
const httpsKeyPath = process.env.HTTPS_KEY_PATH;
const httpsCertPath = process.env.HTTPS_CERT_PATH;
const voiceModelPath = path.join(ROOT, "voice-models", "en_US-amy-medium.onnx");
const voiceWorkerPath = path.join(ROOT, "scripts", "voice_worker.py");
const voicePythonPath = path.join(ROOT, ".venv-tts", "Scripts", "python.exe");
const fishAudioApiKey = process.env.FISH_AUDIO_API_KEY;
const fishAudioModel = process.env.FISH_AUDIO_MODEL || "s2.1-pro-free";
const DEFAULT_FISH_VOICE = "8d21b053e2804e2a890e1cf62f267b6f";
const fishAudioReferenceIds = {
  en: process.env.FISH_AUDIO_REFERENCE_ID_EN || process.env.FISH_AUDIO_REFERENCE_ID || DEFAULT_FISH_VOICE,
  hi: process.env.FISH_AUDIO_REFERENCE_ID_HI || process.env.FISH_AUDIO_REFERENCE_ID || DEFAULT_FISH_VOICE,
};
const sttApiKey = process.env.GROQ_API_KEY || "";
const sttEnabled = !["0", "false", "off"].includes(String(process.env.STT_ENABLED || "1").toLowerCase());
const sttModel = process.env.STT_MODEL || "whisper-large-v3-turbo";
const nvidiaVoiceApiKey = process.env.NVIDIA_VOICE_API_KEY || process.env.NVIDIA_API_KEY || "";
const nvidiaVoiceModel = process.env.NVIDIA_VOICE_MODEL || "chatterbox-multilingual-tts";
const serverState = {
  expression: "idle",
  motion: "float",
  speaking: false,
  line: "Hi! I'm Twinkle Toes. Ready when you are.",
  status: "Ready",
};
const recentEvents = [];
const conversationHistory = [];
const activeTimers = new Map();

function currentState() {
  return requestContext.getStore()?.state || serverState;
}

function currentStore() {
  return requestContext.getStore()?.store;
}

async function publish(name, data) {
  const event = { id: randomUUID(), name, data };
  recentEvents.push(event);
  recentEvents.splice(0, Math.max(0, recentEvents.length - 100));
  if (isVercel) await currentStore().appendEvent(event);
}

async function updateState(changes) {
  const state = currentState();
  Object.assign(state, changes);
  if (isVercel) await currentStore().setState(changes);
  await publish("state", state);
}

async function settleDueTimers() {
  if (!isVercel) return;
  const store = currentStore();
  for (const { serialized, timer } of await store.dueTimers()) {
    if (await store.claimTimerCompletion(timer.id)) {
      await publish("timer-complete", timer);
    }
    await store.removeTimer(serialized);
  }
}

async function enforceServerKeyRateLimit(request, scope) {
  if (!isVercel) return;
  const limit = SERVER_KEY_RATE_LIMITS[scope];
  const ip = String(request.headers["x-vercel-forwarded-for"] || "").trim();
  if (!isIP(ip)) {
    throw Object.assign(new Error("Vercel did not provide a valid client IP for rate limiting."), {
      statusCode: 503,
    });
  }
  const ipHash = createHash("sha256").update(ip).digest("hex");
  const result = await vercelStore.consumeRateLimit(
    scope,
    ipHash,
    limit.perMinute,
    limit.perHour,
  );
  if (!result.allowed) {
    throw Object.assign(new Error("Too many requests. Please wait before trying again."), {
      statusCode: 429,
    });
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function readJson(request, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = "";
    let received = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      received += chunk.length;
      if (received > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.resume();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        const value = JSON.parse(body || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          reject(Object.assign(new Error("Request body must be a JSON object."), { statusCode: 400 }));
          return;
        }
        resolve(value);
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      received += chunk.length;
      if (received > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("Audio is too large."), { statusCode: 413 }));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function getProviderStatus() {
  if (!provider) {
    return { enabled: false, configured: false, name: providerName, keyName: null, model: null };
  }
  return {
    enabled: aiEnabled,
    configured: aiEnabled && Boolean(provider.key),
    name: providerName,
    keyName: provider.keyName,
    model: provider.model,
  };
}

async function requestChat(messages, tools, chatProvider) {
  const response = await fetch(chatProvider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chatProvider.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatProvider.model,
      messages,
      temperature: 0.7,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
      // Groq counts hidden reasoning tokens here; the other providers use the standard field.
      ...(chatProvider.name === "groq"
        ? { max_completion_tokens: 800, reasoning_effort: "low" }
        : { max_tokens: 800 }),
      // NVIDIA Nemotron 3.5 reasons by default and leaves no content within max_tokens.
      ...(chatProvider.name === "nvidia" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    }),
    signal: AbortSignal.timeout(isVercel ? 12_000 : 35_000),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const detail = result.error?.message || result.detail || `Provider returned HTTP ${response.status}.`;
    throw new Error(`AI request failed: ${detail}`);
  }

  const result = await response.json().catch(() => ({}));
  const message = result.choices?.[0]?.message;
  if (!message) throw new Error("The AI provider returned an empty response.");
  return message;
}

async function askModel(messages, tools, chatProvider) {
  const assistant = await requestChat(messages, tools, chatProvider);
  if (assistant.content?.trim() || (tools && assistant.tool_calls?.length)) return assistant;
  console.warn("AI returned an empty response; retrying once.");
  return requestChat(messages, tools, chatProvider);
}

function webSearchQuery(toolCall) {
  if (toolCall?.function?.name !== "web_search") {
    throw new Error("The AI requested an unknown tool.");
  }
  const raw = toolCall.function.arguments;
  const args = typeof raw === "string" ? JSON.parse(raw) : raw;
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new Error("The AI requested an invalid web search.");
  }
  return query;
}

async function searchForModel(query, clientSettings = {}) {
  try {
    console.log(`Web search: ${query}`);
    const apiKey = (clientSettings.apiSource || "env") === "browser"
      ? clientSettings.tavilyApiKey
      : tavilyApiKey;
    const result = await searchWeb(query, { apiKey });
    console.log(`Web search: ${result.results.length} result(s)`);
    if (result.results.length === 0) {
      return JSON.stringify({
        error: "Web search returned no results. Tell the person you could not find an answer, and do not guess.",
      });
    }
    return JSON.stringify({
      today: new Date().toLocaleDateString("en-CA"),
      note: "Results may conflict. Prefer the newest dated claim and official sources over older blog posts.",
      ...result,
    });
  } catch (error) {
    console.warn(`Web search failed: ${error.message}`);
    return JSON.stringify({
      error: "Web search is unavailable right now. Tell the person you could not check the web, and do not guess.",
    });
  }
}

function companionTool(name) {
  return TOOL_DEFINITIONS.find((tool) => tool.function.name === name);
}

async function runCompanionTool(call, clientSettings) {
  const name = call?.function?.name;
  const args = call?.function?.arguments;
  const definition = companionTool(name);
  if (!definition) throw new Error("The AI requested an unknown tool.");
  const result = await executeTool(name, args, {
    notes: clientSettings.notes || [],
    timers: activeTimers,
    deferTimer: isVercel,
    onTimer: (timer) => publish("timer-complete", timer).catch((error) => {
      console.error("Could not publish timer completion:", error.message);
    }),
  });
  if (isVercel && result.type === "timer") await currentStore().addTimer(result);
  if (result.notes) clientSettings.notes = result.notes;
  return result;
}

const LANGUAGE_FALLBACKS = {
  hi: "क्षमा करें, मुझे हिंदी में उत्तर देने में परेशानी हो रही है। कृपया फिर से पूछें।",
  en: "Sorry, I could not answer that in English. Please try again.",
};

function englishLanguageCorrection() {
  return "Your previous reply used a non-English script or language. Rewrite the same answer only in English using Latin letters. Keep the mood tag.";
}

// This model can answer a Hindi prompt in Roman letters. Translating the draft is
// more reliable than telling it again to use Devanagari.
async function rewriteInDevanagari(raw, chatProvider) {
  const assistant = await askModel([
    {
      role: "system",
      content:
        "Translate the user text into natural Hindi written only in Devanagari script. " +
        `Begin with one mood tag from: ${expressionList.join(", ")}. ` +
        "Never use Latin letters for Hindi words. Output only the mood tag and the translation.",
    },
    { role: "user", content: raw },
  ], undefined, chatProvider);
  return ensureMoodTag(typeof assistant.content === "string" ? assistant.content.trim() : "");
}

async function getReply(message, requestedLanguage = "", history = [], clientSettings = {}) {
  if (!aiEnabled) throw new Error("Twinkle Toes is unavailable right now.");
  const chatProvider = resolveChatProvider(clientSettings, providers, providerName);

  const forceSearch = webSearchEnabled && shouldForceSearch(message);
  const language = resolveLanguage(requestedLanguage, message);
  if (language === "other") {
    return {
      mood: "curious",
      reply: "I can only speak English and Hindi. Please ask me in English or Hindi.",
      language,
      deviceActions: [],
      graphics: [],
      timers: [],
      notes: [],
    };
  }
  const messages = [
    { role: "system", content: currentSystemPrompt(language) },
    ...history,
    { role: "user", content: message },
  ];
  if (forceSearch) {
    // Forced searches skip the model's tool call: NVIDIA's required tool_choice is unreliable.
    const query = cleanSearchQuery(message);
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "forced-web-search",
          type: "function",
          function: { name: "web_search", arguments: JSON.stringify({ query }) },
        },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: "forced-web-search",
      content: await searchForModel(query, clientSettings),
    });
  }

  const tools = [
    ...(webSearchEnabled && !forceSearch ? [WEB_SEARCH_TOOL] : []),
    DEVICE_ACTION_TOOL,
    ...TOOL_DEFINITIONS,
  ];

  const deviceActions = [];
  const graphics = [];
  const timers = [];
  const notes = [];
  const assistant = await runToolConversation(messages, tools, chatProvider, askModel, async (call) => {
    try {
      if (call?.function?.name === "web_search") {
        return await searchForModel(webSearchQuery(call), clientSettings);
      }
      if (call?.function?.name === "open_approved_app") {
        deviceActions.push(createDeviceAction(call.function.arguments));
        return "An action button is ready, but the app has not been opened. Tell the person to tap it on their device.";
      }
      const result = await runCompanionTool(call, clientSettings);
      if (result.type === "graphic") graphics.push(result);
      if (result.type === "timer") timers.push(result);
      if (result.type.startsWith("note")) notes.push(result);
      return result;
    } catch (error) {
      if (call?.function?.name === "web_search") {
        console.warn(`Web search failed: ${error.message}`);
        return {
          error: "Web search is unavailable right now. Tell the person you could not check the web, and do not guess.",
        };
      }
      return { error: error.message };
    }
  });

  const raw = typeof assistant.content === "string" ? assistant.content.trim() : "";
  if (!raw) throw new Error("The AI provider returned an empty response.");

  let { mood, reply } = parseMood(raw);
  if (!reply) throw new Error("The AI provider returned an empty response.");

  if (!replyMatchesLanguage(reply, language)) {
    console.warn(`AI switched to the wrong language for ${language}; rewriting once.`);
    let corrected = null;
    if (language === "hi") {
      const rewritten = await rewriteInDevanagari(raw, chatProvider);
      corrected = rewritten ? parseMood(rewritten) : null;
    } else {
      const retryMessages = [
        ...messages,
        { role: "assistant", content: raw },
        { role: "user", content: englishLanguageCorrection() },
      ];
      const retry = await askModel(retryMessages, undefined, chatProvider);
      const retryRaw = typeof retry.content === "string" ? retry.content.trim() : "";
      corrected = retryRaw ? parseMood(retryRaw) : null;
    }
    if (corrected?.reply && replyMatchesLanguage(corrected.reply, language)) {
      ({ mood, reply } = corrected);
    } else {
      console.warn("AI still replied in the wrong language; using a fixed fallback.");
      mood = "confused";
      reply = LANGUAGE_FALLBACKS[language] || LANGUAGE_FALLBACKS.en;
    }
  }

  return { mood, reply, language, deviceActions, graphics, timers, notes };
}

let voiceWorker = null;
let nvidiaVoiceWorker = null;
let voiceJobId = 0;

function stopVoiceWorker(worker, error) {
  if (worker.stopped) return;
  worker.stopped = true;
  for (const job of worker.jobs.values()) {
    clearTimeout(job.timer);
    job.reject(error);
  }
  worker.jobs.clear();
  worker.process.kill();
  if (voiceWorker === worker) voiceWorker = null;
  if (nvidiaVoiceWorker === worker) nvidiaVoiceWorker = null;
}

// Loads each voice backend once; its first reply after a restart pays the initialization cost.
function startVoiceWorker(backend) {
  const args = backend === "nvidia" ? [voiceWorkerPath, "nvidia"] : [voiceWorkerPath, "piper", voiceModelPath];
  const child = spawn(voicePythonPath, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const worker = { process: child, jobs: new Map(), buffer: "", stopped: false };
  worker.ready = new Promise((resolve, reject) => {
    worker.markReady = resolve;
    worker.markFailed = reject;
  });
  if (backend === "nvidia") nvidiaVoiceWorker = worker;
  else voiceWorker = worker;

  let stderr = "";
  child.stdin.on("error", () => {}); // surfaced through close instead
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    worker.buffer += chunk;
    for (let index = worker.buffer.indexOf("\n"); index >= 0; index = worker.buffer.indexOf("\n")) {
      const line = worker.buffer.slice(0, index).trim();
      worker.buffer = worker.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.ready) {
        worker.markReady();
        continue;
      }
      const job = worker.jobs.get(message.id);
      if (!job) continue;
      clearTimeout(job.timer);
      worker.jobs.delete(message.id);
      if (message.ok) job.resolve();
      else job.reject(new Error(`Voice generation failed: ${message.error || "unknown error"}`));
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4000) stderr += chunk.slice(0, 4000 - stderr.length);
  });

  const fail = (error) => {
    worker.markFailed(error);
    stopVoiceWorker(worker, error);
  };
  child.on("error", (error) => fail(new Error(`Could not start voice generation: ${error.message}`)));
  child.on("close", (code) => {
    fail(new Error(`Voice generation stopped: ${stderr.trim() || `exit code ${code}`}`));
  });

  return worker;
}

function ensureVoiceWorker() {
  return voiceWorker || startVoiceWorker("piper");
}

function ensureNvidiaVoiceWorker() {
  return nvidiaVoiceWorker || startVoiceWorker("nvidia");
}

async function synthesizeWorkerVoice(worker, text, language, apiKey = "") {
  await worker.ready;
  if (worker.stopped) {
    throw Object.assign(new Error("Voice worker restarted. Please try again."), { statusCode: 503 });
  }

  const outputPath = path.join(os.tmpdir(), `twinkle-toes-${randomUUID()}.wav`);
  try {
    await new Promise((resolve, reject) => {
      const id = String(++voiceJobId);
      const timer = setTimeout(() => {
        stopVoiceWorker(worker, Object.assign(new Error("Voice generation timed out."), { statusCode: 504 }));
      }, 30_000);
      worker.jobs.set(id, { resolve, reject, timer });
      worker.process.stdin.write(`${JSON.stringify({ id, text, path: outputPath, language, apiKey })}\n`);
    });
    return fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(outputPath, { force: true });
  }
}

async function synthesizeLocalVoice(text, language = "en") {
  if (!fs.existsSync(voiceModelPath) || !fs.existsSync(voicePythonPath)) {
    throw Object.assign(
      new Error("Local Piper voice is not installed. Run .\\setup-voice.ps1 on the server computer."),
      { statusCode: 503 },
    );
  }

  return synthesizeWorkerVoice(ensureVoiceWorker(), text, language);
}

async function synthesizeNvidiaVoice(text, language, apiKey = nvidiaVoiceApiKey) {
  if (!apiKey) {
    throw Object.assign(new Error("NVIDIA voice is not configured. Add NVIDIA_VOICE_API_KEY or NVIDIA_API_KEY."), {
      statusCode: 503,
    });
  }
  if (!fs.existsSync(voicePythonPath)) {
    throw Object.assign(new Error("NVIDIA voice client is not installed. Run .\\setup-voice.ps1."), { statusCode: 503 });
  }
  return synthesizeWorkerVoice(ensureNvidiaVoiceWorker(), text, language, apiKey);
}

async function transcribeAudio(audio, contentType, apiKey) {
  const startedAt = performance.now();
  const extension = contentType.includes("mp4") ? "m4a" : contentType.includes("ogg") ? "ogg" : contentType.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `speech.${extension}`);
  form.append("model", sttModel);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const detail = result.error?.message || result.detail || `HTTP ${response.status}.`;
    throw Object.assign(new Error(`Speech recognition failed: ${detail}`), { statusCode: 502 });
  }

  const result = await response.json().catch(() => ({}));
  const text = typeof result.text === "string" ? result.text.trim().slice(0, 1000) : "";
  if (!text) {
    throw Object.assign(new Error("I didn't catch that. Try speaking again."), { statusCode: 422 });
  }
  console.log(`Speech-to-text: ${Math.round(performance.now() - startedAt)} ms`);
  return {
    text,
    language: normalizeLanguage(result.language) || detectLanguage(text),
  };
}

async function synthesizeFishAudio(text, referenceId, apiKey, signal) {
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: fishAudioModel,
    },
    body: JSON.stringify({
      text,
      format: "mp3",
      reference_id: referenceId,
      temperature: 0.4,
      top_p: 0.5,
      latency: "balanced",
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      `Fish Audio returned HTTP ${response.status}: ${result.message || result.error?.message || "TTS request failed."}`,
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("audio/")) {
    throw new Error(`Fish Audio returned unexpected content type "${contentType || "unknown"}".`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) {
    throw new Error("Fish Audio audio response exceeded 10 MB.");
  }
  if (!response.body) throw new Error("Fish Audio returned no audio stream.");
  const audioStream = response.body.getReader();
  const firstChunk = await audioStream.read();
  if (firstChunk.done || !firstChunk.value?.byteLength) {
    throw new Error("Fish Audio returned empty audio.");
  }
  const audio = Buffer.from(firstChunk.value);
  if (audio.length > 10 * 1024 * 1024) {
    await audioStream.cancel();
    throw new Error("Fish Audio audio response exceeded 10 MB.");
  }
  return { audio, audioStream, contentType, engine: "fish-audio" };
}

async function synthesizeVoice(text, clientSettings = {}, signal) {
  const startedAt = performance.now();
  const language = detectLanguage(text);
  const useBrowserKeys = (clientSettings.apiSource || "env") === "browser";
  const activeFishAudioApiKey = useBrowserKeys ? clientSettings.fishAudioApiKey : fishAudioApiKey;
  const activeNvidiaVoiceApiKey = useBrowserKeys ? clientSettings.nvidiaVoiceApiKey : nvidiaVoiceApiKey;
  if (activeFishAudioApiKey) {
    try {
      const result = await synthesizeFishAudio(text, fishAudioReferenceIds[language], activeFishAudioApiKey, signal);
      console.log(
        `Voice source: Fish Audio (${fishAudioModel}, ${language}; first audio chunk: ${Math.round(performance.now() - startedAt)} ms)`,
      );
      return { ...result, language };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (language === "hi") {
        throw Object.assign(new Error(`Hindi speech needs Fish Audio, and generation failed: ${error.message}`), {
          statusCode: 502,
        });
      }
      if (isVercel) {
        throw Object.assign(new Error(`Fish Audio generation failed: ${error.message}`), { statusCode: 502 });
      }
      console.warn(`Fish Audio TTS failed; falling back to local Piper: ${error.message}`);
      const localAudio = await synthesizeLocalVoice(text, language);
      console.log(`Voice source: Piper fallback (${Math.round(performance.now() - startedAt)} ms)`);
      return { audio: localAudio, contentType: "audio/wav", engine: "piper-fallback", language };
    }
  }

  if (activeNvidiaVoiceApiKey && !isVercel) {
    try {
      const audio = await synthesizeNvidiaVoice(text, language, activeNvidiaVoiceApiKey);
      console.log(`Voice source: NVIDIA ${nvidiaVoiceModel} (${language}; ${Math.round(performance.now() - startedAt)} ms)`);
      return { audio, contentType: "audio/wav", engine: "nvidia-chatterbox", language };
    } catch (error) {
      if (language === "hi") {
        throw Object.assign(new Error(`Hindi speech needs NVIDIA Chatterbox; generation failed: ${error.message}`), { statusCode: 502 });
      }
      console.warn(`NVIDIA voice failed; falling back to local Piper: ${error.message}`);
      const localAudio = await synthesizeLocalVoice(text, language);
      console.log(`Voice source: Piper fallback (${Math.round(performance.now() - startedAt)} ms)`);
      return { audio: localAudio, contentType: "audio/wav", engine: "piper-fallback", language };
    }
  }

  if (isVercel) {
    throw Object.assign(new Error("Configure Fish Audio for server-generated speech, or use this browser's built-in voice."), {
      statusCode: 503,
    });
  }

  if (language === "hi") {
    throw Object.assign(
      new Error("Hindi speech needs Fish Audio or NVIDIA Chatterbox; the local Piper voice only speaks English."),
      { statusCode: 503 },
    );
  }

  console.warn("Fish Audio and NVIDIA Chatterbox are not configured; using local Piper voice.");
  const localAudio = await synthesizeLocalVoice(text, language);
  console.log(`Voice source: Piper fallback (${Math.round(performance.now() - startedAt)} ms)`);
  return { audio: localAudio, contentType: "audio/wav", engine: "piper-fallback", language };
}

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/control": ["control.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/control.html": ["control.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/eye-model.js": ["eye-model.js", "text/javascript; charset=utf-8"],
  "/eye-renderer.js": ["eye-renderer.js", "text/javascript; charset=utf-8"],
  "/idle-mood.js": ["idle-mood.js", "text/javascript; charset=utf-8"],
  "/THIRD-PARTY-NOTICES.txt": ["THIRD-PARTY-NOTICES.txt", "text/plain; charset=utf-8"],
  "/manifest.json": ["manifest.json", "application/manifest+json; charset=utf-8"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
  "/icon.svg": ["icon.svg", "image/svg+xml"],
};

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const cursor = url.searchParams.get("since") || "";
  const isEventPoll = request.method === "GET" && url.pathname === "/api/events";
  let stateLoaded = false;

  if (isVercel && ([
    "/api/control",
    "/api/say",
    "/api/stop",
    "/api/chat",
  ].includes(url.pathname) || isEventPoll && !cursor)) {
    Object.assign(currentState(), await currentStore().getState(currentState()));
    stateLoaded = true;
  }

  if (isEventPoll) {
    const localCursor = recentEvents.findIndex((event) => event.id === cursor);
    const batch = isVercel
      ? await currentStore().getEventBatch(cursor)
      : {
          events: cursor === "0"
            ? recentEvents
            : cursor && localCursor >= 0
              ? recentEvents.slice(localCursor + 1)
              : [],
          cursor: recentEvents.at(-1)?.id || "0",
          reset: Boolean(cursor && cursor !== "0" && localCursor < 0),
        };
    await settleDueTimers();
    if (isVercel && batch.reset && !stateLoaded) {
      Object.assign(currentState(), await currentStore().getState(currentState()));
      stateLoaded = true;
    }
    json(response, 200, {
      ...batch,
      ...(stateLoaded ? { state: currentState() } : {}),
      pollIntervalMs: isVercel ? 2500 : 900,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    json(response, 200, {
      defaultApiSource,
      sharedStateConfigured: !isVercel || vercelStore.isConfigured(),
      chat: {
        enabled: aiEnabled,
        configured: getProviderStatus().configured,
        personalKeysOnly: false,
        defaultProvider: providerName,
        providers: Object.entries(providers).map(([name, item]) => ({
          name,
          model: item.model,
          configured: Boolean(item.key),
        })),
      },
      speechToText: {
        enabled: sttEnabled && Boolean(sttApiKey),
        acceptsBrowserKey: sttEnabled,
        model: sttModel,
      },
      realtimeTransport: "polling",
      webSearch: {
        enabled: webSearchEnabled,
        tavilyConfigured: Boolean(tavilyApiKey),
      },
      voice: {
        fishAudioConfigured: Boolean(fishAudioApiKey),
        fishAudioModel,
        nvidiaConfigured: !isVercel && Boolean(nvidiaVoiceApiKey),
        nvidiaModel: nvidiaVoiceModel,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/transcribe") {
    const apiSource = String(request.headers["x-twinkle-api-source"] || defaultApiSource).trim();
    if (!["env", "browser"].includes(apiSource)) {
      json(response, 400, { error: "Choose Server .env or Personal keys." });
      return;
    }
    const browserSttKey = String(request.headers["x-twinkle-stt-key"] || "").trim();
    const clientSttKey = apiSource === "browser" ? browserSttKey : "";
    if (clientSttKey.length > 2048) {
      json(response, 400, { error: "Speech API key is too long." });
      return;
    }
    const activeSttKey = apiSource === "browser" ? clientSttKey : sttApiKey;
    if (!sttEnabled || !activeSttKey) {
      json(response, 503, {
        error: "Speech recognition is unavailable right now.",
      });
      return;
    }
    const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("audio/")) {
      json(response, 415, { error: "Send recorded audio with an audio content type." });
      return;
    }
    const audio = await readBody(request, MAX_AUDIO_BYTES);
    if (audio.length === 0) {
      json(response, 400, { error: "The audio recording was empty." });
      return;
    }
    if (apiSource === "env") await enforceServerKeyRateLimit(request, "transcribe");
    json(response, 200, await transcribeAudio(audio, contentType, activeSttKey));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/speech") {
    const body = await readJson(request, MAX_CHAT_BODY_BYTES);
    const clientSettings = validateClientSettings(body.settings);
    clientSettings.apiSource ??= defaultApiSource;
    clientSettings.notes ??= [];
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_CHAT_CHARS) {
      json(response, 400, { error: `Speech text must be 1 to ${MAX_CHAT_CHARS} characters.` });
      return;
    }
    if (clientSettings.apiSource === "env" && fishAudioApiKey) {
      await enforceServerKeyRateLimit(request, "speech");
    }
    const startedAt = performance.now();
    const speechAbort = new AbortController();
    response.on?.("close", () => {
      if (!response.writableEnded) speechAbort.abort();
    });
    try {
      const { audio, audioStream, contentType } = await synthesizeVoice(
        body.text.trim(),
        clientSettings,
        speechAbort.signal,
      );
      response.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      let size = audio.length;
      if (size > 10 * 1024 * 1024) throw new Error("Speech audio response exceeded 10 MB.");
      if (!response.write(audio)) await once(response, "drain");
      if (audioStream) {
        while (true) {
          const { done, value } = await audioStream.read();
          if (done) break;
          size += value.byteLength;
          if (size > 10 * 1024 * 1024) {
            throw new Error("Speech audio response exceeded 10 MB.");
          }
          if (!response.write(Buffer.from(value))) await once(response, "drain");
        }
      }
      response.end();
      console.log(`Speech delivery: ${Math.round(performance.now() - startedAt)} ms`);
    } catch (error) {
      if (speechAbort.signal.aborted) return;
      console.error("Speech failed:", error.message);
      if (response.headersSent) {
        response.destroy(error);
      } else {
        json(response, 503, { error: "Twinkle Toes cannot speak right now. Please try again." });
      }
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/control") {
    const body = await readJson(request);
    const changes = {};
    if (body.expression !== undefined) {
      if (!expressions.has(body.expression)) {
        json(response, 400, { error: "Unknown expression." });
        return;
      }
      changes.expression = body.expression;
    }
    if (body.motion !== undefined) {
      if (!motionList.includes(body.motion)) {
        json(response, 400, { error: "Motion must be float or dance." });
        return;
      }
      changes.motion = body.motion;
    }
    if (body.speaking !== undefined) {
      if (typeof body.speaking !== "boolean") {
        json(response, 400, { error: "Speaking must be a boolean." });
        return;
      }
      changes.speaking = body.speaking;
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || body.status.length > 60) {
        json(response, 400, { error: "Status must be a string of at most 60 characters." });
        return;
      }
      changes.status = body.status;
    }
    if (body.line !== undefined) {
      if (typeof body.line !== "string" || body.line.length > 240) {
        json(response, 400, { error: "Speech line must be a string of at most 240 characters." });
        return;
      }
      changes.line = body.line;
    }
    await updateState(changes);
    json(response, 200, { state: currentState() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/say") {
    const body = await readJson(request);
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 240) {
      json(response, 400, { error: "Speech text must be 1 to 240 characters." });
      return;
    }
    const text = body.text.trim();
    const expression = expressions.has(body.expression) ? body.expression : "speaking";
    await updateState({ expression, speaking: true, line: text, status: "Speaking" });
    await publish("speech", { text });
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stop") {
    await updateState({ expression: "idle", speaking: false, status: "Ready" });
    await publish("stop", {});
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(request, MAX_CHAT_BODY_BYTES);
    const clientSettings = validateClientSettings(body.settings);
    clientSettings.apiSource ??= defaultApiSource;
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > MAX_CHAT_CHARS) {
      json(response, 400, { error: `Message must be 1 to ${MAX_CHAT_CHARS} characters.` });
      return;
    }
    if (clientSettings.apiSource === "env" && provider?.key) {
      await enforceServerKeyRateLimit(request, "chat");
    }
    await publish("user-message", { text: body.message.trim() });
    await updateState({ expression: "thinking", speaking: false, status: "Thinking" });
    try {
      const requestedLanguage = typeof body.language === "string" ? body.language : "";
      const startedAt = performance.now();
      const message = body.message.trim();
      const history = isVercel ? await currentStore().getHistory() : conversationHistory;
      const { reply, mood, language, deviceActions, graphics, timers, notes } = await getReply(
        message,
        requestedLanguage,
        recentMessages(history),
        clientSettings,
      );
      rememberTurn(history, message, reply);
      if (isVercel) await currentStore().setHistory(history);
      console.log(`AI reply: ${Math.round(performance.now() - startedAt)} ms`);
      await updateState({ expression: mood, speaking: true, line: reply, status: "Speaking" });
      for (const action of deviceActions) await publish("device-action", action);
      for (const graphic of graphics) await publish("graphic-created", graphic);
      for (const timer of timers) await publish("timer-created", timer);
      await publish("assistant", { reply, mood });
      json(response, 200, { reply, mood, language, deviceActions, graphics, timers, notes });
    } catch (error) {
      console.error("Chat failed:", error.message);
      const publicError = "Twinkle Toes is taking a moment. Please try again.";
      await updateState({ expression: "confused", speaking: false, line: publicError, status: "Taking a moment" });
      await publish("chat-error", { error: publicError });
      json(response, 502, { error: publicError });
    }
    return;
  }

  if (request.method === "GET" && staticFiles[url.pathname]) {
    const [filename, contentType] = staticFiles[url.pathname];
    const content = await fs.promises.readFile(path.join(PUBLIC_DIR, filename));
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    response.end(content);
    return;
  }

  json(response, 404, { error: "Not found." });
}

const requestHandler = (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "microphone=(self), camera=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  );

  const sharedStatePaths = new Set([
    "/api/events",
    "/api/control",
    "/api/say",
    "/api/stop",
    "/api/chat",
  ]);
  const requestPath = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  const context = {
    state: isVercel ? { ...serverState } : serverState,
    store: null,
  };
  if (isVercel && sharedStatePaths.has(requestPath)) {
    try {
      context.store = vercelStore.forSession(request.headers["x-twinkle-session"]);
    } catch (error) {
      json(response, error.statusCode || 400, { error: error.message });
      return;
    }
  }

  requestContext.run(context, () => {
    handle(request, response).catch((error) => {
      console.error("Request failed:", error.message);
      if (!response.headersSent) {
        json(response, error.statusCode || 500, { error: error.message || "Internal server error." });
      } else {
        response.end();
      }
    });
  });
};

if (!isVercel && Boolean(httpsKeyPath) !== Boolean(httpsCertPath)) {
  throw new Error("Set both HTTPS_KEY_PATH and HTTPS_CERT_PATH to enable HTTPS.");
}
if (!isVercel && httpsKeyPath && (!fs.existsSync(path.resolve(ROOT, httpsKeyPath)) || !fs.existsSync(path.resolve(ROOT, httpsCertPath)))) {
  throw new Error("HTTPS is enabled but a certificate file is missing. Check HTTPS_KEY_PATH and HTTPS_CERT_PATH.");
}

const server = isVercel ? null : httpsKeyPath
  ? https.createServer(
      {
        key: fs.readFileSync(path.resolve(ROOT, httpsKeyPath)),
        cert: fs.readFileSync(path.resolve(ROOT, httpsCertPath)),
      },
      requestHandler,
    )
  : http.createServer(requestHandler);
const protocol = httpsKeyPath ? "https" : "http";

function localAddresses() {
  const addresses = [];
  const virtualAdapter = /vEthernet|VirtualBox|VMware|Hyper-V|Loopback|Tailscale|ZeroTier|WSL|Bluetooth/i;
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    if (virtualAdapter.test(name)) continue;
    for (const details of interfaces || []) {
      if (details.family === "IPv4" && !details.internal && !details.address.startsWith("169.254.")) {
        addresses.push(details.address);
      }
    }
  }
  return [...new Set(addresses)];
}

function startServer() {
  server.listen(port, "0.0.0.0", () => {
    console.log(`${BOT_NAME} is running. Press Ctrl+C to stop.\n`);
    console.log(`  This computer: ${protocol}://localhost:${port}`);
    console.log(`  Controller:    ${protocol}://localhost:${port}/control`);

    const addresses = localAddresses();
    if (addresses.length === 0) {
      console.log("\nNo LAN IPv4 address found. Connect this computer to Wi-Fi and restart.");
    }
    for (const address of addresses) {
      const displayUrl = `${protocol}://${address}:${port}`;
      console.log(`\n  Android display: ${displayUrl}`);
      console.log("  Scan with the Android camera:");
      qr.generate(displayUrl, { small: true });
    }

    const ai = getProviderStatus();
    const aiLabel = !ai.enabled
      ? "disabled"
      : ai.configured
        ? `${ai.name} / ${ai.model}`
        : `${ai.name} selected; API key not set`;
    console.log(`\nAI: ${aiLabel}`);
    console.log(
      `Web search: ${webSearchEnabled ? `Tavily (${tavilyApiKey ? "API key" : "keyless"})` : "disabled"}`,
    );
    console.log(
      `Voice: Fish Audio ${fishAudioApiKey ? `(${fishAudioModel}; primary)` : "(not configured)"}; NVIDIA Chatterbox is the fallback when configured, then Piper for English`,
    );
    if (fishAudioApiKey && !process.env.FISH_AUDIO_REFERENCE_ID_HI) {
      console.warn("FISH_AUDIO_REFERENCE_ID_HI is not set; Hindi speech will use the default Fish Audio voice.");
    }
    console.log(
      `Speech to text: ${!sttEnabled ? "disabled" : sttApiKey ? `Groq ${sttModel}` : "ready for a browser-supplied Groq key"}`,
    );
    if (fs.existsSync(voiceModelPath) && fs.existsSync(voicePythonPath)) {
      console.log("Piper fallback: installed; starts only if Fish Audio or NVIDIA Chatterbox is unavailable");
    } else {
      console.log("Piper fallback: not installed; run setup-voice.ps1");
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other server or set PORT in .env.`);
    } else {
      console.error("Twinkle Toes could not start:", error);
    }
    process.exitCode = 1;
  });
}

if (require.main === module) startServer();

module.exports = requestHandler;

function shutdown() {
  voiceWorker?.process.kill();
  nvidiaVoiceWorker?.process.kill();
  process.exit(0);
}

if (require.main === module) process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
