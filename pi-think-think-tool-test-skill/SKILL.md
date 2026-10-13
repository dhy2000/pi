---
name: test-pi-think-think-tool
description: Runs pi-think non-interactively on a complex reasoning benchmark, captures raw provider requests and SSE responses, extracts the think-tool scratchpad and final answer, checks that the reasoning is substantive and answer-consistent, and writes a Markdown report. Use when testing whether pi-think exposes useful model reasoning through the `think` tool.
compatibility: Requires Node.js, a built pi-think checkout, a configured tool-calling model, provider credentials, and network access.
---

# Test pi-think Think-Tool

Test the local pi-think checkout in non-interactive mode, capture the provider wire exchange, verify that model scratchpad reasoning arrives as the plaintext `think.arguments.thoughts` field, and write a sensitive Markdown report containing the response summary, full scratchpad, and verification evidence into the caller's current directory.

## Safety and operating rules

- Use a harmless but genuinely multi-step problem. Do not use a trivial echo prompt such as `Answer with exactly: pong` for the main test.
- Tell the user that this invokes a real model and may consume paid tokens before running it, unless they already explicitly requested a live replay.
- Never print, copy, or write API-key values into the report.
- Render authorization as `Authorization: Bearer $PROVIDER_API_KEY`.
- Treat the wire log and report as sensitive because they contain prompts, tool arguments, model scratchpad text, and responses. Set both files to mode `0600`.
- Keep the raw wire log in the caller's current directory so the user can inspect every request and response. Remove only temporary parser scripts and stdout/stderr captures.
- Include the captured `thoughts` text verbatim in the report, clearly labeled **think-tool scratchpad**. Do not label it a provider-native thinking block.
- Never claim that tool-call text proves access to the model's hidden internal chain-of-thought. The test can verify only that the emitted scratchpad is substantive, question-specific, logically useful, and consistent with the final answer.
- Do not use `--no-tools`: in this codebase it can prevent the `think` tool from reaching the provider payload.
- Prefer `--tools think` to isolate the experiment from filesystem and shell tools.
- Do not run a build unless the user requests it. If `packages/coding-agent/dist/cli.js` is absent, report that the checkout must be built first.

## Inputs

Use these defaults when the user does not specify values:

- Prompt: the project-selection benchmark below
- Think-tool name: `think`
- Think effort: `medium` (about 8k tokens where the dialect supports a hard cap)
- Report: `pi-think-think-tool-wire-report.md`
- Raw wire log: `pi-think-think-tool-wire.jsonl`

### Default complex benchmark

Use this exact prompt when the user does not provide a complex question:

```text
Solve this constrained project-selection problem. Show only a concise final answer with the selected projects, total cost, total value, and a short optimality justification; do all detailed reasoning in the think tool.

Budget: 22. Each project is listed as project: (cost, value):
A:(4,9), B:(6,13), C:(5,11), D:(7,15), E:(3,7), F:(8,18), G:(4,8), H:(6,14), I:(2,4), J:(5,12).

Constraints:
1. Select exactly one of F and G.
2. Selecting D requires B.
3. Selecting H requires C and forbids E.
4. A and J cannot both be selected.
5. If F is selected, at least one of D or H must be selected.
6. Select at least four projects.
7. I may be selected only if E or G is selected.

Find the feasible selection with maximum total value. Break value ties by lower total cost, then by lexicographically smallest sorted project list. Justify optimality by comparing the best feasible possibilities in the F and G branches.
```

The independently verified optimum is:

- selected projects: `C, G, H, I, J`
- total cost: `22`
- total value: `49`
- the `F` branch has no feasible selection under all constraints

Do not put the oracle answer into the model prompt. Use it only after generation to check the captured scratchpad and final answer. For an alternative user-supplied problem, establish an independent oracle with a small exhaustive solver, exact calculation, tests, or another deterministic method before judging the model.

Choose the provider and model as follows:

