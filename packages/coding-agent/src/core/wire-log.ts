/**
 * wire-log.ts — optional raw provider wire logging for research/debugging.
 *
 * Enabled by setting PI_WIRE_LOG to a file path. When set, every outgoing LLM
 * request and its full (reassembled) response body is appended to that file as
 * JSONL. This is the definitive record of what went on the wire: whether
 * `thinking` was disabled, what the scratchpad tool schema looked like, which
 * `tool_choice` was forced, and the raw SSE deltas of the response (including
 * thinking blocks — plaintext, encrypted, or absent).
 *
 * Implemented as a fetch tap, so it is dialect- and provider-agnostic.
 */

import { appendFileSync } from "node:fs";

export const WIRE_LOG_ENV = "PI_WIRE_LOG";

interface WireLogEntry {
	id: number;
	dir: "req" | "res";
	ts: string;
	url: string;
	status?: number;
	body: unknown;
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * Wrap a fetch implementation so request/response bodies are logged to
 * `logPath` (JSONL). Responses are cloned before logging, so consumers see an
 * untouched stream; SSE bodies are logged fully reassembled after completion.
 */
export function createWireTapFetch(
	logPath: string,
	inner: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	let counter = 0;
	const write = (entry: WireLogEntry): void => {
		try {
			appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
		} catch {
			// Logging must never break requests.
		}
	};
	return async (input, init) => {
		const id = ++counter;
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const body = init?.body;
		write({
			id,
			dir: "req",
			ts: new Date().toISOString(),
			url,
			body: typeof body === "string" ? tryParseJson(body) : `[${typeof body}]`,
		});
		const response = await inner(input, init);
		const clone = response.clone();
		void clone
			.text()
			.then((text) =>
				write({
					id,
					dir: "res",
					ts: new Date().toISOString(),
					url,
					status: response.status,
					body: tryParseJson(text),
				}),
			)
			.catch(() => {});
		return response;
	};
}
