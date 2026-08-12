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

/** Reasoning-effort levels for think-tool mode — mirrors pi's ThinkingLevel scale
 * (and the OpenAI/Anthropic effort conventions) so each think-tool effort cell can
 * be compared 1:1 against the same native thinking level. */
export type ThinkToolEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINK_TOOL_EFFORTS: readonly ThinkToolEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

export function isThinkToolEffort(value: string): value is ThinkToolEffort {
	return (THINK_TOOL_EFFORTS as readonly string[]).includes(value);
}

/**
 * Hard output cap (tokens) applied to the forced first scratchpad call per level.
 * Values mirror pi's native thinking budgets (minimal 1024 / low 2048 / medium
 * 8192 / high 16384), extended with xhigh; unlike native budgets the whole cap is
 * usable CoT, because the forced think turn contains only the scratchpad call —
 * the answer is produced in a separate, uncapped turn. "max" = uncapped (the
 * truncation-salvage continuation keeps reasoning unbounded).
 */
export const THINK_EFFORT_MAX_TOKENS: Record<Exclude<ThinkToolEffort, "max">, number> = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
	xhigh: 32768,
};

export interface ThinkToolOptions {
	/**
	 * Reasoning effort for the scratchpad. Unset or "max" = unbounded: truncated
	 * notes are continued in follow-up calls. Capped levels: the model is
	 * instructed to stay under the budget, the forced first call is hard-capped,
	 * and a truncated note ends reasoning ("wrap up and answer") instead of continuing.
	 */
	effort?: ThinkToolEffort;
}

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

export function thinkToolPromptGuidelines(toolName: string, effort?: ThinkToolEffort): string[] {
	const guidelines = [
		`Use the ${toolName} tool for ALL step-by-step reasoning: before answering the user, before any non-trivial tool call, and after tool results when deciding what to do next. Reason silently as little as possible — record your reasoning in ${toolName} first, then act.`,
	];
	const budget = effort && effort !== "max" ? THINK_EFFORT_MAX_TOKENS[effort] : undefined;
	if (budget) {
		guidelines.push(
			`Keep each ${toolName} note under roughly ${budget} tokens: prioritize the decisive steps, skip restatements and alternatives.`,
		);
	} else {
		guidelines.push(
			`If a ${toolName} note was cut off by the output limit, continue reasoning in the next ${toolName} call exactly where you left off.`,
		);
	}
	return guidelines;
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

export function createThinkToolDefinition(
	toolName: string = DEFAULT_THINK_TOOL_NAME,
	options: ThinkToolOptions = {},
): ToolDefinition {
	if (!THINK_TOOL_NAME_PATTERN.test(toolName)) {
		throw new Error(`Invalid think-tool name "${toolName}" (must match /^[a-zA-Z0-9_-]{1,64}$/)`);
	}
	const effort = options.effort;
	const budget = effort && effort !== "max" ? THINK_EFFORT_MAX_TOKENS[effort] : undefined;
	const description = budget
		? `${THINK_TOOL_DESCRIPTION} Keep each note under roughly ${budget} tokens.`
		: THINK_TOOL_DESCRIPTION;
	let recorded = 0;
	return {
		name: toolName,
		label: toolName,
		description,
		promptGuidelines: thinkToolPromptGuidelines(toolName, effort),
		parameters: thinkSchema,
		// Truncated thoughts are still valuable: record the salvaged prefix. With a
		// capped effort the truncation note ends reasoning instead of continuing it.
		salvageTruncatedArgs: true,
		...(budget
			? {
					truncationNote:
						"Scratchpad reasoning budget reached (output limit hit). Do NOT continue reasoning — " +
						"wrap up and write your answer now based on what you have.",
				}
			: {}),
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