1. Use an explicit provider/model supplied by the user.
2. Otherwise inspect `node packages/coding-agent/dist/cli.js --list-models` and select a configured tool-calling model.
3. Prefer an OpenAI Responses or OpenAI Chat Completions model because its function-call wire format is straightforward to replay as curl.
4. Do not inspect or print credential values. It is acceptable to list environment-variable names without values.

## Procedure

### 1. Establish paths and check prerequisites

Record the caller's current directory as `CALLER_CWD`. Resolve the repository root with:

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
PI_CLI="$REPO_ROOT/packages/coding-agent/dist/cli.js"
```

Verify that `$PI_CLI` exists. Check available models:

```bash
node "$PI_CLI" --list-models
```

Do not read `auth.json` or print secret environment values.

### 2. Run pi-think non-interactively

Write the wire log into the caller's current directory and capture stdout/stderr temporarily:

```bash
STAMP="$(date +%s)"
WIRE_LOG="$CALLER_CWD/pi-think-think-tool-wire.jsonl"
RUN_OUT="/tmp/pi-think-run-$STAMP.out"
RUN_ERR="/tmp/pi-think-run-$STAMP.err"
rm -f "$WIRE_LOG"

PI_WIRE_LOG="$WIRE_LOG" \
node "$PI_CLI" \
  --provider "$PROVIDER" \
  --model "$MODEL" \
  --reasoning-mode think-tool \
  --think-tool-name "$THINK_TOOL_NAME" \
  --think-effort "$THINK_EFFORT" \
  --tools "$THINK_TOOL_NAME" \
  --no-context-files \
  --no-extensions \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-session \
  -p "$PROMPT" \
  >"$RUN_OUT" 2>"$RUN_ERR"
```

For the default benchmark, successful stdout must identify `C, G, H, I, J`, cost `22`, and value `49`, with a concise optimality justification.

Provider retries may create repeated request entries. Preserve and explain them rather than pretending only one request occurred. After the run, set `chmod 600 "$WIRE_LOG"`.

### 3. Parse the JSONL wire log

Each line has this shape:

```json
{
  "id": 1,
  "dir": "req",
  "ts": "...",
  "url": "https://provider.example/responses",
  "status": 200,
  "body": {}
}
```

Request bodies are usually JSON objects. Streaming response bodies are stored as reassembled SSE text, not as a JSON array.

Write any multi-line parsing program to a temporary file under `/tmp`; do not embed a multi-line program directly in a shell command. Parse SSE blocks by collecting their `event:` and `data:` lines, then JSON-parse each `data:` value.

For every request, extract:

- wire id and URL,
- model,
- input/messages roles and item types,
- tool definitions,
- native reasoning/thinking setting,
- `tool_choice`,
- output-token cap.

For every response, extract:

- HTTP status,
- SSE event sequence,
- function-call name,
- accumulated function-call arguments,
- function-call output,
- final visible text,
- provider error or retry evidence.

### 4. Verify the mechanism

A passing OpenAI Responses run must demonstrate two logical turns.

#### Forced scratchpad turn

The request must contain equivalents of:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "think",
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
  "tool_choice": {
    "type": "function",
    "name": "think"
  }
}
```

With `--think-effort medium`, expect an 8192-token cap on this forced turn where supported. `openai-codex-responses` deliberately omits the hard cap because that backend rejects `max_output_tokens`; for that dialect, effort control is instruction-level only.

The response must contain a completed function call equivalent to:

```json
{
  "type": "function_call",
  "name": "think",
  "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
}
```

Fail the verification if the model only emits native reasoning and no `think` tool call.

#### Continuation/final-answer turn

The next request must replay both items:

```json
{
  "type": "function_call",
  "name": "think",
  "arguments": "{\"thoughts\":\"<model scratchpad text>\"}"
}
```

```json
{
  "type": "function_call_output",
  "output": "{\"recorded\":1}"
}
```

On this continuation, forced `tool_choice` should be absent or reset to automatic mode, and the normal answer-token budget should be restored. The response should then contain visible assistant text.

