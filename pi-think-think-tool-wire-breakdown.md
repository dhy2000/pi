# pi-think Think-Tool Wire Breakdown

This document records a non-interactive `pi-think` run using `--reasoning-mode think-tool` and breaks down the request/response sequence that makes the scratchpad tool work.

## Replay command used

```bash
PI_WIRE_LOG=/tmp/pi-think-wire-think.jsonl \
node packages/coding-agent/dist/cli.js \
  --provider 0011.ai \
  --model gpt-5.6-sol \
  --reasoning-mode think-tool \
  --think-effort minimal \
  --tools think \
  --no-context-files \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session \
  -p 'Answer with exactly: pong'
```

Observed CLI output:

```text
pong
```

Redactions in this write-up:

- Authorization headers are shown as `$OPENAI_API_KEY_0011AI`.
- `prompt_cache_key` is replaced with `'<session-cache-key>'`.
- Scratchpad `thoughts` content is redacted as `'<model scratchpad text>'`.
- The developer/system prompt is abbreviated except for the think-tool guideline.

## High-level sequence

The run produced four provider requests in the wire log:

| Wire id | Purpose | Result |
| --- | --- | --- |
| 1 | Forced `think` tool request | No response body logged before retry |
| 2 | Forced `think` tool retry | No response body logged before retry |
| 3 | Forced `think` tool retry | Successful SSE response containing a `think` function call |
| 4 | Continuation after local tool execution | Successful SSE response containing final text `pong` |

The important behavior is visible in request 3 and request 4.

## Request 3: force the model to call `think`

pi-think sends an OpenAI Responses request with `tool_choice` pinned to the `think` tool. This is the extraction step: the model must answer this turn by emitting a function call whose JSON arguments contain `thoughts`.

Equivalent sanitized curl:

```bash
curl -N 'https://api.3366.ai/responses' \
  -H 'Authorization: Bearer $OPENAI_API_KEY_0011AI' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "model": "gpt-5.6-sol",
  "input": [
    {
      "role": "developer",
      "content": "... Guidelines:\n- Use the think tool for ALL step-by-step reasoning: before answering the user, before any non-trivial tool call, and after tool results when deciding what to do next. Reason silently as little as possible — record your reasoning in think first, then act.\n- Keep each think note under roughly 1024 tokens ..."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Answer with exactly: pong"
        }
      ]
    }
  ],
  "stream": true,
  "prompt_cache_key": "<session-cache-key>",
  "store": false,
  "max_output_tokens": 1024,
  "tools": [
    {
      "type": "function",
      "name": "think",
      "description": "External scratchpad. Use it for ALL step-by-step reasoning before answering or acting. Content is not shown to the user. Keep each note under roughly 1024 tokens.",
      "parameters": {
        "type": "object",
        "required": ["thoughts"],
        "properties": {
          "thoughts": {
            "type": "string",
            "description": "Your complete private reasoning"
          }
        }
      }
    }
  ],
  "reasoning": {
    "effort": "none"
  },
  "tool_choice": {
    "type": "function",
    "name": "think"
  }
}
JSON
```

Key fields:

- `tools[0].name = "think"`: registers the scratchpad as a normal function tool.
- `tools[0].parameters.properties.thoughts`: makes the model write text into a plaintext JSON argument.
- `tool_choice = { "type": "function", "name": "think" }`: forces the first assistant turn to be a `think` call.
- `reasoning.effort = "none"`: native provider reasoning is turned off for this request path.
- `max_output_tokens = 1024`: because this run used `--think-effort minimal`, the forced scratchpad turn is capped to the minimal budget.

## Response 3: provider streams a `think` function call

The response is an SSE stream. Sanitized event sequence:

```json
[
  {
    "event": "response.created",
    "type": "response.created",
    "status": "in_progress"
  },
  {
    "event": "response.output_item.added",
    "type": "response.output_item.added",
    "item": {
      "type": "function_call",
      "name": "think",
      "arguments": "",
      "call_id": "call_..."
    }
  },
  {
    "event": "response.function_call_arguments.delta",
    "type": "response.function_call_arguments.delta",
    "delta": "{\"thoughts\":\"..."
  },
  {
    "event": "response.function_call_arguments.done",
    "type": "response.function_call_arguments.done",
    "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
  },
  {
    "event": "response.output_item.done",
    "type": "response.output_item.done",
    "item": {
      "type": "function_call",
      "name": "think",
      "arguments": "{\"thoughts\":\"<model scratchpad text>\"}",
      "call_id": "call_..."
    }
  },
  {
    "event": "response.completed",
    "type": "response.completed",
    "status": "completed"
  }
]
```

At this point pi's OpenAI Responses adapter parses the streamed function-call arguments and creates an assistant content block:

