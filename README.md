# pi-think — the pi agent with custom think enabled

> **pi-think** is a fork of the [pi](https://github.com/earendil-works/pi) coding
> agent that adds one feature on top of an otherwise untouched upstream: a
> startup-selected **think-tool reasoning mode**. With it, the model's
> chain-of-thought is externalized into a plaintext scratchpad **tool call**, so
> the full reasoning becomes visible — live in the TUI, and persisted in the
> session file — even for models whose native thinking is hidden, summarized, or
> encrypted. Everything below the separator is upstream pi documentation.

## What it does

Frontier-model APIs increasingly conceal chain-of-thought: summarized thinking, or
fully encrypted thinking blocks (opaque `signature`, empty text). pi-think
operationalizes the **scratchpad-tool injection** method inside a full coding agent:

- A benign free-text scratchpad tool (default name `think`, parameter `thoughts`) is
  registered. Tool arguments are plaintext-visible to the API caller by protocol
  necessity — function calling cannot work otherwise.
- The model is steered (system prompt + a forced first call per user prompt) to write
  its step-by-step reasoning into `thoughts`, and the TUI renders it like native
  thinking. The CoT persists in the session transcript as ordinary tool calls, so it
  stays readable across `/model` switches and is saved in the session file.

The mechanism is **dialect-generic**: request shaping keys off the model's API family
(`anthropic-messages` / `openai-completions` / `openai-responses`), never a specific
provider, so it works with any tool-calling model on those dialects — including
Anthropic-compatible gateways and OpenAI-compatible endpoints configured in
`~/.pi/agent/models.json`. No provider is hardcoded.

## Install

```bash
git clone https://github.com/ict-agent/pi-think.git
cd pi-think
npm install
npm run build

# run from the repo:
node packages/coding-agent/dist/cli.js --reasoning-mode think-tool

# or put the `pi` binary on your PATH:
(cd packages/coding-agent && npm link)
pi --reasoning-mode think-tool
```

Requires Node.js (see upstream pi's prerequisites). All stock pi configuration
(`~/.pi/agent`, providers, models, themes, extensions) works unchanged — pi-think
only adds the reasoning-mode flags.

## Usage

```bash
pi --reasoning-mode think-tool --model <provider>/<model>   # CoT visible, live
pi --reasoning-mode think-tool --think-tool-name deep_think # custom scratchpad name
pi --reasoning-mode native                                  # stock pi (default)
PI_WIRE_LOG=/tmp/wire.jsonl pi --reasoning-mode think-tool  # + raw request/response log
```

- `--reasoning-mode` is fixed at startup; there is no runtime switching. `native` is
  unmodified pi.
- In think-tool mode, Anthropic-dialect reasoning models get `thinking: {"type":
  "disabled"}` pinned on the wire, and the scratchpad call is forced via
  `tool_choice` on fresh user prompts (continuation turns run `auto`, so thinking
  interleaves with real tool use). The same forcing applies on the OpenAI Chat and
  Responses dialects.
- A scratchpad call truncated by the output token limit is recorded with its
  salvaged partial arguments and the model is asked to continue — reasoning length
  is unbounded.
- If a model writes its visible reply into the scratchpad and ends the turn with an
  empty message (observed with haiku-class models), the harness enqueues a one-shot
  nudge telling it to write the actual reply.
- `PI_WIRE_LOG` appends every raw LLM request/response body (JSONL; SSE responses
  reassembled) — the on-the-wire ground truth for exactly what thinking/tool payloads
  were sent and received.

### Change map vs upstream

- `packages/agent`: `AgentTool.salvageTruncatedArgs` + truncated-message salvage path
  in the agent loop.
- `packages/ai`: anthropic compat flag `supportsPromptCaching` (providers whose
  non-Claude upstreams reject `cache_control`).
- `packages/coding-agent`: `core/tools/think.ts` (scratchpad tool + TUI renderer),
  `core/think-tool-mode.ts` (dialect-generic payload shaping), `core/wire-log.ts`
  (`PI_WIRE_LOG`), empty-answer nudge in `agent-session.ts`, `--reasoning-mode` /
  `--think-tool-name` CLI flags, sdk wiring.

---

<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# Pi Agent Harness

This is the home of the Pi agent harness project including our self extensible coding agent.

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

To learn more about Pi:

* [Visit pi.dev](https://pi.dev), the project website with demos
* [Read the documentation](https://pi.dev/docs/latest), but you can also ask the agent to explain itself

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/chord](packages/chord)** | Standalone application-composition runtime for services, replicated state, RPC, and plugins |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs. The script installs dependencies and builds the executable with its runtime assets; pass `--skip-install` if dependencies are already provided.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
