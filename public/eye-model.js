/* Port of eyes::FaceFor, eyes::Mirror, eyes::Wave, eyes::Mix and eyes::Ease
 * from Zongzhu eye_model.h. See THIRD-PARTY-NOTICES.txt.
 */
(() => {
  const Mood = Object.freeze({
    Idle: "idle",
    Listening: "listening",
    Thinking: "thinking",
    Speaking: "speaking",
    Happy: "happy",
    Excited: "excited",
    Curious: "curious",
    Confused: "confused",
    Angry: "angry",
    Surprised: "surprised",
    Sad: "sad",
    Sleepy: "sleepy",
    Dizzy: "dizzy",
  });

  const moods = Object.values(Mood);
  const homeX = 100;
  const maxReach = 200;

  function wave(time, hz, phase = 0) {
    return Math.sin((time * hz + phase) * 6.2831853);
  }

  function shape() {
    return {
      dx: 0,
      dy: 0,
      w: 76,
      h: 150,
      tilt: 0,
      lid: 0,
      lidTilt: 0,
      arc: 0,
      spin: 0,
    };
  }

  function mirror(value) {
    return {
      ...value,
      dx: -value.dx,
      tilt: -value.tilt,
      lidTilt: -value.lidTilt,
    };
  }

  function faceFor(mood, time) {
    const left = shape();
    let result;
    switch (mood) {
      case Mood.Listening:
        left.w = 82;
        left.h = 140 + 6 * wave(time, 0.9);
        left.tilt = -4;
        left.dy = -4;
        result = { left, right: mirror(left) };
        result.right.h = 140 - 6 * wave(time, 0.9);
        return result;
      case Mood.Thinking:
        left.w = 80;
        left.h = 124;
        left.dx = -16 + 6 * wave(time, 0.25);
        left.dy = -18;
        result = { left, right: { ...left, h: 108, lid: 0.18, lidTilt: -8 } };
        return result;
      case Mood.Speaking:
        left.w = 80 - 3 * wave(time, 5.3);
        left.h = 136 + 9 * wave(time, 5.3) + 5 * wave(time, 3.1, 0.3);
        return { left, right: { ...left } };
      case Mood.Happy:
        left.arc = 1;
        left.w = 104;
        left.h = 104;
        left.dy = 8 + 4 * Math.abs(wave(time, 1.6));
        left.tilt = -6;
        return { left, right: mirror(left) };
      case Mood.Excited:
        left.w = 94;
        left.h = 156;
        left.dy = -6 - 6 * Math.abs(wave(time, 2.4));
        return { left, right: { ...left } };
      case Mood.Curious:
        left.w = 86;
        left.h = 166;
        left.tilt = -6;
        left.dy = -6;
        return { left, right: { ...left, w: 70, h: 112, lid: 0.12 } };
      case Mood.Confused:
        left.w = 80;
        left.h = 132 + 10 * wave(time, 0.6);
        left.tilt = 8;
        return {
          left,
          right: { ...left, h: 112 - 10 * wave(time, 0.6), tilt: -5, dy: -10 },
        };
      case Mood.Angry:
        left.w = 92;
        left.h = 118;
        left.dy = 4;
        left.lid = 0.36;
        left.lidTilt = 16;
        return { left, right: mirror(left) };
      case Mood.Surprised:
        left.w = 118 + 4 * wave(time, 1.2);
        left.h = left.w;
        left.dy = -10;
        return { left, right: { ...left } };
      case Mood.Sad:
        left.w = 86;
        left.h = 108;
        left.dy = 20 + 3 * wave(time, 0.4);
        left.lid = 0.3;
        left.lidTilt = -14;
        return { left, right: mirror(left) };
      case Mood.Sleepy:
        left.arc = -1;
        left.w = 112;
        left.h = 112;
        left.dy = 26 + 4 * wave(time, 0.22);
        left.tilt = 4;
        return { left, right: mirror(left) };
      case Mood.Dizzy:
        left.w = 108;
        left.h = 108;
        left.spin = 1;
        left.dx = 7 * wave(time, 0.9);
        left.dy = 7 * wave(time, 0.9, 0.25);
        return { left, right: { ...left, dx: -left.dx } };
      default:
        left.h = 150 + 3 * wave(time, 0.3);
        left.dy = 2 * wave(time, 0.17);
        return { left, right: { ...left } };
    }
  }

  function mix(from, to, amount) {
    const result = {};
    for (const key of ["dx", "dy", "w", "h", "tilt", "lid", "lidTilt", "arc", "spin"]) {
      result[key] = from[key] + (to[key] - from[key]) * amount;
    }
    return result;
  }

  function ease(milliseconds, rate = 11) {
    return 1 - Math.exp(-milliseconds * 0.001 * rate);
  }

  window.ZongzhuEyeModel = Object.freeze({ Mood, moods, homeX, maxReach, wave, faceFor, mix, ease });
})();