```ts
{
  type: "toolCall",
  name: "think",
  arguments: {
    thoughts: "<model scratchpad text>"
  }
}
```

That is the core extraction mechanism. The model's reasoning is not read from a hidden chain-of-thought API field; it arrives as normal function-call JSON.

## Local tool execution: record-only acknowledgement

The `think` tool's `execute()` method does not compute anything. It only returns a counter:

```json
{"recorded":1}
```

The reason is that the useful data already exists in the assistant tool call's arguments:

```json
{"thoughts":"<model scratchpad text>"}
```

This is why the scratchpad survives in the transcript: it is ordinary assistant message content, not out-of-band metadata.

## Request 4: continue with the recorded scratchpad call

After local tool execution, pi-think sends the next request. This request replays:

1. the original user prompt,
2. the assistant's `think` function call,
3. the tool result `{"recorded":1}`.

There is no forced `tool_choice` on this continuation turn. The model can now answer normally.

Equivalent sanitized curl:

```bash
curl -N 'https://api.3366.ai/responses' \
  -H 'Authorization: Bearer $OPENAI_API_KEY_0011AI' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "model": "gpt-5.6-sol",
  "input": [
    {
      "role": "developer",
      "content": "... same developer prompt and think-tool guideline ..."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Answer with exactly: pong"
        }
      ]
    },
    {
      "type": "function_call",
      "id": "fc_...",
      "call_id": "call_...",
      "name": "think",
      "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_...",
      "output": "{\"recorded\":1}"
    }
  ],
  "stream": true,
  "prompt_cache_key": "<session-cache-key>",
  "store": false,
  "max_output_tokens": 16384,
  "tools": [
    {
      "type": "function",
      "name": "think",
      "description": "External scratchpad. Use it for ALL step-by-step reasoning before answering or acting. Content is not shown to the user. Keep each note under roughly 1024 tokens.",
      "parameters": {
        "type": "object",
        "required": ["thoughts"],
        "properties": {
          "thoughts": {
            "type": "string",
            "description": "Your complete private reasoning"
          }
        }
      }
    }
  ],
  "reasoning": {
    "effort": "none"
  }
}
JSON
```

Key difference from request 3:

- `tool_choice` is absent.
- `max_output_tokens` is back to the normal answer budget.
- The prior `think` call and `function_call_output` are included in `input`.

## Response 4: final answer text

Sanitized SSE event sequence:

```json
[
  {
    "event": "response.created",
    "type": "response.created",
    "status": "in_progress"
  },
  {
    "event": "response.output_item.added",
    "type": "response.output_item.added",
    "item": {
      "type": "message"
    }
  },
  {
    "event": "response.output_text.delta",
    "type": "response.output_text.delta",
    "delta": "pong"
  },
  {
    "event": "response.output_text.done",
    "type": "response.output_text.done"
  },
  {
    "event": "response.completed",
    "type": "response.completed",
    "status": "completed"
  }
]
```

The CLI prints:

```text
pong
```

## Code path map

Relevant implementation points:

- `packages/coding-agent/src/cli/args.ts`
  - Parses `--reasoning-mode think-tool`, `--think-tool-name`, and `--think-effort`.
- `packages/coding-agent/src/core/sdk.ts`
  - Forces session thinking level to `off` in think-tool mode.
  - Registers `createThinkToolDefinition(...)`.
  - Adds `applyThinkToolPayload(...)` to the provider payload hook.
- `packages/coding-agent/src/core/tools/think.ts`
  - Defines the `think` tool schema with `thoughts: string`.
  - Adds prompt guidelines telling the model to reason through the tool.
  - Executes as a no-op acknowledgement: `{"recorded": N}`.
  - Renders `args.thoughts` in the TUI.
- `packages/coding-agent/src/core/think-tool-mode.ts`
  - Detects fresh user prompts.
  - Forces `tool_choice` to `think`.
  - Disables native Anthropic thinking when applicable.
  - Applies the scratchpad effort cap on the forced call.
- `packages/ai/src/api/openai-responses-shared.ts`
  - Parses `response.function_call_arguments.delta` into a `toolCall` block.
  - Parses later `response.output_text.delta` into visible assistant text.

## Mechanism summary

The working mechanism is:

1. Register `think(thoughts: string)` as a normal tool.
2. Add system-prompt guidance requiring use of that tool for reasoning.
3. Force the first assistant turn to call `think` via provider `tool_choice`.
4. Receive model reasoning as plaintext JSON function-call arguments.
5. Execute the tool locally as a no-op and return `{"recorded":1}`.
6. Send a continuation request containing the recorded scratchpad call and result.
7. Let the model produce the final visible answer normally.
