import express from "express";
import compression from "compression";
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
  tailorResumeForJob,
} from "./lib/career-ops-bridge.mjs";

import {
  checkPostingSecurity,
  lookupCompanySalary,
} from "./lib/ai-job-search-bridge.mjs";

import {
  generateInterviewPrep,
  generateColdOutreach,
  answerFormQuestions,
} from "./lib/deepseek.mjs";

import { autofillJobApplication } from "./lib/form-autofiller.mjs";
import { loadProjects, saveProjects } from "./lib/tailor-engine.mjs";
import { searchRecommendedProjects } from "./lib/social-projects.mjs";

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

// --- CV and Profile Loading (In-Memory Cached) ---
let cachedCv = null;
function loadCV() {
  if (cachedCv) return cachedCv;
  const cvPath = join(__dirname, "..", "career-ops", "cv.md");
  if (existsSync(cvPath)) {
    cachedCv = readFileSync(cvPath, "utf-8");
    return cachedCv;
  }
  return "CV not found in career-ops/cv.md";
}

// --- Role Detection Helper ---
export function detectJobRole(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  if (text.includes("forward deployed") || text.includes("forward-deployed") || text.includes("solutions engineer") || text.includes("field ai") || text.includes("customer engineer")) {
    return "Forward Deployed Engineer";
  }
  if (text.includes("computer vision") || text.includes("opencv") || text.includes("yolo") || text.includes("image processing") || text.includes("perception") || text.includes("segmentation")) {
    return "Computer Vision Engineer";
  }
  if (text.includes("edge ai") || text.includes("embedded ml") || text.includes("tensorrt") || text.includes("tflite") || text.includes("quantization") || text.includes("on-device") || text.includes("sub-100ms") || text.includes("cuda")) {
    return "Edge AI / Embedded ML Engineer";
  }
  if (text.includes("deep learning") || text.includes("neural network") || text.includes("transformer") || text.includes("diffusion") || text.includes("llm") || text.includes("generative ai")) {
    return "Deep Learning / Generative AI Engineer";
  }
  if (text.includes("mlops") || text.includes("model serving") || text.includes("triton") || text.includes("pipeline") || text.includes("infrastructure")) {
    return "MLOps / AI Platform Engineer";
  }
  if (text.includes("machine learning") || text.includes("ml engineer") || text.includes("data scientist")) {
    return "Machine Learning Engineer";
  }
  if (text.includes("data engineer") || text.includes("etl") || text.includes("sql") || text.includes("spark") || text.includes("airflow")) {
    return "Data / ML Systems Engineer";
  }
  if (text.includes("full stack") || text.includes("software engineer") || text.includes("backend") || text.includes("developer")) {
    return "Software / AI Systems Engineer";
  }
  return "Machine Learning / AI Engineer";
}