For OpenAI Chat Completions, map the same checks to `messages`, `tool_calls[].function.arguments`, and a tool-role result. For Anthropic Messages, map them to `tool_use`, `input_json_delta`, and `tool_result`; also verify native thinking is sent as disabled when the model supports reasoning.

#### Extract the complete scratchpad

Parse every successful response's SSE `data:` records. For OpenAI Responses-family logs, select each `response.function_call_arguments.done` event, parse its `.arguments` JSON string, and extract `.thoughts`. Concatenate multiple `think` calls in chronological order with clear call separators.

A jq extraction for the first response is:

```bash
jq -rs '
  map(select(.dir == "res"))[0].body
  | gsub("\\r"; "")
  | split("\\n\\n")[]
  | [
      split("\\n")[]
      | select(startswith("data: "))
      | ltrimstr("data: ")
    ]
  | select(length > 0)
  | join("\\n")
  | fromjson
  | select(.type == "response.function_call_arguments.done")
  | .arguments
  | fromjson
  | .thoughts
' "$WIRE_LOG"
```

Adapt the extraction to Chat Completions or Anthropic SSE event shapes when necessary.

#### Verify reasoning quality and answer consistency

Use **observable scratchpad validity** as the verification target. Do not call it proof of hidden internal thinking.

For the default benchmark, independently enumerate all `2^10 = 1024` project subsets in a temporary script and enforce every budget and dependency constraint. Confirm the unique optimum before evaluating the model. Do not infer correctness from the model's own scratchpad.

Evaluate the captured scratchpad against all of these checks:

1. **Non-empty and substantive:** at least 500 characters by default, with multiple inferential or computational steps. A shorter correct derivation is `PARTIAL`, not a plumbing failure.
2. **Question-specific:** refers to several named projects, costs/values, the budget, and relevant constraints rather than merely restating the prompt.
3. **Constraint-aware:** explicitly handles the exactly-one-of-`F`/`G` split, prerequisites/exclusions, and budget feasibility.
4. **Derivational:** contains intermediate candidate totals, eliminations, bounds, or comparisons that could reasonably lead to the answer.
5. **Oracle-correct:** supports `C,G,H,I,J`, cost `22`, value `49`, recognizes that the `F` branch is infeasible under all constraints, and rules out a better feasible `G`-branch alternative.
6. **Answer-consistent:** the visible final answer agrees with the scratchpad's conclusion and the independent oracle.
7. **No material contradiction:** no invalid selected set, arithmetic error affecting the conclusion, or unsupported optimality claim.

Classify the result:

- `PASS`: wire mechanism passes and all seven observable reasoning checks pass.
- `PARTIAL`: wire mechanism passes and the answer is correct, but reasoning is too brief, incomplete, or weakly justified.
- `FAIL`: no plaintext `think.arguments.thoughts`, the scratchpad is unrelated/non-derivational, or the final answer is materially inconsistent or incorrect.

Also summarize the visible response in 2–4 sentences: state the selected answer, key totals, and whether its optimality explanation matches the scratchpad and oracle.

### 5. Produce curl reproductions

For each successful logical provider request, write a sanitized curl command with JSON supplied through a quoted heredoc:

```bash
curl -N 'https://provider.example/responses' \
  -H 'Authorization: Bearer $PROVIDER_API_KEY' \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "model": "..."
}
JSON
```

Requirements:

- Preserve the actual API dialect and endpoint observed in the wire log.
- Preserve fields important to think-tool behavior.
- Replace credentials and session/cache identifiers with placeholders.
- Abbreviate unrelated system-prompt text.
- Mark curl as an equivalent reconstruction when the wire logger did not record headers.
- Show streamed responses as JSON event summaries, while noting that the actual transport was SSE.

### 6. Write the report into the caller's current directory

Write `$CALLER_CWD/$REPORT_NAME`. Include:

