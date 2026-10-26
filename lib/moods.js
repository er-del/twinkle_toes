const MOODS = Object.freeze([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "happy",
  "excited",
  "curious",
  "confused",
  "angry",
  "surprised",
  "sad",
  "sleepy",
  "dizzy",
]);

const moodSet = new Set(MOODS);

// Matches tags such as [angry], [[mood:angry]], or **[angry]** at the start of a reply.
const MOOD_TAG = /^\s*(?:\*\*)?\[+\s*(?:mood\s*:\s*)?([a-z]+)\s*\]+(?:\*\*)?[\s:.-]*/i;

// Any stray mood tag left inside the spoken text must not be read aloud.
const MOOD_TAG_ANY = /\[+\s*(?:mood\s*:\s*)?([a-z]+)\s*\]+/gi;
const BARE_MOOD = new RegExp(`^(${MOODS.join("|")})(?![a-z])[\\s:.-]*`, "i");

// Used only when the provider forgets the tag. Negative feelings are checked before positive ones.
const MOOD_HINTS = [
  ["angry", /\b(angry|furious|mad|annoyed|unfair|hate)\b/i],
  ["sad", /\b(sad|sorry|upset|cry|lonely|miss|grief)\b/i],
  ["dizzy", /\b(dizzy|spinning|overwhelmed|chaos|chaotic|wild|crazy)\b/i],
  ["surprised", /\b(surprised|unbelievable|whoa|no way)\b/i],
  ["excited", /\b(excited|amazing|awesome|yay|can't wait)\b/i],
  ["confused", /\b(confused|unclear|don't understand|not sure)\b/i],
  ["sleepy", /\b(sleepy|tired|sleep|bedtime|good night)\b/i],
  ["curious", /\b(curious|why|how|wonder|interesting)\b/i],
  ["happy", /\b(happy|glad|great|love|wonderful|fun|funny|joke|laugh|nice)\b/i],
];

// Devanagari has no ASCII word boundaries, so these patterns are separate.
const HINDI_MOOD_HINTS = [
  ["angry", /(गुस्सा|नाराज़|नाराज|अन्याय|बुरा लग)/],
  ["sad", /(दुख|उदास|रोना|अकेल|क्षमा|माफ़ी|माफी)/],
  ["dizzy", /(चक्कर|अभिभूत|अफरा-तफरी|अराजक)/],
  ["surprised", /(हैरान|आश्चर्य|अचंभ|वाह)/],
  ["excited", /(शानदार|ज़बरदस्त|जबरदस्त|बहुत खुश|बधाई)/],
  ["confused", /(समझ नहीं|उलझन|असमंजस|क्या मतलब)/],
  ["sleepy", /(नींद|थका|थक गया|सोना|सो जाओ)/],
  ["curious", /(क्यों|कैसे|जानना|जानें|मतलब क्या)/],
  ["happy", /(खुश|अच्छा|शुक्रिया|धन्यवाद|प्यार|मज़ा|मजा|हँस|हंस)/],
];

function parseMood(rawReply) {
  const reply = String(rawReply || "").trim();
  const match = reply.match(MOOD_TAG);
  if (match) {
    const mood = match[1].toLowerCase();
    const cleanReply = stripMoodTags(reply.slice(match[0].length));
    return {
      mood: moodSet.has(mood) ? mood : hintMood(cleanReply),
      reply: cleanReply,
    };
  }
  return { mood: hintMood(reply), reply: stripMoodTags(reply) };
}

function ensureMoodTag(text) {
  const value = String(text || "").trim();
  return value.replace(BARE_MOOD, (match, mood) => `[${mood.toLowerCase()}] `);
}

function stripMoodTags(text) {
  return text
    .replace(MOOD_TAG_ANY, (tag, word) => (moodSet.has(word.toLowerCase()) ? "" : tag))
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hintMood(text) {
  return (
    [...MOOD_HINTS, ...HINDI_MOOD_HINTS].find(([, pattern]) => pattern.test(text))?.[0] || "idle"
  );
}

module.exports = { MOODS, MOOD_TAG, ensureMoodTag, parseMood };
