const MAX_TOOL_CALLS = 6;
const MAX_TOOL_ROUNDS = 3;

async function runToolConversation(messages, tools, chatProvider, askModel, executeToolCall) {
  let assistant = await askModel(messages, tools, chatProvider);
  let toolCallCount = 0;
  let round = 0;

  while (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length > 0 && round < MAX_TOOL_ROUNDS) {
    messages.push({
      role: "assistant",
      content: assistant.content || "",
      tool_calls: assistant.tool_calls,
    });

    for (const [index, call] of assistant.tool_calls.entries()) {
      let content;
      if (toolCallCount >= MAX_TOOL_CALLS) {
        content = JSON.stringify({ error: "Tool limit reached. Finish using the results and actions already available." });
      } else {
        toolCallCount++;
        try {
          const result = await executeToolCall(call);
          content = typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
          content = JSON.stringify({ error: error.message });
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id || `tool-${round}-${index}`,
        content,
      });
    }

    round++;
    assistant = await askModel(
      messages,
      round < MAX_TOOL_ROUNDS && toolCallCount < MAX_TOOL_CALLS ? tools : undefined,
      chatProvider,
    );
  }

  if (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length > 0) {
    messages.push({
      role: "assistant",
      content: assistant.content || "",
      tool_calls: assistant.tool_calls,
    });
    assistant.tool_calls.forEach((call, index) => {
      messages.push({
        role: "tool",
        tool_call_id: call.id || `tool-${round}-${index}`,
        content: JSON.stringify({ error: "Tool-round limit reached. Finish using the results and actions already available." }),
      });
    });
    assistant = await askModel(messages, undefined, chatProvider);
  }

  return assistant;
}

module.exports = { runToolConversation };
