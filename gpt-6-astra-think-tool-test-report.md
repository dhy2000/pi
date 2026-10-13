# GPT-6 Astra pi-think Think-Tool Test

## Result

**PASS.** pi-think obtained model scratchpad content as the plaintext JSON value of a forced `think` function call's `thoughts` argument, acknowledged it locally, replayed the call and result, and obtained the visible final answer in a second provider turn.

The raw request/response log is:

- `gpt-6-astra-think-tool-wire.jsonl`
- mode: `0600`
- size: 36,997 bytes
- entries: 4 JSONL records: two requests and two responses

The raw log is sensitive. It contains the prompt, model-generated scratchpad text, tool arguments, response identifiers, and reassembled SSE responses. It does not contain authorization headers because the wire logger does not record headers.

## Test environment

| Field | Value |
| --- | --- |
| Date | 2026-09-08T03:53:48+00:00 |
| Git commit | `cafb233ffaa23234188704a237b1165bc8d58fe1` |
| CLI | `packages/coding-agent/dist/cli.js` |
| Provider | `openai-codex` |
| Model | `gpt-6-astra` |
| API dialect | `openai-codex-responses` |
| Transport | SSE |
| Reasoning mode | `think-tool` |
| Think effort | `minimal` |
| Active tools | `think` only |
| Prompt | `Answer with exactly: pong` |
| Session persistence | disabled |

`gpt-6-astra` was present in the local configured model list as an `openai-codex` reasoning model.

## Command

A temporary working directory supplied a project-local setting of `{"transport":"sse"}`. SSE was required so the fetch-based wire logger could capture the exchange instead of the WebSocket transport.

The Codex SSE implementation normally zstd-compresses request bodies. The existing wire logger records non-string request bodies as `[object]`, so a temporary Node preload disabled request compression for this diagnostic run. This changed only transfer encoding, not the JSON payload.

```bash
cd /tmp/pi-think-gpt6-astra-run

NODE_OPTIONS="--require=/tmp/pi-disable-zstd.cjs" \
PI_WIRE_LOG="/workspace/think/pi-think/gpt-6-astra-think-tool-wire.jsonl" \
node /workspace/think/pi-think/packages/coding-agent/dist/cli.js \
  --provider openai-codex \
  --model gpt-6-astra \
  --reasoning-mode think-tool \
  --think-tool-name think \
  --think-effort minimal \
  --tools think \
  --no-context-files \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session \
  --approve \
  -p 'Answer with exactly: pong'
```

Exit status: `0`

Standard output:

```text
pong
```

Standard error was empty.

## Log format

Each line of `gpt-6-astra-think-tool-wire.jsonl` is one object:

```json
{
  "id": 1,
  "dir": "req",
  "ts": "...",
  "url": "https://chatgpt.com/backend-api/codex/responses",
  "body": {}
}
```

Responses also contain `status`. Their `body` is the full reassembled SSE stream as text.

## Chronological exchange

| Wire id | Direction | HTTP status | Purpose |
| --- | --- | --- | --- |
| 1 | request | — | Fresh user prompt; force `think` function |
| 1 | response | 200 | Stream plaintext `think.arguments.thoughts` |
| 2 | request | — | Replay `think` call plus local `{"recorded":1}` result |
| 2 | response | 200 | Stream final assistant text `pong` |

No retries occurred.

## Turn 1: forced scratchpad call

### Important request fields

The first request contained:

```json
{
  "model": "gpt-6-astra",
  "store": false,
  "stream": true,
  "input": [
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
  "text": {
    "verbosity": "low"
  },
  "include": [
    "reasoning.encrypted_content"
  ],
  "tool_choice": {
    "type": "function",
    "name": "think"
  },
  "parallel_tool_calls": true,
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
      },
      "strict": null
    }
  ]
}
```

The complete request in the raw log also contains:

- the full `instructions` string, including the requirement to use `think` for step-by-step reasoning;
- a `prompt_cache_key`, omitted here as session-specific metadata.

Unlike ordinary OpenAI Responses, the Codex backend deliberately does not accept `max_output_tokens`; therefore the `minimal` effort is instruction-level only for this dialect. `applyThinkToolPayload()` intentionally skips a hard effort cap for `openai-codex-responses`.

### Equivalent request curl

This is a payload-focused reconstruction. The actual OAuth/account headers are managed by pi and are not present in the wire log.

```bash
curl -N 'https://chatgpt.com/backend-api/codex/responses' \
  -H 'Authorization: Bearer $OPENAI_CODEX_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "model": "gpt-6-astra",
  "store": false,
  "stream": true,
  "instructions": "<full pi system prompt including the think-tool guideline>",
  "input": [
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
  "text": {"verbosity": "low"},
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "<session-cache-key>",
  "tool_choice": {"type": "function", "name": "think"},
  "parallel_tool_calls": true,
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
      },
      "strict": null
    }
  ]
}
JSON
```

### Response event sequence

The HTTP response was `200`. The raw SSE stream contained:

