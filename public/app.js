(() => {
  "use strict";

  const DEFAULT_WAKE_NOTE = "Speak English or Hindi; the server transcribes your voice and replies aloud.";
  const CAPTURE_SILENCE_MS = 500;
  const MAX_VOICE_TRANSCRIPT_CHARS = 4000;
  const SETTINGS_STORAGE_KEY = "twinkle-toes-settings-v1";
  const NOTES_STORAGE_KEY = "twinkle-toes-notes-v1";
  const SESSION_STORAGE_KEY = "twinkle-toes-room-v1";
  const { IDLE_AFTER_MS, SLEEPY_AFTER_MS, restingMoodFor } = window.TwinkleIdleMood;
  const mode = document.body.dataset.mode;
  const sessionId = getSessionId();
  const connection = document.querySelector("#connection-label");
  const connectionWrap = document.querySelector(".connection");
  const face = document.querySelector("#robot-face");
  const motionStage = document.querySelector("#robot-motion");
  const line = document.querySelector("#robot-line");
  const status = document.querySelector("#robot-status");
  const wakeNote = document.querySelector("#wake-note");
  const micState = document.querySelector("#mic-state");
  const motionState = document.querySelector("#motion-state");
  const screenState = document.querySelector("#screen-state");
  const startButton = document.querySelector("#start-button");
  const startLabel = document.querySelector("#start-label");
  const skipButton = document.querySelector("#skip-button");
  const voiceDock = document.querySelector("#voice-dock");
  const voiceDockHeard = document.querySelector("#voice-dock-heard");
  const voiceDockStatus = document.querySelector("#voice-dock-status");
  const voiceOrb = document.querySelector("#voice-orb");
  const deviceActionCard = document.querySelector("#device-action-card");
  const deviceActionTitle = document.querySelector("#device-action-title");
  const deviceActionOpen = document.querySelector("#device-action-open");
  const deviceActionDismiss = document.querySelector("#device-action-dismiss");
  const graphicDisplayCard = document.querySelector("#graphic-display-card");
  const graphicDisplayTitle = document.querySelector("#graphic-display-title");
  const graphicDisplayArt = document.querySelector("#graphic-display-art");
  const toast = document.querySelector("#toast");
  const approvedActionOrigins = new Set([
    "https://www.youtube.com",
    "https://open.spotify.com",
    "https://mail.google.com",
    "https://www.google.com",
  ]);

  let recognition = null;
  let listening = false;
  let waitingForReply = false;
  let restartRecognition = () => {};
  let resumeListening = () => {};
  let stopCapture = () => {};
  let stopMoodCycle = () => {};
  let serverSpeech = false;
  let configuredServerSpeech = false;
  let acceptsBrowserSttKey = false;
  let wakeLock = null;
  let micGranted = false;
  let starting = false;
  let hasEntered = false;
  let toastTimer = 0;
  let speech = null;
  let browserUtterance = null;
  let speechGeneration = 0;
  let audioPlayback = null;
  let speechAbort = null;
  let lastChatError = "";
  let userSettings = {};
  const activeToolTimers = new Map();
  let toolStatusMessage = "";
  let toolStatusInterval = 0;
  let serverDefaultApiSource = "env";
  let serverConfigStatus = null;
  let serverConfigPromise = null;
  let idleMoodTimer = 0;
  let idleSince = 0;

  function getSessionId() {
    const query = new URLSearchParams(window.location.search);
    const roomFromUrl = query.get("room");
    const isUuid = (value) =>
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    let room = isUuid(roomFromUrl) ? roomFromUrl : "";
    if (!room) {
      try {
        const stored = localStorage.getItem(SESSION_STORAGE_KEY);
        if (isUuid(stored)) room = stored;
      } catch (error) {
        console.warn("Could not read this device's room ID:", error.message);
      }
    }
    if (!room) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      room = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, room);
    } catch (error) {
      console.warn("Could not save this device's room ID:", error.message);
    }
    if (roomFromUrl !== room) {
      query.set("room", room);
      window.history.replaceState(null, "", `${window.location.pathname}?${query}${window.location.hash}`);
    }
    document.querySelectorAll('a[href="/"], a[href="/control"]').forEach((link) => {
      const destination = new URL(link.href);
      destination.searchParams.set("room", room);
      link.href = destination.href;
    });
    return room;
  }

  let currentState = {
    expression: "idle",
    motion: "float",
    speaking: false,
  };

  const eyeRenderer = face && window.ZongzhuEyeRenderer
    ? new window.ZongzhuEyeRenderer(face, (mood) => {
        post("/api/control", { expression: mood }).catch((error) => {
          console.warn("Could not sync Twinkle Toes' expression:", error);
        });
      })
    : null;

  function setSense(element, label, state = "idle") {
    if (!element) return;
    element.textContent = label;
    element.dataset.state = state;
  }

  function setNote(message, tone = "muted") {
    if (!wakeNote) return;
    wakeNote.textContent = message;
    wakeNote.dataset.tone = tone;
  }

  function showToast(message, duration = 5200) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), duration);
  }

  function loadNotes() {
    let notes;
    try {
      notes = JSON.parse(localStorage.getItem(NOTES_STORAGE_KEY) || "[]");
    } catch (error) {
      console.error("Could not read saved browser notes:", error);
      throw new Error("Saved notes could not be read from this browser.");
    }
    if (!Array.isArray(notes) || notes.length > 20 || notes.some((note) =>
      !note || typeof note.id !== "string" || typeof note.title !== "string" ||
      typeof note.text !== "string" || typeof note.createdAt !== "string"
    )) {
      throw new Error("Saved notes in this browser have an invalid format.");
    }
    return notes;
  }

  function saveChatNotes(notes) {
    if (!Array.isArray(notes) || notes.length === 0) return;
    const latest = notes[notes.length - 1];
    if (!Array.isArray(latest?.notes)) return;
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(latest.notes));
    } catch (error) {
      console.error("Could not save browser-local notes:", error);
      toolStatusMessage = "Could not save the note in this browser.";
      renderToolStatus();
      showToast(toolStatusMessage);
      return;
    }
    toolStatusMessage = latest.type === "note_deleted"
      ? "Saved note deleted on this device."
      : latest.type === "note_saved"
        ? "Note saved on this device."
        : `${latest.notes.length} saved note${latest.notes.length === 1 ? "" : "s"} found on this device.`;
    renderToolStatus();
    if (mode === "display") showToast(toolStatusMessage);
  }

  function loadUserSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
      return {
        apiSource: ["env", "browser"].includes(stored.apiSource)
          ? stored.apiSource
          : typeof stored.chatApiKey === "string" && stored.chatApiKey.trim()
            ? "browser"
            : "",
        chatProvider: ["groq", "nvidia", "opencode-zen"].includes(stored.chatProvider)
          ? stored.chatProvider
          : "",
        chatApiKey: typeof stored.chatApiKey === "string" ? stored.chatApiKey : "",
        fishAudioApiKey: typeof stored.fishAudioApiKey === "string" ? stored.fishAudioApiKey : "",
        sttApiKey: typeof stored.sttApiKey === "string" ? stored.sttApiKey : "",
        tavilyApiKey: typeof stored.tavilyApiKey === "string" ? stored.tavilyApiKey : "",
      };
    } catch (error) {
      console.warn("Could not read saved provider settings:", error.message);
      return {};
    }
  }

  function sttApiKey() {
    if (configuredServerSpeech) return "";
    return userSettings.sttApiKey ||
      (userSettings.chatProvider === "groq" ? userSettings.chatApiKey : "") ||
      "";
  }

  function activeApiSource() {
    if (!serverConfigStatus) return serverDefaultApiSource;
    return userSettings.apiSource || serverDefaultApiSource;
  }

  function refreshServerSpeech() {
    serverSpeech = configuredServerSpeech || acceptsBrowserSttKey && Boolean(sttApiKey());
    renderVoiceControl();
  }

  function settingsFor(endpoint) {
    if (endpoint === "/api/chat") {
      const apiSource = activeApiSource();
      return {
        apiSource,
        chatProvider: userSettings.chatProvider,
        notes: loadNotes(),
        ...(apiSource === "browser" ? { chatApiKey: userSettings.chatApiKey } : {}),
        ...(apiSource === "browser" ? { tavilyApiKey: userSettings.tavilyApiKey } : {}),
      };
    }
    if (endpoint === "/api/speech") {
      const useServerVoice = Boolean(serverConfigStatus?.voice?.fishAudioConfigured);
      const useBrowserVoice = !useServerVoice &&
        Boolean(
          userSettings.fishAudioApiKey ||
          userSettings.chatProvider === "nvidia" && userSettings.chatApiKey,
        );
      const apiSource = useServerVoice ? "env" : useBrowserVoice ? "browser" : activeApiSource();
      return {
        apiSource,
        ...(apiSource === "browser" ? {
          fishAudioApiKey: userSettings.fishAudioApiKey,
          nvidiaVoiceApiKey:
            userSettings.chatProvider === "nvidia" ? userSettings.chatApiKey : "",
        } : {}),
      };
    }
    return {};
  }

  function setupSettings() {
    const form = document.querySelector("#settings-form");
    if (!form) return;
    const panel = document.querySelector("#setup-panel");
    const providerSelect = document.querySelector("#chat-provider");
    const sourceInputs = [...document.querySelectorAll('input[name="apiSource"]')];
    const personalFields = document.querySelector("#personal-provider-fields");
    const sourceHint = document.querySelector("#api-source-hint");
    const envSummary = document.querySelector("#env-config-summary");
    const chatKey = document.querySelector("#chat-api-key");
    const fishKey = document.querySelector("#fish-audio-api-key");
    const sttKey = document.querySelector("#stt-api-key");
    const tavilyKey = document.querySelector("#tavily-api-key");
    const status = document.querySelector("#settings-status");
    const summary = document.querySelector("#setup-summary-note");
    const inputs = [chatKey, fishKey, sttKey, tavilyKey].filter(Boolean);
    let providerWasChanged = false;
    let sourceWasChanged = false;
    userSettings = loadUserSettings();

    function renderEnvConfig(source) {
      if (!envSummary) return;
      envSummary.hidden = source !== "env";
      const setText = (id, text) => {
        const element = document.querySelector(id);
        if (element) element.textContent = text;
      };
      if (!serverConfigStatus) {
        ["#env-chat-model", "#env-voice-model", "#env-stt-model", "#env-search-model"]
          .forEach((id) => setText(id, "Unavailable"));
        return;
      }
      const config = serverConfigStatus;
      const chatConfigured = config.chat?.providers?.find(
        (item) => item.name === config.chat.defaultProvider,
      )?.configured;
      setText("#env-chat-model", !config.chat?.enabled
        ? "AI disabled"
        : `${config.chat.defaultProvider} · ${serverStatusModel(config.chat.defaultProvider)} · ${chatConfigured ? "key ready" : "key missing"}`);
      setText("#env-voice-model", config.voice?.fishAudioConfigured
        ? `Fish Audio · ${config.voice.fishAudioModel} · ready`
        : config.voice?.nvidiaConfigured
          ? `NVIDIA · ${config.voice.nvidiaModel} · ready`
          : "Piper · English only");
      setText("#env-stt-model", !config.speechToText?.enabled
        ? "Unavailable"
        : `${config.speechToText.model} · key ready`);
      setText("#env-search-model", !config.webSearch?.enabled
        ? "Disabled"
        : `Tavily · ${config.webSearch.tavilyConfigured ? "key configured" : "keyless"}`);
    }

    function renderSource() {
      const source = sourceInputs.find((input) => input.checked)?.value || serverDefaultApiSource;
      sourceInputs.forEach((input) => {
        input.closest(".api-source-option")?.classList.toggle("selected", input.checked);
      });
      if (personalFields) personalFields.hidden = source !== "browser";
      renderEnvConfig(source);
      if (sourceHint) {
        const selectedProvider = providerSelect?.selectedOptions[0]?.textContent || "provider";
        if (!serverConfigStatus) {
          sourceHint.textContent = "Server configuration is unavailable. Reconnect before saving API settings.";
        } else if (!serverConfigStatus.chat?.enabled) {
          sourceHint.textContent = "AI chat is disabled by the server's AI_ENABLED setting.";
        } else if (source === "env") {
          const configured = serverConfigStatus.chat.providers?.find(
            (item) => item.name === serverConfigStatus.chat.defaultProvider,
          )?.configured;
          sourceHint.textContent = configured
            ? `Using ${serverConfigStatus.chat.defaultProvider} · ${serverStatusModel(serverConfigStatus.chat.defaultProvider)} from the server environment.`
            : "Server mode is selected, but the default provider key is missing from the server environment.";
        } else {
          sourceHint.textContent = `Your ${selectedProvider} key will be used with the model configured for that provider in the server environment.`;
        }
      }
      if (chatKey) chatKey.required = source === "browser";
      if (summary) {
        if (source === "browser") {
          summary.textContent = userSettings.chatApiKey
            ? `Personal keys · ${providerSelect?.selectedOptions[0]?.textContent || "provider"} · ${serverStatusModel(providerSelect?.value)}`
            : "Personal API keys required";
        } else if (serverConfigStatus?.chat?.providers?.some(
          (item) => item.name === serverConfigStatus.chat.defaultProvider && item.configured,
        )) {
          summary.textContent = `Server .env · ${serverConfigStatus.chat.defaultProvider} · ${serverStatusModel(serverConfigStatus.chat.defaultProvider)}`;
        } else if (serverConfigStatus && !serverConfigStatus.chat?.enabled) {
          summary.textContent = "AI disabled on server";
        } else {
          summary.textContent = "Server key not configured";
        }
      }
    }

    function serverStatusModel(name) {
      return serverConfigStatus?.chat?.providers?.find((item) => item.name === name)?.model || "model not configured";
    }

    sourceInputs.forEach((input) => {
      input.checked = (serverConfigStatus ? activeApiSource() : serverDefaultApiSource) === input.value;
      input.addEventListener("change", () => {
        sourceWasChanged = true;
        renderSource();
      });
    });
    if (providerSelect) providerSelect.value = userSettings.chatProvider || "groq";
    if (chatKey) chatKey.value = userSettings.chatApiKey || "";
    if (fishKey) fishKey.value = userSettings.fishAudioApiKey || "";
    if (sttKey) sttKey.value = userSettings.sttApiKey || "";
    if (tavilyKey) tavilyKey.value = userSettings.tavilyApiKey || "";
    renderSource();

    document.querySelector(".show-api-keys")?.addEventListener("change", (event) => {
      inputs.forEach((input) => {
        input.type = event.target.checked ? "text" : "password";
      });
    });

    providerSelect?.addEventListener("change", () => {
      providerWasChanged = true;
      if (userSettings.chatApiKey && providerSelect.value !== userSettings.chatProvider && chatKey) {
        chatKey.value = "";
        if (status) {
          status.textContent = "The saved chat key belongs to the previous provider. Enter a key for the newly selected provider.";
          status.dataset.tone = "error";
        }
      }
      renderSource();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = {
        apiSource: sourceInputs.find((input) => input.checked)?.value || serverDefaultApiSource,
        chatProvider: providerSelect?.value || "groq",
        chatApiKey: chatKey?.value.trim() || "",
        fishAudioApiKey: fishKey?.value.trim() || "",
        sttApiKey: sttKey?.value.trim() || "",
        tavilyApiKey: tavilyKey?.value.trim() || "",
      };
      if (next.apiSource === "browser" && !next.chatApiKey) {
        if (status) {
          status.textContent = "Add the selected provider's API key before saving Personal keys mode.";
          status.dataset.tone = "error";
        }
        chatKey?.focus();
        return;
      }
      if (next.apiSource === "browser" &&
        [next.chatApiKey, next.fishAudioApiKey, next.sttApiKey, next.tavilyApiKey].some(Boolean) &&
        !window.isSecureContext) {
        if (status) {
          status.textContent = "API keys require a secure HTTPS connection on this device. Configure HTTPS for the server, then reopen this page.";
          status.dataset.tone = "error";
        }
        return;
      }
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        userSettings = next;
        refreshServerSpeech();
        renderSource();
        if (status) {
          status.textContent = next.apiSource === "env"
            ? "Server .env mode saved for this browser. Personal keys are ignored."
            : "Personal keys mode saved in this browser. Keys are stored locally and sent only for provider requests.";
          status.dataset.tone = "success";
        }
        if (panel) panel.open = false;
      } catch (error) {
        console.error("Could not save provider settings:", error);
        if (status) {
          status.textContent = "Could not save settings in this browser. Check browser storage permissions and try again.";
          status.dataset.tone = "error";
        }
      }
    });

    document.querySelector("#clear-settings")?.addEventListener("click", () => {
      try {
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
        userSettings = {};
        refreshServerSpeech();
        form.reset();
        inputs.forEach((input) => {
          input.type = "password";
        });
        const showKeys = document.querySelector(".show-api-keys");
        if (showKeys) showKeys.checked = false;
        if (providerSelect) providerSelect.value = "groq";
        sourceWasChanged = false;
        sourceInputs.forEach((input) => { input.checked = input.value === serverDefaultApiSource; });
        renderSource();
        if (panel) panel.open = true;
        if (status) {
          status.textContent = "Saved keys cleared from this browser. Server-configured defaults are unchanged.";
          status.dataset.tone = "success";
        }
      } catch (error) {
        console.error("Could not clear provider settings:", error);
        if (status) {
          status.textContent = "Could not clear browser storage. Remove this site's stored data in browser settings.";
          status.dataset.tone = "error";
        }
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== SETTINGS_STORAGE_KEY) return;
      userSettings = loadUserSettings();
      if (serverDefaultApiSource === "env") userSettings.apiSource = "env";
      refreshServerSpeech();
      const source = serverDefaultApiSource === "env"
        ? "env"
        : userSettings.apiSource || serverDefaultApiSource;
      sourceInputs.forEach((input) => { input.checked = input.value === source; });
      if (providerSelect) providerSelect.value = userSettings.chatProvider || providerSelect.value;
      if (chatKey) chatKey.value = userSettings.chatApiKey || "";
      if (fishKey) fishKey.value = userSettings.fishAudioApiKey || "";
      if (sttKey) sttKey.value = userSettings.sttApiKey || "";
      if (tavilyKey) tavilyKey.value = userSettings.tavilyApiKey || "";
      renderSource();
    });

    serverConfigPromise = fetch("/api/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        serverConfigStatus = data;
        serverDefaultApiSource = data.defaultApiSource === "browser" ? "browser" : "env";
        configuredServerSpeech = Boolean(data.speechToText?.enabled);
        acceptsBrowserSttKey = Boolean(data.speechToText?.acceptsBrowserKey);
        if (!sourceWasChanged) {
          userSettings.apiSource = serverDefaultApiSource;
          sourceInputs.forEach((input) => { input.checked = input.value === serverDefaultApiSource; });
        }
        refreshServerSpeech();
        if (providerSelect && !userSettings.chatProvider && !providerWasChanged && data.chat?.defaultProvider) {
          providerSelect.value = data.chat.defaultProvider;
        }
        renderSource();
        return data;
      })
      .catch((error) => {
        console.warn("Could not load provider status:", error.message);
        renderSource();
        return null;
      });
  }

  function inKiosk() {
    return document.body.dataset.kiosk === "on";
  }

  function restIsActive() {
    return currentState.speaking || listening || waitingForReply ||
      ["listening", "thinking", "speaking"].includes(currentState.expression);
  }

  function scheduleRestMood(reset = false) {
    if (mode !== "display" || !face) return;
    if (idleMoodTimer) window.clearTimeout(idleMoodTimer);
    idleMoodTimer = 0;
    if (restIsActive()) {
      idleSince = 0;
      return;
    }
    if (reset || !idleSince) idleSince = performance.now();

    const elapsed = performance.now() - idleSince;
    const restingMood = restingMoodFor(elapsed);
    if (restingMood === "sleepy") {
      face.dataset.expression = restingMood;
      return;
    }
    if (restingMood) face.dataset.expression = restingMood;
    const nextBoundary = elapsed < IDLE_AFTER_MS ? IDLE_AFTER_MS : SLEEPY_AFTER_MS;
    idleMoodTimer = window.setTimeout(
      () => scheduleRestMood(),
      Math.max(0, nextBoundary - elapsed),
    );
  }

  function noteDisplayActivity() {
    if (mode !== "display" || !face) return;
    if (!restIsActive()) face.dataset.expression = "idle";
    scheduleRestMood(true);
  }

  function setVoiceCaption(text) {
    if (!voiceDockHeard) return;
    voiceDockHeard.hidden = !text;
    voiceDockHeard.textContent = text ? `I heard: ${text}` : "";
  }

  function renderVoiceControl() {
    if (!voiceDock || !voiceOrb) return;
    voiceDock.hidden = !inKiosk();
    const canUseServerSpeech =
      serverSpeech &&
      window.isSecureContext &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined";
    const state = currentState.speaking
      ? "interrupt"
      : waitingForReply
        ? "busy"
        : listening
          ? "listening"
          : "ready";
    const labels = {
      listening: ["Listening · tap to pause", "Pause listening"],
      interrupt: ["Your turn · tap to speak", "Interrupt Twinkle Toes and speak"],
      busy: ["One moment…", "Please wait for the reply"],
      ready: ["Touch to talk", "Start listening"],
    };
    voiceOrb.dataset.state = state;
    voiceOrb.disabled = state === "busy" || (!recognition && !canUseServerSpeech);
    voiceOrb.setAttribute("aria-label", labels[state][1]);
    voiceOrb.setAttribute("aria-pressed", String(listening));
    if (voiceDockStatus) {
      voiceDockStatus.textContent = voiceOrb.disabled && state !== "busy"
        ? "Microphone unavailable"
        : labels[state][0];
    }
    scheduleRestMood();
  }

  async function post(endpoint, payload = {}) {
    if ((endpoint === "/api/chat" || endpoint === "/api/speech") && serverConfigPromise) {
      await serverConfigPromise;
    }
    const body = endpoint === "/api/chat" || endpoint === "/api/speech"
      ? { ...payload, settings: settingsFor(endpoint) }
      : payload;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Twinkle-Session": sessionId },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    if (endpoint === "/api/chat") saveChatNotes(result.notes);
    return result;
  }

  function highlightExpression(expression) {
    document.querySelectorAll("#expression-grid [data-expression]").forEach((button) => {
      const selected = button.dataset.expression === expression;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function setState(value) {
    currentState = { ...currentState, ...value };

    if (face && value.expression) face.dataset.expression = value.expression;
    if (motionStage && typeof value.motion === "string") motionStage.dataset.motion = value.motion;
    if (line && typeof value.line === "string") line.textContent = value.line;
    if (status && typeof value.status === "string") status.textContent = value.status;

    highlightExpression(value.expression || currentState.expression);
    document
      .querySelector("#dance-animation")
      ?.setAttribute("aria-pressed", String(currentState.motion === "dance"));
    if (value.expression || value.speaking !== undefined || value.status) scheduleRestMood(true);
    renderVoiceControl();
  }

  function addChatMessage(text, type) {
    const log = document.querySelector("#chat-log");
    if (!log) return;
    log.querySelector(".chat-note")?.remove();
    const item = document.createElement("div");
    item.className = `chat-message ${type}`;
    item.textContent = text;
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function createGraphicSvg(graphic) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const colorPattern = /^#[\da-f]{6}$/i;
    if (!graphic || typeof graphic.title !== "string" ||
        !colorPattern.test(graphic.background) || !Array.isArray(graphic.elements) ||
        graphic.elements.length > 14) {
      console.warn("Rejected an invalid generated graphic.");
      return null;
    }
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 320 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", graphic.title);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const background = document.createElementNS(svgNamespace, "rect");
    background.setAttribute("width", "320");
    background.setAttribute("height", "220");
    background.setAttribute("fill", graphic.background);
    svg.append(background);

    for (const item of graphic.elements) {
      if (!item || !colorPattern.test(item.color) ||
          !["circle", "rect", "line", "text"].includes(item.shape)) continue;
      const shape = document.createElementNS(svgNamespace, item.shape);
      shape.setAttribute("fill", item.shape === "line" ? "none" : item.color);
      if (item.shape !== "line") {
        shape.setAttribute("x", String(item.x));
        shape.setAttribute("y", String(item.y));
      }
      if (item.shape === "circle") {
        shape.setAttribute("cx", String(item.x));
        shape.setAttribute("cy", String(item.y));
        shape.setAttribute("r", String(item.radius));
      } else if (item.shape === "rect") {
        shape.setAttribute("width", String(item.width));
        shape.setAttribute("height", String(item.height));
        shape.setAttribute("rx", "8");
      } else if (item.shape === "line") {
        shape.setAttribute("x1", String(item.x));
        shape.setAttribute("y1", String(item.y));
        shape.setAttribute("x2", String(item.x2));
        shape.setAttribute("y2", String(item.y2));
        shape.setAttribute("stroke", item.color);
        shape.setAttribute("stroke-width", "4");
        shape.setAttribute("stroke-linecap", "round");
      } else if (item.shape === "text") {
        if (typeof item.text !== "string" || item.text.length > 80) continue;
        shape.setAttribute("fill", item.color);
        shape.setAttribute("font-size", String(item.size));
        shape.setAttribute("font-family", "system-ui, sans-serif");
        shape.setAttribute("font-weight", "600");
        shape.textContent = item.text;
      }
      svg.append(shape);
    }
    return svg;
  }

  function renderGraphic(graphic) {
    const svg = createGraphicSvg(graphic);
    if (!svg) return;
    if (mode === "display" && graphicDisplayCard && graphicDisplayTitle && graphicDisplayArt) {
      graphicDisplayTitle.textContent = graphic.title;
      graphicDisplayArt.replaceChildren(svg);
      graphicDisplayCard.hidden = false;
      return;
    }
    const log = document.querySelector("#chat-log");
    if (!log) return;
    const card = document.createElement("article");
    card.className = "chat-graphic";
    const title = document.createElement("strong");
    title.textContent = graphic.title;
    card.append(title, svg);
    log.append(card);
    log.scrollTop = log.scrollHeight;
  }

  function renderToolStatus() {
    const container = document.querySelector("#tool-status");
    if (!container) return;
    container.replaceChildren();
    if (toolStatusMessage) {
      const message = document.createElement("p");
      message.textContent = toolStatusMessage;
      container.append(message);
    }
    for (const timer of activeToolTimers.values()) {
      const chip = document.createElement("span");
      chip.className = "tool-timer-chip";
      const remaining = Math.max(0, Math.ceil((timer.dueAt - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      chip.textContent = `${timer.label} · ${minutes}:${String(seconds).padStart(2, "0")}`;
      container.append(chip);
    }
    container.hidden = container.childElementCount === 0;
    if (activeToolTimers.size && !toolStatusInterval) {
      toolStatusInterval = window.setInterval(renderToolStatus, 1000);
    } else if (!activeToolTimers.size && toolStatusInterval) {
      window.clearInterval(toolStatusInterval);
      toolStatusInterval = 0;
    }
  }

  function showDeviceAction(action) {
    if (typeof action?.title !== "string" || typeof action?.url !== "string") return;
    let destination;
    try {
      destination = new URL(action.url);
    } catch {
      console.error("Rejected an invalid device action URL.");
      return;
    }
    if (!approvedActionOrigins.has(destination.origin)) {
      console.error("Rejected a device action outside the approved app list.");
      return;
    }

    if (mode === "display" && deviceActionCard && deviceActionTitle && deviceActionOpen) {
      deviceActionTitle.textContent = action.title;
      deviceActionOpen.onclick = () => {
        window.open(destination.href, "_blank", "noopener,noreferrer");
        deviceActionCard.hidden = true;
      };
      if (deviceActionDismiss) deviceActionDismiss.onclick = () => {
        deviceActionCard.hidden = true;
      };
      deviceActionCard.hidden = false;
      return;
    }

    const message = document.createElement("div");
    message.className = "chat-message bot";
    const title = document.createElement("p");
    title.textContent = action.title;
    const button = document.createElement("button");
    button.className = "device-action-open";
    button.type = "button";
    button.textContent = "Open on this device";
    button.addEventListener("click", () => {
      window.open(destination.href, "_blank", "noopener,noreferrer");
      button.disabled = true;
      button.textContent = "Opened";
    });
    message.append(title, button);
    const log = document.querySelector("#chat-log");
    log?.append(message);
    if (log) log.scrollTop = log.scrollHeight;
  }

  function clearAudio() {
    speechAbort?.abort();
    speechAbort = null;
    if (browserUtterance && "speechSynthesis" in window) window.speechSynthesis.cancel();
    browserUtterance = null;
    audioPlayback?.pause();
    audioPlayback = null;
    if (speech?.src.startsWith("blob:")) URL.revokeObjectURL(speech.src);
    speech = null;
  }

  function finishSpeech(generation) {
    if (generation !== speechGeneration) return;
    speechGeneration++;
    clearAudio();
    waitingForReply = false;
    post("/api/control", { speaking: false, status: "Ready" }).catch((error) => {
      console.warn("Could not update Twinkle Toes' status:", error);
    });
    resumeListening();
    renderVoiceControl();
  }

  function speak(text) {
    if (mode !== "display" || !face || !text) return;

    const generation = ++speechGeneration;
    clearAudio();
    speechAbort = new AbortController();

    Promise.resolve(serverConfigPromise)
      .then(() => fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, settings: settingsFor("/api/speech") }),
        signal: speechAbort.signal,
      }))
      .then(async (response) => {
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || `Voice request failed (${response.status}).`);
        }
        return response.blob();
      })
      .then((audio) => {
        if (generation !== speechGeneration) return;
        speech = new Audio(URL.createObjectURL(audio));
        audioPlayback = speech;
        speech.onended = () => finishSpeech(generation);
        speech.onerror = () => {
          if (generation !== speechGeneration) return;
          setNote("The audio could not play on this device.", "error");
          finishSpeech(generation);
        };
        return speech.play();
      })
      .catch((error) => {
        if (error.name === "AbortError" || generation !== speechGeneration) return;
        if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
          browserUtterance = new SpeechSynthesisUtterance(text);
          browserUtterance.lang = /[\u0900-\u097f]/.test(text) ? "hi-IN" : "en-US";
          browserUtterance.onend = () => finishSpeech(generation);
          browserUtterance.onerror = () => finishSpeech(generation);
          window.speechSynthesis.speak(browserUtterance);
          setNote("Using this browser's built-in voice.");
          return;
        }
        setNote(error.message, "error");
        showToast(error.message, 7000);
        finishSpeech(generation);
      });
  }

  function stopSpeaking() {
    speechGeneration++;
    clearAudio();
  }

  document.querySelector("#graphic-display-dismiss")?.addEventListener("click", () => {
    if (graphicDisplayCard) graphicDisplayCard.hidden = true;
  });

  function connectEvents() {
    const listeners = new Map();
    let cursor = "";
    let stopped = false;
    let storageWarningShown = false;
    let retryTimer = 0;
    const on = (name, handler) => {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
    };

    async function poll() {
      if (stopped) return;
      try {
        const response = await fetch(`/api/events${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`, {
          cache: "no-store",
          headers: { "X-Twinkle-Session": sessionId },
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || `Event polling failed (${response.status}).`);
        }
        const batch = await response.json();
        if (batch.state) setState(batch.state);
        for (const event of batch.events || []) {
          for (const handler of listeners.get(event.name) || []) handler(event.data);
        }
        cursor = batch.cursor || cursor;
        connection.textContent = "Connected";
        connectionWrap.classList.add("connected");
        const activeReply = waitingForReply || currentState.expression === "thinking" || currentState.speaking;
        const pollInterval = activeReply
          ? Math.min(batch.pollIntervalMs || 900, 1000)
          : batch.pollIntervalMs || 900;
        retryTimer = window.setTimeout(poll, pollInterval);
      } catch (error) {
        connection.textContent = "Reconnecting";
        connectionWrap.classList.remove("connected");
        if (error.message.includes("UPSTASH_REDIS_REST_URL") && !storageWarningShown) {
          storageWarningShown = true;
          const message = "Vercel setup needed: add the Upstash Redis REST URL and token to the project's Environment Variables.";
          setNote(message, "error");
          showToast(message, 8000);
        }
        retryTimer = window.setTimeout(poll, 2500);
      }
    };

    on("state", setState);

    on("speech", ({ text }) => {
      if (mode !== "display") return;
      stopMoodCycle();
      waitingForReply = true;
      renderVoiceControl();
      speak(text);
    });

    on("assistant", ({ reply }) => {
      stopMoodCycle();
      if (mode === "control") {
        addChatMessage(reply, "bot");
      } else {
        if (line) line.textContent = reply;
        waitingForReply = true;
        renderVoiceControl();
        speak(reply);
      }
    });

    on("device-action", showDeviceAction);

    on("graphic-created", renderGraphic);

    on("timer-created", (timer) => {
      if (typeof timer?.id !== "string" || !Number.isFinite(timer.dueAt)) return;
      activeToolTimers.set(timer.id, timer);
      renderToolStatus();
      if (mode === "display") showToast(`${timer.label || "Timer"} started.`);
    });

    on("timer-complete", (timer) => {
      if (timer?.id) activeToolTimers.delete(timer.id);
      toolStatusMessage = `${timer?.label || "Your timer"} is finished.`;
      renderToolStatus();
      showToast(toolStatusMessage, 8000);
      if (mode === "control") addChatMessage(toolStatusMessage, "bot");
    });

    on("user-message", ({ text }) => {
      stopMoodCycle();
      if (mode === "control") addChatMessage(text, "user");
    });

    on("chat-error", ({ error }) => {
      stopMoodCycle();
      lastChatError = error;
      if (mode === "control") {
        addChatMessage(error, "error");
      } else {
        if (line) line.textContent = error;
        waitingForReply = false;
        showToast(error, 6500);
        resumeListening();
        renderVoiceControl();
      }
    });

    on("stop", () => {
      stopMoodCycle();
      stopSpeaking();
      waitingForReply = false;
      listening = false;
      stopCapture();
      if (recognition) {
        try {
          recognition.stop();
        } catch (error) {
          /* already stopped */
        }
      }
      renderVoiceControl();
    });

    poll();
    window.addEventListener("pagehide", () => {
      stopped = true;
      window.clearTimeout(retryTimer);
    }, { once: true });
  }

  function startLabelIdle() {
    if (hasEntered) return "Resume";
    return recognition || serverSpeech ? "Enable & enter" : "Enter display";
  }

  function setupRecognition(button) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      if (mode === "display" && !serverSpeech) {
        setSense(micState, "Unavailable", "error");
        setNote("Voice input isn't available in this browser. Use the controller to talk to Twinkle Toes.");
        if (skipButton) skipButton.hidden = true;
        if (startLabel) startLabel.textContent = startLabelIdle();
      } else if (button) {
        button.disabled = true;
        button.title = "Speech recognition is not supported by this browser.";
        const note = document.querySelector("#voice-note");
        if (note) {
          note.textContent = "Speech recognition isn't available in this browser. Type messages in the chat box instead.";
        }
      }
      return;
    }

    recognition = new Recognition();
    restartRecognition = () => {
      if (!recognition || !listening || waitingForReply || mode !== "display") return;
      window.setTimeout(() => {
        if (!listening || waitingForReply) return;
        try {
          recognition.start();
        } catch (error) {
          if (error.name !== "InvalidStateError") console.error("Could not restart voice recognition:", error);
        }
      }, 350);
    };
    resumeListening = restartRecognition;

    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      listening = true;
      if (mode === "display") {
        if (!micGranted) setSense(micState, "Listening", "busy");
        if (face) face.dataset.expression = "listening";
        if (status) status.textContent = "Listening";
      }
      button?.classList.add("active");
      button?.setAttribute("aria-label", "Stop voice commands");
      renderVoiceControl();
    };

    recognition.onresult = async (event) => {
      const message = event.results[0][0].transcript.trim();
      if (!message) return;

      if (mode === "control") {
        const input = document.querySelector("#message-input");
        input.value = message;
        document.querySelector("#chat-form").requestSubmit();
        return;
      }

      setVoiceCaption(message);
      waitingForReply = true;
      renderVoiceControl();
      if (line) line.textContent = message;
      if (status) status.textContent = "Thinking";
      if (face) face.dataset.expression = "thinking";
      try {
        await post("/api/chat", { message });
      } catch (error) {
        waitingForReply = false;
        if (line) line.textContent = error.message;
        if (status) status.textContent = "AI error";
        restartRecognition();
        renderVoiceControl();
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;

      if (mode === "display") {
        const permissionDenied = event.error === "not-allowed" && !micGranted;
        if (permissionDenied) setSense(micState, "Blocked", "error");
        else if (event.error === "service-not-allowed") setSense(micState, "Unavailable", "error");
        else setSense(micState, "Paused", "error");
        if (permissionDenied) micGranted = false;

        const message = event.error === "not-allowed"
          ? !window.isSecureContext
            ? "The browser blocked microphone access because this page is HTTP. Use trusted HTTPS or the desktop controller."
            : "Voice recognition couldn't use the microphone. Check the microphone permission in browser settings."
          : event.error === "service-not-allowed"
            ? !window.isSecureContext
              ? "The browser doesn't allow voice recognition for this HTTP address. Use trusted HTTPS or the desktop controller."
              : "Voice recognition isn't available for this site. Use the controller instead."
            : event.error === "audio-capture"
              ? "No microphone was found. Check the device and try again."
              : event.error === "network"
                ? "Voice recognition lost its connection. Try again."
                : `Voice input stopped (${event.error}).`;

        if (inKiosk()) showToast(`${message} Double-tap the top-right corner to return.`, 7000);
        else setNote(message, "error");

        listening = false;
        if (startButton) startButton.disabled = false;
        if (startLabel) startLabel.textContent = startLabelIdle();
      }

      button?.classList.remove("active");
      button?.setAttribute("aria-label", "Start voice commands");
      if (status && status.textContent === "Listening") status.textContent = "Ready";
      renderVoiceControl();
    };

    recognition.onend = () => {
      if (listening && mode === "display") {
        restartRecognition();
        return;
      }

      listening = false;
      button?.classList.remove("active");
      button?.setAttribute("aria-label", "Start voice commands");
      if (status && status.textContent === "Listening") status.textContent = "Ready";
      if (face && face.dataset.expression === "listening") {
        face.dataset.expression = currentState.expression || "idle";
      }
      renderVoiceControl();
    };

    if (button) {
      button.addEventListener("click", () => {
        if (listening) {
          listening = false;
          recognition.stop();
          return;
        }
        try {
          recognition.start();
        } catch (error) {
          console.error("Could not start voice recognition:", error);
          const note = document.querySelector("#voice-note");
          if (note) note.textContent = `Couldn't start the microphone: ${error.message}`;
        }
      });
    }
  }

  async function setupDisplay() {
    try {
      const response = await fetch("/api/status");
      const data = response.ok ? await response.json() : null;
      configuredServerSpeech = Boolean(data?.speechToText?.enabled);
      acceptsBrowserSttKey = Boolean(data?.speechToText?.acceptsBrowserKey);
      refreshServerSpeech();
    } catch (error) {
      console.warn("Could not check server speech recognition:", error.message);
    }
    setupRecognition(null);

    let tiltEnabled = false;
    let captureStream = null;
    let captureContext = null;
    let captureAnalyser = null;
    let captureTimer = null;
    let captureRecorder = null;
    let captureChunks = [];
    let captureTranscriptChunks = [];
    let captureLanguageCounts = { en: 0, hi: 0 };
    let captureTranscriptionQueue = Promise.resolve();
    let captureTranscriptionError = null;
    let captureGeneration = 0;
    let captureHeardSpeech = false;
    let captureSilenceSince = 0;
    let captureStartedAt = 0;
    let captureFinalChunk = false;
    let captureWanted = false;
    const captureBuffer = new Float32Array(1024);

    if ((recognition || serverSpeech) && navigator.permissions?.query) {
      try {
        navigator.permissions
          .query({ name: "microphone" })
          .then((result) => {
            if (result.state === "granted") {
              setSense(micState, "Ready", "ok");
            } else if (result.state === "denied") {
              setSense(micState, "Blocked", "error");
              setNote("Microphone is blocked in this browser. Allow it in site settings, or enter without it.", "error");
            }
          })
          .catch(() => {});
      } catch (error) {
        /* Microphone permission queries are not supported in this browser. */
      }
    }

    async function requestFullscreen() {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        const active = Boolean(document.fullscreenElement);
        setSense(screenState, active ? "Active" : "Windowed", active ? "ok" : "idle");
      } catch (error) {
        setSense(screenState, "Windowed");
      }
    }

    async function requestWakeLock() {
      if (!("wakeLock" in navigator)) return;
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch (error) {
        console.warn("Screen wake lock is unavailable:", error.message);
      }
    }

    async function requestMicrophone() {
      if (!recognition && !serverSpeech) return false;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setSense(micState, "Trying browser voice", "busy");
        setNote("Trying this browser's voice recognition. It may still block microphone access on an HTTP network address.");
        return true;
      }

      setSense(micState, "Requesting", "busy");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        micGranted = true;
        setSense(micState, "Granted", "ok");
        return true;
      } catch (error) {
        micGranted = false;
        const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
        setSense(micState, denied ? "Blocked" : "Unavailable", "error");
        setNote(
          denied
            ? "Microphone permission was blocked. Allow it in browser settings, or enter without it."
            : `Microphone unavailable: ${error.message}`,
          "error",
        );
        return false;
      }
    }

    async function enableDeviceTilt() {
      if (tiltEnabled) return;
      if (!eyeRenderer || !("DeviceOrientationEvent" in window)) {
        setSense(motionState, "Unavailable");
        return;
      }
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
          if (await DeviceOrientationEvent.requestPermission() !== "granted") {
            setSense(motionState, "Denied");
            return;
          }
        } catch (error) {
          console.warn("Device orientation permission was not granted:", error.message);
          setSense(motionState, "Unavailable");
          return;
        }
      }
      window.addEventListener("deviceorientation", (event) => {
        eyeRenderer.setTilt((event.gamma || 0) / 35, (event.beta || 0) / 35);
      });
      tiltEnabled = true;
      setSense(motionState, "Enabled", "ok");
    }

    function enterKiosk() {
      document.body.dataset.kiosk = "on";
      hasEntered = true;
      window.clearTimeout(toastTimer);
      toast?.classList.remove("visible");
      setNote(DEFAULT_WAKE_NOTE);
      document.activeElement?.blur();
      renderVoiceControl();
    }

    function leaveKiosk() {
      document.body.dataset.kiosk = "off";
      listening = false;
      stopCapture();
      if (recognition) {
        try {
          recognition.stop();
        } catch (error) {
          /* already stopped */
        }
      }
      if (face) face.dataset.expression = currentState.expression || "idle";
      if (startLabel) startLabel.textContent = startLabelIdle();
      setNote("Paused. The microphone is off until you resume.");
      startButton?.focus({ preventScroll: true });
      renderVoiceControl();
    }

    function startListening() {
      if (!recognition) return;
      try {
        recognition.start();
      } catch (error) {
        if (error.name === "InvalidStateError") return;
        if (inKiosk()) showToast("Microphone is paused. Double-tap the top-right corner to retry.", 6000);
        else setNote(`Couldn't start the microphone: ${error.message}`, "error");
      }
    }

    function discardRecording() {
      if (!captureRecorder) return;
      const recorder = captureRecorder;
      captureRecorder = null;
      captureChunks = [];
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }

    function armRecording() {
      if (!captureWanted || waitingForReply || captureRecorder || !captureStream) return;
      captureChunks = [];
      captureFinalChunk = false;
      captureHeardSpeech = false;
      captureSilenceSince = 0;
      captureStartedAt = performance.now();
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (candidate) => typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(captureStream, type ? { mimeType: type } : undefined);
      captureRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) captureChunks.push(event.data);
      };
      recorder.onstop = () => {
        const chunks = captureChunks;
        const heard = captureHeardSpeech;
        const isFinalChunk = captureFinalChunk;
        captureChunks = [];
        captureRecorder = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (heard && blob.size > 1500) sendRecording(blob, isFinalChunk);
        else if (isFinalChunk && captureTranscriptChunks.length) sendRecording(null, true);
        else window.setTimeout(armRecording, 100);
      };
      recorder.start();
      setSense(micState, "Listening", "ok");
    }

    function queueTranscription(blob) {
      const generation = captureGeneration;
      captureTranscriptionQueue = captureTranscriptionQueue
        .then(async () => {
          if (generation !== captureGeneration || captureTranscriptionError) return;
          const response = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": blob.type || "audio/webm",
              "X-Twinkle-Api-Source": configuredServerSpeech
                ? "env"
                : sttApiKey()
                  ? "browser"
                  : activeApiSource(),
              "X-Twinkle-Session": sessionId,
              ...(sttApiKey() ? { "X-Twinkle-Stt-Key": sttApiKey() } : {}),
            },
            body: blob,
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || `Speech recognition failed (${response.status}).`);
          const message = String(result.text || "").trim();
          if (!message) throw new Error("I didn't catch that. Try speaking again.");
          if (generation !== captureGeneration) return;

          captureTranscriptChunks.push(message);
          if (result.language === "hi" || result.language === "en") {
            captureLanguageCounts[result.language]++;
          }
          if (captureTranscriptChunks.join(" ").length > MAX_VOICE_TRANSCRIPT_CHARS) {
            throw new Error("That was a long message. Please split it into shorter parts.");
          }
        })
        .catch((error) => {
          if (generation === captureGeneration) captureTranscriptionError = error;
        });
    }

    async function sendRecording(blob, isFinalChunk) {
      if (blob) queueTranscription(blob);
      if (!isFinalChunk) {
        window.setTimeout(armRecording, 100);
        return;
      }

      waitingForReply = true;
      renderVoiceControl();
      if (line) line.textContent = "";
      if (status) status.textContent = "Transcribing";
      try {
        await captureTranscriptionQueue;
        if (captureTranscriptionError) throw captureTranscriptionError;
        const fullMessage = captureTranscriptChunks.join(" ");
        if (!fullMessage) throw new Error("I didn't catch that. Try speaking again.");

        const language =
          captureLanguageCounts.hi > captureLanguageCounts.en ? "hi" : "en";
        captureTranscriptChunks = [];
        captureLanguageCounts = { en: 0, hi: 0 };
        captureTranscriptionError = null;
        captureTranscriptionQueue = Promise.resolve();
        waitingForReply = true;
        setVoiceCaption(fullMessage);
        if (line) line.textContent = fullMessage;
        if (status) status.textContent = "Thinking";
        if (face) face.dataset.expression = "thinking";
        await post("/api/chat", { message: fullMessage, language });
      } catch (error) {
        captureTranscriptChunks = [];
        captureLanguageCounts = { en: 0, hi: 0 };
        captureTranscriptionError = null;
        captureTranscriptionQueue = Promise.resolve();
        waitingForReply = false;
        if (line) line.textContent = error.message;
        if (status) status.textContent = "AI error";
        showToast(error.message, 6500);
        setSense(micState, "Listening", "ok");
      } finally {
        if (!waitingForReply) armRecording();
      }
    }

    function captureTick() {
      if (!captureWanted || !captureAnalyser) return;
      if (waitingForReply) {
        discardRecording();
        return;
      }
      if (!captureRecorder) {
        armRecording();
        return;
      }

      captureAnalyser.getFloatTimeDomainData(captureBuffer);
      let sum = 0;
      for (const sample of captureBuffer) sum += sample * sample;
      const level = Math.sqrt(sum / captureBuffer.length);
      const now = performance.now();
      // shortcut: fixed RMS threshold; tune if quiet speech is missed or noise starts a clip.
      if (level > 0.012) {
        if (!captureHeardSpeech) {
          captureHeardSpeech = true;
          setSense(micState, "Hearing", "busy");
        }
        captureSilenceSince = 0;
      } else if (captureHeardSpeech && !captureSilenceSince) {
        captureSilenceSince = now;
      }

      const silence = captureSilenceSince ? now - captureSilenceSince : 0;
      const length = now - captureStartedAt;
      if (captureHeardSpeech && silence >= CAPTURE_SILENCE_MS) {
        captureFinalChunk = true;
        setSense(micState, "Transcribing", "busy");
        captureRecorder.stop();
      } else if (!captureHeardSpeech && captureTranscriptChunks.length && length >= CAPTURE_SILENCE_MS) {
        captureFinalChunk = true;
        setSense(micState, "Transcribing", "busy");
        captureRecorder.stop();
      } else if (captureHeardSpeech && length >= 20_000) {
        captureFinalChunk = false;
        setSense(micState, "Transcribing", "busy");
        captureRecorder.stop();
      } else if (!captureHeardSpeech && length >= 20_000) {
        captureRecorder.stop();
      }
    }

    async function openCapture() {
      if (typeof MediaRecorder === "undefined") return false;
      setSense(micState, "Requesting", "busy");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContext();
        if (context.state === "suspended") await context.resume();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        captureStream = stream;
        captureContext = context;
        captureAnalyser = analyser;
        micGranted = true;
        setSense(micState, "Ready", "ok");
        return true;
      } catch (error) {
        micGranted = false;
        const denied = error.name === "NotAllowedError" || error.name === "SecurityError";
        setSense(micState, denied ? "Blocked" : "Unavailable", "error");
        setNote(
          denied
            ? "Microphone permission was blocked. Allow it in browser settings, or enter without it."
            : `Microphone unavailable: ${error.message}`,
          "error",
        );
        return false;
      }
    }

    function startCapture() {
      if (!captureStream) return false;
      listening = true;
      captureWanted = true;
      if (!captureTimer) {
        captureTimer = window.setInterval(captureTick, 100);
        resumeListening = () => {
          if (captureWanted) window.setTimeout(armRecording, 350);
        };
        stopCapture = () => {
          captureWanted = false;
          listening = false;
          captureGeneration++;
          captureTranscriptChunks = [];
          captureLanguageCounts = { en: 0, hi: 0 };
          captureTranscriptionError = null;
          captureTranscriptionQueue = Promise.resolve();
          discardRecording();
          window.clearInterval(captureTimer);
          captureTimer = null;
          captureStream?.getTracks().forEach((track) => track.stop());
          captureStream = null;
          captureAnalyser = null;
          captureContext?.close().catch(() => {});
          captureContext = null;
        };
      }
      armRecording();
      return true;
    }

    async function toggleVoiceControl() {
      const interrupting = currentState.speaking;
      if (waitingForReply && !interrupting) return;

      if (interrupting) {
        stopSpeaking();
        setVoiceCaption("");
        waitingForReply = false;
        currentState = { ...currentState, speaking: false, status: "Listening" };
        post("/api/control", { speaking: false, status: "Listening" }).catch((error) => {
          console.warn("Could not update Twinkle Toes' status:", error);
        });
        resumeListening();
        renderVoiceControl();
        if (listening) return;
      } else if (listening) {
        listening = false;
        if (captureStream) stopCapture();
        else {
          try {
            recognition?.stop();
          } catch (error) {
            if (error.name !== "InvalidStateError") console.error("Could not pause voice input:", error);
          }
        }
        setSense(micState, "Paused");
        renderVoiceControl();
        return;
      }

      if (
        serverSpeech &&
        window.isSecureContext &&
        navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined"
      ) {
        if (!captureStream && !(await openCapture())) return;
        startCapture();
      } else if (recognition) {
        startListening();
      } else {
        showToast("Voice input is unavailable in this browser.", 6000);
      }
      renderVoiceControl();
    }

    voiceOrb?.addEventListener("click", toggleVoiceControl);

    async function startFlow(requestMic) {
      if (starting) return;

      const wantsMic = requestMic && Boolean(recognition || serverSpeech);
      let useServerSpeech =
        wantsMic &&
        serverSpeech &&
        window.isSecureContext &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined";
      const directRecognition =
        wantsMic && (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia);
      starting = true;
      if (startButton) startButton.disabled = true;
      if (startLabel) startLabel.textContent = "Opening...";
      setNote(wantsMic ? "Requesting microphone, screen and motion access..." : "Opening the display...");

      const fullscreenTask = requestFullscreen();
      const tiltTask = enableDeviceTilt();
      let granted = false;

      if (useServerSpeech) {
        granted = await openCapture();
        if (!granted && recognition) {
          granted = await requestMicrophone();
          useServerSpeech = false;
        }
      } else if (directRecognition) {
        if (!recognition) {
          setNote(
            !window.isSecureContext
              ? "Server speech-to-text needs HTTPS. Open the trusted HTTPS address to use the microphone."
              : "This browser cannot record or recognise speech. Use the desktop controller instead.",
            "error",
          );
        } else {
          setSense(micState, "Trying browser voice", "busy");
          setNote("Trying this browser's voice recognition. It may still block microphone access on an HTTP network address.");
          try {
            recognition.start();
            granted = true;
          } catch (error) {
            if (error.name !== "InvalidStateError") {
              console.error("Could not start browser voice recognition:", error);
              setNote(
                !window.isSecureContext
                  ? "The browser refused voice recognition on this HTTP address. Use trusted HTTPS or the desktop controller."
                  : `Couldn't start voice recognition: ${error.message}`,
                "error",
              );
            }
          }
        }
      } else if (wantsMic) {
        granted = await requestMicrophone();
      }

      await Promise.allSettled([fullscreenTask, tiltTask]);
      await requestWakeLock();

      starting = false;
      if (startButton) startButton.disabled = false;

      if (wantsMic && !granted) {
        if (startLabel) startLabel.textContent = startLabelIdle();
        return;
      }

      micGranted = granted && !directRecognition;
      if (granted && useServerSpeech) startCapture();
      else if (granted && !directRecognition) startListening();
      else if (!wantsMic && (recognition || serverSpeech)) setSense(micState, "Skipped");

      enterKiosk();
      if (startLabel) startLabel.textContent = startLabelIdle();
    }

    startButton?.addEventListener("click", () => startFlow(true));
    skipButton?.addEventListener("click", () => startFlow(false));

    let lastCornerTap = 0;
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!inKiosk()) return;
        if (event.clientX < window.innerWidth - 96 || event.clientY > 96) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const now = performance.now();
        if (now - lastCornerTap <= 700) {
          lastCornerTap = 0;
          leaveKiosk();
        } else {
          lastCornerTap = now;
        }
      },
      true,
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && inKiosk()) leaveKiosk();
    });

    document.addEventListener("fullscreenchange", () => {
      setSense(
        screenState,
        document.fullscreenElement ? "Active" : "Windowed",
        document.fullscreenElement ? "ok" : "idle",
      );
    });

    document.addEventListener("visibilitychange", async () => {
      if (
        document.visibilityState === "visible" &&
        !wakeLock &&
        "wakeLock" in navigator &&
        document.fullscreenElement
      ) {
        try {
          wakeLock = await navigator.wakeLock.request("screen");
        } catch (error) {
          console.warn("Could not restore screen wake lock:", error.message);
        }
      }
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) => console.warn("Offline support unavailable:", error.message));
    }
  }

  function setupController() {
    const form = document.querySelector("#chat-form");
    const messageInput = document.querySelector("#message-input");
    const voiceButton = document.querySelector("#voice-button");
    const sayForm = document.querySelector("#say-form");
    const sayInput = document.querySelector("#say-input");

    setupRecognition(voiceButton);

    document.querySelectorAll(".tool-prompts [data-prompt]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!messageInput) return;
        messageInput.value = button.dataset.prompt;
        messageInput.focus();
        messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
      });
    });

    async function sendControl(payload) {
      try {
        await post("/api/control", payload);
      } catch (error) {
        addChatMessage(error.message, "error");
      }
    }

    const moodButtons = [...document.querySelectorAll("#expression-grid [data-expression]")];
    const cycleButton = document.querySelector("#cycle-moods");
    const cycleLabel = "🎭 Cycle 13 moods";
    let moodTimer = 0;
    let moodIndex = 0;

    stopMoodCycle = () => {
      if (!moodTimer) return;
      window.clearInterval(moodTimer);
      moodTimer = 0;
      cycleButton?.setAttribute("aria-pressed", "false");
      if (cycleButton) cycleButton.textContent = cycleLabel;
    };

    function showNextMood() {
      if (moodButtons.length === 0) return;
      const button = moodButtons[moodIndex % moodButtons.length];
      moodIndex = (moodIndex + 1) % moodButtons.length;
      if (button) sendControl({ expression: button.dataset.expression });
    }

    cycleButton?.addEventListener("click", () => {
      if (moodTimer) {
        stopMoodCycle();
        return;
      }
      moodIndex = Math.max(
        0,
        moodButtons.findIndex((button) => button.dataset.expression === currentState.expression),
      );
      showNextMood();
      moodTimer = window.setInterval(showNextMood, 2200);
      cycleButton.setAttribute("aria-pressed", "true");
      cycleButton.textContent = "⏹ Stop mood cycle";
    });

    document.querySelector("#dance-animation").addEventListener("click", () => {
      stopMoodCycle();
      sendControl({ motion: currentState.motion === "dance" ? "float" : "dance" });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = messageInput.value.trim();
      if (!message) return;

      stopMoodCycle();
      messageInput.value = "";
      lastChatError = "";
      const submit = form.querySelector("button");
      submit.disabled = true;
      try {
        await post("/api/chat", { message });
      } catch (error) {
        // The server also broadcasts chat errors; avoid showing the same one twice.
        if (error.message !== lastChatError) addChatMessage(error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });

    sayForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = sayInput.value.trim();
      if (!text) return;
      stopMoodCycle();
      try {
        await post("/api/say", { text });
        sayInput.value = "";
      } catch (error) {
        addChatMessage(error.message, "error");
      }
    });

    document.querySelector("#expression-grid").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-expression]");
      if (!button) return;
      stopMoodCycle();
      sendControl({ expression: button.dataset.expression });
    });

    document.querySelector("#stop-button").addEventListener("click", async () => {
      stopMoodCycle();
      try {
        await post("/api/stop");
      } catch (error) {
        addChatMessage(error.message, "error");
      }
    });
  }

  connectEvents();
  setupSettings();
  if (mode === "display") {
    document.addEventListener("pointerdown", noteDisplayActivity);
    document.addEventListener("keydown", noteDisplayActivity);
    setupDisplay();
    scheduleRestMood(true);
  }
  if (mode === "control") setupController();
})();
