/**
 * think.ts — Scratchpad ("think-tool") for the think-tool reasoning mode.
 *
 * Registers a benign free-text scratchpad tool (default name `think`). The
 * model externalizes its chain-of-thought into the tool's `thoughts`
 * parameter, which is plaintext-visible to the caller by protocol necessity —
 * this surfaces full reasoning even from models whose native thinking is
 * summarized or encrypted (e.g. Anthropic-dialect models behind gateways).
 *
 * The tool itself is dialect-agnostic: it works with any tool-calling model,
 * on any provider. Execution is a no-op that acknowledges the note with a
 * running counter (`{"recorded": N}`); the CoT persists in the session
 * transcript as ordinary tool calls, so it also survives `/model` switches.
 *
 * Truncation handling: the tool opts into `salvageTruncatedArgs`, so a
 * max_tokens-truncated call is still recorded (partial JSON is salvage-parsed)
 * and the agent loop tells the model to continue in a follow-up call.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export const DEFAULT_THINK_TOOL_NAME = "think";

const THINK_TOOL_DESCRIPTION =
	"External scratchpad. Use it for ALL step-by-step reasoning before " +
	"answering or acting. Content is not shown to the user.";

const thinkSchema = Type.Object({
	thoughts: Type.String({ description: "Your complete private reasoning" }),
});

export type ThinkToolInput = Static<typeof thinkSchema>;

export interface ThinkToolDetails {
	/** Running count of recorded notes in this session. */
	recorded: number;
}

/** Anthropic-style tool name rule; keeps a configured tool name wire-safe. */
export const THINK_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function thinkToolPromptGuidelines(toolName: string): string[] {
	return [
		`Use the ${toolName} tool for ALL step-by-step reasoning: before answering the user, before any non-trivial tool call, and after tool results when deciding what to do next. Reason silently as little as possible — record your reasoning in ${toolName} first, then act.`,
		`If a ${toolName} note was cut off by the output limit, continue reasoning in the next ${toolName} call exactly where you left off.`,
	];
}

function formatThinkCall(thoughts: string, theme: Theme, expanded: boolean): string {
	const body = thoughts.trimEnd();
	if (!body) {
		return theme.italic(theme.fg("thinkingText", "…"));
	}
	const lines = body.split("\n");
	const maxLines = expanded ? lines.length : 12;
	const shown = lines.slice(0, maxLines).join("\n");
	let text = theme.italic(theme.fg("thinkingText", shown));
	if (lines.length > maxLines) {
		text +=
			theme.fg("muted", `\n… (${lines.length - maxLines} more lines, `) +
			keyHint("app.tools.expand", "to expand") +
			theme.fg("muted", ")");
	}
	return text;
}

function thoughtsOf(args: unknown): string {
	if (typeof args === "object" && args !== null) {
		const thoughts = (args as Record<string, unknown>).thoughts;
		if (typeof thoughts === "string") return thoughts;
	}
	return "";
}

function recordedOf(details: unknown): number | undefined {
	if (typeof details === "object" && details !== null) {
		const recorded = (details as Record<string, unknown>).recorded;
		if (typeof recorded === "number") return recorded;
	}
	return undefined;
}

export function createThinkToolDefinition(toolName: string = DEFAULT_THINK_TOOL_NAME): ToolDefinition {
	if (!THINK_TOOL_NAME_PATTERN.test(toolName)) {
		throw new Error(`Invalid think-tool name "${toolName}" (must match /^[a-zA-Z0-9_-]{1,64}$/)`);
	}
	let recorded = 0;
	return {
		name: toolName,
		label: toolName,
		description: THINK_TOOL_DESCRIPTION,
		promptGuidelines: thinkToolPromptGuidelines(toolName),
		parameters: thinkSchema,
		// Truncated thoughts are still valuable: record the salvaged prefix and
		// let the loop ask the model to continue (see agent-loop.ts).
		salvageTruncatedArgs: true,
		async execute() {
			// The note itself already lives in the transcript as the call's
			// arguments; execution only acknowledges it with a running counter.
			recorded += 1;
			return {
				content: [{ type: "text" as const, text: JSON.stringify({ recorded }) }],
				details: { recorded } satisfies ThinkToolDetails,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatThinkCall(thoughtsOf(args), theme, context.expanded));
			return text;
		},
		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const n = recordedOf(result.details);
			text.setText(theme.fg("muted", n !== undefined ? `recorded #${n}` : "recorded"));
			return text;
		},
	};
}

export function createThinkTool(toolName: string = DEFAULT_THINK_TOOL_NAME): AgentTool<typeof thinkSchema> {
	return wrapToolDefinition(createThinkToolDefinition(toolName));
}
