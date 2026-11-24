import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

// Regression guard for MSRC 150092: v1 of the extension built a shell command from
// the .prompty file name and ran it with terminal.sendText. The extension must run
// prompts in-process through the @prompty runtime and never spawn shells or processes.

const PACKAGES_DIR = path.resolve(__dirname, "../../../..");
const SOURCE_DIRS = [path.join(PACKAGES_DIR, "core", "src"), path.join(PACKAGES_DIR, "server", "src")];
const BUNDLE = path.join(PACKAGES_DIR, "core", "out", "extension.bundle.js");
const THIS_FILE = "noShellExecution.test.ts";

const FORBIDDEN_IN_SOURCE: [string, RegExp][] = [
	["createTerminal", /\bcreateTerminal\s*\(/],
	["sendText", /\bsendText\s*\(/],
	["child_process", /\bchild_process\b/],
	["ShellExecution", /\bShellExecution\b/],
	["ProcessExecution", /\bProcessExecution\b/],
	["tasks.executeTask", /\bexecuteTask\s*\(/],
];

// Only VS Code terminal APIs are checked in the bundle: third-party SDKs (for example
// @azure/identity's AzureCliCredential) legitimately use child_process with fixed arguments.
const FORBIDDEN_IN_BUNDLE: [string, RegExp][] = [
	["createTerminal", /\bcreateTerminal\s*\(/],
	["sendText", /\.sendText\s*\(/],
];

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSourceFiles(full));
		} else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && entry.name !== THIS_FILE) {
			files.push(full);
		}
	}
	return files;
}

suite("No shell execution (MSRC 150092)", () => {
	test("first-party source never creates terminals, tasks, or child processes", () => {
		const violations: string[] = [];
		for (const dir of SOURCE_DIRS) {
			assert.ok(fs.existsSync(dir), `missing source dir ${dir}`);
			for (const file of listSourceFiles(dir)) {
				const text = fs.readFileSync(file, "utf-8");
				for (const [name, pattern] of FORBIDDEN_IN_SOURCE) {
					if (pattern.test(text)) {
						violations.push(`${path.relative(PACKAGES_DIR, file)}: ${name}`);
					}
				}
			}
		}
		assert.deepStrictEqual(violations, []);
	});

	test("bundled extension never sends text to a terminal", function () {
		if (!fs.existsSync(BUNDLE)) {
			this.skip();
		}
		const text = fs.readFileSync(BUNDLE, "utf-8");
		const violations = FORBIDDEN_IN_BUNDLE.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
		assert.deepStrictEqual(violations, []);
	});

	test("bundled extension never loads vscode as native ESM", function () {
		if (!fs.existsSync(BUNDLE)) {
			this.skip();
		}
		// `import("vscode")` cannot resolve in the extension host; vscode must be required.
		assert.ok(!/\bimport\(\s*["']vscode["']\s*\)/.test(fs.readFileSync(BUNDLE, "utf-8")));
	});
});
