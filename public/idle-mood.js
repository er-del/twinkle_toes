(() => {
  const IDLE_AFTER_MS = 30_000;
  const SLEEPY_AFTER_MS = 120_000;

  function restingMoodFor(elapsedMs) {
    if (elapsedMs >= SLEEPY_AFTER_MS) return "sleepy";
    if (elapsedMs >= IDLE_AFTER_MS) return "idle";
    return null;
  }

  const idleMood = Object.freeze({ IDLE_AFTER_MS, SLEEPY_AFTER_MS, restingMoodFor });
  if (typeof module !== "undefined" && module.exports) module.exports = idleMood;
  if (typeof window !== "undefined") window.TwinkleIdleMood = idleMood;
})();
