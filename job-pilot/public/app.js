/**
 * Job Pilot — Unified Frontend Application Engine
 * Powered by career-ops (evaluation & tracking) + ai-job-search (posting_guard & salary)
 */

// --- Application State ---
let allJobs = [];
let trackedApplications = [];
let currentSort = "exp-match"; // Default: Best Experience Match (0-2 yrs / Entry first!)
let currentExpFilter = "all";   // "all", "entry", "mid", "senior"
let currentRoleFilter = "all";  // "all", "Computer Vision", "Machine Learning", "Edge AI", etc.
let currentTimeFilter = "all";  // "all", "24h", "3d", "7d"
let searchQuery = "";

// Wizard / Stepper Flow State
let activeFlowJobId = null;
let activeStep = 1; // 1: Overview, 2: Resume, 3: Form Q&A, 4: Apply & Track

// Candidate Profile Constants
const CANDIDATE_PROFILE = {
  fullName: "Prakhar Pragyan Chaubey",
  firstName: "Prakhar Pragyan",
  lastName: "Chaubey",
  email: "prakharpragyan1000@gmail.com",
  phone: "+91-8853511579",
  location: "Ghaziabad, Uttar Pradesh, India",
  city: "Ghaziabad",
  country: "India",
  linkedin: "https://linkedin.com/in/prakhar-b045b91ab",
  github: "https://github.com/pieby2",
  portfolio: "https://github.com/pieby2",
  currentCompany: "Mayonix Innovation",
  currentTitle: "Machine Learning Engineer",
  noticePeriod: "Immediately available (15-30 days)",
  salaryExpectation: "₹15,00,000 INR (Negotiable)",
  workAuth: "Yes",
  sponsorship: "No",
  education: "B.Tech Computer Science & Engineering, ABES EC (July 2026)",
  experienceSummary: "1 yr ML Engineer at Mayonix (YOLOv8/v9 92%+ mAP, sub-100ms edge latency via TensorRT/TFLite/INT8) + AlphaSense AI + IEEE WAMS 2025 & INCSTIC-2025"
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  loadProfile();
  loadStats();
  refreshJobs();
});

