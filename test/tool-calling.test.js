const assert = require("node:assert/strict");
const test = require("node:test");

const { runToolConversation } = require("../lib/tool-calling");

test("executes multiple tool rounds and supplies the prior results to follow-up calls", async () => {
  const messages = [{ role: "user", content: "Calculate and then draw." }];
  const firstTool = { id: "calculate-1", type: "function", function: { name: "calculate", arguments: "{}" } };
  const secondTool = { id: "draw-1", type: "function", function: { name: "draw_graphic", arguments: "{}" } };
  const responses = [
    { tool_calls: [firstTool] },
    { tool_calls: [secondTool] },
    { content: "Done." },
  ];
  const requests = [];
  const executed = [];
  const result = await runToolConversation(messages, [{ type: "function" }], {}, async (history, tools) => {
    requests.push({ history: [...history], tools });
    return responses.shift();
  }, async (call) => {
    executed.push(call.id);
    return { ok: true };
  });

  assert.equal(result.content, "Done.");
  assert.deepEqual(executed, ["calculate-1", "draw-1"]);
  assert.equal(requests[1].tools.length, 1);
  assert.equal(requests[2].tools.length, 1);
  assert.deepEqual(messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id), [
    "calculate-1",
    "draw-1",
  ]);
});

test("bounds tool execution across model rounds and requests a final tool-free response", async () => {
  const messages = [];
  const responses = Array.from({ length: 4 }, (_, round) => ({
    tool_calls: Array.from({ length: 3 }, (_, index) => ({
      id: `${round}-${index}`,
      function: { name: "sample", arguments: "{}" },
    })),
  }));
  let executions = 0;
  const modelTools = [];
  const result = await runToolConversation(messages, [], {}, async (_history, tools) => {
    modelTools.push(tools);
    return responses.shift() || { content: "Finished." };
  }, async () => {
    executions++;
    return "ok";
  });

  assert.equal(executions, 6);
  assert.equal(messages.filter((message) => message.role === "tool").length, 12);
  assert.equal(modelTools[2], undefined);
  assert.equal(modelTools[4], undefined);
  assert.equal(result.content, "Finished.");
});