```json
[
  {"type":"response.created"},
  {"type":"response.in_progress"},
  {
    "type":"response.output_item.added",
    "item":{"type":"function_call","name":"think","arguments":""}
  },
  {"type":"response.function_call_arguments.delta","delta":"..."},
  {"type":"response.function_call_arguments.delta","delta":"..."},
  {
    "type":"response.function_call_arguments.done",
    "arguments":"{\"thoughts\":\"<model scratchpad text>\"}"
  },
  {
    "type":"response.output_item.done",
    "item":{
      "type":"function_call",
      "name":"think",
      "arguments":"{\"thoughts\":\"<model scratchpad text>\"}"
    }
  },
  {"type":"response.completed"}
]
```

There were ten `response.function_call_arguments.delta` events. Concatenating those deltas produced valid JSON with a string-valued `thoughts` property. The exact content is intentionally omitted from this report but remains in the raw log requested by the user.

This proves that GPT-6 Astra supplied the scratchpad as normal function-call JSON, not merely as opaque native reasoning metadata.

## Local `think` execution

pi parsed the completed function call into an assistant tool-call block:

```json
{
  "type": "toolCall",
  "name": "think",
  "arguments": {
    "thoughts": "<model scratchpad text>"
  }
}
```

The local tool performs no reasoning. Its acknowledgement was:

```json
{"recorded":1}
```

The useful content was already persisted in the assistant function-call arguments.

## Turn 2: replay and final answer

### Important request fields

The second request contained the original user message, the completed assistant function call, and its local result:

```json
{
  "model": "gpt-6-astra",
  "store": false,
  "stream": true,
  "input": [
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
      "name": "think",
      "call_id": "<call-id>",
      "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "<call-id>",
      "output": "{\"recorded\":1}"
    }
  ],
  "tool_choice": "auto"
}
```

The critical transition is `tool_choice`: it changed from the forced function selection to `"auto"`. The continuation is therefore free to return visible text or make another tool call.

### Equivalent request curl

```bash
curl -N 'https://chatgpt.com/backend-api/codex/responses' \
  -H 'Authorization: Bearer $OPENAI_CODEX_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "model": "gpt-6-astra",
  "store": false,
  "stream": true,
  "instructions": "<same full pi system prompt>",
  "input": [
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
      "id": "<function-call-item-id>",
      "call_id": "<call-id>",
      "name": "think",
      "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "<call-id>",
      "output": "{\"recorded\":1}"
    }
  ],
  "text": {"verbosity": "low"},
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "<session-cache-key>",
  "tool_choice": "auto",
  "parallel_tool_calls": true,
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
      },
      "strict": null
    }
  ]
}
JSON
```

### Response event sequence

The second HTTP response was `200`:

```json
[
  {"type":"response.created"},
  {"type":"response.in_progress"},
  {"type":"response.output_item.added","item":{"type":"message"}},
  {"type":"response.content_part.added"},
  {"type":"response.output_text.delta","delta":"pong"},
  {"type":"response.output_text.done","text":"pong"},
  {"type":"response.content_part.done"},
  {"type":"response.output_item.done","item":{"type":"message"}},
  {"type":"response.completed"}
]
```

pi printed `pong` and exited successfully.

## Verification checklist

- [x] Non-interactive `-p` mode used.
- [x] Model explicitly selected as `openai-codex/gpt-6-astra`.
- [x] Only the `think` tool was active.
- [x] First request registered `think(thoughts: string)`.
- [x] First request forced `tool_choice` to `think`.
- [x] First response streamed plaintext JSON function-call arguments.
- [x] Completed arguments contained a string-valued `thoughts` property.
- [x] Local tool returned `{"recorded":1}`.
- [x] Second request replayed the call and tool result.
- [x] Second request reset `tool_choice` to `"auto"`.
- [x] Second response returned visible text `pong`.
- [x] Raw requests and reassembled responses were retained in the workspace log file.

## Relevant code paths

- `packages/coding-agent/src/cli/args.ts`: parses non-interactive and think-tool options.
- `packages/coding-agent/src/core/sdk.ts`: registers `think`, turns native session thinking off, and installs payload shaping.
- `packages/coding-agent/src/core/tools/think.ts`: defines `thoughts: string`, prompt guidelines, acknowledgement, and rendering.
- `packages/coding-agent/src/core/think-tool-mode.ts`: forces the first call and resets continuation `tool_choice`.
- `packages/ai/src/api/openai-codex-responses.ts`: builds the Codex Responses payload and streams SSE events.
- `packages/coding-agent/src/core/wire-log.ts`: records request bodies and reassembled response streams.

## Limitation discovered

`PI_WIRE_LOG` currently sees the Codex SSE request after zstd compression. Its logger handles string bodies but represents binary request bodies as `[object]`. The diagnostic preload disabled zstd so that this requested run could retain the actual JSON request bodies. A permanent solution would be to make `createWireTapFetch()` decode supported compressed/binary request bodies before logging.