// --- Navigation Tabs (Desktop Header + Mobile Bottom Nav) ---
function initNavigation() {
  const switchView = (viewName) => {
    // Update Desktop Tabs
    document.querySelectorAll(".tab-btn").forEach((t) => {
      const match = t.dataset.view === viewName;
      t.classList.toggle("active", match);
      t.setAttribute("aria-selected", match ? "true" : "false");
    });

    // Update Mobile Tabs
    document.querySelectorAll(".mobile-tab-btn").forEach((t) => {
      t.classList.toggle("active", t.dataset.view === viewName);
    });

    // Switch View Containers
    document.querySelectorAll(".view").forEach((v) => {
      v.classList.toggle("active", v.id === `view-${viewName}`);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (viewName === "history") {
      loadTracked();
    } else if (viewName === "dashboard") {
      loadStats();
    }
  };

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.querySelectorAll(".mobile-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

// --- Toggle Scanner Collapse ---
function toggleScannerCollapse() {
  const body = document.getElementById("scanner-inputs");
  const icon = document.getElementById("scan-toggle-icon");
  if (!body) return;
  body.classList.toggle("collapsed");
  if (icon) {
    icon.textContent = body.classList.contains("collapsed") ? "▶" : "▼";
  }
}

// --- Profile & Stats ---
async function loadProfile() {
  try {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.name) {
      const el = document.getElementById("user-name");
      if (el) el.textContent = data.name;
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    const local = data.local || {};
    const cOps = data.careerOps || {};

    setElText("stat-total", local.totalScanned || 0);
    setElText("stat-applied", cOps.byStatus?.Applied || local.appliedCount || 0);
    setElText("stat-avg-score", cOps.avgScore ? `${cOps.avgScore.toFixed(1)}/5` : "—");
    setElText("stat-top-score", cOps.topScore ? `${cOps.topScore.toFixed(1)}/5` : "—");
  } catch { /* ignore */ }
}

function setElText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// --- Experience & Role Helper Functions ---
function getJobExperience(job) {
  if (job.experience_required && job.experience_min !== undefined) {
    return {
      text: job.experience_required,
      min: job.experience_min,
      max: job.experience_max || job.experience_min,
      level: job.experience_level || "entry",
      matchBadge: job.experience_match || "Good Match"
    };
  }

  const title = job.title || "";
  const desc = job.description || "";
  const text = `${title} ${desc}`.toLowerCase();

  // 1. Fresher / Entry Level / Intern
  if (/\b(fresher|freshers|entry[- ]level|graduate[- ]engineer|campus|intern|internship|trainee|0[- ]to[- ]1\s*years?|0[- ]1\s*years?|0[- ]to[- ]2\s*years?|0[- ]2\s*years?)\b/i.test(text)) {
    return { text: "0-1 yrs (Fresher / Entry)", min: 0, max: 1, level: "entry", matchBadge: "Ideal Match (0-2 yrs)" };
  }

  // 2. Explicit range
  const rangeMatch = text.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?experience)?\b/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    const level = max <= 2 ? "entry" : max <= 5 ? "mid" : "senior";
    const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : "Stretch (Mid/Senior)";
    return { text: `${min}-${max} yrs`, min, max, level, matchBadge };
  }

  // 3. Plus pattern
  const plusMatch = text.match(/\b(\d+)\s*\+\s*(?:years?|yrs?)(?:\s*(?:of\s*)?experience)?\b/i);
  if (plusMatch) {
    const min = parseInt(plusMatch[1], 10);
    const level = min <= 2 ? "entry" : min <= 5 ? "mid" : "senior";
    const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : "Stretch (Mid/Senior)";
    return { text: `${min}+ yrs`, min, max: min + 3, level, matchBadge };
  }

  // 4. Minimum pattern
  const minMatch = text.match(/\b(?:at\s*least|minimum|min\.?)\s*(\d+)\s*(?:years?|yrs?)\b/i);
  if (minMatch) {
    const min = parseInt(minMatch[1], 10);
    const level = min <= 2 ? "entry" : min <= 5 ? "mid" : "senior";
    const matchBadge = min <= 1 ? "Ideal Match (0-2 yrs)" : min <= 2 ? "Good Match (1-3 yrs)" : "Stretch (Mid/Senior)";
    return { text: `${min}+ yrs`, min, max: min + 3, level, matchBadge };
  }

  // 5. Title hints
  if (/\b(lead|principal|staff|director|architect|head\s*of)\b/i.test(title)) {
    return { text: "6+ yrs (Lead / Senior)", min: 6, max: 12, level: "senior", matchBadge: "Senior Level" };
  }
  if (/\b(senior|sr\.?)\b/i.test(title)) {
    return { text: "4+ yrs (Senior)", min: 4, max: 8, level: "senior", matchBadge: "Senior Level" };
  }
  if (/\b(junior|jr\.?|associate)\b/i.test(title)) {
    return { text: "0-2 yrs (Junior)", min: 0, max: 2, level: "entry", matchBadge: "Ideal Match (0-2 yrs)" };
  }

  return { text: "1-3 yrs (Standard)", min: 1, max: 3, level: "entry", matchBadge: "Good Match (1-3 yrs)" };
}

function detectRoleClient(title = "", desc = "") {
  const text = `${title} ${desc}`.toLowerCase();
  if (text.includes("computer vision") || text.includes("opencv") || text.includes("yolo") || text.includes("image processing") || text.includes("perception") || text.includes("segmentation") || text.includes("camera") || text.includes("video analytics")) {
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

function getJobTimestamp(job) {
  if (job.date_posted) {
    const t = new Date(job.date_posted).getTime();
    if (!isNaN(t)) return t;
  }
  if (job._scannedAt) {
    const t = new Date(job._scannedAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function formatPostedTime(dateStr, scannedStr) {
  const d = dateStr ? new Date(dateStr) : scannedStr ? new Date(scannedStr) : null;
  if (!d || isNaN(d.getTime())) return "Recently";
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "⚡ Today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString();
}

// --- Jobs Fetching & Cache ---
async function refreshJobs() {
  try {
    const res = await fetch("/api/jobs");
    allJobs = await res.json();

    const activeCount = allJobs.filter((j) => j._status === "new" || j._status === "saved").length;
    setElText("total-jobs-count", activeCount);
    setElText("home-job-count", activeCount);
    setElText("header-jobs-badge", activeCount);
    setElText("mobile-jobs-badge", activeCount);

    applySortAndFilter();
  } catch (e) {
    console.error("Failed to load jobs:", e);
  }
}

// --- Filtering & Experience Ranking ---
function setExpFilter(exp) {
  currentExpFilter = exp;
  document.querySelectorAll("[data-exp]").forEach((p) => {
    p.classList.toggle("active", p.dataset.exp === exp);
  });
  applySortAndFilter();
}

function setRoleFilter(role) {
  currentRoleFilter = role;
  document.querySelectorAll("[data-role]").forEach((p) => {
    p.classList.toggle("active", p.dataset.role === role);
  });
  applySortAndFilter();
}

function setTimeFilter(time) {
  currentTimeFilter = time;
  document.querySelectorAll("[data-time]").forEach((p) => {
    p.classList.toggle("active", p.dataset.time === time);
  });
  applySortAndFilter();
}

function clearSearch() {
  const input = document.getElementById("job-search-input");
  if (input) input.value = "";
  searchQuery = "";
  const clearBtn = document.getElementById("clear-search-btn");
  if (clearBtn) clearBtn.style.display = "none";
  applySortAndFilter();
}

function applySortAndFilter() {
  const sortSelect = document.getElementById("job-sort-select");
  if (sortSelect) currentSort = sortSelect.value;

  const searchInput = document.getElementById("job-search-input");
  searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const clearBtn = document.getElementById("clear-search-btn");
  if (clearBtn) clearBtn.style.display = searchQuery ? "block" : "none";

  let filtered = allJobs.filter((j) => j._status === "new" || j._status === "saved");

  // 1. Search Query Filter
  if (searchQuery) {
    filtered = filtered.filter((j) => {
      const matchText = `${j.title} ${j.company_name || j.company || ""} ${j.location || ""} ${j.description || ""} ${j.target_role || ""}`.toLowerCase();
      return matchText.includes(searchQuery);
    });
  }

  // 2. Experience Filter (entry: 0-2 yrs, mid: 2-5 yrs, senior: 5+ yrs)
  if (currentExpFilter !== "all") {
    filtered = filtered.filter((j) => {
      const exp = getJobExperience(j);
      return exp.level === currentExpFilter;
    });
  }

  // 3. Role Category Filter
  if (currentRoleFilter !== "all") {
    const rf = currentRoleFilter.toLowerCase();
    filtered = filtered.filter((j) => {
      const role = (j.target_role || detectRoleClient(j.title, j.description)).toLowerCase();
      return role.includes(rf);
    });
  }

  // 4. Time Filter
  if (currentTimeFilter !== "all") {
    const now = Date.now();
    const maxAgeMs =
      currentTimeFilter === "24h"
        ? 24 * 60 * 60 * 1000
        : currentTimeFilter === "3d"
        ? 3 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    filtered = filtered.filter((j) => {
      const ts = getJobTimestamp(j);
      return now - ts <= maxAgeMs;
    });
  }

  // 5. Ranking & Sorting
  filtered.sort((a, b) => {
    const expA = getJobExperience(a);
    const expB = getJobExperience(b);

    if (currentSort === "exp-match") {
      // 0-2 yrs / Entry first (Ideal Candidate Fit), then Mid (2-5), then Senior (5+)
      const rankOrder = { entry: 0, mid: 1, senior: 2 };
      const rankDiff = (rankOrder[expA.level] ?? 1) - (rankOrder[expB.level] ?? 1);
      if (rankDiff !== 0) return rankDiff;
      // Tie-breaker: newest posted
      return getJobTimestamp(b) - getJobTimestamp(a);
    }

    if (currentSort === "exp-asc") {
      // Experience: lowest min years to highest
      return expA.min - expB.min;
    }

    if (currentSort === "exp-desc") {
      // Experience: highest min years to lowest
      return expB.min - expA.min;
    }

    if (currentSort === "score-highest") {
      const scoreA = a._evaluation?.score ?? 0;
      const scoreB = b._evaluation?.score ?? 0;
      return scoreB - scoreA;
    }

    if (currentSort === "posted-newest") {
      return getJobTimestamp(b) - getJobTimestamp(a);
    }

    if (currentSort === "posted-oldest") {
      return getJobTimestamp(a) - getJobTimestamp(b);
    }

    if (currentSort === "company-az") {
      const compA = (a.company_name || a.company || "").toLowerCase();
      const compB = (b.company_name || b.company || "").toLowerCase();
      return compA.localeCompare(compB);
    }

    return 0;
  });

  renderJobsList("jobs-list", filtered);
  renderJobsList("home-jobs-list", filtered.slice(0, 15));
}

// --- Render Job Cards ---
function renderJobsList(containerId, jobs) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (jobs.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No jobs found matching your filters. Try clearing filters or scanning for more roles!</p>
      </div>`;
    return;
  }

  el.innerHTML = jobs.map((job) => createJobCardHtml(job)).join("");
}

function createJobCardHtml(job) {
  const company = job.company_name || job.company || "Company";
  const title = job.title || "Software / ML Engineer";
  const location = job.location || "India";
  const site = (job.site || "portal").toLowerCase();
  const postedTime = formatPostedTime(job.date_posted, job._scannedAt);
  const eval_ = job._evaluation;
  const targetRole = job.target_role || detectRoleClient(title, job.description);
  const exp = getJobExperience(job);

  // Experience Badge Style Class
  const expBadgeClass = exp.level === "entry" ? "badge-exp-entry" : exp.level === "mid" ? "badge-exp-mid" : "badge-exp-senior";

  // Score Pill
  let scoreBadgeHtml = "";
  if (eval_ && eval_.score) {
    const isApply = (eval_.verdict || "").toUpperCase().includes("APPLY");
    scoreBadgeHtml = `<div class="badge-score-pill ${isApply ? 'score-apply' : 'score-review'}">${eval_.score.toFixed(1)} ⭐ ${escHtml(eval_.verdict || "REVIEW")}</div>`;
  }

  // Portal Badge
  let portalBadge = `<span class="tag-badge badge-portal">${escHtml(site)}</span>`;
  if (site.includes("wellfound")) portalBadge = `<span class="tag-badge badge-wf">🌟 Wellfound</span>`;
  else if (site.includes("yc")) portalBadge = `<span class="tag-badge badge-yc">🚀 YC Startup</span>`;

  return `
    <article class="job-card" onclick="openJobFlow('${job._id}', 1)">
      <div class="job-card-top-row">
        <div class="job-card-title-group">
          <h3 class="job-card-title">${escHtml(title)}</h3>
          <div class="job-card-company">
            <span>🏢 ${escHtml(company)}</span>
            <span>•</span>
            <span class="job-card-location">📍 ${escHtml(location)}</span>
          </div>
        </div>
        ${scoreBadgeHtml}
      </div>

      <div class="job-meta-tags">
        <span class="tag-badge badge-role">🎯 ${escHtml(targetRole)}</span>
        <span class="tag-badge ${expBadgeClass}">⏳ Exp: ${escHtml(exp.text)}</span>
        <span class="tag-badge badge-posted">${postedTime}</span>
        ${portalBadge}
        ${job._tailoredResume ? `<span class="tag-badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.35);">📄 Resume Ready</span>` : ""}
      </div>

      <div class="card-bottom-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm btn-flow-primary" onclick="openJobFlow('${job._id}', 1)">
          ⚡ Start 4-Step Application Flow
        </button>
        <button class="btn btn-sm btn-outline btn-card-secondary" onclick="openJobFlow('${job._id}', 2)">
          📄 Resume
        </button>
        ${(job.job_url || job.link) ? `
          <a href="${escHtml(job.job_url || job.link)}" target="_blank" rel="noopener" class="btn btn-sm btn-ghost" title="Open Job Portal">
            🔗 Portal
          </a>` : ""}
      </div>
    </article>
  `;
}

// =========================================================================
// THE FIXED 4-STEP APPLICATION STEPPER WIZARD
// =========================================================================

function openJobFlow(jobId, startingStep = 1) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  activeFlowJobId = jobId;
  activeStep = startingStep;

  const company = job.company_name || job.company || "Company";
  const title = job.title || "Engineer";
  const targetRole = job.target_role || detectRoleClient(title, job.description);
  const exp = getJobExperience(job);

  // Update Sticky Modal Header
  setElText("flow-job-title", title);
  setElText("flow-job-company", `${company} · ${job.location || "India"}`);
  setElText("flow-role-badge", `🎯 ${targetRole}`);
  setElText("flow-exp-badge", `⏳ Exp Required: ${exp.text}`);
  setElText("flow-match-badge", `${exp.level === 'entry' ? '🟢' : exp.level === 'mid' ? '🟡' : '🟣'} ${exp.matchBadge}`);

  renderStep(activeStep);
  document.getElementById("job-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("job-modal").classList.add("hidden");
  activeFlowJobId = null;
}

function goToStep(stepNum) {
  if (stepNum < 1 || stepNum > 4) return;
  activeStep = stepNum;
  renderStep(activeStep);
}

function nextStep() {
  if (activeStep < 4) {
    goToStep(activeStep + 1);
  } else {
    // Finish step 4 -> Mark applied
    if (activeFlowJobId) {
      markApplied(activeFlowJobId);
      closeModal();
    }
  }
}

function prevStep() {
  if (activeStep > 1) {
    goToStep(activeStep - 1);
  }
}

function renderStep(stepNum) {
  const job = allJobs.find((j) => j._id === activeFlowJobId);
  if (!job) return;

  // 1. Update Stepper Tabs
  for (let s = 1; s <= 4; s++) {
    const btn = document.getElementById(`step-btn-${s}`);
    const pane = document.getElementById(`step-pane-${s}`);

    if (btn) {
      btn.classList.toggle("active", s === stepNum);
      btn.classList.toggle("completed", s < stepNum);
    }
    if (pane) {
      pane.classList.toggle("active", s === stepNum);
    }
  }

  // 2. Update Footer Controls
  const prevBtn = document.getElementById("flow-prev-btn");
  const nextBtn = document.getElementById("flow-next-btn");
  const indicator = document.getElementById("step-indicator-text");

  if (prevBtn) {
    prevBtn.disabled = stepNum === 1;
  }

  if (indicator) {
    indicator.textContent = `Step ${stepNum} of 4`;
  }

  if (nextBtn) {
    if (stepNum === 1) nextBtn.innerHTML = `Next: Tailor Resume ▶`;
    else if (stepNum === 2) nextBtn.innerHTML = `Next: Form Answers ▶`;
    else if (stepNum === 3) nextBtn.innerHTML = `Next: Apply &amp; Track ▶`;
    else if (stepNum === 4) nextBtn.innerHTML = `✅ Complete &amp; Mark Applied`;
  }

  // 3. Render Step Content
  if (stepNum === 1) renderStep1(job);
  else if (stepNum === 2) renderStep2(job);
  else if (stepNum === 3) renderStep3(job);
  else if (stepNum === 4) renderStep4(job);

  // Scroll step body to top
  const scrollArea = document.querySelector(".modal-body-scrollable");
  if (scrollArea) scrollArea.scrollTop = 0;
}

// -------------------------------------------------------------------------
// STEP 1: JOB OVERVIEW & EVALUATION
// -------------------------------------------------------------------------
function renderStep1(job) {
  const container = document.getElementById("step-1-content");
  if (!container) return;

  const company = job.company_name || job.company || "Company";
  const desc = job.description || "No job description available";
  const eval_ = job._evaluation;
  const salary = job._salaryBenchmark;
  const security = job._security;
  const exp = getJobExperience(job);
  const targetRole = job.target_role || detectRoleClient(job.title, desc);

  // Evaluation Banner
  let evalSection = "";
  if (eval_) {
    const isApply = (eval_.verdict || "").toUpperCase().includes("APPLY");
    const scoreColor = eval_.score >= 4 ? "var(--accent-emerald)" : eval_.score >= 3 ? "var(--accent-amber)" : "var(--accent-rose)";
    evalSection = `
      <div class="eval-card-banner">
        <div class="score-circle-lg" style="background:${scoreColor}">
          ${eval_.score.toFixed(1)}
        </div>
        <div>
          <div class="verdict-text-bold" style="color:${scoreColor}">
            ${escHtml(eval_.verdict)} — Official career-ops Rubric
          </div>
          <div class="verdict-summary-text">${escHtml(eval_.summary || "Evaluation completed against candidate cv.md")}</div>
        </div>
      </div>

      ${eval_.strengths?.length ? `
        <div class="step-section-box">
          <div class="step-box-title" style="color:var(--accent-emerald)">✅ Matched Strengths (from cv.md)</div>
          <ul class="strengths-list">
            ${eval_.strengths.map((s) => `<li>${escHtml(s)}</li>`).join("")}
          </ul>
        </div>` : ""}

      ${eval_.gaps?.length ? `
        <div class="step-section-box">
          <div class="step-box-title" style="color:var(--accent-amber)">⚠️ Gaps &amp; Interview Focus</div>
          <ul class="gaps-list">
            ${eval_.gaps.map((g) => `<li>${escHtml(g)}</li>`).join("")}
          </ul>
        </div>` : ""}
    `;
  } else {
    evalSection = `
      <div class="step-section-box" style="text-align:center;padding:20px;">
        <p style="color:var(--text-secondary);font-size:0.86rem;margin-bottom:10px;">
          This job has not been evaluated with the official 5-point career-ops rubric yet.
        </p>
        <button class="btn btn-primary btn-sm" onclick="evaluateJobInFlow('${job._id}')">
          ⚡ Evaluate Match with career-ops &amp; DeepSeek
        </button>
      </div>`;
  }

  // Salary & Security Cards
  let salarySecurityHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px;margin-bottom:14px;">
      <div class="step-section-box" style="margin-bottom:0;">
        <div class="step-box-title" style="color:#c084fc;">💵 Salary Benchmark</div>
        <div style="font-size:0.84rem;color:#cbd5e1;margin-top:6px;">
          ${salary?.categories?.engineering?.index ? `Comp Index: <strong>${salary.categories.engineering.index}</strong> (Baseline 100 = ~₹12 LPA)` : "Standard Market Range: ₹12–18 LPA for early-career ML/CV"}
        </div>
      </div>
      <div class="step-section-box" style="margin-bottom:0;">
        <div class="step-box-title" style="color:var(--accent-emerald);">🛡️ Posting Security</div>
        <div style="font-size:0.84rem;color:#cbd5e1;margin-top:6px;">
          ${security?.verdict ? escHtml(security.verdict) : "Verified by ai-job-search posting_guard"}
        </div>
      </div>
    </div>`;

  container.innerHTML = `
    <!-- Experience & Candidate Match Highlight Card -->
    <div class="step-section-box" style="border-left:4px solid var(--accent-primary);">
      <div class="step-box-header">
        <span class="step-box-title">⏳ Experience Requirement &amp; Candidate Fit</span>
        <span class="tag-badge ${exp.level === 'entry' ? 'badge-exp-entry' : exp.level === 'mid' ? 'badge-exp-mid' : 'badge-exp-senior'}">
          ${escHtml(exp.text)}
        </span>
      </div>
      <div style="font-size:0.86rem;color:#cbd5e1;line-height:1.5;">
        <strong>Job Requirement:</strong> ${escHtml(exp.text)} in ${escHtml(targetRole)}.<br>
        <strong>Candidate Match:</strong> ${escHtml(exp.matchBadge)} — Prakhar Pragyan Chaubey has 1 yr experience at Mayonix Innovation deploying sub-100ms edge AI models (92%+ mAP YOLO) and expected B.Tech graduation July 2026.
      </div>
    </div>

    ${evalSection}

    ${salarySecurityHtml}

    <!-- Job Description Box -->
    <div class="step-section-box">
      <div class="step-box-header">
        <span class="step-box-title">📄 Full Job Description</span>
        <span class="tag-badge badge-role">🎯 ${escHtml(targetRole)}</span>
      </div>
      <div style="max-height:240px;overflow-y:auto;font-size:0.83rem;color:var(--text-secondary);line-height:1.6;white-space:pre-wrap;background:var(--bg-surface);padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border-subtle);">
${escHtml(desc)}
      </div>
    </div>

    <!-- Quick Action to Continue -->
    <div style="text-align:right;margin-top:10px;">
      <button class="btn btn-primary" onclick="goToStep(2)">
        Continue to Step 2: Tailor Resume ➔
      </button>
    </div>
  `;
}

// -------------------------------------------------------------------------
// STEP 2: ROLE-SPECIFIC RESUME TAILORING
// -------------------------------------------------------------------------
function renderStep2(job) {
  const container = document.getElementById("step-2-content");
  if (!container) return;

  const company = job.company_name || job.company || "Company";
  const targetRole = job.target_role || detectRoleClient(job.title, job.description);
  const tailored = job._tailoredResume;

  if (tailored) {
    container.innerHTML = `
      <div class="step-section-box" style="border-left:4px solid var(--accent-emerald);">
        <div class="step-box-header">
          <div>
            <span class="step-box-title" style="color:var(--accent-emerald);">📄 Tailored ATS Personal Resume</span>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">Customized strictly from verified track record (zero hallucinations)</div>
          </div>
          <span class="tag-badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.35);">
            Ready for ${escHtml(targetRole)}
          </span>
        </div>

        <div style="font-size:0.9rem;font-weight:700;color:#ffffff;margin-bottom:6px;">
          🎯 Role Headline: <span style="color:#38bdf8;">${escHtml(tailored.headline || targetRole)}</span>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.pdf" target="_blank" download="Prakhar_Chaubey_Resume_${escHtml(company)}.pdf" class="btn btn-success btn-sm">
            ⬇️ Download PDF Resume
          </a>
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.html" target="_blank" class="btn btn-outline btn-sm">
            🖨️ Save as PDF / Print Preview
          </a>
          <button class="btn btn-ghost btn-sm" onclick="tailorResumeInFlow('${job._id}')">
            ↻ Re-tailor for Role
          </button>
        </div>
      </div>

      <!-- Preview Summary & Competencies -->
      <div class="step-section-box">
        <div class="step-box-title" style="color:#93c5fd;margin-bottom:8px;">🎯 Tailored Professional Summary</div>
        <div style="font-size:0.84rem;color:#cbd5e1;line-height:1.55;background:var(--bg-surface);padding:10px 12px;border-radius:var(--radius-md);">
          ${escHtml(tailored.formAnswers?.whyInterested || `Machine Learning Engineer at Mayonix Innovation specializing in edge AI and computer vision models (92%+ mAP YOLOv8/v9, sub-100ms latency on edge hardware via TensorRT, TFLite, INT8 quantization). Seeking to contribute to ${company} as a ${targetRole}.`)}
        </div>
      </div>

      <div style="text-align:right;margin-top:14px;">
        <button class="btn btn-primary" onclick="goToStep(3)">
          Continue to Step 3: Application Form Answers ➔
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="step-section-box" style="text-align:center;padding:28px 18px;">
        <div style="font-size:2.2rem;margin-bottom:10px;">📄</div>
        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">Generate Role-Specific Resume for ${escHtml(company)}</h3>
        <p style="font-size:0.84rem;color:var(--text-secondary);max-width:520px;margin:0 auto 16px;">
          Our engine reformulates your real accomplishments (Mayonix YOLO 92%+ mAP, sub-100ms edge optimization, AlphaSense AI, IEEE publications) with vocabulary from this <strong>${escHtml(targetRole)}</strong> job description under strict anti-fabrication rules.
        </p>
        <button class="btn btn-primary" onclick="tailorResumeInFlow('${job._id}')">
          ⚡ Generate Role-Specific Resume (PDF &amp; HTML)
        </button>
      </div>
    `;
  }
}

// -------------------------------------------------------------------------
// STEP 3: MOBILE FORM AUTO-FILL & SCREENING ANSWERS
// -------------------------------------------------------------------------
function renderStep3(job) {
  const container = document.getElementById("step-3-content");
  if (!container) return;

  const company = job.company_name || job.company || "Company";
  const targetRole = job.target_role || detectRoleClient(job.title, job.description);
  const fAnswers = job._tailoredResume?.formAnswers || {};

  const whyInterested = fAnswers.whyInterested || `I am excited to apply for the ${targetRole} position at ${company}. With proven experience deploying edge-optimized YOLOv8/v9 models (92%+ mAP, sub-100ms latency) and multi-model AI architectures, I am eager to contribute to ${company}'s engineering goals.`;
  const relevantExperience = fAnswers.relevantExperience || `At Mayonix Innovation, I engineered on-device computer vision models with TensorFlow Lite and YOLOv8/v9, optimizing them via INT8/FP16 quantization for sub-100ms mobile latency. In addition, I built AlphaSense AI, integrating PyTorch, Transformers, Mamba, and FastAPI.`;
  const whyHireMe = fAnswers.whyHireMe || `I combine practical production experience taking edge models to sub-100ms latencies with published IEEE research in machine learning. I can immediately contribute to ${company}'s computer vision and ML pipelines.`;
  const coverLetter = fAnswers.coverLetter || `Dear Hiring Team at ${company},\n\nI am writing to express my strong interest in the ${job.title || targetRole} role. As a Machine Learning Engineer at Mayonix Innovation and published IEEE researcher, I specialize in computer vision, real-time object detection (YOLOv8/v9, 92%+ mAP), and edge model optimization (INT8/FP16 quantization, TensorRT, TFLite).\n\nMy background matches your requirements for high-performance ML engineering and latency-critical systems. I look forward to the opportunity to discuss how my hands-on experience can support ${company}'s engineering goals.\n\nSincerely,\nPrakhar Pragyan Chaubey`;

  container.innerHTML = `
    <!-- Top 1-Tap Copy Action -->
    <div class="step-section-box" style="background:linear-gradient(135deg, rgba(30,41,59,0.8), rgba(15,23,42,0.9));border:1px solid rgba(59,130,246,0.35);">
      <div class="step-box-header">
        <span class="step-box-title" style="color:#38bdf8;">📱 Mobile Phone &amp; Web Form Assistant</span>
        <span class="tag-badge" style="background:rgba(56,189,248,0.2);color:#38bdf8;">Phone Ready</span>
      </div>
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
        Applying on your phone? Tap <strong>Copy All Form Info</strong> to copy everything into your clipboard, or tap any individual pill below to copy that exact field:
      </p>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-primary btn-sm" onclick="copyAllJobFormInfo('${job._id}')" style="flex:2;min-width:200px;">
          ⚡ Copy All Form Info (1-Tap)
        </button>
        <button class="btn btn-outline btn-sm" onclick="copyJobBookmarklet('${job._id}')" style="flex:1;">
          📲 Copy Mobile Bookmarklet
        </button>
      </div>

      <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">
        1-Tap Copy Candidate Details:
      </div>
      <div class="pill-grid-touch">
        <button class="touch-pill" onclick="copyDirect('Prakhar Pragyan Chaubey', this)">👤 Name</button>
        <button class="touch-pill" onclick="copyDirect('prakharpragyan1000@gmail.com', this)">✉️ Email</button>
        <button class="touch-pill" onclick="copyDirect('+91-8853511579', this)">📞 Phone</button>
        <button class="touch-pill" onclick="copyDirect('Ghaziabad, Uttar Pradesh, India', this)">📍 Location</button>
        <button class="touch-pill" onclick="copyDirect('https://linkedin.com/in/prakhar-b045b91ab', this)">🔗 LinkedIn</button>
        <button class="touch-pill" onclick="copyDirect('https://github.com/pieby2', this)">🐙 GitHub</button>
        <button class="touch-pill" onclick="copyDirect('Mayonix Innovation', this)">🏢 Current Co.</button>
        <button class="touch-pill" onclick="copyDirect('Machine Learning Engineer', this)">💼 Current Title</button>
        <button class="touch-pill" onclick="copyDirect('Immediately available (15-30 days)', this)">⏱️ Notice Period</button>
        <button class="touch-pill" onclick="copyDirect('₹15,00,000 INR (Negotiable)', this)">💵 Expected CTC</button>
        <button class="touch-pill" onclick="copyDirect('Yes', this)">🛡️ Auth to Work: Yes</button>
        <button class="touch-pill" onclick="copyDirect('No', this)">🚫 Sponsorship: No</button>
      </div>
    </div>

    <!-- Tailored Screening Answers -->
    <div class="step-section-box">
      <div class="step-box-title" style="color:#93c5fd;margin-bottom:8px;">📝 Pre-Written Screening Question Answers</div>

      ${createCopyAnswerCardHtml("❓ Why are you interested in this role & company?", whyInterested)}
      ${createCopyAnswerCardHtml("💼 Describe your relevant experience", relevantExperience)}
      ${createCopyAnswerCardHtml("🎯 Why should we hire you? (Proof points)", whyHireMe)}
      ${createCopyAnswerCardHtml("📝 Cover Letter / Note to Hiring Team", coverLetter)}
    </div>

    <!-- Cloud Headless Auto-Fill (Optional) -->
    <div class="step-section-box">
      <div class="step-box-header">
        <span class="step-box-title" style="color:#60a5fa;">🤖 Cloud Form Auto-Filler (Playwright)</span>
      </div>
      <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">
        Have our cloud runner navigate to the portal, auto-fill candidate details &amp; questions, and take a screenshot of the filled page.
      </p>
      <button class="btn btn-autofill btn-sm" onclick="autofillForm('${job._id}')">
        🚀 Run Cloud Auto-Fill &amp; Get Screenshot
      </button>
      <div id="autofill-feedback-${job._id}" style="margin-top:8px;font-size:0.82rem;display:none;"></div>
    </div>

    <!-- Custom Portal Question Solver -->
    <div class="step-section-box">
      <div class="step-box-title" style="color:var(--accent-amber);">✨ Portal Custom Question Solver</div>
      <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px;">
        Asked an unusual question on the portal? Paste it below to generate an authentic answer with DeepSeek:
      </p>
      <textarea id="custom-questions-input-${job._id}" class="search-input" style="width:100%;height:68px;resize:vertical;font-size:0.82rem;margin-bottom:8px;" placeholder="Paste questions here (e.g. 'Explain your experience with TensorRT', 'Why leave your current role?')..."></textarea>
      <button class="btn btn-primary btn-sm" onclick="solveQuestionsInFlow('${job._id}')">
        ✨ Solve Question with DeepSeek
      </button>
      <div id="solved-questions-container-${job._id}" style="margin-top:8px;">
        ${(job._customQuestions || []).map((qa) => createCopyAnswerCardHtml(qa.question, qa.answer)).join("")}
      </div>
    </div>

    <div style="text-align:right;margin-top:14px;">
      <button class="btn btn-primary" onclick="goToStep(4)">
        Continue to Step 4: Apply &amp; Track ➔
      </button>
    </div>
  `;
}

function createCopyAnswerCardHtml(promptText, answerText) {
  const cardId = "qa-" + Math.random().toString(36).substring(2, 9);
  return `
    <div class="copy-answer-card">
      <div class="copy-answer-header">
        <span class="copy-answer-prompt">${escHtml(promptText)}</span>
        <button class="btn-copy-chip" onclick="copyDirect('${escHtml(answerText).replace(/'/g, "\\'")}', this)">
          📋 Copy
        </button>
      </div>
      <div class="copy-answer-body">${escHtml(answerText)}</div>
    </div>
  `;
}

// -------------------------------------------------------------------------
// STEP 4: APPLY ON PORTAL & SYNC TRACKER
// -------------------------------------------------------------------------
function renderStep4(job) {
  const container = document.getElementById("step-4-content");
  if (!container) return;

  const company = job.company_name || job.company || "Company";
  const jobUrl = job.job_url || job.link || "";
  const outreach = job._coldOutreach;
  const prep = job._interviewPrep;

  container.innerHTML = `
    <!-- Main Apply Button -->
    <div class="step-section-box" style="text-align:center;padding:24px 16px;background:linear-gradient(135deg, rgba(16,185,129,0.1), rgba(15,23,42,0.9));border:1px solid rgba(16,185,129,0.35);">
      <div style="font-size:2rem;margin-bottom:8px;">🚀</div>
      <h3 style="font-size:1.15rem;font-weight:800;color:#ffffff;margin-bottom:6px;">Ready to Submit Application</h3>
      <p style="font-size:0.84rem;color:var(--text-secondary);max-width:480px;margin:0 auto 16px;">
        Open the official job application portal in a new tab. Paste your pre-copied answers or use the 1-click mobile bookmarklet to fill all inputs!
      </p>

      ${jobUrl ? `
        <a href="${escHtml(jobUrl)}" target="_blank" rel="noopener" class="btn btn-success" style="font-size:0.95rem;padding:12px 24px;">
          🔗 Open Official Application Portal &amp; Apply Now
        </a>` : `<p style="color:var(--accent-amber);">Portal URL not found directly. Please search on company careers page.</p>`}
    </div>

    <!-- Official Tracker Sync -->
    <div class="step-section-box">
      <div class="step-box-title" style="color:#60a5fa;margin-bottom:8px;">📜 Sync with Official career-ops Tracker</div>
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
        Marking applied synchronizes your local status and commits the record to <code>career-ops/data/applications.md</code>.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-success btn-sm" onclick="markAppliedInFlow('${job._id}')">
          ✅ Mark as Applied
        </button>
        <button class="btn btn-outline btn-sm" onclick="updateJobStatus('${job._id}', 'saved')">
          ⭐ Save for Later
        </button>
        <button class="btn btn-ghost btn-sm" onclick="updateJobStatus('${job._id}', 'skipped')">
          ❌ Skip Job
        </button>
      </div>
    </div>

    <!-- Recruiter Cold Outreach Box -->
    <div class="step-section-box">
      <div class="step-box-header">
        <span class="step-box-title" style="color:#a855f7;">✉️ Recruiter &amp; Founder Cold Outreach</span>
        ${!outreach ? `<button class="btn btn-primary btn-sm" onclick="generateColdOutreach('${job._id}')">Draft DMs</button>` : ""}
      </div>
      ${outreach ? `
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <a href="${escHtml(outreach.linkedinSearchUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
            🔎 Search Hiring Managers on LinkedIn
          </a>
          <a href="${escHtml(outreach.mailtoUrl)}" class="btn btn-outline btn-sm">
            ✉️ Open Email Draft
          </a>
        </div>
        ${createCopyAnswerCardHtml("💬 LinkedIn Connection Note (<300 chars)", outreach.linkedinNote)}
        ${createCopyAnswerCardHtml("📄 Cold Email / InMail Subject & Body", `${outreach.emailSubject}\n\n${outreach.emailBody}`)}
      ` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Click 'Draft DMs' to generate high-converting outreach messages tailored to hiring managers at ${company}.</p>`}
    </div>

    <!-- Technical Interview Prep Box -->
    <div class="step-section-box">
      <div class="step-box-header">
        <span class="step-box-title" style="color:var(--accent-primary);">🎙️ AI Technical Interview Cheat Sheet</span>
        ${!prep ? `<button class="btn btn-primary btn-sm" onclick="generateInterviewPrep('${job._id}')">Generate Prep</button>` : ""}
      </div>
      ${prep ? `
        <div style="font-size:0.8rem;color:#cbd5e1;margin-bottom:8px;">
          <strong>Technical Focus:</strong> ${escHtml(prep.summary || "High-frequency edge AI and ML questions")}
        </div>
        ${(prep.technicalQuestions || []).map((tq, i) => createCopyAnswerCardHtml(`Q${i+1}: ${tq.question}`, `Why they ask: ${tq.whyTheyAsk}\n\nSuggested Answer:\n${tq.suggestedAnswer}`)).join("")}
      ` : `<p style="font-size:0.8rem;color:var(--text-secondary);">Click 'Generate Prep' to analyze this exact role and generate predicted technical interview questions with tailored model answers.</p>`}
    </div>
  `;
}

// =========================================================================
// WIZARD ACTION HANDLERS
// =========================================================================

async function evaluateJobInFlow(jobId) {
  showLoading("Evaluating job match with official career-ops rubric...\nComparing tech stack with candidate's real CV...");
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/evaluate`, { method: "POST" });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const job = allJobs.find((j) => j._id === jobId);
    if (job) {
      job._evaluation = data.evaluation;
      job._salaryBenchmark = data.salaryBenchmark;
      job._security = data.security;
    }

    hideLoading();
    renderStep(1);
    showToast("✅ career-ops match evaluation complete!");
  } catch (e) {
    hideLoading();
    alert("Evaluation failed: " + e.message);
  }
}

async function tailorResumeInFlow(jobId) {
  showLoading("Tailoring role-specific ATS resume with DeepSeek...\nStrict anti-fabrication rules active...\nCompiling PDF via Playwright Chromium...");
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/tailor-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const job = allJobs.find((j) => j._id === jobId);
    if (job) {
      job._tailoredResume = data;
    }

    hideLoading();
    renderStep(2);
    showToast("✅ Tailored personal resume generated!");
  } catch (e) {
    hideLoading();
    alert("Resume tailoring notice: " + e.message);
  }
}

async function solveQuestionsInFlow(jobId) {
  const input = document.getElementById(`custom-questions-input-${jobId}`);
  const questionsText = input ? input.value.trim() : "";
  if (!questionsText) {
    alert("Please paste one or more questions from the application form first.");
    return;
  }

  showLoading("DeepSeek is analyzing your CV to generate authentic answers...");
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/solve-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: questionsText }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const job = allJobs.find((j) => j._id === jobId);
    if (job) {
      if (!job._customQuestions) job._customQuestions = [];
      for (const item of (data.answers || [])) {
        const idx = job._customQuestions.findIndex((q) => q.question === item.question);
        if (idx !== -1) job._customQuestions[idx] = item;
        else job._customQuestions.push(item);
      }
    }

    hideLoading();
    renderStep(3);
    showToast("✅ Question answers generated!");
  } catch (err) {
    hideLoading();
    alert("Question solving failed: " + err.message);
  }
}

async function markAppliedInFlow(jobId) {
  await updateJobStatus(jobId, "applied");
  showToast("🎉 Application recorded and synced with tracker!");
}

async function updateJobStatus(jobId, status) {
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const job = allJobs.find((j) => j._id === jobId);
    if (job) job._status = status;

    applySortAndFilter();
    loadStats();
    showToast(`Status updated to: ${status}`);
  } catch (e) {
    alert("Status update error: " + e.message);
  }
}