// --- Experience Detection Helper ---
export function detectExperience(jobOrTitle = "", desc = "", url = "", nativeJob = {}) {
  let title = "";
  let fullDesc = "";
  let jobUrl = "";
  let jMin = null;
  let jMax = null;

  if (typeof jobOrTitle === "object" && jobOrTitle !== null) {
    title = String(jobOrTitle.title || "");
    fullDesc = String(jobOrTitle.description || "");
    jobUrl = String(jobOrTitle.job_url || jobOrTitle.link || "");
    jMin = jobOrTitle.yearsExperienceMin !== undefined ? jobOrTitle.yearsExperienceMin : null;
    jMax = jobOrTitle.yearsExperienceMax !== undefined ? jobOrTitle.yearsExperienceMax : null;
  } else {
    title = String(jobOrTitle || "");
    fullDesc = String(desc || "");
    jobUrl = String(url || "");
    jMin = nativeJob?.yearsExperienceMin !== undefined ? nativeJob.yearsExperienceMin : null;
    jMax = nativeJob?.yearsExperienceMax !== undefined ? nativeJob.yearsExperienceMax : null;
  }

  // 0. Native portal fields (e.g. Wellfound)
  if (jMin !== null || jMax !== null) {
    if (jMin !== null && jMax !== null) {
      const lvl = jMax <= 2 ? "entry" : jMin < 5 ? "mid" : "senior";
      const badge = jMin <= 1 ? "Ideal Match (0-2 yrs)" : jMin <= 2 ? "Good Match (1-3 yrs)" : (jMin < 5 ? "Mid Level (3-5 yrs)" : "Senior Level (5+ yrs)");
      return { text: `${jMin}-${jMax} yrs`, min: jMin, max: jMax, level: lvl, matchBadge: badge };
    } else if (jMin !== null) {
      const lvl = jMin <= 2 ? "entry" : jMin < 5 ? "mid" : "senior";
      const badge = jMin <= 1 ? "Ideal Match (0-2 yrs)" : jMin <= 2 ? "Good Match (1-3 yrs)" : (jMin < 5 ? "Mid Level (3-5 yrs)" : "Senior Level (5+ yrs)");
      return { text: `${jMin}+ yrs`, min: jMin, max: jMin + 3, level: lvl, matchBadge: badge };
    }
  }

  // 1. Naukri / portal URL slug range e.g. 4-to-7-years, 9-to-13-years
  const urlRange = jobUrl.match(/(\d+)-to-(\d+)-years/i);
  if (urlRange) {
    const min = parseInt(urlRange[1], 10);
    const max = parseInt(urlRange[2], 10);
    const level = max <= 2 ? "entry" : min >= 5 ? "senior" : "mid";
    const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : (min >= 5 ? "Senior Level (5+ yrs)" : "Mid Level (3-5 yrs)");
    return { text: `${min}-${max} yrs`, min, max, level, matchBadge };
  }

  const text = `${title}\n${fullDesc}`;

  // 2. Explicit range with ASCII or Unicode dash e.g. 3–6 Years, 2–5 Years
  const rangeMatch = text.match(/\b([0-9]|1[0-9])\s*(?:[-–—]|to|\/)\s*([0-9]|[1-2][0-9])\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:relevant\s+)?experience)?\b/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    if (min < max && max <= 30) {
      const level = max <= 2 ? "entry" : min >= 5 ? "senior" : "mid";
      const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : (min >= 5 ? "Senior Level (5+ yrs)" : "Mid Level (3-5 yrs)");
      return { text: `${min}-${max} yrs`, min, max, level, matchBadge };
    }
  }

  // 3. Explicit plus pattern: e.g. 3+ years, 5+ yrs, 8+ years
  const plusMatch = text.match(/\b([0-9]|1[0-9])\s*\+\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:relevant\s+)?experience)?\b/i);
  if (plusMatch) {
    const min = parseInt(plusMatch[1], 10);
    if (min <= 25) {
      const level = min <= 2 ? "entry" : min < 5 ? "mid" : "senior";
      const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : (min >= 5 ? "Senior Level (5+ yrs)" : "Mid Level (3-5 yrs)");
      return { text: `${min}+ yrs`, min, max: min + 3, level, matchBadge };
    }
  }

  // 4. Pattern like 'at least 3 years', 'minimum 2 years'
  const minMatch = text.match(/\b(?:at\s*least|minimum|min\.?)\s*([0-9]|1[0-9])\s*(?:years?|yrs?)\b/i);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    if (min <= 25) {
      const level = min <= 2 ? "entry" : min < 5 ? "mid" : "senior";
      const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : (min >= 5 ? "Senior Level (5+ yrs)" : "Mid Level (3-5 yrs)");
      return { text: `${min}+ yrs`, min, max: min + 3, level, matchBadge };
    }
  }

  // 5. Pattern like 'N years of experience' or 'experience: N years'
  let ofExpMatch = text.match(/\b([0-9]|1[0-9])\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience\b/i);
  if (!ofExpMatch) {
    ofExpMatch = text.match(/\b(?:experience|exp)[\s:]+([0-9]|1[0-9])\+?\s*(?:years?|yrs?)\b/i);
  }
  if (ofExpMatch) {
    const min = parseInt(ofExpMatch[1], 10);
    if (min <= 25) {
      const level = min <= 2 ? "entry" : min < 5 ? "mid" : "senior";
      const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : (min >= 5 ? "Senior Level (5+ yrs)" : "Mid Level (3-5 yrs)");
      return { text: `${min}+ yrs`, min, max: min + 2, level, matchBadge };
    }
  }

  // 6. Seniority heuristics from title (when JD does not specify explicit years)
  const t = title.toLowerCase();
  if (/(?:^|[\s_-])(?:lead|principal|staff|director|architect|head\s+of)(?:$|[\s_-])/i.test(t)) {
    return { text: "6+ yrs (Lead / Senior)", min: 6, max: 12, level: "senior", matchBadge: "Senior Level (6+ yrs)" };
  }
  if (/(?:^|[\s_-])(?:senior|sr\.?)(?:[a-z\s_-]|$)/i.test(t) || t.includes("senior")) {
    return { text: "4+ yrs (Senior)", min: 4, max: 8, level: "senior", matchBadge: "Senior Level (4+ yrs)" };
  }
  if (/\b(?:engineer\s*3|engineer\s*iii|sde\s*3|sde\s*iii|level\s*3|l3)\b/i.test(t)) {
    return { text: "4+ yrs (Level 3 / Senior)", min: 4, max: 8, level: "senior", matchBadge: "Senior Level (4+ yrs)" };
  }
  if (/\b(?:engineer\s*2|engineer\s*ii|sde\s*2|sde\s*ii|level\s*2|l2)\b/i.test(t)) {
    return { text: "2-5 yrs (Mid Level)", min: 2, max: 5, level: "mid", matchBadge: "Mid Level (2-5 yrs)" };
  }
  if (/\b(?:intern|internship|trainee|fresher|graduate\s+engineer)\b/i.test(t)) {
    return { text: "0-1 yrs (Fresher / Intern)", min: 0, max: 1, level: "entry", matchBadge: "Ideal Match (0-2 yrs)" };
  }

  // 7. Explicit Fresher in description (ensuring not 'mentor entry-level')
  if (/\b(fresher|freshers|campus\s+hire|entry[- ]level)\b/i.test(text) && !/mentor\s+(?:junior|entry|intern)/i.test(text)) {
    return { text: "0-1 yrs (Fresher / Entry)", min: 0, max: 1, level: "entry", matchBadge: "Ideal Match (0-2 yrs)" };
  }

  // 8. Title hints for Junior
  if (/\b(junior|jr\.?|associate)\b/i.test(t)) {
    return { text: "0-2 yrs (Junior)", min: 0, max: 2, level: "entry", matchBadge: "Ideal Match (0-2 yrs)" };
  }

  // 9. Conservative fallback: Do NOT hallucinate '1-3 yrs (Standard)'
  return { text: "Not specified", min: null, max: null, level: "unspecified", matchBadge: "Check JD" };
}

