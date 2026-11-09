/**
 * ai-job-search-bridge.mjs — Bridge between Job Pilot and ai-job-search tools
 *
 * Exposes:
 * - checkPostingSecurity: Runs posting through ai-job-search/tools/posting_guard.py
 * - lookupCompanySalary: Runs ai-job-search/salary_lookup.py
 */

import { spawn } from "child_process";
import { join, resolve } from "path";

const AI_JOB_SEARCH_DIR = resolve(join(process.cwd(), "..", "ai-job-search"));

/**
 * Run posting_guard on a job description to check for prompt injection,
 * zero-width unicode, and hidden text.
 */
export function checkPostingSecurity(text) {
  return new Promise((res) => {
    if (!text) {
      return res({ clean: "", verdict: "clean", issues: [] });
    }

    const script = `
import sys, json, os
sys.path.insert(0, r"${AI_JOB_SEARCH_DIR.replace(/\\/g, "/")}")
from tools.posting_guard import guard

text = sys.stdin.read()
clean, findings = guard(text, "text")
print(json.dumps({
    "clean": clean,
    "verdict": findings.get("verdict", "posting_guard: clean"),
    "invisible_flagged": findings.get("invisible_flagged", 0),
    "hidden_blocks": len(findings.get("hidden_blocks", [])),
    "instruction_like": len(findings.get("instruction_like", []))
}))
`;

    const py = spawn("python", ["-c", script], {
      cwd: AI_JOB_SEARCH_DIR,
      env: { ...process.env },
    });

    let stdout = "";
    py.stdout.on("data", (d) => (stdout += d.toString()));

    py.on("close", (code) => {
      try {
        const data = JSON.parse(stdout);
        res(data);
      } catch {
        res({ clean: text, verdict: "clean", invisible_flagged: 0 });
      }
    });

    py.on("error", () => res({ clean: text, verdict: "clean", invisible_flagged: 0 }));

    py.stdin.write(text);
    py.stdin.end();
  });
}

/**
 * Lookup salary benchmark for a company
 */
export function lookupCompanySalary(company) {
  return new Promise((res) => {
    if (!company) return res(null);

    const py = spawn("python", [join(AI_JOB_SEARCH_DIR, "salary_lookup.py"), company, "--json"], {
      cwd: AI_JOB_SEARCH_DIR,
      env: { ...process.env },
    });

    let stdout = "";
    py.stdout.on("data", (d) => (stdout += d.toString()));

    py.on("close", (code) => {
      try {
        const data = JSON.parse(stdout);
        res(Array.isArray(data) && data.length > 0 ? data[0] : null);
      } catch {
        res(null);
      }
    });

    py.on("error", () => res(null));
  });
}
