import type { Usage } from "../store";

export interface Measure {
	measure: string;
	unit: string;
}

export const formatDuration = (duration: number): Measure => {
	if (duration < 1000) { return { measure: duration.toLocaleString(), unit: "ms" }; }
	duration /= 1000;
	if (duration < 60) { return { measure: duration.toPrecision(3), unit: "s" }; }
	duration /= 60;
	return { measure: duration.toPrecision(3), unit: "m" };
};

export const formatTokens = (tokens: number, full = false): Measure => {
	if (full) {
		return { measure: tokens.toLocaleString(), unit: "t" };
	} else {
		if (tokens < 10000) { return { measure: tokens.toLocaleString(), unit: "t" }; }
		tokens /= 1000;
		return { measure: tokens.toPrecision(3), unit: "kt" };
	}
};

const USAGE_LABELS: Record<string, string> = {
	prompt_tokens: "Input",
	input_tokens: "Input",
	completion_tokens: "Output",
	output_tokens: "Output",
	total_tokens: "Total",
	cache_creation_input_tokens: "Cache Write",
	cache_read_input_tokens: "Cache Read",
};

/** Human-readable label for a usage key: known keys get friendly names, others are humanized from snake_case. */
export const formatUsageLabel = (key: string): string =>
	USAGE_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/** Compute total tokens from a usage object — uses total_tokens if present, otherwise sums all values. */
export const totalTokens = (usage: Usage): number => {
	if (usage.total_tokens != null) {return usage.total_tokens;}
	return Object.values(usage).reduce((sum, v) => sum + v, 0);
};

export const nonExpandable = ["{}", "true", "false", "null", "undefined"];
export const nonExpandableKeys = ["key", "token", "secret", "password", "credential"];

export const isExpandable = (key: string, value: unknown): boolean => {
	if (typeof value === "string") {
		if (nonExpandableKeys.some((nonExpandableKey) => key.toLowerCase().includes(nonExpandableKey))) { return false; }
		return !nonExpandable.includes(value);
	} else if (typeof value === "number") {
		return false;
	} else if (typeof value === "boolean") {
		return false;
	} else if (value === null) {
		return false;
	} else if (value === undefined) {
		return false;
	} else if (Array.isArray(value)) {
		return value.length > 0;
	} else if (typeof value === "object") {
		return Object.keys(value).length > 0;
	}
	return true;
};
