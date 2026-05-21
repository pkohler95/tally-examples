// Claude agent loop with tool use. Uses @anthropic-ai/sdk's messages
// API to run a multi-turn conversation where Claude can call the
// `get_weather` tool. Each tool call routes through `callGetWeatherTool`
// in tools.ts, which handles the x402 payment leg via Tally.
//
// The loop runs until Claude responds with text only (no tool calls)
// or hits MAX_TURNS. Most weather queries finish in 2 turns: the
// first invokes the tool, the second formats the answer.

import Anthropic from "@anthropic-ai/sdk";
import {
  TOOL_DEFINITION,
  callGetWeatherTool,
  type ToolContext,
} from "./tools";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5";
const MAX_TURNS = 5;

export async function runClaudeAgent(
  task: string,
  ctx: ToolContext,
): Promise<string> {
  const anthropic = new Anthropic();

  const tools: Anthropic.Tool[] = [
    {
      name: TOOL_DEFINITION.name,
      description: TOOL_DEFINITION.description,
      input_schema: TOOL_DEFINITION.parameters,
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    });

    // Append Claude's response to the conversation.
    messages.push({ role: "assistant", content: response.content });

    // If Claude is done — no tool calls in the response — return the
    // text. This is the normal terminal state of the loop.
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUseBlocks.length === 0) {
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }

    // Otherwise, execute each tool call and feed results back as a
    // single user message containing tool_result blocks.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (block.name !== TOOL_DEFINITION.name) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        continue;
      }
      const result = await callGetWeatherTool(
        ctx,
        block.input as { city: string },
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(
          result.ok ? result.data : { error: result.error },
        ),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "(agent reached the turn limit without finalizing)";
}
