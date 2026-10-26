(() => {
  "use strict";

  const DEFAULT_WAKE_NOTE = "Speak English or Hindi; the server transcribes your voice and replies aloud.";
  const CAPTURE_SILENCE_MS = 500;
  const MAX_VOICE_TRANSCRIPT_CHARS = 4000;
  const SETTINGS_STORAGE_KEY = "twinkle-toes-settings-v1";
  const { IDLE_AFTER_MS, SLEEPY_AFTER_MS, restingMoodFor } = window.TwinkleIdleMood;
  const mode = document.body.dataset.mode;
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
  let speechGeneration = 0;
  let audioPlayback = null;
  let speechAbort = null;
  let lastChatError = "";
  let userSettings = {};
  let idleMoodTimer = 0;
  let idleSince = 0;

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

  function loadUserSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
      return {
        chatProvider: ["groq", "nvidia", "opencode-zen"].includes(stored.chatProvider)
          ? stored.chatProvider
          : "",
        chatApiKey: typeof stored.chatApiKey === "string" ? stored.chatApiKey : "",
        fishAudioApiKey: typeof stored.fishAudioApiKey === "string" ? stored.fishAudioApiKey : "",
        sttApiKey: typeof stored.sttApiKey === "string" ? stored.sttApiKey : "",
      };
    } catch (error) {
      console.warn("Could not read saved provider settings:", error.message);
      return {};
    }
  }

  function sttApiKey() {
    return userSettings.sttApiKey ||
      (userSettings.chatProvider === "groq" ? userSettings.chatApiKey : "") ||
      "";
  }

  function refreshServerSpeech() {
    serverSpeech = configuredServerSpeech || (acceptsBrowserSttKey && Boolean(sttApiKey()));
    renderVoiceControl();
  }

  function settingsFor(endpoint) {
    if (endpoint === "/api/chat") {
      return {
        chatProvider: userSettings.chatProvider,
        chatApiKey: userSettings.chatApiKey,
      };
    }
    if (endpoint === "/api/speech") {
      return {
        fishAudioApiKey: userSettings.fishAudioApiKey,
        nvidiaVoiceApiKey:
          userSettings.chatProvider === "nvidia" ? userSettings.chatApiKey : "",
      };
    }
    return {};
  }

  function setupSettings() {
    const form = document.querySelector("#settings-form");
    if (!form) return;
    const panel = document.querySelector("#setup-panel");
    const providerSelect = document.querySelector("#chat-provider");
    const chatKey = document.querySelector("#chat-api-key");
    const fishKey = document.querySelector("#fish-audio-api-key");
    const sttKey = document.querySelector("#stt-api-key");
    const status = document.querySelector("#settings-status");
    const summary = document.querySelector("#setup-summary-note");
    const inputs = [chatKey, fishKey, sttKey].filter(Boolean);
    let providerWasChanged = false;
    userSettings = loadUserSettings();

    if (providerSelect) providerSelect.value = userSettings.chatProvider || "groq";
    if (chatKey) chatKey.value = userSettings.chatApiKey || "";
    if (fishKey) fishKey.value = userSettings.fishAudioApiKey || "";
    if (sttKey) sttKey.value = userSettings.sttApiKey || "";
    if (userSettings.chatApiKey || userSettings.fishAudioApiKey || userSettings.sttApiKey) {
      if (panel) panel.open = false;
      if (summary) summary.textContent = "Personal keys saved in this browser";
    }

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
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = {
        chatProvider: providerSelect?.value || "groq",
        chatApiKey: chatKey?.value.trim() || "",
        fishAudioApiKey: fishKey?.value.trim() || "",
        sttApiKey: sttKey?.value.trim() || "",
      };
      if (Object.values(next).some((value) => typeof value === "string" && value) && !window.isSecureContext) {
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
        if (status) {
          status.textContent = "Settings saved in this browser. Keys are sent only with the requests that need them.";
          status.dataset.tone = "success";
        }
        if (summary) {
          summary.textContent = next.chatApiKey || next.fishAudioApiKey || next.sttApiKey
            ? "Personal keys saved in this browser"
            : `Provider preference saved: ${next.chatProvider}`;
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
        if (panel) panel.open = true;
        if (summary) summary.textContent = "Add your own keys or use the server defaults";
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
      refreshServerSpeech();
      if (providerSelect) providerSelect.value = userSettings.chatProvider || providerSelect.value;
      if (chatKey) chatKey.value = userSettings.chatApiKey || "";
      if (fishKey) fishKey.value = userSettings.fishAudioApiKey || "";
      if (sttKey) sttKey.value = userSettings.sttApiKey || "";
    });

    fetch("/api/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) return;
        if (providerSelect && !userSettings.chatProvider && !providerWasChanged && data.chat?.defaultProvider) {
          providerSelect.value = data.chat.defaultProvider;
        }
        if (summary && !userSettings.chatApiKey && !userSettings.fishAudioApiKey && !userSettings.sttApiKey) {
          summary.textContent = !data.chat?.enabled
            ? "AI chat is disabled in server settings"
            : data.chat?.configured
              ? `Server default: ${data.chat.defaultProvider} · add personal keys if desired`
              : `Selected: ${providerSelect?.value || data.chat?.defaultProvider || "provider"} · add a key to start`;
        }
      })
      .catch((error) => console.warn("Could not load provider status:", error.message));
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
    const body = endpoint === "/api/chat" || endpoint === "/api/speech"
      ? { ...payload, settings: settingsFor(endpoint) }
      : payload;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
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

    fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, settings: settingsFor("/api/speech") }),
      signal: speechAbort.signal,
    })
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
        setNote(error.message, "error");
        showToast(error.message, 7000);
        finishSpeech(generation);
      });
  }

  function stopSpeaking() {
    speechGeneration++;
    clearAudio();
  }

  function connectEvents() {
    const events = new EventSource("/api/events");
    const on = (name, handler) => {
      events.addEventListener(name, (event) => {
        try {
          handler(JSON.parse(event.data));
        } catch (error) {
          console.error(`Invalid ${name} event:`, error);
        }
      });
    };

    events.onopen = () => {
      connection.textContent = "Connected";
      connectionWrap.classList.add("connected");
    };
    events.onerror = () => {
      connection.textContent = "Reconnecting";
      connectionWrap.classList.remove("connected");
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
