// OpenAI agent loop with function calling. Mirrors agent-claude.ts
// in structure — multi-turn conversation, tool calls routed through
// `callGetWeatherTool`, terminal condition is "model responded
// without calling any function."
//
// Defaults to gpt-4o-mini because it's cheap and more than smart
// enough for this single-tool flow. Override via OPENAI_MODEL env
// var (e.g., OPENAI_MODEL=gpt-4o for noticeably faster/better
// responses on harder tasks).

import OpenAI from "openai";
import {
  TOOL_DEFINITION,
  callGetWeatherTool,
  type ToolContext,
} from "./tools";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const MAX_TURNS = 5;

export async function runOpenAIAgent(
  task: string,
  ctx: ToolContext,
): Promise<string> {
  const openai = new OpenAI();

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: TOOL_DEFINITION.name,
        description: TOOL_DEFINITION.description,
        parameters: TOOL_DEFINITION.parameters,
      },
    },
  ];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: task },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      tools,
      messages,
    });

    const message = response.choices[0]?.message;
    if (!message) return "(no response from model)";

    // Append the assistant's reply to the conversation history.
    messages.push(message);

    // No tool calls → terminal state, return the text content.
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "(model returned empty content)";
    }

    // Otherwise, execute each tool call and append its result as a
    // role:tool message keyed by tool_call_id.
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      if (toolCall.function.name !== TOOL_DEFINITION.name) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: `Unknown tool: ${toolCall.function.name}`,
          }),
        });
        continue;
      }

      let args: { city: string };
      try {
        args = JSON.parse(toolCall.function.arguments) as { city: string };
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: "Tool arguments were not valid JSON",
          }),
        });
        continue;
      }

      const result = await callGetWeatherTool(ctx, args);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(
          result.ok ? result.data : { error: result.error },
        ),
      });
    }
  }

  return "(agent reached the turn limit without finalizing)";
}
