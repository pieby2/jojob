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
    const job = jobs.find((j) => j._id === id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const jobTitle = job.title || "Machine Learning Engineer";
    const company = job.company_name || job.company || "Company";
    const description = job.description || jobTitle;
    const reportPath = job._evaluation?.reportPath;

    console.log(`[resume] Tailoring personal resume for job ${id}: ${company} — ${jobTitle}`);
    const result = await tailorResumeForJob({
      jobId: id,
      jobTitle,
      company,
      description,
      reportPath,
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
    if (!job) return res.status(404).send("Job not found");

    const safeJobId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const localPdf = join(__dirname, "data", "resumes", `resume-${safeJobId}.pdf`);

    if (!existsSync(localPdf)) {
      try {
        console.log(`[resume] Auto-generating resume PDF on-demand for ${id}...`);
        const jobTitle = job.title || "Machine Learning Engineer";
        const company = job.company_name || job.company || "Company";
        const description = job.description || jobTitle;
        const reportPath = job._evaluation?.reportPath;
        const result = await tailorResumeForJob({ jobId: id, jobTitle, company, description, reportPath });
        job._tailoredResume = result;
        saveJobs(jobs);
      } catch (e) {
        console.warn("Auto-tailor on PDF request failed:", e.message);
      }
    }

    if (existsSync(localPdf)) {
      const compSlug = (job.company_name || job.company || "Company").replace(/[^a-zA-Z0-9]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Prakhar_Chaubey_Resume_${compSlug}.pdf"`);
      return res.sendFile(localPdf);
    }

    // Fallback to any existing PDF in career-ops/output
    const outDir = join(__dirname, "..", "career-ops", "output");
    if (existsSync(outDir)) {
      const pdfs = (await import("fs")).readdirSync(outDir).filter((f) => f.endsWith(".pdf"));
      if (pdfs.length > 0) {
        res.setHeader("Content-Type", "application/pdf");
        return res.sendFile(join(outDir, pdfs[pdfs.length - 1]));
      }
    }

    res.status(404).send("Resume PDF not found. Click 'Tailor My Resume' in Job Pilot to generate.");
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
app.get("/api/bookmarklet", (_req, res) => {
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
