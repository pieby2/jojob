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
let recommendedProjects = [];
let currentSocialPlatform = "all";
let lastSocialQuery = "";
let lastSocialSources = {};
const SAVED_PROJECTS_KEY = "job_pilot_saved_social_projects_v1";
let savedSocialProjects = (() => {
  try {
    return JSON.parse(localStorage.getItem(SAVED_PROJECTS_KEY) || "[]");
  } catch {
    return [];
  }
})();

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

// --- Initialization (Instant Cache-First Paint + Background Bootstrap) ---
const CACHE_KEY = "job_pilot_cache_v2";

document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  // 1. Instant 0ms Paint: restore cached jobs, stats & profile from local storage
  loadFromLocalCache();
  // 2. High-speed single-request background sync: fetches fresh data via /api/init
  bootstrapApp();
});

function loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.profile?.name) {
      setElText("user-name", data.profile.name);
    }
    if (data.stats) {
      applyStatsToDom(data.stats);
    }
    if (Array.isArray(data.jobs) && data.jobs.length > 0) {
      allJobs = data.jobs;
      const activeCount = allJobs.filter((j) => j._status === "new" || j._status === "saved").length;
      setElText("total-jobs-count", activeCount);
      setElText("home-job-count", activeCount);
      setElText("header-jobs-badge", activeCount);
      setElText("mobile-jobs-badge", activeCount);
      applySortAndFilter();
    }
  } catch (e) {
    console.warn("Cache paint notice:", e);
  }
}

async function bootstrapApp() {
  try {
    const res = await fetchWithRetry("/api/init", { timeoutMs: 15000 }, 2);
    const data = await res.json();
    if (!data) return;

    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {}

    if (data.profile?.name) {
      setElText("user-name", data.profile.name);
    }
    if (data.stats) {
      applyStatsToDom(data.stats);
    }
    if (Array.isArray(data.jobs)) {
      allJobs = data.jobs;
      const activeCount = allJobs.filter((j) => j._status === "new" || j._status === "saved").length;
      setElText("total-jobs-count", activeCount);
      setElText("home-job-count", activeCount);
      setElText("header-jobs-badge", activeCount);
      setElText("mobile-jobs-badge", activeCount);
      applySortAndFilter();
    }
  } catch (err) {
    console.warn("Bootstrap sync notice:", err);
    if (!allJobs || allJobs.length === 0) {
      loadProfile();
      loadStats();
      refreshJobs();
    }
  }
}

