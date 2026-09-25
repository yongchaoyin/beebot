import assert from "node:assert/strict";
import { createServer } from "node:http";

/** A loopback-only OpenAI-compatible SSE source. It replaces model inference,
 * not the SDK parser, provider adapter, SendMessage tool or transcript writer.
 * Unscripted requests terminate privately and are counted as fixture failures.
 */
export async function scriptedChatModel(t, steps) {
  const requests = [];
  let unexpected = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const index = requests.length;
      requests.push({ path: request.url, input });
      const step = steps[index] ?? { text: "" };
      if (index >= steps.length) unexpected++;
      const envelope = { id: `fixture-${index}`, object: "chat.completion.chunk", created: 1, model: "colleague-fixture" };
      response.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } } : {}) })}\n\n`);
      emit({ role: "assistant" });
      for (const text of step.deltas ?? [step.text ?? ""]) if (text) emit({ content: text });
      if (step.tool) emit({ tool_calls: [{ index: 0, id: `call-${index}`, type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] });
      emit({}, step.tool ? "tool_calls" : "stop");
      response.end("data: [DONE]\n\n");
    } catch (error) {
      unexpected++;
      response.writeHead(500).end("fixture request invalid");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests,
    assertComplete() {
      assert.equal(unexpected, 0, "model requested an unplanned inference step");
      assert.equal(requests.length, steps.length);
      assert.ok(requests.every(({ path, input }) => path === "/v1/chat/completions" && input.model === "colleague-fixture"));
    },
  };
}

export const publicReply = content => ({ tool: { name: "SendMessage", args: { type: "text", content } } });
