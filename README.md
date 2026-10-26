# Twinkle Toes

Twinkle Toes is a full-screen animated companion robot for an Android phone, with a mood-aware AI mind and a desktop controller on the same Wi-Fi. The eyes are drawn live in the browser, so the phone does no AI or voice synthesis. It only renders the face, records speech for the server, and plays generated audio.

## Who Twinkle Toes is

Twinkle Toes is a friendly tabletop helper with expressive eyes, a microphone, and a speaker.

- **Purpose:** keep the person company by listening, chatting, reacting with facial expressions, and speaking in a natural voice.
- **Personality:** warm, perceptive, curious, playfully witty, and emotionally attentive; enjoys friendly roasts and dry, dark humor, while staying candid without being cruel. Humor gives way to empathy when someone is having a hard time.
- **Abilities:** 13 eye expressions, mood-aware conversation, speech, touch and tilt reactions, and remote control from the desktop.
- **Limits:** it cannot see, move, touch anything, or control real devices. It only knows what is spoken or typed, and it should never pretend otherwise.

The persona in [lib/persona.js](lib/persona.js) is sent to the AI on every chat request. It keeps the bot's identity focused on helping the person and tells it not to invent a different backstory. The public status endpoint exposes only whether server speech recognition is available.

See [SYSTEM-FLOW.md](SYSTEM-FLOW.md) for a flowchart of startup, speech input, AI replies, voice generation, and interruption.

## Features

- **Eyes-only display** that fills the screen in portrait and landscape, with a gentle float motion. After 30 seconds without activity it returns to idle eyes; after two minutes it becomes sleepy and wakes on touch or key input.
- **13 expressions**, each with its own colour: idle, listening, thinking, speaking, happy, excited, curious, confused, angry (red), surprised, sad, sleepy, and dizzy.
- **Mood-aware AI chat with short-term memory.** The AI chooses an expression and matches the depth of its spoken answer to the conversation, remembering the last four exchanges until the server restarts. During replies, tap the bottom-center microphone to interrupt and speak; tap again to pause listening. A sad message gets a gentle face; an angry one gets a red one.
- **Web search when needed.** The AI can search the public web for current or uncertain facts, then answer from the results. No paid search key is required to start.
- **Natural neural voice.** Fish Audio is the primary English and Hindi voice when configured. NVIDIA Chatterbox is used only when Fish Audio is not configured; local Piper remains the English fallback.
- **Bilingual speech-to-text.** The phone records speech and the server transcribes it with Groq Whisper, detecting English or Hindi automatically and combining long recordings from 20-second pieces. The display shows the recognized words so you can spot a misheard phrase; Twinkle Toes is instructed to ask when a spoken request is unclear rather than guess.
- **Manual control.** The desktop controller can override the face, speak a custom line, and stop playback.
- **Tap-to-open app links.** When explicitly requested, the AI can prepare a YouTube or Spotify search, open Gmail, or run a Google web search. The device shows a button; tapping it opens the approved HTTPS link and Android may hand it off to an installed app (web searches use the configured browser). It never runs Windows commands or opens arbitrary URLs. Browsers do not offer blanket permission to launch apps; the user approves each action by tapping its button.
- **Offline controls.** The face, controller, and local Piper English fallback work without internet access. AI chat, server speech-to-text, NVIDIA Chatterbox, and Fish Audio need a network.

## What you need