// --- Recruiter Cold Outreach ---
async function generateColdOutreach(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("AI is crafting high-converting cold DMs & emails...\nInjecting Mayonix & AlphaSense metrics...");
  try {
    const res = await fetch("/api/cold-outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._coldOutreach = data;
    hideLoading();
    renderStep(4);
    showToast("✉️ Cold outreach messages drafted!");
  } catch (e) {
    hideLoading();
    alert("Outreach error: " + e.message);
  }
}

// --- Technical Interview Prep ---
async function generateInterviewPrep(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("Generating technical interview cheat sheet...\nFormulating questions, tailored answers, and system design...");
  try {
    const res = await fetch("/api/interview-prep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._interviewPrep = data;
    hideLoading();
    renderStep(4);
    showToast("🎙️ Interview prep cheat sheet ready!");
  } catch (e) {
    hideLoading();
    alert("Interview prep error: " + e.message);
  }
}

// =========================================================================
// 1-TAP COPY & MOBILE BOOKMARKLET HELPERS
// =========================================================================

function copyDirect(text, btn) {
  if (navigator.vibrate) navigator.vibrate(35);
  const origText = btn ? btn.innerHTML : "";

  function notifyCopied() {
    if (btn) {
      btn.classList.add("pill-copied");
      btn.innerHTML = "✅ Copied!";
      setTimeout(() => {
        btn.classList.remove("pill-copied");
        btn.innerHTML = origText;
      }, 1400);
    }
    showToast("Copied to clipboard!");
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(notifyCopied).catch(() => {
      fallbackCopy(text);
      notifyCopied();
    });
  } else {
    fallbackCopy(text);
    notifyCopied();
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

async function copyAllJobFormInfo(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  let text = job._tailoredResume?.copyAllText;
  if (!text) {
    try {
      showLoading("Compiling complete application info package...");
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/form-pack`);
      const data = await res.json();
      hideLoading();
      if (data.copyAllText) {
        text = data.copyAllText;
        if (data.formAnswers) {
          if (!job._tailoredResume) job._tailoredResume = {};
          job._tailoredResume.formAnswers = data.formAnswers;
          job._tailoredResume.copyAllText = data.copyAllText;
          job._tailoredResume.bookmarklet = data.bookmarklet;
        }
      }
    } catch {
      hideLoading();
    }
  }

  if (!text) {
    const company = job.company_name || job.company || "Company";
    const role = job.target_role || detectRoleClient(job.title, job.description);
    text = `APPLICANT INFORMATION:
Name: ${CANDIDATE_PROFILE.fullName}
Email: ${CANDIDATE_PROFILE.email}
Phone: ${CANDIDATE_PROFILE.phone}
Location: ${CANDIDATE_PROFILE.location}
LinkedIn: ${CANDIDATE_PROFILE.linkedin}
GitHub: ${CANDIDATE_PROFILE.github}
Current Company: ${CANDIDATE_PROFILE.currentCompany}
Current Title: ${CANDIDATE_PROFILE.currentTitle}
Notice Period: ${CANDIDATE_PROFILE.noticePeriod}
Expected CTC: ${CANDIDATE_PROFILE.salaryExpectation}
Work Authorization: ${CANDIDATE_PROFILE.workAuth} (No sponsorship required)

WHY INTERESTED:
I am excited to apply for the ${role} position at ${company}. With hands-on experience deploying edge-optimized YOLOv8/v9 models (92%+ mAP, sub-100ms latency) and multi-model AI architectures, I am eager to contribute to ${company}'s engineering goals.

RELEVANT EXPERIENCE:
At Mayonix Innovation, I developed on-device computer vision models with TensorFlow Lite and YOLOv8/v9, optimizing them via INT8/FP16 quantization for sub-100ms mobile latency. I also engineered AlphaSense AI, integrating PyTorch, Transformers, Mamba, and FastAPI.

WHY HIRE ME:
I combine practical production experience optimizing edge models to sub-100ms latencies with published IEEE research in machine learning. I can immediately contribute to ${company}'s computer vision and ML pipelines.`;
  }

  copyDirect(text, null);
  alert("⚡ Complete Application Form Package copied!\n\nAll candidate details and tailored screening answers are in your clipboard ready to paste.");
}

async function copyJobBookmarklet(jobId) {
  try {
    const res = await fetch(`/api/bookmarklet?jobId=${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (data.bookmarklet) {
      copyDirect(data.bookmarklet, null);
      alert("📲 Mobile Auto-Fill Bookmarklet copied!\n\n📱 HOW TO USE ON YOUR PHONE:\n1. Bookmark any page in Mobile Chrome or Safari.\n2. Edit the bookmark: rename to '⚡ Auto-Fill' and paste this script into the URL field.\n3. Open any job application page (Workday, Greenhouse, Lever, Naukri, LinkedIn) on your phone.\n4. Type '⚡ Auto-Fill' in the URL bar (or select it from Bookmarks) -> All candidate details and screening answers will auto-fill instantly!");
    }
  } catch (err) {
    alert("Could not copy bookmarklet: " + err.message);
  }
}

// --- Cloud Headless Form Autofill (Playwright) ---
async function autofillForm(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("Navigating to application portal in cloud...\nAuto-filling candidate details...\nAttaching tailored PDF resume...\nAnswering screening questions with DeepSeek...");

  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/autofill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    hideLoading();
    const feedback = document.getElementById(`autofill-feedback-${jobId}`);
    if (feedback) {
      feedback.style.display = "block";
      let html = `<div style="color:var(--accent-emerald);font-weight:700;">✅ Cloud Auto-Fill Completed! Filled ${data.filledFields?.length || 0} fields and answered ${data.answeredQuestions?.length || 0} questions.</div>`;
      if (data.screenshot) {
        html += `<div style="margin-top:8px;"><strong style="font-size:0.75rem;color:var(--text-muted);">Captured Filled Form Snapshot:</strong><br><img src="${data.screenshot}" style="width:100%;max-height:260px;object-fit:cover;border-radius:6px;border:1px solid var(--border-subtle);margin-top:4px;" alt="Filled form screenshot"/></div>`;
      }
      feedback.innerHTML = html;
    }

    alert(`✅ Cloud Auto-Fill Complete!\n\nFilled ${data.filledFields?.length || 0} fields and ${data.answeredQuestions?.length || 0} questions.\n\nSnapshot preview has been loaded below. Proceed to Step 4 to review and submit!`);
  } catch (err) {
    hideLoading();
    alert("Auto-fill notice: " + err.message + "\n\nTip: You can use the '⚡ Copy All Form Info' button or individual field pills to fill the form in seconds on your phone!");
  }
}

// =========================================================================
// SCANNING HANDLERS
// =========================================================================

async function scanJobs() {
  const btn = document.getElementById("btn-scan");
  const status = document.getElementById("scan-status");
  const query = document.getElementById("scan-query").value;
  const location = document.getElementById("scan-location").value;
  const sites = document.getElementById("scan-sites").value;

  btn.disabled = true;
  btn.textContent = "⏳ Scanning Portals & Securing...";
  status.classList.add("hidden");
  showLoading("Scanning portals via JobSpy...\nRunning postings through ai-job-search security guard...");

  try {
    const res = await fetch(`/api/scan?search=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&sites=${encodeURIComponent(sites)}&results=15`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    status.textContent = `✅ Found ${data.new} new jobs (${data.total} total) — all verified through posting_guard!`;
    status.className = "status-msg success";
    status.classList.remove("hidden");

    await refreshJobs();
    await loadStats();

    if (data.new > 0) {
      document.querySelector('[data-view="jobs"]')?.click();
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    status.className = "status-msg error";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Scan Portals (with Security Gate)";
    hideLoading();
  }
}

async function scanAts() {
  const btn = document.getElementById("btn-scan-ats");
  const status = document.getElementById("scan-status");

  btn.disabled = true;
  btn.textContent = "⏳ Scanning ATS Boards...";
  status.classList.add("hidden");
  showLoading("Scanning official career-ops ATS boards (Greenhouse, Lever, Ashby)...");

  try {
    const res = await fetch("/api/scan-ats", { method: "POST" });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    status.textContent = `✅ ATS Scan complete: Found ${data.totalFound} listings across ${data.scannedPortals} portals!`;
    status.className = "status-msg success";
    status.classList.remove("hidden");

    await refreshJobs();
    await loadStats();
  } catch (e) {
    status.textContent = `❌ ATS Scan failed: ${e.message}`;
    status.className = "status-msg error";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🏢 Scan Direct ATS Boards (career-ops)";
    hideLoading();
  }
}

// =========================================================================
// OFFICIAL CAREER-OPS TRACKER VIEW
// =========================================================================

async function loadTracked() {
  const list = document.getElementById("history-list");
  if (!list) return;

  try {
    const res = await fetch("/api/tracked");
    trackedApplications = await res.json();
    renderTrackedList("all");
  } catch {
    list.innerHTML = `<div class="empty-state"><p>Could not connect to career-ops tracker.</p></div>`;
  }
}

function filterTracked(filter) {
  document.querySelectorAll(".tracker-filter-bar .filter-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.filter === filter);
  });
  renderTrackedList(filter);
}

function renderTrackedList(filter) {
  const list = document.getElementById("history-list");
  if (!list) return;

  let items = trackedApplications;
  if (filter !== "all") {
    items = items.filter((a) => (a.status || "").toLowerCase() === filter.toLowerCase());
  }

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <p>No tracked applications found under "${escHtml(filter)}". Mark jobs as applied in Step 4 to track them here!</p>
      </div>`;
    return;
  }

  list.innerHTML = items.map((app) => `
    <article class="job-card" style="cursor:default;">
      <div class="job-card-top-row">
        <div>
          <h3 class="job-card-title">${escHtml(app.company)}</h3>
          <div class="job-card-company">${escHtml(app.role || "Engineering")}</div>
        </div>
        <div class="badge-score-pill score-apply">${escHtml(app.status || "Applied")}</div>
      </div>
      <div class="job-meta-tags">
        ${app.date ? `<span class="tag-badge badge-posted">📅 ${escHtml(app.date)}</span>` : ""}
        ${app.archetype ? `<span class="tag-badge badge-role">${escHtml(app.archetype)}</span>` : ""}
      </div>
    </article>
  `).join("");
}

// =========================================================================
// UI HELPERS (LOADING, TOASTS, ESCAPING)
// =========================================================================

function showLoading(msg = "Analyzing...") {
  const el = document.getElementById("loading");
  const txt = document.getElementById("loading-text");
  if (txt) txt.textContent = msg;
  if (el) el.classList.remove("hidden");
}

function hideLoading() {
  const el = document.getElementById("loading");
  if (el) el.classList.add("hidden");
}

function showToast(msg) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>✨</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
