(() => {
  const model = window.ZongzhuEyeModel;
  const MOOD_COLORS = Object.freeze({
    idle: "#f4ffff",
    listening: "#9ff6ff",
    thinking: "#c4b5fd",
    speaking: "#b8f6ff",
    happy: "#ffe08a",
    excited: "#ffb86b",
    curious: "#9ff2d0",
    confused: "#d8b4fe",
    angry: "#ff6b6b",
    surprised: "#fff3a6",
    sad: "#8fb8ff",
    sleepy: "#b0a7ff",
    dizzy: "#ff9ee6",
  });

  function toRgb(hex) {
    return {
      r: Number.parseInt(hex.slice(1, 3), 16),
      g: Number.parseInt(hex.slice(3, 5), 16),
      b: Number.parseInt(hex.slice(5, 7), 16),
    };
  }

  class EyeRenderer {
    constructor(canvas, onMood) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.onMood = onMood;
      this.face = model.faceFor(model.Mood.Idle, 0);
      this.tint = toRgb(MOOD_COLORS.idle);
      this.gaze = { x: 0, y: 0 };
      this.targetGaze = { x: 0, y: 0 };
      this.glance = { x: 0, y: 0 };
      this.nextGlance = 1500;
      this.reaction = "";
      this.reactionUntil = 0;
      this.nextBlink = 2500;
      this.blinkStart = 0;
      this.blinking = false;
      this.doubleBlink = false;
      this.touch = null;
      this.pendingTap = 0;
      this.running = true;
      this.lastFrame = performance.now();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
      this.attachTouch();
      requestAnimationFrame((now) => this.render(now));
    }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.context.setTransform(width / 466, 0, 0, height / 466, 0, 0);
    }

    attachTouch() {
      const point = (event) => {
        const bounds = this.canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - bounds.left) / bounds.width) * 466,
          y: ((event.clientY - bounds.top) / bounds.height) * 466,
        };
      };
      this.canvas.addEventListener("pointerdown", (event) => {
        this.canvas.setPointerCapture(event.pointerId);
        const position = point(event);
        this.touch = { ...position, start: performance.now(), moved: false, kind: "" };
        this.targetGaze.x = 0;
        this.targetGaze.y = 0;
      });

      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.touch) return;
        const position = point(event);
        const dx = position.x - this.touch.x;
        const dy = position.y - this.touch.y;
        const elapsed = performance.now() - this.touch.start;
        if (!this.touch.kind && Math.max(Math.abs(dx), Math.abs(dy)) >= 14) {
          this.touch.kind = elapsed >= 220 ? "follow" : Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
        }
        if (this.touch.kind === "follow") {
          this.touch.moved = true;
          this.targetGaze.x = Math.max(-1, Math.min(1, (position.x - 233) / 150));
          this.targetGaze.y = Math.max(-1, Math.min(1, (position.y - 240) / 150));
          return;
        }
        if (!this.touch.moved && this.touch.kind === "horizontal" && Math.abs(dx) >= 60) {
          this.react(model.moods[(model.moods.indexOf(this.canvas.dataset.expression) + (dx > 0 ? 1 : model.moods.length - 1)) % model.moods.length]);
          this.touch.moved = true;
        } else if (!this.touch.moved && this.touch.kind === "vertical" && Math.abs(dy) >= 60) {
          this.react(dy < 0 ? model.Mood.Surprised : model.Mood.Sleepy, 3000);
          this.touch.moved = true;
        }
        if (this.touch.kind === "horizontal" || this.touch.kind === "vertical") {
          this.touch.x = position.x;
          this.touch.y = position.y;
        }
      });

      const finish = () => {
        if (!this.touch) return;
        const touch = this.touch;
        const elapsed = performance.now() - touch.start;
        if (!touch.moved && !touch.kind && elapsed >= 650) {
          this.react(model.Mood.Angry);
        } else if (!touch.moved && !touch.kind) {
          const now = performance.now();
          if (this.pendingTap && now - this.pendingTap <= 280) {
            this.pendingTap = 0;
            this.react(model.Mood.Surprised);
          } else {
            this.pendingTap = now;
            window.setTimeout(() => {
              if (this.pendingTap && performance.now() - this.pendingTap >= 280) {
                this.pendingTap = 0;
                this.react(model.Mood.Happy);
              }
            }, 290);
          }
        }
        this.touch = null;
      };
      this.canvas.addEventListener("pointerup", finish);
      this.canvas.addEventListener("pointercancel", finish);
    }

    react(mood, duration = 2000) {
      this.reaction = mood;
      this.reactionUntil = performance.now() + duration;
      if (this.onMood) this.onMood(mood, duration);
    }

    setTilt(x, y) {
      if (this.touch?.kind === "follow") return;
      const shape = (value) => {
        const magnitude = Math.max(0, Math.abs(value) - 0.03) / 0.3;
        return Math.sign(value) * Math.min(1, magnitude);
      };
      this.targetGaze.x = shape(x);
      this.targetGaze.y = shape(y);
    }

    blinkFactor(now, mood) {
      const noBlink = [model.Mood.Happy, model.Mood.Sleepy, model.Mood.Dizzy, model.Mood.Surprised];
      if (!this.blinking) {
        if (now < this.nextBlink || noBlink.includes(mood)) return 1;
        this.blinking = true;
        this.blinkStart = now;
      }
      const age = now - this.blinkStart;
      const close = 70;
      const hold = 30;
      const open = 140;
      if (age < close) return Math.max(0.06, 1 - age / close);
      if (age < close + hold) return 0.06;
      if (age < close + hold + open) return Math.max(0.06, (age - close - hold) / open);
      this.blinking = false;
      this.nextBlink = now + (this.doubleBlink ? 2600 : 2600 + Math.random() * 3400);
      this.doubleBlink = !this.doubleBlink && Math.random() < 0.2;
      if (this.doubleBlink) this.nextBlink = now + 90;
      return 1;
    }

    updateGaze(now, dt, mood) {
      const glancing = [model.Mood.Idle, model.Mood.Listening, model.Mood.Speaking].includes(mood);
      if (now >= this.nextGlance) {
        this.nextGlance = now + 1200 + Math.random() * 2300;
        const home = !glancing || Math.random() < 1 / 3;
        this.glance.x = home ? 0 : (Math.random() - 0.5) * 0.7;
        this.glance.y = home ? 0 : (Math.random() - 0.5) * 0.4;
      }
      let x = this.targetGaze.x + this.glance.x;
      let y = this.targetGaze.y + this.glance.y;
      if (this.touch?.kind === "follow" && this.touch.moved) {
        x = this.targetGaze.x;
        y = this.targetGaze.y;
      }
      const amount = model.ease(dt, this.touch ? 14 : 18);
      this.gaze.x += (Math.max(-1, Math.min(1, x)) - this.gaze.x) * amount;
      this.gaze.y += (Math.max(-1, Math.min(1, y)) - this.gaze.y) * amount;
    }

    drawEye(shape, homeX, centerY, blink, now, index, color) {
      const ctx = this.context;
      const weight = 1 - Math.min(1, Math.abs(shape.arc));
      const cx = homeX + shape.dx + this.gaze.x * 34;
      const cy = centerY + shape.dy + this.gaze.y * 26;
      let width = 0;
      let height = 0;
      if (weight >= 0.03) {
        width = Math.max(4, shape.w);
        height = Math.max(4, shape.h * blink * weight);
        ctx.save();
        ctx.globalAlpha = weight;
        ctx.fillStyle = color;
        ctx.translate(cx, cy);
        if (height > width && shape.tilt !== 0) {
          ctx.rotate(shape.tilt * Math.PI / 180);
          const half = (height - width) / 2;
          ctx.beginPath();
          ctx.moveTo(0, -half);
          ctx.lineTo(0, half);
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.strokeStyle = color;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.roundRect(-width / 2, -height / 2, width, height, Math.min(width, height) / 2);
          ctx.fill();
        }
        ctx.restore();

        if (shape.lid >= 0.01) {
          const edge = cy - height / 2 + shape.lid * height;
          const slope = Math.tan(shape.lidTilt * Math.PI / 180) * width / 2;
          const reach = Math.max(width, height) / 2 + 2;
          const sideSlope = 2 * slope / width;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(cx - reach, cy - reach);
          ctx.lineTo(cx + reach, cy - reach);
          ctx.lineTo(cx + reach, edge + slope + sideSlope * (reach - width / 2));
          ctx.lineTo(cx - reach, edge - slope - sideSlope * (reach - width / 2));
          ctx.closePath();
          ctx.fill();
        }

        if (shape.spin >= 0.05) {
          const diameter = Math.min(width, height);
          const turn = (now * 0.42 + index * 90) * Math.PI / 180;
          ctx.strokeStyle = "#000";
          ctx.lineCap = "round";
          ctx.lineWidth = Math.max(3, diameter / 11);
          ctx.beginPath();
          ctx.arc(cx, cy, diameter * 0.37, turn, turn + 260 * Math.PI / 180);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, diameter * 0.2, -turn, -turn + 220 * Math.PI / 180);
          ctx.stroke();
        }
      }

      const arcWeight = Math.min(1, Math.abs(shape.arc));
      if (arcWeight >= 0.03) {
        const diameter = Math.max(10, shape.w);
        const radius = diameter / 2;
        const capY = cy + diameter * (shape.arc > 0 ? 0.22 : -0.28);
        const start = ((shape.arc > 0 ? 182 : 32) + shape.tilt) * Math.PI / 180;
        const end = ((shape.arc > 0 ? 358 : 148) + shape.tilt) * Math.PI / 180;
        ctx.save();
        ctx.globalAlpha = arcWeight;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, diameter * (shape.arc > 0 ? 0.22 : 0.085));
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, capY, radius, start, end);
        ctx.stroke();
        ctx.restore();
      }
    }

    render(timestamp) {
      if (!this.running) return;
      const ctx = this.context;
      const now = timestamp;
      const dt = Math.min(100, now - this.lastFrame);
      this.lastFrame = now;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 466, 466);

      const expression = this.canvas.dataset.expression || model.Mood.Idle;
      const mood = now < this.reactionUntil ? this.reaction : expression;
      const modelTime = now / 1000;
      this.updateGaze(now, dt, mood);
      const target = model.faceFor(mood, modelTime);
      const amount = model.ease(dt, mood === model.Mood.Dizzy ? 16 : 11);
      this.face.left = model.mix(this.face.left, target.left, amount);
      this.face.right = model.mix(this.face.right, target.right, amount);

      const targetTint = toRgb(MOOD_COLORS[mood] || MOOD_COLORS.idle);
      const tintAmount = model.ease(dt, 9);
      this.tint.r += (targetTint.r - this.tint.r) * tintAmount;
      this.tint.g += (targetTint.g - this.tint.g) * tintAmount;
      this.tint.b += (targetTint.b - this.tint.b) * tintAmount;
      const color = `rgb(${Math.round(this.tint.r)}, ${Math.round(this.tint.g)}, ${Math.round(this.tint.b)})`;

      const blink = this.blinkFactor(now, mood);
      this.drawEye(this.face.left, 233 - model.homeX, 240, blink, now, 0, color);
      this.drawEye(this.face.right, 233 + model.homeX, 240, blink, now, 1, color);
      requestAnimationFrame((next) => this.render(next));
    }
  }

  window.ZongzhuEyeRenderer = EyeRenderer;
})();