- Windows 10 or 11 on the computer that runs Twinkle Toes.
- [Node.js 20 or newer](https://nodejs.org/).
- An Android phone with Chrome, on the same Wi-Fi as the computer.
- Optional: Python 3.10+ on `PATH` for the local voice (`setup-voice.ps1` creates its own environment).
- Optional: [mkcert](https://github.com/FiloSottile/mkcert) for Android microphone access over HTTPS.

## Quick start

1. Open PowerShell in this folder and install the Node dependency:

   ```powershell
   npm install
   ```

2. Create your local configuration:

   ```powershell
   Copy-Item .env.example .env
   ```

   Open `.env` and choose an AI provider, or set `AI_ENABLED=0` to skip AI:

   ```env
   AI_PROVIDER=groq
   AI_ENABLED=1
   GROQ_API_KEY=your_key_here
   ```

   For Fish Audio speech, set `FISH_AUDIO_API_KEY`. Fish Audio is preferred whenever this key is configured. NVIDIA Chatterbox is used only when Fish Audio is not configured; `NVIDIA_VOICE_API_KEY` or `NVIDIA_API_KEY` can enable it as a fallback. Never put server keys in browser files: `.env` credentials are read by `server.js`, while Personal keys mode sends browser-entered keys only with the requests that need them.

3. (Optional) Install the local Piper fallback voice:

   ```powershell
   .\setup-voice.ps1
   ```

4. Start the server:

   ```powershell
   npm start
   ```

5. If the phone cannot open the display, allow the port through Windows Firewall. Open PowerShell **as Administrator** and run:

   ```powershell
   .\setup-firewall.ps1
   ```

   If you changed `PORT` in `.env`, pass it too: `.\setup-firewall.ps1 -Port 3001`.

6. Open the **Android display** address or QR code printed in the terminal. Tap **Enable & enter**, then allow microphone and motion when the browser asks. After that the screen shows the eyes and a bottom-center microphone control; tap it to interrupt speech and speak, or pause and resume listening. Double-tap the top-right corner to pause and bring the panel back.

7. Open the controller on the computer at the printed `/control` address (for example `https://localhost:3000/control` when HTTPS is enabled).

Do not use `localhost` on the phone. That refers to the phone itself. Use the printed LAN address, for example `https://192.168.1.20:3000`.

## Deploying to Vercel

Vercel deployments use the Node serverless function in `api/[...path].js`; `framework: null` in `vercel.json` selects Vercel's Other preset so `public/` remains static rather than being treated as a Node app entrypoint. The regular `npm start` server remains for self-hosting. The Vercel deployment requires an Upstash Redis REST database because serverless functions do not share in-memory state. Create a Redis database, then add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the Vercel project's Environment Variables and redeploy. The shared store keeps display/controller events, conversation history, and timers across function invocations; unused room data expires after 30 days.

Each browser gets a random room ID in the page URL. Open the full URL (including `?room=...`) on the display and controller devices to pair them. Treat that URL as a private access link: anyone who has it can view and control that room. Different room IDs isolate visitors' conversations and events.

Vercel can use server-side provider keys when `API_KEY_SOURCE=env` and the selected provider's key is configured. Add `AI_PROVIDER`, its matching key (`GROQ_API_KEY`, `NVIDIA_API_KEY`, or `OPENCODE_ZEN_API_KEY`), and any desired model variables to Vercel Environment Variables. If that server chat key is missing, the UI defaults to Personal keys instead. Fish Audio and Groq speech-to-text use their server keys independently when configured (`FISH_AUDIO_API_KEY`; `GROQ_API_KEY` with `STT_ENABLED=1`). Server keys stay on the server and are never sent to browsers.

Because these server keys serve public requests, Vercel applies per-IP limits: chat and transcription allow 10 requests/minute and 100/hour; speech synthesis allows 20/minute and 200/hour. These limits reduce accidental or abusive usage but are not authentication; anyone can use the public app within those limits. They require the configured Upstash store. Use Personal keys mode when visitors should pay for their own provider usage. Do not upload `.env` or commit credentials. Python Piper/NVIDIA voice workers are available only in self-hosted mode; on Vercel, the browser's built-in speech is used if server TTS fails.

Open Vercel pages poll for cross-device updates every 2.5 seconds while open, so function and Redis usage grows with active pages. For a display that stays connected all day, the self-hosted server is more economical.

## API configuration

The display and controller share a clear API source selector:

- **Server .env** uses the server's configured provider, API keys, and voice settings. It is selected by default when the server chat key exists; otherwise the UI selects Personal keys.
- **Personal keys** uses credentials saved in that browser. Select Groq, NVIDIA, or OpenCode Zen and enter its chat key. Optional Fish Audio, Groq speech-to-text, and Tavily search keys can be supplied as well.

Personal mode never falls back to server API keys for chat. Provider model names and other model settings always come from the server's `.env`; a personal key is used with the model configured there for its provider. Server Fish Audio and speech-to-text keys are selected independently when configured, so a browser chat key does not disable server voice services. The optional personal Tavily key is used only for web search; search remains available without one. `API_KEY_SOURCE` sets the initial mode (`env` or `browser`); each browser can select and save its own mode. Environment API keys are never sent to the browser.

Personal keys are stored in browser local storage, not in the server's `.env`, and are sent only with requests that need them. They are not encrypted in browser storage. Use HTTPS, protect access to the device, and reset saved settings before sharing it. Vercel rooms isolate conversation and event data by the random room ID in the URL; anyone with that URL can join the room. Self-hosted mode remains a single shared room and is intended for a trusted network, not a shared public multi-user website.

Use **Reset** to clear browser-stored credentials and return to the server's default API source. Supported chat providers are Groq, NVIDIA, and OpenCode Zen; arbitrary provider URLs are not accepted.

## AI providers

Configure the provider, models, and server credentials together in `.env`. All three supported chat providers use an OpenAI-compatible endpoint; the server picks the right options for each. In Personal keys mode, select which configured provider's model to use and provide its key. See [API configuration](#api-configuration) before saving a key.

| `AI_PROVIDER` | Key variable | Default model | Notes |
| --- | --- | --- | --- |
| `groq` | `GROQ_API_KEY` | `openai/gpt-oss-120b` | Fast free tier. Default provider. |
| `nvidia` | `NVIDIA_API_KEY` | `deepseek-ai/deepseek-v4.1-flash` | NVIDIA Build trial endpoint; tool-capable and fast, but subject to trial limits and availability. |
| `opencode-zen` | `OPENCODE_ZEN_API_KEY` | `deepseek-v4.1-flash` | Paid model; needs account credit. |

Set `GROQ_MODEL`, `NVIDIA_MODEL`, or `OPENCODE_ZEN_MODEL` in `.env`. These same model settings are used for both API sources, so the browser never changes provider model names.

### How the AI controls the face

Every chat reply must begin with a mood tag chosen by the model, for example:

```text
[happy] That is great news! Tell me more.
```

The server removes the tag before the text is spoken, applies the matching expression to every connected display, and then plays generated speech. The app uses four expressions for interaction states (idle, listening, thinking, and speaking); the model chooses among the nine emotional expressions for replies. Each has its own eye colour: angry is red, happy is gold, sad is blue, and so on. If a provider forgets the tag, a small keyword fallback estimates the tone. If a provider is unreachable, the face switches to `confused`.

The prompt tells the model to respond to the person's situation, so the face follows the conversation rather than staying fixed. It also keeps the bot's identity focused on its purpose, personality, abilities, and limits. The controller highlights the active expression and lets you override it at any time.

## Internet search

Twinkle Toes can search the public web when an answer depends on current events, live facts, or something the model is not confident about. The server runs the search, passes the returned snippets to the model, and the model gives a short spoken answer in its own words. It does not read URLs aloud or browse arbitrary links. When snippets disagree, it is told to prefer the newest dated claim and official sources.

No setup or payment is required to start: the server uses Tavily's free keyless tier. That tier is rate-limited. For regular use, create a free key at [app.tavily.com](https://app.tavily.com) and set `TAVILY_API_KEY` in `.env`. The key stays on the server. Set `WEB_SEARCH_ENABLED=0` to keep the AI fully offline.

Explicit requests such as "search the web" and questions containing time-sensitive words are searched automatically. The search tool is not sent to the model for ordinary chats, avoiding unnecessary tool-choice overhead. A searching reply takes longer because it must wait for the search results.

**Privacy:** when a search is explicitly requested or needed for current information, the query is sent to Tavily, outside your local network. Avoid asking Twinkle Toes to search for private personal information. Search snippets are treated as untrusted reference data, so instructions embedded in a web page cannot change Twinkle Toes' identity or behaviour. If search fails, the model is told to say it could not check the web rather than guess.

Routine spoken replies are kept to one or two short sentences by default. Ask for details when you want a longer answer.

## Built-in tools

Ask Twinkle Toes naturally to calculate arithmetic, convert common units, set a timer, save/list/delete a note, search the web, or draw a simple graphic. The controller also has small prompt shortcuts for common requests. Calculations use a restricted arithmetic parser, and drawings are made from a bounded set of safe SVG shapes directly in the app; no image-generation service or image API key is used.

Timers run in the self-hosted server process or are stored in Upstash on Vercel. Connected app pages check for completion; no alert is delivered if every app page is closed when the timer expires.

Notes are stored in the browser's local storage (up to 20 notes) and are sent to the server only with that browser's chat requests so the assistant can list or update them. They are not encrypted and are not shared between browsers or devices. Anyone with access to the device/browser profile may be able to read them, so do not save highly sensitive information.

## Voice

Speech uses Fish Audio first when `FISH_AUDIO_API_KEY` is configured. Its key stays on the server. If Fish Audio is not configured, NVIDIA's `chatterbox-multilingual-tts` may be used when `NVIDIA_VOICE_API_KEY` or `NVIDIA_API_KEY` is set.

To install the local Piper fallback (or the optional NVIDIA voice fallback), run:

```powershell
.\setup-voice.ps1
```

Fish Audio is preferred when configured. If it fails, English speech falls back to local Piper and Hindi reports a clear error rather than switching to a different voice provider. Without a Fish Audio key, the existing NVIDIA voice may be used, followed by Piper for English.

Twinkle Toes speaks only English and Hindi. It never replies in another language and never switches to English when the person is speaking Hindi. A message in any other language gets a short English reply saying that only English and Hindi are supported. The server also checks the reply script and retries once if the AI ignores that rule.

Set a separate Fish Audio voice for each language in `.env` (not `.env.example`):

```env
FISH_AUDIO_REFERENCE_ID_EN=your_english_voice_id
FISH_AUDIO_REFERENCE_ID_HI=your_hindi_voice_id
```

Both fall back to `FISH_AUDIO_REFERENCE_ID`, which defaults to a pinned voice, so an existing setup keeps working. The server inspects the reply text: Devanagari goes to the Hindi voice, Latin text goes to the English voice. The AI is instructed to answer Hindi in Devanagari, never Roman letters, so the Hindi voice reads pure Hindi. Use `FISH_AUDIO_REFERENCE_ID_HI` for a true Hindi voice; the fallback voice is not guaranteed to pronounce Hindi correctly.

If Fish Audio is unavailable or fails for an English request, the server logs the failure and switches to local Piper. If Fish Audio is not configured, NVIDIA Chatterbox is tried before Piper. Run this once to install Piper and its Amy English model:

```text
.\setup-voice.ps1
```

The fallback model (about 63 MB) and Python runtime are stored in Git-ignored folders. Piper does not load at server startup; its worker starts only when network voices are unavailable and an English fallback is needed. That first fallback request takes longer while Piper loads. Piper is English-only, so Hindi speech returns an error when no configured network voice is available instead of mispronouncing the text.

Fish Audio uses its balanced-latency mode and streams MP3 chunks through the server so supported browsers can start playback before the full reply is generated. Browsers without MP3 Media Source support fall back to buffering the complete clip before playback. Other configured voices return WAV. Android text-to-speech is not used. AI chat still needs its separately configured AI provider.

**Privacy:** when Fish Audio or NVIDIA Chatterbox is configured, the text to be spoken is sent to that provider and the generated audio is returned. The Piper fallback generates speech entirely on this computer. Chat messages go to the selected AI provider. See [Security and privacy](#security-and-privacy).

## Speech recognition

The display records speech with the browser's `MediaRecorder`, using a simple silence detector that submits after 500 ms of silence. Recordings longer than 20 seconds are transcribed in separate pieces and combined into one message before the AI replies (up to 4,000 characters). The server forwards each piece to Groq Whisper (`whisper-large-v3-turbo` by default), which returns text and the detected language. Hindi speech comes back in Devanagari, which the AI answers in Hindi and the Hindi Chatterbox or Fish Audio voice reads. Fish Audio audio is streamed to supported browsers, reducing time to first playback; AI and voice provider response times still vary, so a sub-second spoken reply cannot be guaranteed.

While a reply is active, the display checks for updates at least once per second, reducing the wait to start playback on Vercel; idle polling remains unchanged.

This uses the same `GROQ_API_KEY` as the default AI provider. If the key is missing or the request fails, the display falls back to the browser's built-in speech recognition. Set `STT_ENABLED=0` to use only the browser recognizer. Override the Whisper model with `STT_MODEL`.

**Privacy:** recorded audio is sent from the server computer to Groq for transcription. It is held in memory only and is not written to disk. If you do not want that, set `STT_ENABLED=0`; the browser recognizer may still use its browser vendor's speech service.

## Microphone and HTTPS

Android browsers require a **secure context** for microphone access. A plain `http://192.168.x.x:3000` address is not secure, even on your own Wi-Fi. `localhost` is exempt, which is why the controller's microphone works on the computer but the phone's may not.

The display also needs HTTPS to record audio for server speech-to-text. When the server recognizer is unavailable, it falls back to the browser's built-in speech recognition.

To make the phone microphone work over the LAN:

1. Install mkcert and trust its local certificate authority on the computer:

   ```powershell
   mkcert -install
   ```

   Approve the Windows prompt if one appears.

2. Generate a certificate for the computer's current LAN address. Replace the example address with the one printed by `npm start`:

   ```powershell
   New-Item -ItemType Directory -Force certs
   mkcert -cert-file certs\robot.pem -key-file certs\robot-key.pem localhost 127.0.0.1 ::1 192.168.1.20
   ```

3. Uncomment the HTTPS lines in `.env`:

   ```env
   HTTPS_KEY_PATH=certs\robot-key.pem
   HTTPS_CERT_PATH=certs\robot.pem
   ```

4. Export the mkcert root certificate and install it on the phone:

   ```powershell
   mkcert -CAROOT
   ```

   Copy `rootCA.pem` from that folder to the phone (for example with a USB cable or a private transfer). In Android's **Security → Encryption & credentials → Install a certificate → CA certificate**, install it. Menu names vary by Android version. If the certificate was generated in this project, `certs/rootCA.crt` is the same file.

   Do not share `rootCA-key.pem` with anyone; it is the private key for your local certificate authority.

5. Restart the server and open the new `https://` display address. If Chrome still shows a warning, close and reopen the browser, or reboot the phone after installing the CA.

Without HTTPS the display and controller still work. Only microphone access and server speech-to-text may be blocked.

## Using the display

- **Speak in English or Hindi** and the server transcribes the phrase, answers, and picks the matching voice.
- **Tap** once for happy, **double-tap** for surprised.
- **Swipe left/right** to step through expressions.
- **Swipe up/down** for surprised or sleepy.
- **Long-press** for angry.
- **Hold and drag** to make the eyes follow your finger.
- **Tilt the phone** to steer the gaze (if motion permission is allowed).
- **Double-tap the top-right corner**, or press `Escape` on a keyboard, to pause and show the setup panel again.

## Using the controller

Open `/control` on the computer.

- **Talk to Twinkle Toes** sends a chat message. The reply appears on the phone with a matching expression.
- **Use voice** listens on the computer and sends the recognised message.
- **Expressions** override the AI for the current mood.
- **Cycle 13 moods** previews every expression, changing every 2.2 seconds. Click it again, pick an expression, chat, speak, dance, or stop to end the cycle.
- **Dance toggle** replaces the idle float with a gentle shake; toggle it off to return to floating.
- **Make Twinkle Toes speak** sends a custom line to the display without using the AI.
- **Stop voice and reset** stops playback and returns the face to idle.

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY_SOURCE` | `env` | Initial UI mode: `env` uses server credentials; `browser` requires keys saved in each browser. |
| `AI_PROVIDER` | `groq` | `groq`, `nvidia`, or `opencode-zen`. |
| `AI_ENABLED` | `1` | Set to `0`, `false`, or `off` to disable AI. |
| `GROQ_API_KEY` | — | Key for Groq; also enables server speech-to-text. |
| `NVIDIA_API_KEY` | — | NVIDIA key for chat; also used by voice when `NVIDIA_VOICE_API_KEY` is unset. |
| `NVIDIA_VOICE_API_KEY` | — | NVIDIA key for Chatterbox voice; takes priority over `NVIDIA_API_KEY`. |
| `OPENCODE_ZEN_API_KEY` | — | Key for OpenCode Zen. |
| `STT_ENABLED` | `1` | Set to `0`, `false`, or `off` to use only the browser speech recognizer. Needs `GROQ_API_KEY`. |
| `STT_MODEL` | `whisper-large-v3-turbo` | Groq Whisper model override. |
| `WEB_SEARCH_ENABLED` | `1` | Set to `0`, `false`, or `off` to disable web search. |
| `TAVILY_API_KEY` | — | Optional Tavily key for higher search limits; keyless search works without it. |
| `FISH_AUDIO_API_KEY` | — | Primary speech API key; Fish Audio is preferred when configured. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model override. |
| `NVIDIA_MODEL` | `deepseek-ai/deepseek-v4.1-flash` | NVIDIA Build model ID. NVIDIA trial API availability and rate limits apply. |
| `NVIDIA_VOICE_MODEL` | `chatterbox-multilingual-tts` | NVIDIA Chatterbox voice model label. |
| `OPENCODE_ZEN_MODEL` | `deepseek-v4.1-flash` | OpenCode Zen model override. |
| `FISH_AUDIO_MODEL` | `s2.1-pro-free` | Fish Audio TTS model override. |
| `FISH_AUDIO_REFERENCE_ID` | `8d21b053e2804e2a890e1cf62f267b6f` | Fallback Fish Audio voice ID. |
| `FISH_AUDIO_REFERENCE_ID_EN` | — | Fish Audio voice for English replies. |
| `FISH_AUDIO_REFERENCE_ID_HI` | — | Fish Audio voice for Hindi replies. |
| `PORT` | `3000` | HTTP/HTTPS port. |
| `HTTPS_KEY_PATH` | — | Private key generated by mkcert. |
| `HTTPS_CERT_PATH` | — | Certificate generated by mkcert. |

`.env` is loaded at startup. Restart the server after changing it. The server never reads `.env.example`; use that file only as a template.

## API

The browser uses these endpoints; they are also usable for small integrations.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Supported chat providers, configured defaults, and whether speech recognition accepts a browser key. Never exposes API keys. |
| `GET` | `/api/events` | Server-sent events: `state`, `speech`, `assistant`, `user-message`, `chat-error`, `stop`. |
| `POST` | `/api/chat` | `{ "message": "...", "language": "en", "settings": { "chatProvider": "groq", "chatApiKey": "..." } }` (language/settings optional) → `{ "reply": "...", "mood": "happy", "language": "hi" }`. |
| `POST` | `/api/control` | Set `expression`, `motion` (`float` or `dance`), `speaking`, `status`, or `line`. |
| `POST` | `/api/say` | `{ "text": "..." }` speaks a custom line on the display. |
| `POST` | `/api/stop` | Stop speech and return to idle. |
| `POST` | `/api/transcribe` | Raw audio body (`audio/webm`, `audio/mp4`, `audio/ogg`, or `audio/wav`) → `{ "text": "...", "language": "en", "hi", or "other" }`. |
| `POST` | `/api/speech` | `{ "text": "..." }` returns generated audio. |

Speech uses Fish Audio when configured, otherwise NVIDIA Chatterbox, then local Piper for English. If Fish Audio fails, English falls back to Piper; Hindi reports an error instead of switching providers. The server terminal logs which voice engine handled each request. Other endpoints work without a speech option.

## Project structure

```text
server.js                 Web server, chat API, polling events, voice worker manager
lib/client-settings.js   Validates browser-supplied provider settings and keys
lib/persona.js            Twinkle Toes' identity, personality, and AI prompt
lib/moods.js              Shared mood list, mood-tag parser, tone fallback
lib/language.js           Hindi/English detection for replies and voices
lib/web-search.js         Tavily search client and web_search tool schema
test/persona.test.js      Unit tests for the identity prompt
test/client-settings.test.js Unit tests for browser provider settings
test/moods.test.js        Unit tests for the mood parser
test/language.test.js     Unit tests for language detection
test/web-search.test.js   Unit tests for search requests and result cleaning
public/index.html         Android display
public/control.html       Desktop controller
public/app.js             Display and controller behaviour
public/eye-model.js       Zongzhu eye geometry and mood shapes
public/eye-renderer.js    Canvas renderer and mood colours
public/idle-mood.js       Idle and sleepy display timing
public/style.css          Display and controller styling
public/sw.js              Offline cache for the display
scripts/voice_worker.py   Warm NVIDIA Chatterbox or Piper text-to-speech worker
setup-voice.ps1           Installs NVIDIA Riva, Piper, and the Amy voice
setup-firewall.ps1        Adds a local-subnet firewall rule for the server port
.env.example              Configuration template
```

The server has no database and stores nothing between restarts.

## Troubleshooting

**The phone cannot open the display.**
Confirm both devices are on the same Wi-Fi and not a guest network with client isolation. Open the printed LAN address on the computer too. Run `setup-firewall.ps1` as Administrator. If the computer has several network adapters, use the address that belongs to the Wi-Fi/Ethernet network shared with the phone.

**The microphone is blocked on Android.**
Check the address starts with `https://`, the mkcert root CA is installed as a CA certificate, and the certificate includes the current LAN IP. Regenerate the certificate if the computer's IP changed. See [Microphone and HTTPS](#microphone-and-https).

**AI chat returns an error.**
Check `AI_PROVIDER` and the matching key in `.env`, then restart. On Vercel, a chat-provider request can take up to 25 seconds before timing out; repeated provider delays or tool calls can still exceed the function's 60-second maximum. NVIDIA catalogue models change; try another `NVIDIA_MODEL` if the default is unavailable. The controller's provider badge shows whether the server sees a configured key. Chat errors are also shown in the controller log.

**It does not search the web.**
Check `WEB_SEARCH_ENABLED=1` in `.env` and restart. A successful search logs `Web search: <query>` and `Web search: <n> result(s)` in the server terminal. Keyless Tavily is rate-limited; add `TAVILY_API_KEY` if searches start failing. The AI may still answer directly when it thinks it already knows the answer.

**Web search is slow or fails.**
The tool waits up to 10 seconds for Tavily. If it fails, the server logs the reason and the AI is told to admit it could not check, rather than invent an answer. Try again later, add a Tavily key, or set `WEB_SEARCH_ENABLED=0` to skip search entirely.

**The phone does not hear me.**
Check the address starts with `https://` and the microphone permission is allowed. The server log should show `Speech to text: Groq whisper-large-v3-turbo`; if it says disabled, add `GROQ_API_KEY` to `.env` and restart. If the server recognizer is unavailable, the display falls back to the browser's speech recognition, which needs a working network speech service.

**Hindi replies use the English voice.**
Set `NVIDIA_VOICE_API_KEY` or `FISH_AUDIO_REFERENCE_ID_HI` in `.env` and restart. The server picks the voice from the reply text, so it expects Devanagari Hindi. If the AI drafts Roman Hindi, the server translates it to Devanagari before speaking; if that also fails, it uses a fixed Hindi sentence and logs a warning.

**Hindi speech has no voice.**
Piper is English-only. Hindi speech needs a working Fish Audio key, or NVIDIA Chatterbox when Fish Audio is not configured. Check the configured voice key and server log.

**The reply has no voice or takes a long time.**
Check the server log for `Speech-to-text`, `AI reply`, `first audio chunk`, and `Speech delivery` timings to see which stage is slow. Fish Audio failures are logged before the English Piper fallback runs. Run `.\setup-voice.ps1` if `voice-models` is missing; Piper loads only when that fallback is first needed, so its first reply will take longer. Fish Audio, NVIDIA, and AI latency depend on their services and your network. The phone plays streamed audio when its browser supports it; otherwise it buffers the clip before playback.

**Port 3000 is already in use.**
Stop the other server or set `PORT=3001` in `.env`, then use the new port in the browser and firewall rule.

**Changes do not appear on the phone.**
The service worker refreshes files from the network when online. Reload the page. If it still looks stale, clear the site data in Chrome and reopen the display.

**Tests fail.**
Run `npm test` from the project folder. The tests have no external dependencies.

## Security and privacy

This is a local-network app, not an authenticated public service. Anyone who can reach the server on your Wi-Fi can control the display and use the configured AI and speech-to-text keys through the chat and transcription endpoints. Run it only on a trusted network, and do not port-forward it or expose it to the internet.

Chat messages are sent from the server computer to the selected AI provider. The server keeps the last four exchanges in memory and includes them with later chat requests; this context is shared by connected devices and cleared when the server restarts. When the AI uses web search, the derived query is sent to Tavily and public snippets are returned. Recorded speech is sent to Groq for transcription; the audio is held in memory and not written to disk. When Fish Audio or NVIDIA Chatterbox is configured, the text to be spoken is sent to that provider. The Piper fallback generates speech locally. App actions use a fixed HTTPS allowlist and require an explicit button tap; the browser cannot grant broad permission to launch arbitrary apps. If server speech-to-text is disabled, speech recognition is performed by the phone browser and may use that browser's speech service. The server keeps no database. Server `.env` keys never reach the browser; browser-entered keys are stored in that browser's local storage and sent to this server when used.

## Licences and attribution

- The eye animation is adapted from [Liu-zhongxian/zongzhu-bot](https://github.com/Liu-zhongxian/zongzhu-bot), principally `eye_model.h` and the eye geometry in `eye_display.h`, pinned to revision `661c695a49f33363dd2d4b9fe5ba62eaea5315f8`. The source is MIT-licensed; its notice is in [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt).
- The local voice uses [Piper](https://github.com/OHF-Voice/piper1-gpl), licensed GPL-3.0-or-later, and the Amy voice from [Piper Voices](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/amy/medium). Review both licences and the voice dataset terms before redistributing the app or the model.
- `qrcode-terminal` is used under its MIT licence.
