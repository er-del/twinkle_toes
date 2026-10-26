// Twinkle Toes speaks only English and Hindi. Devanagari is Hindi, Latin is English;
// any other writing system is treated as an unsupported language.
const DEVANAGARI = /[\u0900-\u097F]/;
const LATIN = /[A-Za-z\u00C0-\u024F]/;
const LETTER = /\p{L}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const DEVANAGARI_SCRIPT = /\p{Script=Devanagari}/u;

// Latin-script phrases that are clearly not English. Short text is not reliable
// enough for a statistical language detector, so only distinctive phrases are used.
const OTHER_LATIN =
  /(?<!\p{L})(bonjour|bonsoir|salut|merci|comment vas-tu|comment allez-vous|ça va|je suis|vous êtes|s'il vous plaît|hola|gracias|cómo estás|como estas|qué tal|buenos días|buenas noches|por favor|hallo|danke|wie geht|guten tag|guten morgen|ciao|grazie|come stai|buongiorno|buonasera|olá|obrigado|obrigada|como você|bom dia|boa noite|merhaba|teşekkür|nasılsın|günaydın|selamat pagi|terima kasih|apa kabar)(?!\p{L})/iu;
const ROMAN_HINDI =
  /(?<!\p{L})(namaste|namaskar|aap|aapka|aapki|aapko|kaise|kaisa|kaisi|kahan|kab|kyun|kyon|kya|mujhe|mujhse|tum|tumhe|mera|meri|mere|hum|hai|hain|hoon|ho|haan|nahi|nahin|bahut|accha|achha|theek|shukriya|dhanyavad|kripya|kyunki|raha|rahi|rahe|karna|karo|kya haal|mera naam|main theek|theek hoon|theek hai)(?!\p{L})/iu;
const CLEAR_ENGLISH =
  /\b(hello|hi there|good morning|good evening|how are you|what|where|when|why|who|thank you|please|can you|tell me|I am|I feel|I need|I want|the|you|your|are|is|this|that|and|but|because|do|does|did|have|has|will|would|should|could)\b/i;

// Common English words inside a Hindi reply mean the model mixed languages.
const ENGLISH_IN_HINDI =
  /\b(the|is|are|am|you|your|how|what|why|this|that|and|with|for|from|have|will|can|could|would|should|hello|sorry)\b/i;

// Script only: used to check the language of a reply without guessing.
function detectScriptLanguage(text) {
  const value = String(text || "");
  if (DEVANAGARI.test(value)) return "hi";
  if (LATIN.test(value)) return "en";
  if (LETTER.test(value)) return "other";
  return "en";
}

function containsUnsupportedScript(text) {
  return [...String(text || "")].some(
    (character) =>
      LETTER.test(character) &&
      !LATIN_SCRIPT.test(character) &&
      !DEVANAGARI_SCRIPT.test(character),
  );
}

function detectLanguage(text) {
  const value = String(text || "");
  if (DEVANAGARI.test(value) || ROMAN_HINDI.test(value)) return "hi";
  const script = detectScriptLanguage(value);
  if (script !== "en") return script;
  return OTHER_LATIN.test(value) ? "other" : "en";
}

function normalizeLanguage(value) {
  const code = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "hi" || code === "hindi") return "hi";
  if (code === "en" || code === "english") return "en";
  return code ? "other" : "";
}

function resolveLanguage(provided, text) {
  const normalized = normalizeLanguage(provided);
  const value = String(text || "");
  const detected = detectLanguage(value);
  if (detected === "hi" || detected === "other") return detected;
  if (CLEAR_ENGLISH.test(value)) return "en";
  if (normalized === "hi") return "hi";
  return normalized || detected;
}

function replyMatchesLanguage(text, language) {
  const detected = detectScriptLanguage(text);
  if (containsUnsupportedScript(text)) return false;
  if (language === "hi") {
    return detected === "hi" && !ENGLISH_IN_HINDI.test(text) && !OTHER_LATIN.test(text);
  }
  return detected === "en" && !OTHER_LATIN.test(text);
}

module.exports = { detectLanguage, normalizeLanguage, resolveLanguage, replyMatchesLanguage };
