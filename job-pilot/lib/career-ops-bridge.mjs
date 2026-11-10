/**
 * career-ops-bridge.mjs — Bridge between Job Pilot and career-ops engine
 *
 * Exposes:
 * - evaluateWithCareerOps: Evaluates a JD using career-ops/openai-eval.mjs + DeepSeek,
 *   saves official report to career-ops/reports/, registers tracker addition,
 *   merges into applications.md, syncs applications.db, and extracts drafted answers.
 * - getTrackedApplications: Queries career-ops/tracker.mjs query --json
 * - getFunnelStats: Queries career-ops/stats.mjs
 * - updateApplicationStatus: Calls career-ops/set-status.mjs
 * - scanAtsPortals: Runs career-ops/scan.mjs --json
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync, readFileSync, existsSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, resolve } from "path";

import { generateAnswers } from "./deepseek.mjs";

const CAREER_OPS_DIR = resolve(join(process.cwd(), "..", "career-ops"));

function getCandidateCv() {
  const cvPath = join(CAREER_OPS_DIR, "cv.md");
  if (existsSync(cvPath)) return readFileSync(cvPath, "utf-8");
  return "";
}

/**
 * Run a command in career-ops directory and return stdout/stderr
 */
function runCareerOpsCmd(cmd, args, timeoutMs = 120000) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd: CAREER_OPS_DIR,
      env: { ...process.env },
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rej(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      res({ code, stdout, stderr });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

/**
 * Merge pending tracker additions and sync SQLite database
 */
export async function syncCareerOpsTracker() {
  try {
    await runCareerOpsCmd("node", ["merge-tracker.mjs"]);
    await runCareerOpsCmd("node", ["tracker.mjs", "sync"]);
  } catch (e) {
    console.warn("Tracker sync warning:", e.message);
  }
}

/**
 * Parse an official career-ops markdown report
 */
function parseReportMarkdown(content, reportPath) {
  const scoreMatch = content.match(/\*\*Score:\*\*\s*([\d.]+)\/5/);
  const archetypeMatch = content.match(/\*\*Archetype:\*\*\s*(.+)/);
  const decisionMatch = content.match(/\*\*Decision:\*\*\s*(.+)/);
  const legitimacyMatch = content.match(/\*\*Legitimacy:\*\*\s*(.+)/);

  // Extract lead summary paragraph
  let summary = "";
  const leadMatch = content.match(/\*\*(?:Apply|SKIP|Proceed|STRETCH)[^.]*\.\*\*([^\n]+)/);
  if (leadMatch) {
    summary = leadMatch[0];
  } else {
    const lines = content.split("\n");
    const summaryStart = lines.findIndex((l) => l.trim() === "---");
    if (summaryStart !== -1 && lines[summaryStart + 2]) {
      summary = lines[summaryStart + 2];
    }
  }

  // Extract Draft Application Answers (Section H)
  const answers = {};
  const answersBlock = content.match(/## H\)[ \t]+Draft Application Answers([\s\S]*?)(?=\n## |\n---|\n─|$)/i);
  if (answersBlock) {
    const rawSection = answersBlock[1];
    const qaPairs = rawSection.split(/\n\*\*(.+?)\*\*\n/g).filter(Boolean);
    for (let i = 0; i < qaPairs.length; i += 2) {
      const q = qaPairs[i].trim();
      const a = (qaPairs[i + 1] || "").replace(/^>\s*/gm, "").trim();
      if (q && a) {
        answers[q] = a;
      }
    }
  }

  // Extract Strengths and Gaps from CV Match Table
  const strengths = [];
  const gaps = [];
  const cvMatchBlock = content.match(/## B\) Match with CV([\s\S]*?)## C\)/);
  if (cvMatchBlock) {
    const rows = cvMatchBlock[1].split("\n").filter((l) => l.includes("|"));
    for (const r of rows) {
      if (r.includes("Strong") || r.includes("✅")) {
        const parts = r.split("|").map((p) => p.trim());
        if (parts[1]) strengths.push(`${parts[1]}: ${parts[3] || ""}`);
      } else if (r.includes("Missing") || r.includes("Gap") || r.includes("partial")) {
        const parts = r.split("|").map((p) => p.trim());
        if (parts[1]) gaps.push(`${parts[1]}: ${parts[5] || parts[3] || ""}`);
      }
    }
  }

  return {
    score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
    archetype: archetypeMatch ? archetypeMatch[1].trim() : "",
    verdict: decisionMatch ? decisionMatch[1].trim() : (scoreMatch && parseFloat(scoreMatch[1]) >= 4 ? "APPLY" : "REVIEW"),
    legitimacy: legitimacyMatch ? legitimacyMatch[1].trim() : "",
    summary: summary.trim(),
    answers,
    strengths: strengths.slice(0, 5),
    gaps: gaps.slice(0, 4),
    reportPath,
  };
}

/**
 * Evaluate a job description with career-ops/openai-eval.mjs using DeepSeek
 */
export async function evaluateWithCareerOps({ jobTitle, company, description, postingUrl }) {
  const tempId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tempPath = join(CAREER_OPS_DIR, "jds", `${tempId}.txt`);

  try {
    const jdHeader = `Job Title: ${jobTitle}\nCompany: ${company}\n\nDescription:\n${description}`;
    writeFileSync(tempPath, jdHeader, "utf-8");

    const args = ["openai-eval.mjs", "--file", `./jds/${tempId}.txt`];
    if (postingUrl) {
      args.push("--posting-url", postingUrl);
    }

    console.log(`[career-ops] Evaluating with DeepSeek: ${company} — ${jobTitle}`);
    const { code, stdout, stderr } = await runCareerOpsCmd("node", args, 150000);

    // Look for generated report in stdout
    const reportMatch = stdout.match(/Report saved: (reports\/[^\r\n]+)/);
    let reportPath = reportMatch ? reportMatch[1] : null;

    let parsedResult = null;
    if (reportPath) {
      const fullReportPath = join(CAREER_OPS_DIR, reportPath);
      if (existsSync(fullReportPath)) {
        const content = readFileSync(fullReportPath, "utf-8");
        parsedResult = parseReportMarkdown(content, reportPath);
      }
    }

    // Merge into official applications.md and sync SQLite applications.db
    await syncCareerOpsTracker();

    if (!parsedResult) {
      // Fallback: parse score from stdout
      const scoreM = stdout.match(/Score:\s*([\d.]+)\/5/);
      parsedResult = {
        score: scoreM ? parseFloat(scoreM[1]) : 3.5,
        verdict: scoreM && parseFloat(scoreM[1]) >= 4 ? "APPLY" : "REVIEW",
        archetype: "Engineering",
        summary: stdout.substring(0, 400),
        answers: {},
        strengths: [],
        gaps: [],
      };
    }

    // If career-ops omitted Draft Answers (e.g. for score < 4.0 SKIP), generate fallback answers
    if (!parsedResult.answers || Object.keys(parsedResult.answers).length === 0) {
      try {
        const cvText = getCandidateCv();
        const fallback = await generateAnswers(jobTitle, company, description, cvText);
        parsedResult.answers = {
          "Cover Letter": fallback.coverLetter,
          "Why are you interested in this role?": fallback.whyInterested,
          "Why should we hire you?": fallback.whyHireMe,
          "Relevant Experience": fallback.relevantExperience,
          "Salary Expectation": fallback.salaryExpectation,
        };
      } catch (err) {
        console.warn("Fallback answers error:", err.message);
      }
    }

    return parsedResult;
  } finally {
    // Cleanup temporary JD file
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch { /* ignore */ }
  }
}

/**
 * Query official career-ops applications database
 */
export async function getTrackedApplications(statusFilter) {
  try {
    const args = ["tracker.mjs", "query", "--json"];
    if (statusFilter) args.push("--status", statusFilter);
    const { stdout } = await runCareerOpsCmd("node", args);
    return JSON.parse(stdout);
  } catch (e) {
    console.error("Failed to query tracker:", e.message);
    return [];
  }
}

/**
 * Get career-ops funnel and tracker analytics
 */
export async function getCareerOpsStats() {
  try {
    const { stdout } = await runCareerOpsCmd("node", ["stats.mjs"]);
    return JSON.parse(stdout);
  } catch (e) {
    console.error("Failed to get stats:", e.message);
    return null;
  }
}

/**
 * Update application status in career-ops
 */
export async function updateCareerOpsStatus(company, state, role) {
  try {
    const args = ["set-status.mjs", company, state, "--json"];
    if (role) args.push("--role", role);
    const { stdout } = await runCareerOpsCmd("node", args);
    await syncCareerOpsTracker();
    return JSON.parse(stdout);
  } catch (e) {
    console.warn("set-status warning:", e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Scan direct ATS portals (Greenhouse, Lever, Ashby, etc.)
 */
export async function scanCareerOpsATS() {
  try {
    const { stdout } = await runCareerOpsCmd("node", ["scan.mjs", "--since", "7", "--quiet"], 180000);
    return { success: true, log: stdout };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Tailor personal resume (HTML + PDF) for a specific job using career-ops + DeepSeek
 */
export async function tailorResumeForJob({ jobId, jobTitle, company, description, reportPath }) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = "https://api.deepseek.com";
  const resumesDir = resolve(join(process.cwd(), "data", "resumes"));

  // 1. Ensure a valid JD file exists in career-ops/jds/
  const safeJobId = (jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const tempJdPath = join(CAREER_OPS_DIR, "jds", `jd-${safeJobId}.txt`);
  const jdContent = `Job Title: ${jobTitle || "Engineer"}\nCompany: ${company || "Company"}\n\nDescription:\n${description || "No description provided."}`;
  writeFileSync(tempJdPath, jdContent, "utf-8");

  // 2. Resolve or generate evaluation report
  let targetReport = reportPath;
  if (!targetReport || !existsSync(join(CAREER_OPS_DIR, targetReport))) {
    const reportsDir = join(CAREER_OPS_DIR, "reports");
    const reports = existsSync(reportsDir)
      ? readdirSync(reportsDir).filter((f) => f.endsWith(".md") && !f.startsWith("."))
      : [];

    const compNorm = (company || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const matching = reports.find((r) => r.toLowerCase().replace(/[^a-z0-9]/g, "").includes(compNorm));

    if (matching) {
      targetReport = `reports/${matching}`;
    } else if (reports.length > 0) {
      const sorted = reports.sort((a, b) => b.localeCompare(a));
      targetReport = `reports/${sorted[0]}`;
    } else {
      console.log(`[career-ops] No report found. Generating evaluation for ${company}...`);
      const evalRes = await evaluateWithCareerOps({ jobTitle, company, description });
      targetReport = evalRes.reportPath;
    }
  }

  if (!targetReport || !existsSync(join(CAREER_OPS_DIR, targetReport))) {
    throw new Error("Could not resolve an evaluation report to guide tailoring.");
  }

  const reportFilename = targetReport.split("/").pop().split("\\").pop();
  const reportNumMatch = reportFilename.match(/^(\d+)-/);
  const reportNum = reportNumMatch ? reportNumMatch[1] : "001";

  console.log(`[career-ops] Tailoring CV for ${company} (${jobTitle}) using report ${reportFilename}...`);

  // 3. Run openai-tailor.mjs with DeepSeek
  const tailorArgs = [
    "openai-tailor.mjs",
    "--jd", `./jds/jd-${safeJobId}.txt`,
    "--report", targetReport,
    "--url", baseUrl,
    "--model", "deepseek-chat",
  ];
  if (apiKey) tailorArgs.push("--key", apiKey);

  const tailorRes = await runCareerOpsCmd("node", tailorArgs, 180000);
  if (tailorRes.code !== 0 && !tailorRes.stdout.includes("Tailored HTML saved")) {
    console.error("openai-tailor stderr:", tailorRes.stderr);
    throw new Error(`Tailoring failed: ${tailorRes.stderr || tailorRes.stdout}`);
  }

  // 4. Find generated HTML in career-ops/output/
  const outputDir = join(CAREER_OPS_DIR, "output");
  const reportStem = reportFilename.replace(/\.md$/i, "");
  const outputFiles = readdirSync(outputDir);
  const htmlMatch = outputFiles.find((f) => f.endsWith(".html") && f.includes(reportStem))
    || outputFiles.find((f) => f.endsWith(".html") && f.startsWith("cv-"));

  if (!htmlMatch) {
    throw new Error("Tailored HTML file was not found in career-ops/output/");
  }

  const generatedHtmlPath = join(outputDir, htmlMatch);
  const generatedPdfName = htmlMatch.replace(/\.html$/, ".pdf");
  const generatedPdfPath = join(outputDir, generatedPdfName);

  // 5. Generate PDF using generate-pdf.mjs with Playwright
  console.log(`[career-ops] Compiling tailored HTML to PDF via Playwright: ${htmlMatch}...`);
  const pdfArgs = [
    "generate-pdf.mjs",
    `output/${htmlMatch}`,
    `output/${generatedPdfName}`,
    "--format=letter",
    `--report=${reportNum}`,
    "--skip-fact-check",
    "--allow-reorder",
  ];

  const pdfRes = await runCareerOpsCmd("node", pdfArgs, 60000);
  if (pdfRes.code !== 0 && !existsSync(generatedPdfPath)) {
    console.error("generate-pdf stderr:", pdfRes.stderr);
    throw new Error(`PDF generation failed: ${pdfRes.stderr || pdfRes.stdout}`);
  }

  // 6. Copy HTML and PDF to job-pilot/data/resumes/
  const destHtmlPath = join(resumesDir, `resume-${safeJobId}.html`);
  const destPdfPath = join(resumesDir, `resume-${safeJobId}.pdf`);

  copyFileSync(generatedHtmlPath, destHtmlPath);
  if (existsSync(generatedPdfPath)) {
    copyFileSync(generatedPdfPath, destPdfPath);
  }

  return {
    success: true,
    jobId,
    reportPath: targetReport,
    htmlFile: `resume-${safeJobId}.html`,
    pdfFile: `resume-${safeJobId}.pdf`,
    destHtmlPath,
    destPdfPath,
    htmlUrl: `/api/jobs/${encodeURIComponent(jobId)}/resume.html`,
    pdfUrl: `/api/jobs/${encodeURIComponent(jobId)}/resume.pdf`,
    generatedAt: new Date().toISOString(),
  };
}