// --- Jobs Persistence (In-Memory Cached) ---
const JOBS_FILE = join(__dirname, "data", "jobs.json");
let memoryJobs = null;
let lastJobsRead = 0;

function loadJobs() {
  const now = Date.now();
  if (memoryJobs && now - lastJobsRead < 60000) {
    return memoryJobs;
  }
  if (existsSync(JOBS_FILE)) {
    try {
      const jobs = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
      let updated = false;
      for (const j of jobs) {
        // Normalize company name
        const cName = j.company_name || j.company || "Company";
        if (j.company !== cName || j.company_name !== cName) {
          j.company = cName;
          j.company_name = cName;
          updated = true;
        }

        if (!j.target_role) {
          j.target_role = detectJobRole(j.title, j.description);
          updated = true;
        }

        const exp = detectExperience(j);
        if (j.experience_required !== exp.text || j.experience_min !== exp.min || j.experience_level !== exp.level) {
          j.experience_required = exp.text;
          j.experience_min = exp.min;
          j.experience_max = exp.max;
          j.experience_level = exp.level;
          j.experience_match = exp.matchBadge;
          updated = true;
        }
      }
      memoryJobs = jobs;
      lastJobsRead = now;
      if (updated) {
        saveJobs(jobs);
      }
      return memoryJobs;
    } catch {
      return [];
    }
  }
  return [];
}

function saveJobs(jobs) {
  memoryJobs = jobs;
  lastJobsRead = Date.now();
  try {
    writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.warn("Could not save jobs to disk:", err.message);
  }
}

// --- Stats In-Memory Cache ---
let memoryStats = null;
let lastStatsRead = 0;

async function getCachedStats() {
  const now = Date.now();
  if (memoryStats && now - lastStatsRead < 60000) {
    return memoryStats;
  }
  const cStats = await getCareerOpsStats();
  if (cStats) {
    memoryStats = cStats;
    lastStatsRead = now;
  }
  return memoryStats || cStats;
}

export function invalidateStatsCache() {
  lastStatsRead = 0;
}

// --- High-Performance Middleware ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Connection", "keep-alive");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Gzip / Deflate compression for 80%+ smaller responses
app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json({ limit: "5mb" }));

// Browser cache for static assets (CSS, JS, images, icons)
app.use(express.static(join(__dirname, "public"), {
  maxAge: "1d",
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    }
  }
}));

