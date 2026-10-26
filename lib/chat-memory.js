const MAX_TURNS = 4;
const MAX_MESSAGE_LENGTH = 1000;

function recentMessages(history) {
  return history.slice(-MAX_TURNS * 2).map(({ role, content }) => ({ role, content }));
}

function rememberTurn(history, userMessage, assistantMessage) {
  history.push(
    { role: "user", content: String(userMessage).slice(0, MAX_MESSAGE_LENGTH) },
    { role: "assistant", content: String(assistantMessage).slice(0, MAX_MESSAGE_LENGTH) },
  );
  history.splice(0, Math.max(0, history.length - MAX_TURNS * 2));
}

module.exports = { recentMessages, rememberTurn };
