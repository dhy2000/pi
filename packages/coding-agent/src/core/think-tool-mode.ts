/**
 * think-tool-mode.ts — "think-tool" reasoning mode (scratchpad-tool injection).
 *
 * The mode is fixed at session start (`--reasoning-mode native|think-tool`) and
 * is deliberately provider-agnostic: everything here is keyed off the model's
 * API dialect, never a specific provider, so it wraps any Anthropic- or
 * OpenAI-dialect model the same way.
 *
 * What the mode does (see the cot_extraction repo for the research context):
 * - registers a free-text scratchpad tool (default name `think`) whose
 *   `thoughts` parameter the model fills with its private chain-of-thought —
 *   plaintext-visible to the caller by protocol necessity;
 * - disables provider-native thinking (anthropic-messages dialect), so all
 *   reasoning flows through the scratchpad instead of a summarized/encrypted
 *   channel;
 * - forces the scratchpad call on fresh user prompts (tool_choice), mirroring
 *   the single-shot extractor's turn-0 forcing; continuation turns run "auto"
 *   so the model interleaves thinking with real tool use;
 * - because the CoT lives in the transcript as ordinary plaintext tool calls,
 *   it is preserved in the session and stays valid across `/model` switches.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

export type ReasoningMode = "native" | "think-tool";

export const REASONING_MODES: readonly ReasoningMode[] = ["native", "think-tool"];

export function isReasoningMode(value: string): value is ReasoningMode {
	return value === "native" || value === "think-tool";
}

type PayloadMessage = { role?: string; content?: unknown };
type ResponsesItem = { type?: string; role?: string };
type ThinkToolPayload = {
	messages?: PayloadMessage[];
	/** Responses-family dialects carry the conversation as `input` items. */
	input?: ResponsesItem[];
	tools?: Array<{ name?: string; function?: { name?: string } }>;
	thinking?: unknown;
	tool_choice?: unknown;
};

/**
 * True when the last wire message is a fresh user prompt (as opposed to a
 * tool-result continuation, which is also role "user" on the Anthropic
 * dialect). Forcing tool_choice on a continuation would break tool-use flow.
 */
function isFreshUserPrompt(last: PayloadMessage | undefined): boolean {
	if (last?.role !== "user") return false;
	if (typeof last.content === "string") return true;
	if (Array.isArray(last.content)) {
		return !last.content.some((block) => (block as { type?: string })?.type === "tool_result");
	}
	return false;
}

/**
 * Mutate an outgoing provider payload for think-tool reasoning mode. Composed
 * into the agent's onPayload hook; only touches dialects with a known
 * tool_choice shape, and only when the scratchpad tool is actually present in
 * the request.
 */
export function applyThinkToolPayload(payload: unknown, model: Model<Api>, toolName: string): void {
	const p = payload as ThinkToolPayload;
	if (!p || !Array.isArray(p.tools)) return;
	const scratchpadPresent = p.tools.some((tool) => tool?.name === toolName || tool?.function?.name === toolName);
	if (!scratchpadPresent) return;

	if (model.api === "anthropic-messages") {
		if (!Array.isArray(p.messages)) return;
		// The attack scenario: native thinking off, so reasoning cannot hide in a
		// summarized or encrypted channel. Only reasoning-capable models carry a
		// thinking config at all.
		if (model.reasoning) {
			p.thinking = { type: "disabled" };
		}
		if (isFreshUserPrompt(p.messages.at(-1))) {
			p.tool_choice = { type: "tool", name: toolName };
		} else if (p.tool_choice !== undefined) {
			p.tool_choice = undefined;
		}
		return;
	}

	if (model.api === "openai-completions") {
		if (!Array.isArray(p.messages)) return;
		// No portable thinking switch on this dialect — force the scratchpad
		// call only.
		if (isFreshUserPrompt(p.messages.at(-1))) {
			p.tool_choice = { type: "function", function: { name: toolName } };
		} else if (p.tool_choice !== undefined) {
			p.tool_choice = undefined;
		}
		return;
	}

	if (model.api === "openai-responses" || model.api === "openai-codex-responses") {
		if (!Array.isArray(p.input)) return;
		// Responses dialects: fresh user prompts end with a user message item;
		// tool continuations end with function_call_output. Native reasoning is
		// left untouched — concealed reasoning is what the scratchpad bypasses.
		const last = p.input.at(-1);
		const isFresh = last?.role === "user" && last?.type !== "function_call_output";
		if (isFresh) {
			p.tool_choice = { type: "function", name: toolName };
		} else if (p.tool_choice !== undefined && typeof p.tool_choice !== "string") {
			p.tool_choice = "auto";
		}
		return;
	}
}
