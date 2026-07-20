// ============================================================
// Stream rules — per-turn injection into the agent loop's prompt
// assembly (pure, host-agnostic).
//
// A stream rule fires when its matcher regex hits the recent
// conversation text; its `inject` text is appended to the system
// prompt for that turn. `once` rules fire a single time per session;
// `cooldownTurns` rules re-fire at most every N turns. Rules are
// evaluated per turn right before the LLM request is built — the TS
// layer of the agent loop, no stream interception needed.
// ============================================================

export interface StreamRule {
	id: string;
	/** Regex source matched against recent conversation text; undefined = always fires. */
	matcher?: string;
	inject: string;
	once?: boolean;
	cooldownTurns?: number;
}

export interface StreamRuleFireState {
	firedAtTurn: Map<string, number>;
	turn: number;
}

export function createStreamRuleState(): StreamRuleFireState {
	return { firedAtTurn: new Map(), turn: 0 };
}

/**
 * Decide which rules inject this turn and advance the state.
 * recentText: the tail of the conversation (caller picks the window).
 */
export function evaluateStreamRules(
	rules: readonly StreamRule[],
	state: StreamRuleFireState,
	recentText: string,
): string[] {
	state.turn += 1;
	const injections: string[] = [];
	for (const rule of rules) {
		if (!rule || typeof rule.inject !== "string" || rule.inject.trim() === "") continue;
		if (rule.once && state.firedAtTurn.has(rule.id)) continue;
		const lastFired = state.firedAtTurn.get(rule.id);
		if (lastFired !== undefined && rule.cooldownTurns !== undefined && state.turn - lastFired < rule.cooldownTurns) {
			continue;
		}
		if (rule.matcher !== undefined) {
			let re: RegExp;
			try {
				re = new RegExp(rule.matcher, "i");
			} catch {
				continue; // bad regex — skip the rule, never break the turn
			}
			if (!re.test(recentText)) continue;
		}
		injections.push(rule.inject);
		state.firedAtTurn.set(rule.id, state.turn);
	}
	return injections;
}

/**
 * Compose the turn's system prompt: base + injected rules block.
 * No injections → base unchanged (zero overhead on the prompt cache).
 */
export function applyStreamRuleInjections(basePrompt: string, injections: readonly string[]): string {
	if (injections.length === 0) return basePrompt;
	return `${basePrompt}\n\n## Active stream rules\n${injections.map((t) => `- ${t}`).join("\n")}`;
}

/**
 * Minimal TOML subset parser for [[stream_rules]] tables:
 *   [[stream_rules]]
 *   id = "no-todos-yet"
 *   matcher = "todo_list"
 *   inject = "Do not create todos for trivial tasks"
 *   once = true
 *   cooldownTurns = 5
 */
export function parseStreamRulesToml(content: string): StreamRule[] {
	const rules: StreamRule[] = [];
	let cur: StreamRule | null = null;
	const flush = () => {
		if (cur && cur.id && cur.inject) rules.push(cur);
		cur = null;
	};
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if (/^\[\[stream_rules\]\]$/i.test(line)) {
			flush();
			cur = { id: "", inject: "" };
			continue;
		}
		if (!cur) continue;
		const m = /^(\w+)\s*=\s*(.+)$/.exec(line);
		if (!m) continue;
		const [, key, rawVal] = m;
		const str = rawVal.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
		switch (key) {
			case "id": cur.id = str; break;
			case "matcher": cur.matcher = str; break;
			case "inject": cur.inject = str; break;
			case "once": cur.once = str === "true"; break;
			case "cooldownTurns": {
				const n = Number.parseInt(str, 10);
				if (Number.isFinite(n) && n > 0) cur.cooldownTurns = n;
				break;
			}
			default: break; // unknown keys ignored (forward-compatible)
		}
	}
	flush();
	return rules;
}