function applyStatsToDom(data) {
  const local = data.local || {};
  const cOps = data.careerOps || {};
  setElText("stat-total", local.totalScanned || 0);
  setElText("stat-applied", cOps.byStatus?.Applied || local.appliedCount || 0);
  setElText("stat-avg-score", cOps.avgScore ? `${cOps.avgScore.toFixed(1)}/5` : "—");
  setElText("stat-top-score", cOps.topScore ? `${cOps.topScore.toFixed(1)}/5` : "—");
}

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
    } else if (viewName === "recommended-projects") {
      updateSavedProjectsCount();
      if (recommendedProjects.length === 0) {
        searchRecommendedProjects();
      } else {
        renderRecommendedProjects();
      }
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

// --- Resilient Fetch with Retry, Timeout & Keep-Alive ---
async function fetchWithRetry(url, options = {}, retries = 2, delay = 1000) {
  const timeoutMs = options.timeoutMs || 40000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
}

// --- Profile & Stats ---
async function loadProfile() {
  try {
    const res = await fetchWithRetry("/api/profile", { timeoutMs: 12000 }, 2);
    const data = await res.json();
    if (data.name) {
      setElText("user-name", data.name);
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  try {
    const res = await fetchWithRetry("/api/stats", { timeoutMs: 12000 }, 2);
    const data = await res.json();
    applyStatsToDom(data);
  } catch { /* ignore */ }
}

function setElText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// --- Experience & Role Helper Functions ---
function getJobExperience(job) {
  if (job.experience_required && job.experience_min !== undefined && job.experience_level) {
    return {
      text: job.experience_required,
      min: job.experience_min,
      max: job.experience_max !== undefined ? job.experience_max : job.experience_min,
      level: job.experience_level || "unspecified",
      matchBadge: job.experience_match || "Check JD"
    };
  }

  const title = String(job.title || "");
  const desc = String(job.description || "");
  const jobUrl = String(job.job_url || job.link || "");
  const jMin = job.yearsExperienceMin !== undefined ? job.yearsExperienceMin : null;
  const jMax = job.yearsExperienceMax !== undefined ? job.yearsExperienceMax : null;

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

  const text = `${title}\n${desc}`;

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
    const res = await fetchWithRetry("/api/jobs", { timeoutMs: 15000 }, 2);
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
  updateJobSearchProjectsHint();

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
      // 0-2 yrs / Entry first (Ideal Candidate Fit), then Mid (2-5), then Senior (5+), then unspecified
      const rankOrder = { entry: 0, mid: 1, senior: 2, unspecified: 3 };
      const rankDiff = (rankOrder[expA.level] ?? 2) - (rankOrder[expB.level] ?? 2);
      if (rankDiff !== 0) return rankDiff;
      // Tie-breaker: newest posted
      return getJobTimestamp(b) - getJobTimestamp(a);
    }

    if (currentSort === "exp-asc") {
      // Experience: lowest min years to highest (unspecified to bottom)
      const valA = expA.min !== null && expA.min !== undefined ? expA.min : 99;
      const valB = expB.min !== null && expB.min !== undefined ? expB.min : 99;
      return valA - valB;
    }

    if (currentSort === "exp-desc") {
      // Experience: highest min years to lowest (unspecified to bottom)
      const valA = expA.min !== null && expA.min !== undefined ? expA.min : -1;
      const valB = expB.min !== null && expB.min !== undefined ? expB.min : -1;
      return valB - valA;
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

  // Fast Batch Rendering: render the first 16 cards immediately so the screen paints in 2ms
  const BATCH_SIZE = 16;
  const initial = jobs.slice(0, BATCH_SIZE);
  el.innerHTML = initial.map((job) => createJobCardHtml(job)).join("");

  // Defer rendering of remaining cards to next idle frame to keep 60 FPS
  if (jobs.length > BATCH_SIZE) {
    const remaining = jobs.slice(BATCH_SIZE);
    const appendRest = () => {
      const restHtml = remaining.map((job) => createJobCardHtml(job)).join("");
      el.insertAdjacentHTML("beforeend", restHtml);
    };
    if (window.requestIdleCallback) {
      window.requestIdleCallback(appendRest, { timeout: 200 });
    } else {
      setTimeout(appendRest, 16);
    }
  }
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
  const expBadgeClass = exp.level === "entry" ? "badge-exp-entry" : exp.level === "mid" ? "badge-exp-mid" : exp.level === "senior" ? "badge-exp-senior" : "badge-exp-unspecified";

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
// STEP 2: MULTI-PROJECT RESUME TAILORING
// -------------------------------------------------------------------------
function renderStep2(job) {
  const container = document.getElementById("step-2-content");
  if (!container) return;

  const company = job.company_name || job.company || "Company";
  const targetRole = job.target_role || detectRoleClient(job.title, job.description);
  const tailored = job._tailoredResume;

  // Build project portfolio preview
  const projectPortfolioHtml = `
    <div class="step-section-box" style="border-left:4px solid #8b5cf6;">
      <div class="step-box-header">
        <div>
          <span class="step-box-title" style="color:#a78bfa;">📂 Project Portfolio</span>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
            Your multi-domain projects. The AI selects the most relevant ones for each JD.
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="openProjectManager()">
          ⚙️ Manage Projects
        </button>
      </div>
      <div id="portfolio-preview" style="margin-top:10px;">
        <div style="color:var(--text-muted);font-size:0.8rem;">Loading portfolio...</div>
      </div>
    </div>`;

  if (tailored) {
    const selectedCount = tailored.selectedProjectCount || tailored.selectedProjectIds?.length || 0;
    const selectedIds = tailored.selectedProjectIds || [];

    container.innerHTML = `
      ${projectPortfolioHtml}

      <div class="step-section-box" style="border-left:4px solid var(--accent-emerald);">
        <div class="step-box-header">
          <div>
            <span class="step-box-title" style="color:var(--accent-emerald);">📄 Fully Custom Resume Generated</span>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
              AI selected ${selectedCount} project(s) most relevant to this JD • Experience bullets rewritten for ${escHtml(targetRole)}
            </div>
          </div>
          <span class="tag-badge" style="background:rgba(16,185,129,0.15);color:#34d399;border:1px solid rgba(16,185,129,0.35);">
            ${tailored.atsScore ? `🎯 ATS ${tailored.atsScore}% · ` : ""}✨ Custom for ${escHtml(targetRole)}
          </span>
        </div>

        <div style="font-size:0.9rem;font-weight:700;color:#ffffff;margin-bottom:6px;">
          🎯 Role Headline: <span style="color:#38bdf8;">${escHtml(tailored.headline || targetRole)}</span>
        </div>

        ${selectedIds.length > 0 ? `
        <div style="margin:8px 0;display:flex;gap:6px;flex-wrap:wrap;">
          ${selectedIds.map((id) => `<span class="tag-badge" style="background:rgba(139,92,246,0.15);color:#c4b5fd;border:1px solid rgba(139,92,246,0.35);font-size:0.72rem;">📁 ${escHtml(id)}</span>`).join("")}
        </div>` : ""}

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.pdf" target="_blank" download="Prakhar_Chaubey_Resume_${escHtml(company)}.pdf" class="btn btn-success btn-sm">
            ⬇️ Download PDF Resume
          </a>
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.html" target="_blank" class="btn btn-outline btn-sm">
            🖨️ Save as PDF / Print Preview
          </a>
          <button class="btn btn-ghost btn-sm" onclick="tailorResumeInFlow('${job._id}')">
            ↻ Re-tailor with Different Projects
          </button>
        </div>
      </div>

      <!-- Tailored Summary Preview -->
      <div class="step-section-box">
        <div class="step-box-title" style="color:#93c5fd;margin-bottom:8px;">🎯 Custom Professional Summary</div>
        <div style="font-size:0.84rem;color:#cbd5e1;line-height:1.55;background:var(--bg-surface);padding:10px 12px;border-radius:var(--radius-md);">
          ${escHtml(tailored.formAnswers?.whyInterested || "")}
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
      ${projectPortfolioHtml}

      <div class="step-section-box" style="text-align:center;padding:28px 18px;">
        <div style="font-size:2.2rem;margin-bottom:10px;">📄</div>
        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">Craft Custom Resume for ${escHtml(company)}</h3>
        <p style="font-size:0.84rem;color:var(--text-secondary);max-width:560px;margin:0 auto 16px;">
          The AI will analyze your <strong>entire project portfolio</strong> and this <strong>${escHtml(targetRole)}</strong> JD to:
        </p>
        <div style="text-align:left;max-width:480px;margin:0 auto 20px;font-size:0.82rem;color:#94a3b8;">
          <div style="margin-bottom:4px;">✅ <strong>Select</strong> the most relevant projects for this specific role</div>
          <div style="margin-bottom:4px;">✅ <strong>Rewrite</strong> experience bullets using JD keywords & terminology</div>
          <div style="margin-bottom:4px;">✅ <strong>Craft</strong> a custom summary, competencies, and skills ordering</div>
          <div>✅ <strong>Generate</strong> ATS-optimized HTML + PDF with zero fabrication</div>
        </div>
        <button class="btn btn-primary" onclick="tailorResumeInFlow('${job._id}')">
          ⚡ Generate Custom Multi-Project Resume
        </button>
      </div>
    `;
  }

  // Load portfolio preview
  loadPortfolioPreview();
}

// -------------------------------------------------------------------------
// PROJECT PORTFOLIO MANAGEMENT
// -------------------------------------------------------------------------
async function loadPortfolioPreview() {
  const container = document.getElementById("portfolio-preview");
  if (!container) return;

  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:12px;color:var(--text-muted);font-size:0.82rem;">
          No projects yet. <button class="btn btn-ghost btn-sm" onclick="openProjectManager()" style="margin-left:8px;">+ Add Your First Project</button>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${projects.map((p) => `
          <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 12px;flex:1;min-width:200px;max-width:340px;">
            <div style="font-size:0.82rem;font-weight:700;color:#e2e8f0;margin-bottom:2px;">${escHtml(p.name)}</div>
            <div style="font-size:0.72rem;color:#8b5cf6;font-weight:600;margin-bottom:4px;">${escHtml(p.domain)}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(p.techStack?.slice(0, 5).join(", "))}</div>
            ${p.demoUrl ? `<div style="margin-top:4px;"><a href="${escHtml(p.demoUrl)}" target="_blank" rel="noopener" style="font-size:0.7rem;color:#38bdf8;text-decoration:none;">🔗 Live Demo</a></div>` : ""}
          </div>
        `).join("")}
      </div>
      <div style="margin-top:8px;font-size:0.74rem;color:var(--text-muted);">
        📊 ${projects.length} project(s) in portfolio across ${[...new Set(projects.map((p) => p.domain))].length} domain(s)
      </div>`;
  } catch (e) {
    container.innerHTML = `<div style="color:#f87171;font-size:0.8rem;">Failed to load portfolio</div>`;
  }
}

function openProjectManager() {
  // Create modal overlay
  const existing = document.getElementById("project-manager-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "project-manager-modal";
  modal.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;";
  modal.innerHTML = `
    <div style="background:#1e293b;border:1px solid #334155;border-radius:16px;width:100%;max-width:700px;max-height:85vh;overflow-y:auto;padding:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="font-size:1.3rem;font-weight:800;color:#ffffff;margin:0;">📂 Project Portfolio Manager</h2>
        <button onclick="document.getElementById('project-manager-modal').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">✕</button>
      </div>

      <div id="project-list-container" style="margin-bottom:20px;">
        <div style="color:var(--text-muted);font-size:0.84rem;">Loading projects...</div>
      </div>

      <div style="border-top:1px solid #334155;padding-top:16px;">
        <h3 style="font-size:1rem;font-weight:700;color:#e2e8f0;margin-bottom:12px;">➕ Add New Project</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <input id="pm-name" placeholder="Project Name (e.g., Real-Time Drone Perception System)" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
          <div style="display:flex;gap:8px;">
            <input id="pm-domain" placeholder="Domain (e.g., Computer Vision)" style="flex:1;background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
            <input id="pm-period" placeholder="Period (e.g., 2025–2026)" style="width:150px;background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
          </div>
          <div style="display:flex;gap:8px;">
            <input id="pm-demo-url" placeholder="Live Demo URL (e.g., https://huggingface.co/spaces/...)" style="flex:1;background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
            <input id="pm-repo-url" placeholder="GitHub Repo URL (optional)" style="flex:1;background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
          </div>
          <textarea id="pm-description" rows="3" placeholder="Project description (2-4 sentences about what you built and the impact)" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;resize:vertical;"></textarea>
          <input id="pm-tech" placeholder="Tech Stack (comma-separated: PyTorch, Docker, FastAPI, AWS...)" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
          <textarea id="pm-bullets" rows="4" placeholder="Key achievement bullets (one per line):&#10;• Achieved 95% accuracy on X&#10;• Reduced latency by 40% using Y&#10;• Deployed to production serving 10K req/s" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;resize:vertical;"></textarea>
          <input id="pm-keywords" placeholder="Keywords for matching (comma-separated: computer vision, edge ai, deployment...)" style="background:#0f172a;border:1px solid #475569;color:#e2e8f0;padding:10px 12px;border-radius:8px;font-size:0.88rem;">
          <button class="btn btn-primary" onclick="addProjectFromForm()">
            ➕ Add Project to Portfolio
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  loadProjectList();
}

async function loadProjectList() {
  const container = document.getElementById("project-list-container");
  if (!container) return;

  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const projects = data.projects || [];

    if (projects.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:16px;color:#94a3b8;font-size:0.88rem;">No projects yet. Add your first project below!</div>`;
      return;
    }

    container.innerHTML = projects.map((p) => `
      <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px 16px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div style="flex:1;">
            <div style="font-size:0.92rem;font-weight:700;color:#f1f5f9;">${escHtml(p.name)}</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:3px;">
              <span style="font-size:0.74rem;font-weight:600;color:#8b5cf6;background:rgba(139,92,246,0.12);padding:2px 8px;border-radius:4px;">${escHtml(p.domain)}</span>
              <span style="font-size:0.74rem;color:#64748b;">${escHtml(p.period)}</span>
            </div>
            <div style="font-size:0.78rem;color:#94a3b8;margin-top:6px;line-height:1.45;">${escHtml(p.description?.substring(0, 180))}${p.description?.length > 180 ? "..." : ""}</div>
            ${(p.demoUrl || p.repoUrl) ? `
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;font-size:0.74rem;">
              ${p.demoUrl ? `<a href="${escHtml(p.demoUrl)}" target="_blank" rel="noopener" style="color:#38bdf8;text-decoration:none;">🔗 Live Demo</a>` : ""}
              ${p.repoUrl ? `<a href="${escHtml(p.repoUrl)}" target="_blank" rel="noopener" style="color:#a78bfa;text-decoration:none;">💻 GitHub Repo</a>` : ""}
            </div>` : ""}
            <div style="font-size:0.72rem;color:#0284c7;margin-top:4px;font-weight:600;">${escHtml(p.techStack?.slice(0, 6).join(" · "))}</div>
            <div style="font-size:0.68rem;color:#64748b;margin-top:2px;">${p.bullets?.length || 0} bullets · ${p.keywords?.length || 0} keywords</div>
          </div>
          <button onclick="deleteProject('${p.id}')" style="background:none;border:1px solid #7f1d1d;color:#f87171;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.76rem;white-space:nowrap;margin-left:10px;">🗑️ Remove</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    container.innerHTML = `<div style="color:#f87171;font-size:0.84rem;">Error loading projects: ${e.message}</div>`;
  }
}

async function addProjectFromForm() {
  const name = document.getElementById("pm-name")?.value?.trim();
  const domain = document.getElementById("pm-domain")?.value?.trim();
  const period = document.getElementById("pm-period")?.value?.trim();
  const demoUrl = document.getElementById("pm-demo-url")?.value?.trim();
  const repoUrl = document.getElementById("pm-repo-url")?.value?.trim();
  const description = document.getElementById("pm-description")?.value?.trim();
  const techStack = document.getElementById("pm-tech")?.value?.trim();
  const bulletsRaw = document.getElementById("pm-bullets")?.value?.trim();
  const keywords = document.getElementById("pm-keywords")?.value?.trim();

  if (!name || !description) {
    alert("Please provide at least a project name and description.");
    return;
  }

  // Parse bullets — strip leading bullet markers
  const bullets = bulletsRaw
    ? bulletsRaw.split("\n").map((l) => l.replace(/^[\s•\-\*]+/, "").trim()).filter(Boolean)
    : [];

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, domain, period, demoUrl, repoUrl, description, techStack, bullets, keywords }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`✅ Added project: ${name}`);
      // Clear form
      ["pm-name", "pm-domain", "pm-period", "pm-demo-url", "pm-repo-url", "pm-description", "pm-tech", "pm-bullets", "pm-keywords"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      loadProjectList();
      loadPortfolioPreview();
    } else {
      alert("Error: " + (data.error || "Unknown error"));
    }
  } catch (e) {
    alert("Failed to add project: " + e.message);
  }
}

async function deleteProject(id) {
  if (!confirm("Remove this project from your portfolio?")) return;

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      showToast("🗑️ Project removed");
      loadProjectList();
      loadPortfolioPreview();
    }
  } catch (e) {
    alert("Failed to delete: " + e.message);
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
    const res = await fetchWithRetry(`/api/jobs/${encodeURIComponent(jobId)}/evaluate`, { method: "POST", timeoutMs: 45000 }, 1);
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
    alert("Evaluation notice: " + (e.message.includes("fetch") ? "Connection timed out. Please try again." : e.message));
  }
}

async function tailorResumeInFlow(jobId) {
  showLoading("🔍 Analyzing your project portfolio against this JD...\n📂 Selecting most relevant projects for this role...\n✍️ Rewriting experience bullets with JD keywords...\n📄 Generating custom HTML + PDF resume...");
  const job = allJobs.find((j) => j._id === jobId);
  try {
    const res = await fetchWithRetry(
      `/api/jobs/${encodeURIComponent(jobId)}/tailor-resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
        timeoutMs: 45000,
      },
      1
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (job) {
      job._tailoredResume = data;
    }

    hideLoading();
    renderStep(2);
    showToast("✅ Tailored personal resume generated!");
  } catch (e) {
    hideLoading();
    alert("Resume tailoring notice: " + (e.message.includes("fetch") ? "Request timed out while compiling PDF. Please tap 'Tailor My Resume' once more." : e.message));
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
    const res = await fetchWithRetry(
      `/api/jobs/${encodeURIComponent(jobId)}/solve-questions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: questionsText }),
        timeoutMs: 35000,
      },
      1
    );
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
    alert("Question solving notice: " + (err.message.includes("fetch") ? "Request timed out. Please try again." : err.message));
  }
}

async function markAppliedInFlow(jobId) {
  await updateJobStatus(jobId, "applied");
  showToast("🎉 Application recorded and synced with tracker!");
}

async function updateJobStatus(jobId, status) {
  try {
    const res = await fetchWithRetry(
      `/api/jobs/${encodeURIComponent(jobId)}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        timeoutMs: 15000,
      },
      2
    );
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
    const res = await fetchWithRetry(
      "/api/cold-outreach",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
        timeoutMs: 30000,
      },
      1
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._coldOutreach = data;
    hideLoading();
    renderStep(4);
    showToast("✉️ Cold outreach messages drafted!");
  } catch (e) {
    hideLoading();
    alert("Outreach notice: " + (e.message.includes("fetch") ? "Request timed out. Please try again." : e.message));
  }
}

// --- Technical Interview Prep ---
async function generateInterviewPrep(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("Generating technical interview cheat sheet...\nFormulating questions, tailored answers, and system design...");
  try {
    const res = await fetchWithRetry(
      "/api/interview-prep",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
        timeoutMs: 35000,
      },
      1
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._interviewPrep = data;
    hideLoading();
    renderStep(4);
    showToast("🎙️ Interview prep cheat sheet ready!");
  } catch (e) {
    hideLoading();
    alert("Interview prep notice: " + (e.message.includes("fetch") ? "Request timed out. Please try again." : e.message));
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
      const res = await fetchWithRetry(`/api/jobs/${encodeURIComponent(jobId)}/form-pack`, { timeoutMs: 30000 }, 1);
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
    const res = await fetchWithRetry(`/api/bookmarklet?jobId=${encodeURIComponent(jobId)}`, { timeoutMs: 15000 }, 2);
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
    const res = await fetchWithRetry(
      `/api/jobs/${encodeURIComponent(jobId)}/autofill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 60000,
      },
      1
    );
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
    alert("Auto-fill notice: " + (err.message.includes("fetch") ? "Cloud auto-filler timed out. You can use 1-Tap Copy pills or Bookmarklet to fill directly on your device." : err.message) + "\n\nTip: You can use the '⚡ Copy All Form Info' button or individual field pills to fill the form in seconds on your phone!");
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
  showLoading("Scanning portals via JobSpy & Startups...\nVerifying listings through ai-job-search security guard...");

  try {
    const res = await fetchWithRetry(
      `/api/scan?search=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&sites=${encodeURIComponent(sites)}&results=15`,
      { timeoutMs: 42000 },
      2,
      1200
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (data.warning) {
      status.textContent = `ℹ️ ${data.warning} Found ${data.total} jobs in database!`;
      status.className = "status-msg info";
    } else {
      status.textContent = `✅ Scan complete: Found ${data.new} newly added jobs (${data.total} total) — all verified!`;
      status.className = "status-msg success";
    }
    status.classList.remove("hidden");

    await refreshJobs();
    await loadStats();

    if (data.new > 0) {
      document.querySelector('[data-view="jobs"]')?.click();
    }
    if (query && query !== "all") {
      const spInput = document.getElementById("social-project-query");
      if (spInput) spInput.value = query;
    }
  } catch (e) {
    console.error("Scan error:", e);
    const isNetwork = e.message.includes("fetch") || e.name === "AbortError" || e.name === "TypeError";
    const msg = isNetwork
      ? "Scan request timed out or mobile network disconnected. The server may still be scanning in the background. Tap 'Retry' or 'Refresh Feed' to load latest jobs."
      : e.message;
    status.innerHTML = `❌ ${msg} <button onclick="scanJobs()" style="margin-left:8px;padding:3px 8px;border-radius:4px;border:none;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer;">Retry</button>`;
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
    const res = await fetchWithRetry("/api/scan-ats", { method: "POST", timeoutMs: 40000 }, 2, 1000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const count = data.totalFound || 0;
    const portals = data.scannedPortals || 12;
    status.textContent = `✅ ATS Scan complete: Scanned ${portals} portals (${count} matching listings tracked)!`;
    status.className = "status-msg success";
    status.classList.remove("hidden");

    await refreshJobs();
    await loadStats();
  } catch (e) {
    console.error("ATS scan error:", e);
    const isNetwork = e.message.includes("fetch") || e.name === "AbortError" || e.name === "TypeError";
    const msg = isNetwork
      ? "ATS scan reached mobile connection timeout. Verified listings are saved in career-ops tracker."
      : e.message;
    status.innerHTML = `❌ ${msg} <button onclick="scanAts()" style="margin-left:8px;padding:3px 8px;border-radius:4px;border:none;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer;">Retry</button>`;
    status.className = "status-msg error";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "📑 Scan ATS Boards (Greenhouse/Lever/Ashby)";
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
    const res = await fetchWithRetry("/api/tracked", { timeoutMs: 15000 }, 2);
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

// =========================================================================
// RECOMMENDED PROJECTS (SOCIAL SHOWCASE SEARCH TAB)
// =========================================================================

function getActiveRoleOrSearchTerm() {
  const rawSearch = document.getElementById("job-search-input")?.value?.trim();
  if (rawSearch) return rawSearch;
  if (currentRoleFilter && currentRoleFilter !== "all") return `${currentRoleFilter} Engineer`;
  const scanVal = document.getElementById("scan-query")?.value;
  if (scanVal && scanVal !== "all") return scanVal;
  return "Computer Vision Engineer";
}

function updateJobSearchProjectsHint() {
  const hintEl = document.getElementById("job-search-projects-hint-text");
  if (!hintEl) return;
  const term = getActiveRoleOrSearchTerm();
  hintEl.innerHTML = `✨ Discover real projects people showcased on X, LinkedIn &amp; dev socials for <strong>"${escHtml(term)}"</strong>`;
}

function openRecommendedProjectsFromJobSearch() {
  const term = getActiveRoleOrSearchTerm();
  openRecommendedProjectsFor(term);
}

function openRecommendedProjectsFromScanner() {
  const scanVal = document.getElementById("scan-query")?.value;
  const term = scanVal && scanVal !== "all" ? scanVal : "Computer Vision Engineer";
  openRecommendedProjectsFor(term);
}

function openRecommendedProjectsFor(roleOrQuery) {
  const input = document.getElementById("social-project-query");
  if (input && roleOrQuery) input.value = roleOrQuery;
  document.querySelector('.tab-btn[data-view="recommended-projects"]')?.click();
  searchRecommendedProjects(true);
}

function setSocialRolePreset(role) {
  const input = document.getElementById("social-project-query");
  if (input) input.value = role;
  searchRecommendedProjects(true);
}

function setSocialPlatformFilter(platform) {
  currentSocialPlatform = platform;
  document.querySelectorAll(".social-platform-pills .filter-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.platform === platform);
  });
  renderRecommendedProjects();
}

function updateSavedProjectsCount() {
  setElText("saved-projects-count", savedSocialProjects.length);
}

function updateSocialDirectLinks(query) {
  const clean = (query || "Computer Vision Engineer").trim();
  setElText("social-query-label", clean);
  const xLink = document.getElementById("direct-x-search-link");
  const liLink = document.getElementById("direct-linkedin-search-link");
  if (xLink) {
    const q = encodeURIComponent(`("${clean}") (built OR project OR showcase OR demo)`);
    xLink.href = `https://x.com/search?q=${q}&f=live`;
  }
  if (liLink) {
    const q = encodeURIComponent(`${clean} project built demo`);
    liLink.href = `https://www.linkedin.com/search/results/content/?keywords=${q}&sortBy=%22relevance%22`;
  }
}

async function searchRecommendedProjects(forceRefresh = false) {
  const input = document.getElementById("social-project-query");
  const query = (input?.value || "Computer Vision Engineer").trim() || "Computer Vision Engineer";
  updateSocialDirectLinks(query);

  if (!forceRefresh && lastSocialQuery.toLowerCase() === query.toLowerCase() && recommendedProjects.length > 0) {
    renderRecommendedProjects();
    return;
  }

  const btn = document.getElementById("btn-search-social-projects");
  const list = document.getElementById("recommended-projects-list");
  const meta = document.getElementById("recommended-projects-meta");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Searching Social Showcases...";
  }
  if (list) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        <div class="empty-icon">🔍</div>
        <p>Searching X/Twitter, LinkedIn, Hacker News, Dev.to, Hugging Face, Medium &amp; GitHub for <strong>${escHtml(query)}</strong> projects...</p>
      </div>`;
  }
  if (meta) meta.classList.add("hidden");

  try {
    const res = await fetchWithRetry(
      `/api/recommended-projects?query=${encodeURIComponent(query)}&platform=all`,
      { timeoutMs: 32000 },
      1,
      800
    );
    const data = await res.json();
    if (data.error && (!data.projects || data.projects.length === 0)) {
      throw new Error(data.error);
    }

    recommendedProjects = data.projects || [];
    lastSocialQuery = query;
    lastSocialSources = data.sources || {};

    if (data.socialSearchLinks?.xUrl) {
      const xLink = document.getElementById("direct-x-search-link");
      if (xLink) xLink.href = data.socialSearchLinks.xUrl;
    }
    if (data.socialSearchLinks?.linkedinUrl) {
      const liLink = document.getElementById("direct-linkedin-search-link");
      if (liLink) liLink.href = data.socialSearchLinks.linkedinUrl;
    }

    setElText("header-projects-badge", recommendedProjects.length);
    updateSavedProjectsCount();
    renderRecommendedProjects();
  } catch (e) {
    console.error("Social projects search error:", e);
    if (list) {
      list.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          <div class="empty-icon">⚠️</div>
          <p>Could not fetch social project showcases: ${escHtml(e.message)}</p>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="searchRecommendedProjects(true)">↻ Try Again</button>
        </div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔎 Search Social Projects";
    }
  }
}

function toggleSaveRecommendedProject(projectId) {
  const existingIdx = savedSocialProjects.findIndex((p) => p.id === projectId);
  if (existingIdx !== -1) {
    savedSocialProjects.splice(existingIdx, 1);
    showToast("Removed from saved project ideas");
  } else {
    const found = recommendedProjects.find((p) => p.id === projectId);
    if (!found) return;
    savedSocialProjects.unshift(found);
    showToast(`Saved "${found.projectName}" to Ideas`);
  }
  try {
    localStorage.setItem(SAVED_PROJECTS_KEY, JSON.stringify(savedSocialProjects.slice(0, 40)));
  } catch {}
  updateSavedProjectsCount();
  renderRecommendedProjects();
}

function renderRecommendedProjects() {
  const list = document.getElementById("recommended-projects-list");
  const meta = document.getElementById("recommended-projects-meta");
  if (!list) return;

  const savedIds = new Set(savedSocialProjects.map((p) => p.id));
  let items = currentSocialPlatform === "saved" ? savedSocialProjects : recommendedProjects;

  if (currentSocialPlatform !== "all" && currentSocialPlatform !== "saved") {
    items = items.filter((p) => p.platformKey === currentSocialPlatform);
  }

  if (meta) {
    const sourceSummary = Object.entries(lastSocialSources || {})
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}: ${count}`)
      .join(" · ");
    meta.innerHTML = `
      <span>Showing <strong>${items.length}</strong> showcased project(s) for <strong>${escHtml(lastSocialQuery || getActiveRoleOrSearchTerm())}</strong></span>
      <span>${sourceSummary ? `Sources: ${escHtml(sourceSummary)}` : ""}</span>
    `;
    meta.classList.remove("hidden");
  }

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        <div class="empty-icon">✨</div>
        <p>${
          currentSocialPlatform === "saved"
            ? "No saved project ideas yet. Click '📌 Save Idea' on any showcased project!"
            : "No showcased posts returned for this source filter. Try '🌐 All Platforms' or use the live X / LinkedIn search buttons above."
        }</p>
      </div>`;
    return;
  }

  const platformIcon = {
    x: "𝕏",
    linkedin: "💼",
    hackernews: "🟧",
    devto: "👩‍💻",
    huggingface: "🤗",
    medium: "✍️",
    github: "🐙",
  };

  list.innerHTML = items.map((proj) => {
    const isSaved = savedIds.has(proj.id);
    const pKey = proj.platformKey || "github";
    const icon = platformIcon[pKey] || "🚀";
    return `
      <article class="social-project-card">
        <div class="social-card-top">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span class="platform-badge platform-${escHtml(pKey)}">${icon} ${escHtml(proj.platform)}</span>
            ${proj.targetRole ? `<span class="tag-badge badge-role">🎯 ${escHtml(proj.targetRole)}</span>` : ""}
          </div>
          <span class="social-engagement">${escHtml(proj.engagement || "")}</span>
        </div>

        <div class="project-what-box">
          <div class="project-what-label">What the Project Was</div>
          <div class="project-what-title">${escHtml(proj.projectName)}</div>
          <div class="project-author-line">By <strong>${escHtml(proj.author || "Builder")}</strong> · Post: ${escHtml(proj.postTitle)}</div>
        </div>

        <div>
          <div class="project-what-label" style="color:#a78bfa;">Project Description</div>
          <p class="project-desc-text">${escHtml(proj.projectDescription)}</p>
        </div>

        ${proj.roleRelevance ? `<div class="project-role-fit">💡 <strong>Why it works for this role:</strong> ${escHtml(proj.roleRelevance)}</div>` : ""}

        ${proj.techTags && proj.techTags.length > 0 ? `
        <div class="job-meta-tags">
          ${proj.techTags.map((t) => `<span class="tag-badge">${escHtml(t)}</span>`).join("")}
        </div>` : ""}

        <div class="social-card-actions">
          <a href="${escHtml(proj.postUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
            🔗 View Original Post
          </a>
          ${proj.demoUrl ? `<a href="${escHtml(proj.demoUrl)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">🚀 Live Demo</a>` : ""}
          <button class="btn btn-ghost btn-sm" onclick="toggleSaveRecommendedProject('${escHtml(proj.id)}')">
            ${isSaved ? "✅ Saved" : "📌 Save Idea"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}
