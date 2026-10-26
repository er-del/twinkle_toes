const { randomUUID } = require("node:crypto");

const MAX_NOTES = 20;
const MAX_TIMERS = 20;
const MAX_GRAPHIC_ELEMENTS = 14;
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Safely calculate arithmetic or convert between supported units. Use for requested calculations, not mental estimates.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", maxLength: 200, description: "Arithmetic expression, such as (18 * 4) / 3." },
          value: { type: "number", description: "Number to convert." },
          from: { type: "string", description: "Source unit: km, mi, m, ft, cm, in, kg, lb, g, c, f, l, or gal." },
          to: { type: "string", description: "Target unit from the same supported list." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_timer",
      description: "Create an in-app timer/reminder for a duration in seconds. Use only when requested; maximum duration is 24 hours.",
      parameters: {
        type: "object",
        properties: {
          seconds: { type: "integer", minimum: 1, maximum: 86400 },
          label: { type: "string", maxLength: 80 },
        },
        required: ["seconds"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_note",
      description: "Save a short note in this browser's local notes when asked. Never save without the person's request.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 80 },
          text: { type: "string", maxLength: 1000 },
        },
        required: ["title", "text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_notes",
      description: "List notes saved in this browser when the person asks to see or recall their notes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Delete a saved note by its exact note ID, but only when the person explicitly asks.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", maxLength: 40 } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draw_graphic",
      description: "Create an original, simple in-app vector illustration using a title and safe geometric shapes. Use when asked to draw or create a graphic. No image API is used.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: 80 },
          background: { type: "string", description: "Hex color such as #172033." },
          elements: {
            type: "array",
            maxItems: MAX_GRAPHIC_ELEMENTS,
            items: {
              type: "object",
              properties: {
                shape: { type: "string", enum: ["circle", "rect", "line", "text"] },
                x: { type: "number" }, y: { type: "number" },
                width: { type: "number" }, height: { type: "number" },
                radius: { type: "number" },
                x2: { type: "number" }, y2: { type: "number" },
                color: { type: "string" },
                text: { type: "string", maxLength: 80 },
                size: { type: "number" },
              },
              required: ["shape", "x", "y", "color"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "background", "elements"],
        additionalProperties: false,
      },
    },
  },
];

function parseArguments(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function calculate(args) {
  if (typeof args.expression === "string" && args.expression.trim()) {
    if (args.expression.length > 200) throw new Error("That calculation is too long.");
    const tokens = [];
    const tokenizer = /\s*(\d+(?:\.\d+)?|[()+\-*/%^])\s*/gy;
    let position = 0;
    while (position < args.expression.length) {
      tokenizer.lastIndex = position;
      const match = tokenizer.exec(args.expression);
      if (!match) throw new Error("Use numbers, parentheses, and + - * / % ^ only.");
      tokens.push(match[1]);
      if (tokens.length > 100) throw new Error("That calculation is too complex.");
      position = tokenizer.lastIndex;
    }
    if (!tokens.length) throw new Error("Enter a calculation.");
    let index = 0;
    function primary() {
      const token = tokens[index++];
      if (token === "+" || token === "-") {
        const value = primary();
        return token === "-" ? -value : value;
      }
      if (token === "(") {
        const value = sum();
        if (tokens[index++] !== ")") throw new Error("Check the parentheses in that calculation.");
        return value;
      }
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error("That calculation is invalid.");
      return value;
    }
    function power() {
      const value = primary();
      if (tokens[index] === "^") {
        index++;
        return value ** power();
      }
      return value;
    }
    function product() {
      let value = power();
      while (["*", "/", "%"].includes(tokens[index])) {
        const operator = tokens[index++];
        const right = power();
        if ((operator === "/" || operator === "%") && right === 0) throw new Error("Cannot divide by zero.");
        value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
      }
      return value;
    }
    function sum() {
      let value = product();
      while (["+", "-"].includes(tokens[index])) {
        const operator = tokens[index++];
        const right = product();
        value = operator === "+" ? value + right : value - right;
      }
      return value;
    }
    const result = sum();
    if (index !== tokens.length || !Number.isFinite(result)) throw new Error("That calculation is invalid.");
    return { type: "calculation", expression: args.expression.trim(), result };
  }

  const value = args.value;
  const from = String(args.from || "").toLowerCase();
  const to = String(args.to || "").toLowerCase();
  const units = {
    km: ["length", 1000], mi: ["length", 1609.344], m: ["length", 1], ft: ["length", 0.3048],
    cm: ["length", 0.01], in: ["length", 0.0254], kg: ["mass", 1], lb: ["mass", 0.45359237],
    g: ["mass", 0.001], l: ["volume", 1], gal: ["volume", 3.785411784],
  };
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Provide a finite number to convert.");
  if (from === "c" && to === "f") return { type: "conversion", value, from, to, result: value * 9 / 5 + 32 };
  if (from === "f" && to === "c") return { type: "conversion", value, from, to, result: (value - 32) * 5 / 9 };
  if (!units[from] || !units[to] || units[from][0] !== units[to][0]) {
    throw new Error("That unit conversion is not supported.");
  }
  return { type: "conversion", value, from, to, result: value * units[from][1] / units[to][1] };
}

function validateGraphic(value) {
  const args = parseArguments(value);
  const colorIsValid = (color) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);
  if (!args || typeof args.title !== "string" || !args.title.trim() || args.title.length > 80 ||
      !colorIsValid(args.background) || !Array.isArray(args.elements) ||
      args.elements.length === 0 || args.elements.length > MAX_GRAPHIC_ELEMENTS) {
    throw new Error("The drawing details are invalid.");
  }
  const elements = args.elements.map((item) => {
    if (!item || !["circle", "rect", "line", "text"].includes(item.shape) ||
        !colorIsValid(item.color) || !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
        item.x < 0 || item.x > 320 || item.y < 0 || item.y > 220) {
      throw new Error("A drawing shape has invalid details.");
    }
    const element = { shape: item.shape, x: item.x, y: item.y, color: item.color };
    if (item.shape === "circle") {
      if (!Number.isFinite(item.radius) || item.radius < 1 || item.radius > 100 ||
          item.x - item.radius < 0 || item.x + item.radius > 320 ||
          item.y - item.radius < 0 || item.y + item.radius > 220) {
        throw new Error("A circle radius is invalid.");
      }
      element.radius = item.radius;
    }
    if (item.shape === "rect") {
      if (!Number.isFinite(item.width) || !Number.isFinite(item.height) ||
          item.width < 1 || item.width > 320 || item.height < 1 || item.height > 220 ||
          item.x + item.width > 320 || item.y + item.height > 220) {
        throw new Error("A rectangle size is invalid.");
      }
      element.width = item.width;
      element.height = item.height;
    }
    if (item.shape === "line") {
      if (!Number.isFinite(item.x2) || !Number.isFinite(item.y2) ||
          item.x2 < 0 || item.x2 > 320 || item.y2 < 0 || item.y2 > 220 ||
          Math.abs(item.x2 - item.x) < 0.01 && Math.abs(item.y2 - item.y) < 0.01) {
        throw new Error("A line endpoint is invalid.");
      }
      element.x2 = item.x2;
      element.y2 = item.y2;
    }
    if (item.shape === "text") {
      if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 80 ||
          !Number.isFinite(item.size) || item.size < 8 || item.size > 48) {
        throw new Error("A text shape is invalid.");
      }
      element.text = item.text;
      element.size = item.size;
    }
    return element;
  });
  return { type: "graphic", title: args.title.trim(), background: args.background, elements };
}