1. Test environment: date, commit, CLI path, provider/model, prompt, effort.
2. Exact non-interactive pi-think command with secrets omitted.
3. Exit status, stdout, and stderr.
4. Chronological request/response table, including retries.
5. Sanitized curl reconstruction for each logical request.
6. Sanitized SSE event breakdown for each successful response.
7. A **Captured think-tool scratchpad** section containing the complete extracted `thoughts` text in chronological order. State its character count and number of think calls.
8. A **Response summary** section with a 2–4 sentence summary of the visible answer.
9. A **Reasoning-quality verification** table covering the seven checks above, with concrete evidence from the scratchpad, final answer, and independent oracle.
10. Verification of:
   - registered `think(thoughts: string)` schema,
   - forced first `tool_choice`,
   - plaintext function-call arguments,
   - local `{"recorded":1}` acknowledgement,
   - continuation request replay,
   - unforced final-answer turn.
11. Code-path map:
   - `packages/coding-agent/src/cli/args.ts`
   - `packages/coding-agent/src/core/sdk.ts`
   - `packages/coding-agent/src/core/tools/think.ts`
   - `packages/coding-agent/src/core/think-tool-mode.ts`
   - the relevant provider adapter under `packages/ai/src/api/`
12. `PASS`, `PARTIAL`, or `FAIL`, plus limitations.

Set `chmod 600 "$CALLER_CWD/$REPORT_NAME"` because the report contains the full scratchpad.

Use this conclusion when all checks pass:

```text
PASS: pi-think captured a substantive, question-specific, oracle-consistent scratchpad as the plaintext JSON value of the forced `think` call's `thoughts` argument, acknowledged and replayed it, and then produced a consistent final answer. This verifies observable scratchpad reasoning, not identity with hidden internal chain-of-thought.
```

### 7. Clean up

After the report and wire log are safely written:

```bash
chmod 600 "$WIRE_LOG" "$CALLER_CWD/$REPORT_NAME"
rm -f "$RUN_OUT" "$RUN_ERR" /tmp/<parser-script> /tmp/<oracle-script>
```

Retain the raw wire log and report in the caller's current directory. Do not remove files outside this experiment.

## Common failure cases

### Wire log is empty

Likely causes:

- The selected transport/provider path does not use the injected fetch implementation.
- The environment variable was not present in the pi process.
- The request failed before fetch.

Retry with an explicitly selected configured OpenAI Responses or OpenAI Completions model. Record the limitation if the provider SDK bypasses the wire tap.

### Request contains no `tools`

Check that the command used `--tools think`. Do not use `--no-tools`, because that can exclude the scratchpad despite think-tool mode being selected.

### Request contains `think` but no forced `tool_choice`

Check that the request represents a fresh user prompt. Continuation requests intentionally do not force the scratchpad.

### Provider retries

Wire ids may show several identical requests before one response. Report all attempts. A successful later attempt can still validate the mechanism.

### Scratchpad call is truncated

The tool opts into truncated-argument salvage. Verify that the partial `thoughts` prefix is recorded and that the tool result includes the continuation or wrap-up instruction appropriate to the selected effort.

### Model puts the answer in the scratchpad and emits no final text

pi-think has an empty-answer nudge in `packages/coding-agent/src/core/agent-session.ts`. If it fires, document the extra provider turn and show the nudge in sanitized form.

### Scratchpad is present but trivial or unrelated

Classify the run as `PARTIAL` when the answer is oracle-correct but the scratchpad is too short or omits meaningful derivation. Classify it as `FAIL` when the scratchpad is generic, unrelated to the problem, materially contradictory, or inconsistent with the final answer. Preserve the evidence in the report.

### User asks whether this proves "real" hidden thinking

State the limitation directly: tool-call text is observable model output elicited as a scratchpad. Relevance, detailed derivation, oracle correctness, and answer consistency provide strong evidence that it functioned as reasoning for the task, but cannot prove identity with unobservable internal activations or a provider-native hidden chain-of-thought block.
