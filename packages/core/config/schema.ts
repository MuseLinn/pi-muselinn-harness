// ============================================================
// MusePi settings schema (pure, host-agnostic).
//
// Single source of truth for MusePi feature configuration: field
// types, defaults, and per-key documentation. The fork's
// SettingsManager stores this under the `musepi` nested settings key
// (same pattern as `terminal` / `compaction`); a future settings
// menu edits these fields. mergeMusepiSettings applies defaults
// deep-merged with whatever the user configured.
// ============================================================

export interface MusepiGoalSettings {
	/** Show the goal badge in the footer. */
	badge?: boolean; // default: true
}

export interface MusepiTodoSettings {
	/** Max rows in the folded panel. */
	maxVisible?: number; // default: 5
}

export interface MusepiSwarmSettings {
	/** Default max_concurrency when the model does not specify it. */
	maxConcurrency?: number; // default: 5
	/** Default subagent timeout in ms. */
	timeoutMs?: number; // default: 1800000 (30 min)
	/** Default model tier when unspecified. */
	modelTier?: "cheap" | "balanced" | "premium" | "auto"; // default: "auto"
}

export interface MusepiTuiSettings {
	/** Editor chrome style. */
	style?: "plain" | "boxed" | "compact"; // default: "boxed"
	/** Show the model name in the editor's top border. */
	modelInBorder?: boolean; // default: false
}

export interface MusepiTruncationSettings {
	/** Spill threshold in chars. */
	thresholdChars?: number; // default: 40000
	/** Preview head/tail sizes in chars. */
	headChars?: number; // default: 1500
	tailChars?: number; // default: 500
}

export interface MusepiSettings {
	goal?: MusepiGoalSettings;
	todo?: MusepiTodoSettings;
	swarm?: MusepiSwarmSettings;
	tui?: MusepiTuiSettings;
	truncation?: MusepiTruncationSettings;
}

/** Default values, applied per-field when unset. */
export const MUSEPI_DEFAULTS: Required<{
	goal: Required<MusepiGoalSettings>;
	todo: Required<MusepiTodoSettings>;
	swarm: Required<MusepiSwarmSettings>;
	tui: Required<MusepiTuiSettings>;
	truncation: Required<MusepiTruncationSettings>;
}> = {
	goal: { badge: true },
	todo: { maxVisible: 5 },
	swarm: { maxConcurrency: 5, timeoutMs: 1_800_000, modelTier: "auto" },
	tui: { style: "boxed", modelInBorder: false },
	truncation: { thresholdChars: 40_000, headChars: 1_500, tailChars: 500 },
};

export type ResolvedMusepiSettings = typeof MUSEPI_DEFAULTS;

function pick<T extends object>(defaults: T, override: unknown): T {
	if (!override || typeof override !== "object") return { ...defaults };
	const out: Record<string, unknown> = { ...defaults };
	for (const key of Object.keys(defaults)) {
		const v = (override as Record<string, unknown>)[key];
		if (v !== undefined && typeof v === typeof (defaults as Record<string, unknown>)[key]) {
			out[key] = v;
		}
	}
	return out as T;
}

/**
 * Resolve user settings against defaults: each known field falls back
 * to its default when unset or mistyped; unknown fields are dropped.
 */
export function mergeMusepiSettings(raw: MusepiSettings | undefined): ResolvedMusepiSettings {
	const r = raw ?? {};
	return {
		goal: pick(MUSEPI_DEFAULTS.goal, r.goal),
		todo: pick(MUSEPI_DEFAULTS.todo, r.todo),
		swarm: pick(MUSEPI_DEFAULTS.swarm, r.swarm),
		tui: pick(MUSEPI_DEFAULTS.tui, r.tui),
		truncation: pick(MUSEPI_DEFAULTS.truncation, r.truncation),
	};
}

/** Per-key documentation for the future settings menu. */
export const MUSEPI_SETTINGS_DOCS: Array<{ key: string; description: string; defaultValue: unknown }> = [
	{ key: "goal.badge", description: "Show the goal badge in the footer", defaultValue: true },
	{ key: "todo.maxVisible", description: "Max rows in the folded todo panel", defaultValue: 5 },
	{ key: "swarm.maxConcurrency", description: "Default parallel workers for agent_swarm", defaultValue: 5 },
	{ key: "swarm.timeoutMs", description: "Subagent timeout in milliseconds", defaultValue: 1_800_000 },
	{ key: "swarm.modelTier", description: "Default model tier for subagents", defaultValue: "auto" },
	{ key: "tui.style", description: "Editor chrome style (plain/boxed/compact)", defaultValue: "boxed" },
	{ key: "tui.modelInBorder", description: "Show model name in the editor top border", defaultValue: false },
	{ key: "truncation.thresholdChars", description: "Tool-result spill threshold (chars)", defaultValue: 40_000 },
	{ key: "truncation.headChars", description: "Preview head size (chars)", defaultValue: 1_500 },
	{ key: "truncation.tailChars", description: "Preview tail size (chars)", defaultValue: 500 },
];