async function executeTool(name, rawArgs, options = {}) {
  const args = parseArguments(rawArgs);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object.");
  if (name === "calculate") return calculate(args);
  if (name === "draw_graphic") return validateGraphic(args);
  if (name === "create_timer") {
    const seconds = args.seconds;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error("Timer duration must be from 1 second to 24 hours.");
    if (args.label !== undefined && typeof args.label !== "string") throw new Error("Timer label must be text.");
    if ((options.timers?.size || 0) >= MAX_TIMERS) throw new Error("There are already 20 active timers.");
    const label = typeof args.label === "string" ? args.label.trim().slice(0, 80) : "";
    const id = randomUUID();
    const timer = { id, label: label || "Timer", seconds, dueAt: Date.now() + seconds * 1000 };
    if (!options.deferTimer) {
      const timeout = setTimeout(() => {
        options.timers?.delete(id);
        options.onTimer?.(timer);
      }, seconds * 1000);
      options.timers?.set(id, timeout);
    }
    return { type: "timer", ...timer };
  }
  if (!Array.isArray(options.notes)) throw new Error("Browser-local notes are not available.");
  if (name === "list_notes") return { type: "notes", notes: options.notes };
  if (name === "save_note") {
    if (typeof args.title !== "string" || !args.title.trim() || args.title.length > 80 ||
        typeof args.text !== "string" || !args.text.trim() || args.text.length > 1000) {
      throw new Error("A note needs a title and text (up to 1000 characters).");
    }
    if (options.notes.length >= MAX_NOTES) throw new Error("The local notes collection is full.");
    const note = { id: randomUUID(), title: args.title.trim(), text: args.text.trim(), createdAt: new Date().toISOString() };
    return { type: "note_saved", note, notes: [...options.notes, note] };
  }
  if (name === "delete_note") {
    if (typeof args.id !== "string" || !args.id.trim()) throw new Error("Provide the exact note ID to delete.");
    const remaining = options.notes.filter((note) => note.id !== args.id);
    if (remaining.length === options.notes.length) throw new Error("No saved note has that ID.");
    return { type: "note_deleted", id: args.id, notes: remaining };
  }
  throw new Error("Unknown companion tool.");
}

module.exports = { TOOL_DEFINITIONS, calculate, executeTool, validateGraphic };
