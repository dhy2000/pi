# How pi-think Gets Thought Text from the Model

pi-think gets thought text mainly by forcing the model to put reasoning into a normal tool-call argument. It does not rely on reading hidden provider chain-of-thought fields.

## Main mechanism: think-tool reasoning mode

When started with `--reasoning-mode think-tool`, pi-think enables scratchpad-tool injection:

1. The CLI parses the mode in `packages/coding-agent/src/cli/args.ts`.
2. Session setup in `packages/coding-agent/src/core/sdk.ts`:
   - fixes reasoning mode at session start,
   - sets native thinking level to `off`,
   - registers and activates the scratchpad tool.
3. The scratchpad tool is defined in `packages/coding-agent/src/core/tools/think.ts`.

The tool schema contains a plaintext field:

```ts
thoughts: Type.String({ description: "Your complete private reasoning" })
```

The tool prompt guideline tells the model to use the tool for step-by-step reasoning before answering or acting.

## Payload forcing

Before the provider request is sent, `packages/coding-agent/src/core/think-tool-mode.ts` mutates the outgoing payload.

For fresh user prompts, it forces the scratchpad tool through provider-specific `tool_choice` shapes:

- Anthropic Messages: `{ type: "tool", name: toolName }`
- OpenAI Chat Completions: `{ type: "function", function: { name: toolName } }`
- OpenAI Responses: `{ type: "function", name: toolName }`

For Anthropic-dialect reasoning models, it also disables native thinking on the wire:

```ts
p.thinking = { type: "disabled" };
```

This steers reasoning away from hidden/summarized/encrypted provider channels and into the plaintext tool argument.

## Streaming and storage

Provider adapters parse tool-call arguments as ordinary tool calls:

- `packages/ai/src/api/openai-completions.ts` reads streamed `tool_calls[].function.arguments`.
- `packages/ai/src/api/openai-responses-shared.ts` reads `response.function_call_arguments.delta`.
- `packages/ai/src/api/anthropic-messages.ts` reads `input_json_delta`.

The parsed assistant content becomes a normal tool-call block:

```ts
{
  type: "toolCall",
  name: "think",
  arguments: { thoughts: "..." }
}
```

The `think` tool execution itself is a no-op acknowledgement. Its `execute()` method returns only a recorded counter, because the actual thought text already lives in the transcript as tool-call arguments.

## Display in the TUI

The TUI displays the thought text using the tool renderer:

- `renderCall()` in `packages/coding-agent/src/core/tools/think.ts` reads `args.thoughts`.
- `ToolExecutionComponent` in `packages/coding-agent/src/modes/interactive/components/tool-execution.ts` calls the renderer and shows it live.

## Native thinking path

Native pi also supports provider-native thinking blocks. Those come through the unified stream protocol as `thinking_start`, `thinking_delta`, and `thinking_end` events.

Examples:

- Anthropic: `thinking_delta` in `packages/ai/src/api/anthropic-messages.ts`
- OpenAI-compatible chat: `reasoning_content`, `reasoning`, or `reasoning_text` in `packages/ai/src/api/openai-completions.ts`
- OpenAI Responses: `response.reasoning_text.delta` / reasoning summary deltas in `packages/ai/src/api/openai-responses-shared.ts`

That native path is separate from pi-think's special method. pi-think's added feature is the plaintext scratchpad tool-call extraction path.
