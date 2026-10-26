const assert = require("node:assert/strict");
const test = require("node:test");

const { TOOL_DEFINITIONS, calculate, executeTool, validateGraphic } = require("../lib/companion-tools");

test("exposes the built-in calculator, timer, notes, and drawing tools", () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.function.name);
  assert.deepEqual(names, [
    "calculate",
    "create_timer",
    "save_note",
    "list_notes",
    "delete_note",
    "draw_graphic",
  ]);
});

test("safely evaluates arithmetic and rejects malformed or unsafe expressions", () => {
  assert.equal(calculate({ expression: "(18 * 4) / 3 - 2^2" }).result, 20);
  assert.throws(() => calculate({ expression: "1 / 0" }), /divide by zero/);
  assert.throws(() => calculate({ expression: "1 2" }), /invalid/);
  assert.throws(() => calculate({ expression: "process.exit()" }), /numbers, parentheses/);
});

test("converts supported units including temperature", () => {
  assert.equal(calculate({ value: 10, from: "km", to: "mi" }).result, 6.2137119223733395);
  assert.equal(calculate({ value: 20, from: "c", to: "f" }).result, 68);
  assert.throws(() => calculate({ value: 3, from: "kg", to: "km" }), /not supported/);
});

test("validates graphics as bounded, safe vector shapes", () => {
  assert.deepEqual(
    validateGraphic({
      title: "A tiny sun",
      background: "#101820",
      elements: [{ shape: "circle", x: 160, y: 100, radius: 35, color: "#FFD166" }],
    }),
    {
      type: "graphic",
      title: "A tiny sun",
      background: "#101820",
      elements: [{ shape: "circle", x: 160, y: 100, radius: 35, color: "#FFD166" }],
    },
  );
  assert.throws(
    () => validateGraphic({ title: "Unsafe", background: "red", elements: [] }),
    /drawing details are invalid/,
  );
  assert.throws(
    () => validateGraphic({
      title: "Bad shape",
      background: "#101820",
      elements: [{ shape: "script", x: 0, y: 0, color: "#ffffff", text: "bad" }],
    }),
    /shape has invalid details/,
  );
});

test("saves, lists, and deletes notes in the browser-provided notes collection", async () => {
  let notes = [];
  const saved = await executeTool("save_note", { title: "Idea", text: "Draw a moon" }, { notes });
  assert.equal(saved.type, "note_saved");
  notes = saved.notes;
  const listed = await executeTool("list_notes", {}, { notes });
  assert.equal(listed.notes.length, 1);
  assert.equal(listed.notes[0].text, "Draw a moon");
  const deleted = await executeTool("delete_note", { id: listed.notes[0].id }, { notes });
  assert.equal(deleted.type, "note_deleted");
  notes = deleted.notes;
  assert.deepEqual((await executeTool("list_notes", {}, { notes })).notes, []);
});

test("validates timer durations and publishes timer completion", async () => {
  const timers = new Map();
  let completed;
  const completion = new Promise((resolve) => { completed = resolve; });
  const timer = await executeTool("create_timer", { seconds: 1, label: "Tea" }, {
    timers,
    onTimer: completed,
  });
  assert.equal(timer.type, "timer");
  assert.equal(timer.label, "Tea");
  assert.equal(timers.size, 1);
  const completedTimer = await completion;
  assert.equal(completedTimer.id, timer.id);
  assert.equal(completedTimer.label, timer.label);
  assert.equal(timers.size, 0);
  await assert.rejects(
    executeTool("create_timer", { seconds: 0 }, { timers }),
    /1 second to 24 hours/,
  );
});
