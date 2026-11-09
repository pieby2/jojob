import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { networkInterfaces } from "os";

// Import bridges from both repositories
import {
  evaluateWithCareerOps,
  getTrackedApplications,
  getCareerOpsStats,
  updateCareerOpsStatus,
  scanCareerOpsATS,
  syncCareerOpsTracker,
} from "./lib/career-ops-bridge.mjs";

import {
  checkPostingSecurity,
  lookupCompanySalary,
} from "./lib/ai-job-search-bridge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- Load environment variables ---
function loadEnv() {
  const envPaths = [
    join(__dirname, ".env"),
    join(__dirname, "..", "career-ops", ".env"),
    join(__dirname, "..", "ai-job-search", ".env"),
  ];
  for (const p of envPaths) {
    if (existsSync(p)) {
      const lines = readFileSync(p, "utf-8").split("\n");
      for (const line of lines) {
        const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
        }
      }
    }
  }
}
loadEnv();

// --- CV and Profile Loading ---
function loadCV() {
  const cvPath = join(__dirname, "..", "career-ops", "cv.md");
  if (existsSync(cvPath)) return readFileSync(cvPath, "utf-8");
  return "CV not found in career-ops/cv.md";
}

// --- Jobs Persistence ---
const JOBS_FILE = join(__dirname, "data", "jobs.json");
function loadJobs() {
  if (existsSync(JOBS_FILE)) {
    try {
      return JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}
function saveJobs(jobs) {
  writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

// --- Middleware ---
app.use(express.json({ limit: "5mb" }));
app.use(express.static(join(__dirname, "public")));

// --- Routes ---

// 1. GET /api/profile
app.get("/api/profile", (_req, res) => {
  const cv = loadCV();
  const nameMatch = cv.match(/^#\s+CV\s*—\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "Prakhar Pragyan Chaubey";
  res.json({
    name,
    integrations: {
      careerOps: "connected (openai-eval.mjs, tracker.mjs, stats.mjs, scan.mjs)",
      aiJobSearch: "connected (posting_guard.py, salary_lookup.py)",
      aiModel: "deepseek-chat via DeepSeek API",
    },
  });
});

// 2. GET /api/stats — queries career-ops stats.mjs
app.get("/api/stats", async (_req, res) => {
  const cStats = await getCareerOpsStats();
  const localJobs = loadJobs();

  const totalScanned = localJobs.length;
  const appliedCount = localJobs.filter((j) => j._status === "applied").length;
  const skippedCount = localJobs.filter((j) => j._status === "skipped").length;
  const savedCount = localJobs.filter((j) => j._status === "saved" || j._status === "new").length;

  res.json({
    local: { totalScanned, appliedCount, skippedCount, savedCount },
    careerOps: cStats?.tracker || null,
    funnel: cStats?.funnel || null,
  });
});

// 3. GET /api/scan — runs JobSpy scraper with ai-job-search posting_guard
app.get("/api/scan", (req, res) => {
  const search = req.query.search || "Machine Learning Engineer";
  const location = req.query.location || "India";
  const results = req.query.results || "15";
  const sites = req.query.sites || "indeed,linkedin";

  const py = spawn("python", [
    join(__dirname, "lib", "scrape_jobs.py"),
    "--search", search,
    "--location", location,
    "--results", results,
    "--sites", sites,
  ]);

  let stdout = "";
  let stderr = "";

  py.stdout.on("data", (d) => (stdout += d.toString()));
  py.stderr.on("data", (d) => (stderr += d.toString()));

  py.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).json({ error: stderr || "Scraper failed", code });
    }
    try {
      const jobs = JSON.parse(stdout);
      const existing = loadJobs();
      const existingUrls = new Set(existing.map((j) => j.job_url));
      let newCount = 0;

      for (const job of jobs) {
        if (!existingUrls.has(job.job_url)) {
          job._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          job._status = "new";
          job._scannedAt = new Date().toISOString();
          existing.push(job);
          newCount++;
        }
      }
      saveJobs(existing);
      res.json({
        total: existing.length,
        new: newCount,
        jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse scraper output", detail: stdout.substring(0, 500) });
    }
  });
});

// 4. GET /api/scan-ats — scans direct company ATS boards via career-ops/scan.mjs
app.get("/api/scan-ats", async (_req, res) => {
  const result = await scanCareerOpsATS();
  res.json(result);
});

// 5. GET /api/jobs — get local scanned jobs
app.get("/api/jobs", (req, res) => {
  const status = req.query.status;
  let jobs = loadJobs();
  if (status) jobs = jobs.filter((j) => j._status === status);
  res.json(jobs);
});

// 6. GET /api/tracked — get official career-ops tracked applications
app.get("/api/tracked", async (req, res) => {
  const tracked = await getTrackedApplications(req.query.status);
  res.json(tracked);
});

// 7. POST /api/evaluate — evaluates job with career-ops/openai-eval + ai-job-search/salary_lookup
app.post("/api/evaluate", async (req, res) => {
  try {
    const { jobId } = req.body;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const company = job.company_name || job.company || "Unknown";
    const title = job.title || "Machine Learning Engineer";
    const desc = job.description || title;
    const postingUrl = job.job_url || job.link || "";

    // 1. ai-job-search posting guard (security verification)
    const security = await checkPostingSecurity(desc);

    // 2. career-ops official evaluation (DeepSeek + profile.yml + oferta rubric)
    const evaluation = await evaluateWithCareerOps({
      jobTitle: title,
      company,
      description: security.clean || desc,
      postingUrl,
    });

    // 3. ai-job-search salary benchmark lookup
    const salaryBenchmark = await lookupCompanySalary(company);

    // Cache on job record
    job._evaluation = evaluation;
    job._salaryBenchmark = salaryBenchmark;
    job._security = security;
    saveJobs(jobs);

    res.json({
      evaluation,
      salaryBenchmark,
      security,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. POST /api/jobs/:id/status — updates status locally AND in career-ops
app.post("/api/jobs/:id/status", async (req, res) => {
  const { status } = req.body;
  const jobs = loadJobs();
  const job = jobs.find((j) => j._id === req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  job._status = status || "skipped";
  saveJobs(jobs);

  // Sync to career-ops if evaluated or applied
  const company = job.company_name || job.company;
  const role = job.title;
  let careerOpsResult = null;

  if (company) {
    const mappedState = status === "applied" ? "Applied" : status === "skipped" ? "SKIP" : status;
    careerOpsResult = await updateCareerOpsStatus(company, mappedState, role);
  }

  res.json({ ok: true, job, careerOps: careerOpsResult });
});

// 9. GET /api/salary — lookup salary benchmark from ai-job-search
app.get("/api/salary", async (req, res) => {
  const { company } = req.query;
  const benchmark = await lookupCompanySalary(company);
  res.json(benchmark || { found: false });
});

// --- Get LAN IP ---
function getLanIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

// --- Start ---
app.listen(PORT, "0.0.0.0", async () => {
  const ip = getLanIP();
  await syncCareerOpsTracker();

  console.log(`
╔══════════════════════════════════════════════════════════╗
║          🚀 Job Pilot + Dual-Engine Active!              ║
╠══════════════════════════════════════════════════════════╣
║  Engine 1: career-ops (openai-eval, tracker, stats)     ║
║  Engine 2: ai-job-search (posting_guard, salary_lookup)  ║
║  Model:    deepseek-chat via DeepSeek API                ║
╠══════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${PORT}                          ║
║  Mobile:   http://${ip}:${PORT}                   ║
╚══════════════════════════════════════════════════════════╝
  `);
});