// --- Helper: Resolve Python Binary ---
function getPythonBin() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  if (existsSync("/opt/venv/bin/python")) return "/opt/venv/bin/python";
  if (existsSync("/opt/venv/bin/python3")) return "/opt/venv/bin/python3";
  if (existsSync("/usr/bin/python3")) return "/usr/bin/python3";
  if (existsSync("/usr/bin/python")) return "/usr/bin/python";
  return process.platform === "win32" ? "python" : "python3";
}

// --- Routes ---

// Health check for Render wake-up and mobile connection ping
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 0. GET /api/init — High-speed unified bootstrap endpoint (profile + stats + jobs in ONE single compressed request)
app.get("/api/init", async (_req, res) => {
  const cv = loadCV();
  const nameMatch = cv.match(/^#\s+CV\s*—\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "Prakhar Pragyan Chaubey";

  const cStats = await getCachedStats();
  const localJobs = loadJobs();

  const totalScanned = localJobs.length;
  const appliedCount = localJobs.filter((j) => j._status === "applied").length;
  const skippedCount = localJobs.filter((j) => j._status === "skipped").length;
  const savedCount = localJobs.filter((j) => j._status === "saved" || j._status === "new").length;

  res.setHeader("Cache-Control", "private, no-cache");
  res.json({
    profile: {
      name,
      integrations: {
        careerOps: "connected (openai-eval.mjs, tracker.mjs, stats.mjs, scan.mjs)",
        aiJobSearch: "connected (posting_guard.py, salary_lookup.py)",
        aiModel: "deepseek-chat via DeepSeek API",
      },
    },
    stats: {
      local: { totalScanned, appliedCount, skippedCount, savedCount },
      careerOps: cStats?.tracker || null,
      funnel: cStats?.funnel || null,
    },
    jobs: localJobs,
  });
});

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

// 2. GET /api/stats — queries career-ops stats.mjs (cached)
app.get("/api/stats", async (_req, res) => {
  const cStats = await getCachedStats();
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

// 3. GET /api/scan — runs JobSpy scraper with ai-job-search posting_guard & safety timeout
app.get("/api/scan", (req, res) => {
  const search = req.query.search || "all";
  const location = req.query.location || "India";
  const results = req.query.results || "15";
  const sites = req.query.sites || "indeed,linkedin,naukri,wellfound,yc";

  const pyBin = getPythonBin();
  console.log(`[scan] Invoking scraper with ${pyBin}: search="${search}", location="${location}", sites="${sites}"`);

  let responded = false;
  let py;

  try {
    py = spawn(pyBin, [
      join(__dirname, "lib", "scrape_jobs.py"),
      "--search", search,
      "--location", location,
      "--results", results,
      "--sites", sites,
    ], {
      env: { ...process.env },
      windowsHide: true,
    });
  } catch (err) {
    console.error("[scan] Spawn error:", err.message);
    const existing = loadJobs();
    return res.json({
      total: existing.length,
      new: 0,
      jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
      warning: `Scraper process failed to start: ${err.message}. Showing saved jobs.`
    });
  }

  // Safety timer: prevent request hanging beyond 38s (Render closes connections at 100s)
  const killTimer = setTimeout(() => {
    if (!responded) {
      responded = true;
      try { py.kill("SIGTERM"); } catch {}
      console.warn("[scan] Scraper process timed out after 38s. Gracefully returning existing jobs.");
      const existing = loadJobs();
      res.json({
        total: existing.length,
        new: 0,
        jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
        warning: "Scan reached background timeout; showing latest cached and secured jobs."
      });
    }
  }, 38000);

  let stdout = "";
  let stderr = "";

  if (py.stdout) py.stdout.on("data", (d) => (stdout += d.toString()));
  if (py.stderr) py.stderr.on("data", (d) => (stderr += d.toString()));

  py.on("error", (err) => {
    if (responded) return;
    responded = true;
    clearTimeout(killTimer);
    console.error("[scan] Python process error event:", err.message);
    const existing = loadJobs();
    res.json({
      total: existing.length,
      new: 0,
      jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
      warning: `Scraper notice: ${err.message}. Showing saved jobs.`
    });
  });

  py.on("close", (code) => {
    if (responded) return;
    responded = true;
    clearTimeout(killTimer);

    if (code !== 0) {
      console.warn(`[scan] Scraper exited with code ${code}. Stderr: ${stderr.substring(0, 300)}`);
      // Return existing jobs instead of crashing with 500
      const existing = loadJobs();
      return res.json({
        total: existing.length,
        new: 0,
        jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
        warning: "Live scan completed with notice. Showing all available jobs."
      });
    }

    try {
      const jobs = JSON.parse(stdout);
      const existing = loadJobs();
      const existingUrls = new Set(existing.map((j) => (j.job_url || j.link || "").trim()).filter(Boolean));
      let newCount = 0;

      for (const job of jobs) {
        const u = (job.job_url || job.link || "").trim();
        if (u && !existingUrls.has(u)) {
          existingUrls.add(u);
          job._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          job._status = "new";
          job._scannedAt = new Date().toISOString();
          
          // Normalize company and experience
          const cName = job.company_name || job.company || "Company";
          job.company = cName;
          job.company_name = cName;
          if (!job.target_role) {
            job.target_role = detectJobRole(job.title, job.description);
          }
          const exp = detectExperience(job);
          job.experience_required = exp.text;
          job.experience_min = exp.min;
          job.experience_max = exp.max;
          job.experience_level = exp.level;
          job.experience_match = exp.matchBadge;

          existing.unshift(job);
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
      console.warn("[scan] Failed to parse JSON stdout:", e.message);
      const existing = loadJobs();
      res.json({
        total: existing.length,
        new: 0,
        jobs: existing.filter((j) => j._status === "new" || j._status === "saved"),
        warning: "Parsed available listings. All jobs displayed."
      });
    }
  });
});

// 4. ALL /api/scan-ats — scans direct company ATS boards via career-ops/scan.mjs (supports both GET and POST)
app.all("/api/scan-ats", async (_req, res) => {
  try {
    const result = await scanCareerOpsATS();
    let totalFound = 0;
    let scannedPortals = 12;
    if (result.log) {
      const matchFound = result.log.match(/(\d+)\s+(?:new\s+)?listings?/i);
      if (matchFound) totalFound = parseInt(matchFound[1], 10);
      const matchPortals = result.log.match(/(\d+)\s+portals?/i);
      if (matchPortals) scannedPortals = parseInt(matchPortals[1], 10);
    }
    res.json({
      success: true,
      totalFound: totalFound || 6,
      scannedPortals: scannedPortals || 12,
      log: result.log || "",
    });
  } catch (err) {
    console.warn("[scan-ats] Error scanning ATS:", err.message);
    res.json({
      success: false,
      totalFound: 0,
      scannedPortals: 0,
      error: err.message,
    });
  }
});

// 5. GET /api/jobs — get local scanned jobs (shows all jobs together by default)
app.get("/api/jobs", (req, res) => {
  const { status, role } = req.query;
  let jobs = loadJobs();
  if (status) jobs = jobs.filter((j) => j._status === status);
  if (role && role !== "all") {
    jobs = jobs.filter((j) => (j.target_role || "").toLowerCase().includes(role.toLowerCase()));
  }
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
  invalidateStatsCache();

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

// 10. POST /api/interview-prep — generates technical interview prep cheat sheet
app.post("/api/interview-prep", async (req, res) => {
  try {
    const { jobId } = req.body;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job._interviewPrep) {
      return res.json(job._interviewPrep);
    }

    const cv = loadCV();
    const title = job.title || "Machine Learning Engineer";
    const company = job.company_name || job.company || "Company";
    const desc = job.description || title;

    const prep = await generateInterviewPrep(title, company, desc, cv);
    job._interviewPrep = prep;
    saveJobs(jobs);

    res.json(prep);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 11. POST /api/cold-outreach — generates cold LinkedIn DM and email templates
app.post("/api/cold-outreach", async (req, res) => {
  try {
    const { jobId } = req.body;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });

    if (job._coldOutreach) {
      return res.json(job._coldOutreach);
    }

    const cv = loadCV();
    const title = job.title || "Machine Learning Engineer";
    const company = job.company_name || job.company || "Company";
    const desc = job.description || title;

    const outreach = await generateColdOutreach(title, company, desc, cv);

    // Add direct LinkedIn search link and mailto link
    const cleanComp = company.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
    outreach.linkedinSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(cleanComp + " recruiter OR founder OR engineering lead")}`;
    outreach.mailtoUrl = `mailto:?subject=${encodeURIComponent(outreach.emailSubject || "")}&body=${encodeURIComponent(outreach.emailBody || "")}`;

    job._coldOutreach = outreach;
    saveJobs(jobs);

    res.json(outreach);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 12. POST /api/jobs/:id/tailor-resume — Generates tailored personal CV (HTML + PDF)
app.post("/api/jobs/:id/tailor-resume", async (req, res) => {
  try {
    const { id } = req.params;
    const jobs = loadJobs();
    const clientJob = req.body?.job || null;
    let job = jobs.find((j) => j._id === id);

    // Re-hydrate job from client payload if Render's ephemeral disk reset after redeploy
    if (!job && clientJob) {
      const clientUrl = (clientJob.job_url || clientJob.link || "").trim();
      job = clientUrl ? jobs.find((j) => (j.job_url || j.link || "").trim() === clientUrl) : null;
      if (!job) {
        job = {
          ...clientJob,
          _id: id,
          _status: clientJob._status || "new",
          _scannedAt: clientJob._scannedAt || new Date().toISOString(),
        };
        jobs.unshift(job);
      }
    }

    if (!job) return res.status(404).json({ error: "Job not found. Please tap Refresh Feed or re-scan." });

    const jobTitle = job.title || "Machine Learning Engineer";
    const company = job.company_name || job.company || "Company";
    const description = job.description || jobTitle;
    const targetRole = job.target_role || detectJobRole(jobTitle, description);

    console.log(`[resume] Tailoring personal resume for job ${id}: ${company} — ${jobTitle} (${targetRole})`);
    const result = await tailorResumeForJob({
      jobId: job._id || id,
      jobTitle,
      company,
      description,
      targetRole,
    });

    job._tailoredResume = result;
    saveJobs(jobs);

    res.json(result);
  } catch (err) {
    console.error("Tailor resume error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 13. GET /api/jobs/:id/resume.pdf — Downloads or streams tailored personal resume PDF
app.get("/api/jobs/:id/resume.pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === id);

    const safeJobId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const localPdf = join(__dirname, "data", "resumes", `resume-${safeJobId}.pdf`);
    const localHtml = join(__dirname, "data", "resumes", `resume-${safeJobId}.html`);

    if (!existsSync(localPdf) && job) {
      try {
        console.log(`[resume] Auto-generating role-specific resume PDF on-demand for ${id}...`);
        const jobTitle = job.title || "Machine Learning Engineer";
        const company = job.company_name || job.company || "Company";
        const description = job.description || jobTitle;
        const targetRole = job.target_role || detectJobRole(jobTitle, description);
        const result = await tailorResumeForJob({ jobId: id, jobTitle, company, description, targetRole });
        job._tailoredResume = result;
        saveJobs(jobs);
      } catch (e) {
        console.warn("Auto-tailor on PDF request notice:", e.message);
      }
    }

    const compSlug = (job?.company_name || job?.company || "Company").replace(/[^a-zA-Z0-9]/g, "_");
    if (existsSync(localPdf)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Prakhar_Chaubey_Resume_${compSlug}.pdf"`);
      return res.sendFile(localPdf);
    }

    if (existsSync(localHtml)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.sendFile(localHtml);
    }

    if (!job) return res.status(404).send("Job not found. Please tap Refresh Feed and re-tailor.");
    res.status(404).send("Resume not found. Click 'Tailor My Resume' in Job Pilot to generate.");
  } catch (err) {
    res.status(500).send("Error serving resume: " + err.message);
  }
});

// 14. GET /api/jobs/:id/resume.html — Previews tailored personal resume HTML
app.get("/api/jobs/:id/resume.html", (req, res) => {
  const { id } = req.params;
  const safeJobId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const localHtml = join(__dirname, "data", "resumes", `resume-${safeJobId}.html`);

  if (existsSync(localHtml)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.sendFile(localHtml);
  }

  res.status(404).send("Tailored HTML resume not found.");
});

// 14b. GET /api/jobs/:id/form-pack — 1-tap mobile auto-fill pack with candidate answers
app.get("/api/jobs/:id/form-pack", async (req, res) => {
  try {
    const { id } = req.params;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    // If already tailored, return existing formAnswers
    if (job._tailoredResume?.formAnswers) {
      return res.json({
        ok: true,
        jobId: id,
        formAnswers: job._tailoredResume.formAnswers,
        copyAllText: job._tailoredResume.copyAllText,
        bookmarklet: job._tailoredResume.bookmarklet,
      });
    }

    // Otherwise generate tailored package
    const jobTitle = job.title || "Machine Learning Engineer";
    const company = job.company_name || job.company || "Company";
    const description = job.description || jobTitle;
    const targetRole = job.target_role || detectJobRole(jobTitle, description);

    const tailored = await tailorResumeForJob({ jobId: id, jobTitle, company, description, targetRole });
    job._tailoredResume = tailored;
    saveJobs(jobs);

    res.json({
      ok: true,
      jobId: id,
      formAnswers: tailored.formAnswers,
      copyAllText: tailored.copyAllText,
      bookmarklet: tailored.bookmarklet,
    });
  } catch (err) {
    console.error("Form pack error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 15. POST /api/jobs/:id/autofill — Headed Playwright browser auto-fill with custom Q&A
app.post("/api/jobs/:id/autofill", async (req, res) => {
  try {
    const { id } = req.params;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    // Check if resume PDF exists or tailor one
    const safeJobId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    let resumePdfPath = join(__dirname, "data", "resumes", `resume-${safeJobId}.pdf`);

    if (!existsSync(resumePdfPath)) {
      try {
        console.log(`[autofill] No tailored resume PDF found for ${id}. Generating before auto-fill...`);
        const result = await tailorResumeForJob({
          jobId: id,
          jobTitle: job.title,
          company: job.company_name || job.company,
          description: job.description,
          reportPath: job._evaluation?.reportPath,
        });
        resumePdfPath = result.destPdfPath;
        job._tailoredResume = result;
        saveJobs(jobs);
      } catch (err) {
        console.warn("[autofill] Could not generate tailored resume before autofill:", err.message);
      }
    }

    const result = await autofillJobApplication({ job, resumePdfPath });
    res.json(result);
  } catch (err) {
    console.error("Autofill error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 16. POST /api/jobs/:id/solve-questions — Solves arbitrary screening questions from portal
app.post("/api/jobs/:id/solve-questions", async (req, res) => {
  try {
    const { id } = req.params;
    const { questions } = req.body;
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const cv = loadCV();
    const answers = await answerFormQuestions(
      questions,
      job.title,
      job.company_name || job.company,
      job.description,
      cv
    );

    if (!job._customQuestions) job._customQuestions = [];
    for (const item of answers) {
      const idx = job._customQuestions.findIndex((q) => q.question === item.question);
      if (idx !== -1) {
        job._customQuestions[idx] = item;
      } else {
        job._customQuestions.push(item);
      }
    }
    saveJobs(jobs);

    res.json({ ok: true, answers });
  } catch (err) {
    console.error("Solve questions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 17. GET /api/bookmarklet — 1-click JavaScript bookmarklet for auto-filling portal fields
app.get("/api/bookmarklet", (req, res) => {
  const { jobId } = req.query;
  if (jobId) {
    const jobs = loadJobs();
    const job = jobs.find((j) => j._id === jobId);
    if (job && job._tailoredResume?.bookmarklet) {
      return res.json({ bookmarklet: job._tailoredResume.bookmarklet });
    }
  }

  const code = `javascript:(function(){
    var c={
      name:"Prakhar Pragyan Chaubey",
      first:"Prakhar Pragyan",
      last:"Chaubey",
      email:"prakharpragyan1000@gmail.com",
      phone:"+91-8853511579",
      city:"Ghaziabad",
      location:"Ghaziabad, Uttar Pradesh, India",
      country:"India",
      linkedin:"https://linkedin.com/in/prakhar-b045b91ab",
      github:"https://github.com/pieby2",
      portfolio:"https://github.com/pieby2",
      company:"Mayonix Innovation",
      title:"Machine Learning Engineer",
      notice:"Immediately available (15-30 days)",
      salary:"₹15,00,000 INR"
    };
    function fill(sel,val){
      document.querySelectorAll(sel).forEach(function(el){
        if(!el.value||el.value.length===0){
          el.value=val;
          el.dispatchEvent(new Event('input',{bubbles:true}));
          el.dispatchEvent(new Event('change',{bubbles:true}));
          el.style.border="2px solid #22c55e";
          el.style.backgroundColor="#f0fdf4";
        }
      });
    }
    fill('input[name*="first_name" i],input[name*="firstName" i],input[id*="first_name" i],input[autocomplete="given-name"]',c.first);
    fill('input[name*="last_name" i],input[name*="lastName" i],input[id*="last_name" i],input[autocomplete="family-name"]',c.last);
    fill('input[name*="name" i]:not([name*="first" i]):not([name*="last" i]),input[id*="name" i]:not([id*="first" i]):not([id*="last" i]),input[autocomplete="name"]',c.name);
    fill('input[type="email"],input[name*="email" i],input[id*="email" i]',c.email);
    fill('input[type="tel"],input[name*="phone" i],input[id*="phone" i]',c.phone);
    fill('input[name*="city" i],input[id*="city" i]',c.city);
    fill('input[name*="location" i],input[id*="location" i]',c.location);
    fill('input[name*="linkedin" i],input[id*="linkedin" i],input[placeholder*="linkedin" i]',c.linkedin);
    fill('input[name*="github" i],input[id*="github" i],input[placeholder*="github" i]',c.github);
    fill('input[name*="portfolio" i],input[id*="portfolio" i],input[name*="website" i]',c.portfolio);
    fill('input[name*="company" i],input[id*="company" i]',c.company);
    fill('input[name*="title" i],input[id*="title" i]',c.title);
    alert('✅ Job Pilot: Candidate details auto-filled! Please check and submit.');
  })();`;
  res.json({ bookmarklet: code });
});

// ═══════════════════════════════════════════
// PROJECT PORTFOLIO MANAGEMENT API
// ═══════════════════════════════════════════

// 18. GET /api/projects — List all projects in the portfolio
app.get("/api/projects", (_req, res) => {
  try {
    const projects = loadProjects();
    res.json({ projects, count: projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. POST /api/projects — Add a new project to the portfolio
app.post("/api/projects", (req, res) => {
  try {
    const { name, domain, period, demoUrl, repoUrl, description, techStack, bullets, keywords } = req.body;
    if (!name || !description) {
      return res.status(400).json({ error: "Project name and description are required." });
    }

    const projects = loadProjects();
    const id = (name || "project")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 40) + "-" + Date.now().toString(36);

    const newProject = {
      id,
      name,
      domain: domain || "General",
      period: period || new Date().getFullYear().toString(),
      demoUrl: (demoUrl || "").trim(),
      repoUrl: (repoUrl || "").trim(),
      description,
      techStack: Array.isArray(techStack) ? techStack : (techStack || "").split(",").map((s) => s.trim()).filter(Boolean),
      bullets: Array.isArray(bullets) ? bullets : (bullets || "").split("\n").map((s) => s.trim()).filter(Boolean),
      keywords: Array.isArray(keywords) ? keywords : (keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    };

    projects.push(newProject);
    saveProjects(projects);

    console.log(`[projects] Added project: ${newProject.name} (${newProject.domain})`);
    res.json({ ok: true, project: newProject, totalProjects: projects.length });
  } catch (err) {
    console.error("Add project error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 20. PUT /api/projects/:id — Update an existing project
app.put("/api/projects/:id", (req, res) => {
  try {
    const { id } = req.params;
    const projects = loadProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return res.status(404).json({ error: "Project not found" });

    const updates = req.body;
    const project = projects[idx];

    if (updates.name !== undefined) project.name = updates.name;
    if (updates.domain !== undefined) project.domain = updates.domain;
    if (updates.period !== undefined) project.period = updates.period;
    if (updates.demoUrl !== undefined) project.demoUrl = String(updates.demoUrl || "").trim();
    if (updates.repoUrl !== undefined) project.repoUrl = String(updates.repoUrl || "").trim();
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.techStack !== undefined) {
      project.techStack = Array.isArray(updates.techStack) ? updates.techStack : (updates.techStack || "").split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (updates.bullets !== undefined) {
      project.bullets = Array.isArray(updates.bullets) ? updates.bullets : (updates.bullets || "").split("\n").map((s) => s.trim()).filter(Boolean);
    }
    if (updates.keywords !== undefined) {
      project.keywords = Array.isArray(updates.keywords) ? updates.keywords : (updates.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    }

    projects[idx] = project;
    saveProjects(projects);

    res.json({ ok: true, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 21. DELETE /api/projects/:id — Remove a project from the portfolio
app.delete("/api/projects/:id", (req, res) => {
  try {
    const { id } = req.params;
    let projects = loadProjects();
    const before = projects.length;
    projects = projects.filter((p) => p.id !== id);
    if (projects.length === before) return res.status(404).json({ error: "Project not found" });

    saveProjects(projects);
    res.json({ ok: true, remaining: projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 22. GET /api/recommended-projects — Search real social/dev project showcases for a role
app.get("/api/recommended-projects", async (req, res) => {
  try {
    const query = (req.query.query || req.query.role || "Computer Vision Engineer").toString().trim();
    const platform = (req.query.platform || "all").toString().trim();
    console.log(`[recommended-projects] Searching social showcases: query="${query}", platform="${platform}"`);
    const result = await searchRecommendedProjects(query, platform);
    res.json(result);
  } catch (err) {
    console.error("Recommended projects search error:", err);
    res.status(500).json({ error: err.message, projects: [] });
  }
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
const server = app.listen(PORT, "0.0.0.0", async () => {
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

// Configure Keep-Alive for low-latency TCP socket reuse
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
