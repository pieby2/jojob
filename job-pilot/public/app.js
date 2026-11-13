/**
 * Job Pilot — Frontend Logic (career-ops + ai-job-search dual engine)
 */

// --- State ---
let allJobs = [];
let trackedApplications = [];
let currentTimeFilter = "all";
let currentRoleFilter = "all";
let currentSort = "posted-newest";

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadProfile();
  loadStats();
  refreshJobs();
});

// --- Navigation ---
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      tab.classList.add("active");
      const targetView = document.getElementById(`view-${tab.dataset.view}`);
      if (targetView) targetView.classList.add("active");

      if (tab.dataset.view === "history") {
        loadTracked();
      } else if (tab.dataset.view === "dashboard") {
        loadStats();
      }
    });
  });
}

// --- Profile & Stats ---
async function loadProfile() {
  try {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.name) {
      document.getElementById("user-name").textContent = data.name.split(" ")[0];
    }
  } catch { /* ignore */ }
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();

    const local = data.local || {};
    const cOps = data.careerOps || {};

    document.getElementById("stat-total").textContent = local.totalScanned || 0;
    document.getElementById("stat-applied").textContent = cOps.byStatus?.Applied || local.appliedCount || 0;
    document.getElementById("stat-avg-score").textContent = cOps.avgScore ? `${cOps.avgScore.toFixed(1)}/5` : "—";
    document.getElementById("stat-top-score").textContent = cOps.topScore ? `${cOps.topScore.toFixed(1)}/5` : "—";
  } catch { /* ignore */ }
}

// --- Scan Portals (with ai-job-search security gate) ---
async function scanJobs() {
  const btn = document.getElementById("btn-scan");
  const status = document.getElementById("scan-status");
  const query = document.getElementById("scan-query").value;
  const location = document.getElementById("scan-location").value;
  const sites = document.getElementById("scan-sites").value;

  btn.disabled = true;
  btn.textContent = "⏳ Scanning & Securing...";
  status.classList.add("hidden");
  showLoading("Scanning portals via JobSpy...\nRunning postings through ai-job-search security guard...");

  try {
    const res = await fetch(`/api/scan?search=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&sites=${encodeURIComponent(sites)}&results=15`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    status.textContent = `✅ Found ${data.new} new jobs (${data.total} total) — all verified through ai-job-search posting_guard!`;
    status.className = "status-msg success";
    status.classList.remove("hidden");

    await refreshJobs();
    await loadStats();

    if (data.new > 0) {
      document.querySelector('[data-view="jobs"]').click();
    }
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    status.className = "status-msg error";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Scan Portals (with ai-job-search Security Gate)";
    hideLoading();
  }
}

// --- Scan Direct ATS Boards (career-ops) ---
async function scanAts() {
  const btn = document.getElementById("btn-scan-ats");
  const status = document.getElementById("scan-status");

  btn.disabled = true;
  btn.textContent = "⏳ Scanning Greenhouse/Lever/Ashby...";
  status.classList.add("hidden");
  showLoading("Scanning direct company ATS boards via career-ops/scan.mjs...\nThis checks 90+ tech companies directly.");

  try {
    const res = await fetch("/api/scan-ats");
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    status.textContent = `✅ Direct ATS scan complete! Tracked in career-ops.`;
    status.className = "status-msg success";
    status.classList.remove("hidden");

    await loadStats();
  } catch (e) {
    status.textContent = `❌ ${e.message}`;
    status.className = "status-msg error";
    status.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "🏢 Scan Direct ATS Boards (career-ops Greenhouse/Lever/Ashby)";
    hideLoading();
  }
}

// --- Jobs List Rendering & Sorting ---
async function refreshJobs() {
  try {
    const res = await fetch("/api/jobs");
    allJobs = await res.json();
    applySortAndFilter();
  } catch { /* ignore */ }
}

function setTimeFilter(filter) {
  currentTimeFilter = filter;
  document.querySelectorAll(".time-filter-pills .pill-btn").forEach((p) => {
    p.classList.toggle("active", p.dataset.time === filter);
  });
  applySortAndFilter();
}

function setRoleFilter(role) {
  currentRoleFilter = role;
  document.querySelectorAll(".role-filter-pills .pill-btn").forEach((p) => {
    p.classList.toggle("active", p.dataset.role === role);
  });
  applySortAndFilter();
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

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString();
}

function applySortAndFilter() {
  const sortSelect = document.getElementById("job-sort-select");
  if (sortSelect) {
    currentSort = sortSelect.value;
  }

  let filtered = allJobs.filter((j) => j._status === "new" || j._status === "saved");

  // 1. Role Category Filter (Shows all roles by default!)
  if (currentRoleFilter !== "all") {
    const rf = currentRoleFilter.toLowerCase();
    filtered = filtered.filter((j) => {
      const role = (j.target_role || detectRoleClient(j.title, j.description)).toLowerCase();
      return role.includes(rf);
    });
  }

  // 2. Time Filter (Last 24h, 3 days, 7 days)
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

  // 3. Ranking & Sorting
  filtered.sort((a, b) => {
    if (currentSort === "posted-newest") {
      return getJobTimestamp(b) - getJobTimestamp(a);
    } else if (currentSort === "posted-oldest") {
      return getJobTimestamp(a) - getJobTimestamp(b);
    } else if (currentSort === "score-highest") {
      const scoreA = a._evaluation?.score || 0;
      const scoreB = b._evaluation?.score || 0;
      return scoreB - scoreA;
    } else if (currentSort === "scanned-newest") {
      const timeA = a._scannedAt ? new Date(a._scannedAt).getTime() : 0;
      const timeB = b._scannedAt ? new Date(b._scannedAt).getTime() : 0;
      return timeB - timeA;
    } else if (currentSort === "company-az") {
      const compA = (a.company_name || a.company || "").toLowerCase();
      const compB = (b.company_name || b.company || "").toLowerCase();
      return compA.localeCompare(compB);
    }
    return 0;
  });

  renderJobs(filtered);
}

function renderJobs(jobs) {
  const list = document.getElementById("jobs-list");
  const homeList = document.getElementById("home-jobs-list");
  const homeCount = document.getElementById("home-job-count");
  const totalCount = document.getElementById("total-jobs-count");

  if (homeCount) homeCount.textContent = jobs.length;
  if (totalCount) totalCount.textContent = jobs.length;

  if (!jobs.length) {
    const emptyHtml = '<p class="empty-state">No matching jobs found for this filter. 🔍</p>';
    if (list) list.innerHTML = emptyHtml;
    if (homeList) homeList.innerHTML = emptyHtml;
    return;
  }

  const html = jobs.map((job) => createJobCard(job)).join("");
  if (list) list.innerHTML = html;
  if (homeList) homeList.innerHTML = html;
}

function createJobCard(job) {
  const eval_ = job._evaluation;
  const score = eval_?.score;
  const scoreClass = score >= 4 ? "score-high" : score >= 3 ? "score-mid" : score > 0 ? "score-low" : "score-none";
  const scoreText = score ? score.toFixed(1) : "?";

  const location = job.location || job.city || "";
  const site = job.site || "";
  const company = job.company_name || job.company || "Unknown";
  const postedLabel = formatPostedTime(job.date_posted, job._scannedAt);
  const security = job._security;
  const salary = job._salaryBenchmark;

  const jobRole = job.target_role || detectRoleClient(job.title, job.description);
  const roleBadge = `<span class="tag tag-role" style="background:rgba(59,130,246,0.18);color:#93c5fd;border:1px solid rgba(59,130,246,0.35);font-weight:600">🎯 Role: ${escHtml(jobRole)}</span>`;

  const siteBadge = site === "wellfound"
    ? `<span class="tag tag-wf">🌟 Wellfound</span>`
    : site === "yc"
    ? `<span class="tag tag-yc">🚀 YC Startup</span>`
    : site === "naukri"
    ? `<span class="tag tag-naukri">🇮🇳 Naukri</span>`
    : site ? `<span class="tag tag-site">${escHtml(site)}</span>` : "";

  const compTag = job.compensation
    ? `<span class="tag tag-salary">💵 ${escHtml(job.compensation)}</span>`
    : salary?.categories?.engineering
    ? `<span class="tag tag-salary">💰 Comp Index: ${salary.categories.engineering.index}</span>`
    : "";

  return `
    <div class="job-card" onclick="openJobDetail('${job._id}')">
      <div class="job-card-header">
        <div>
          <div class="job-title">${escHtml(job.title || "Untitled")}</div>
          <div class="job-company">${escHtml(company)}</div>
        </div>
        <div class="score-badge ${scoreClass}">${scoreText}</div>
      </div>
      <div class="job-meta">
        ${roleBadge}
        <span class="tag tag-time">⏱️ ${escHtml(postedLabel)}</span>
        ${location ? `<span class="tag">📍 ${escHtml(location)}</span>` : ""}
        ${siteBadge}
        ${compTag}
        ${security ? `<span class="tag tag-security" title="${escHtml(security.verdict)}">🛡️ Verified Safe</span>` : ""}
        ${eval_?.archetype ? `<span class="tag tag-archetype">🎯 ${escHtml(eval_.archetype.split("/")[0])}</span>` : ""}
        ${job._tailoredResume ? `<span class="tag" style="background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.3)">📄 Tailored CV Ready</span>` : ""}
      </div>
      <div class="job-actions" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-small" onclick="evaluateJobCard('${job._id}')">
          ${eval_ ? "📄 Report" : "⚡ Evaluate (career-ops)"}
        </button>
        ${job._tailoredResume ? `
        <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.pdf" target="_blank" download="Prakhar_Chaubey_Resume_${escHtml(company)}.pdf" class="btn btn-outline btn-small" style="text-decoration:none" onclick="event.stopPropagation()">
          ⬇️ CV (PDF)
        </a>` : `
        <button class="btn btn-outline btn-small" onclick="tailorResume('${job._id}'); event.stopPropagation()">
          📄 Tailor CV
        </button>`}
        <button class="btn btn-success btn-small" onclick="applyJobCard('${job._id}')">
          🚀 Apply
        </button>
        <button class="btn btn-outline btn-small" onclick="skipJob('${job._id}')">
          ✕ Skip
        </button>
      </div>
    </div>`;
}

// --- Evaluate Job with career-ops ---
async function evaluateJobCard(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  if (job._evaluation) {
    openJobDetail(jobId);
    return;
  }

  showLoading("Evaluating with career-ops engine...\nCalling DeepSeek API with cv.md and oferta rubric...\nSaving report to career-ops/reports/");
  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._evaluation = data.evaluation;
    job._salaryBenchmark = data.salaryBenchmark;
    job._security = data.security;

    await loadStats();
    hideLoading();
    openJobDetail(jobId);
  } catch (e) {
    hideLoading();
    alert("Evaluation failed: " + e.message);
  }
}

// --- Quick Apply Flow ---
async function applyJobCard(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  if (!job._evaluation) {
    await evaluateJobCard(jobId);
  } else {
    openJobDetail(jobId);
  }
}

// --- Open Job Detail Modal ---
function openJobDetail(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  const eval_ = job._evaluation;
  const company = job.company_name || job.company || "Unknown";
  const desc = job.description || "No description available";
  const answers = eval_?.answers || {};
  const salary = job._salaryBenchmark;
  const security = job._security;

  let evalHtml = "";
  if (eval_) {
    const scoreClass = eval_.score >= 4 ? "score-high" : eval_.score >= 3 ? "score-mid" : "score-low";
    const verdictColor = eval_.verdict.toUpperCase().includes("APPLY") ? "var(--green)" : eval_.verdict.toUpperCase().includes("SKIP") ? "var(--red)" : "var(--yellow)";

    evalHtml = `
      <div class="modal-section">
        <h3>career-ops Evaluation</h3>
        <div class="eval-summary">
          <div class="score-badge ${scoreClass}">${eval_.score.toFixed(1)}</div>
          <div>
            <div class="eval-verdict" style="color:${verdictColor}">${escHtml(eval_.verdict)}</div>
            <div class="eval-text">${escHtml(eval_.summary || "Evaluated with official career-ops rubric")}</div>
          </div>
        </div>

        ${eval_.archetype ? `
        <div style="margin-top:8px;font-size:0.82rem;color:var(--text2)">
          <strong>Archetype:</strong> ${escHtml(eval_.archetype)}
          ${eval_.legitimacy ? ` · <strong>Legitimacy:</strong> ${escHtml(eval_.legitimacy)}` : ""}
        </div>` : ""}

        ${eval_.strengths?.length ? `
        <div style="margin-top:10px">
          <strong style="color:var(--green);font-size:0.8rem">✅ MATCHED STRENGTHS (from cv.md)</strong>
          <ul>${eval_.strengths.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ul>
        </div>` : ""}

        ${eval_.gaps?.length ? `
        <div style="margin-top:10px">
          <strong style="color:var(--yellow);font-size:0.8rem">⚠️ GAPS & NOTES</strong>
          <ul>${eval_.gaps.map((g) => `<li>${escHtml(g)}</li>`).join("")}</ul>
        </div>` : ""}

        ${eval_.reportPath ? `
        <div style="margin-top:8px;font-size:0.75rem;color:var(--text2)">
          📁 Report saved in career-ops: <code>${escHtml(eval_.reportPath)}</code>
        </div>` : ""}
      </div>`;
  }

  // Salary Benchmark from ai-job-search
  let salaryHtml = "";
  if (salary) {
    const engIndex = salary.categories?.engineering?.index;
    const allIndex = salary.categories?.all_employees?.index;
    salaryHtml = `
      <div class="modal-section">
        <h3>ai-job-search Salary Benchmark</h3>
        <div class="copy-block" style="background:rgba(168,85,247,0.1);border-color:rgba(168,85,247,0.3)">
          <strong>${escHtml(salary.company)} (${escHtml(salary.city || "Tech")})</strong><br>
          ${engIndex ? `Engineering Comp Index: <strong>${engIndex}</strong> (Baseline 100 = ~₹12 LPA)<br>` : ""}
          ${allIndex ? `Company Avg Comp Index: ${allIndex}` : ""}
        </div>
      </div>`;
  }

  // Cold Outreach Section
  let outreachHtml = "";
  const outreach = job._coldOutreach;
  if (outreach) {
    outreachHtml = `
      <div class="modal-section outreach-box">
        <h3>✉️ Recruiter & Founder Cold Outreach</h3>
        <div style="margin: 6px 0 10px;">
          <a href="${escHtml(outreach.linkedinSearchUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-small" style="text-decoration:none;">
            🔎 Search Hiring Managers on LinkedIn
          </a>
          <a href="${escHtml(outreach.mailtoUrl)}" class="btn btn-outline btn-small" style="text-decoration:none; margin-left: 6px;">
            ✉️ Open Email App
          </a>
        </div>
        ${copyBlock("💬 LinkedIn Connection Request Note (<300 chars)", outreach.linkedinNote)}
        ${copyBlock("✉️ Cold Email Subject", outreach.emailSubject)}
        ${copyBlock("📄 Cold Email / InMail Body", outreach.emailBody)}
        ${copyBlock("⏰ 5-Day Polite Follow-Up Note", outreach.followUp)}
      </div>`;
  }

  // Interview Prep Section
  let prepHtml = "";
  const prep = job._interviewPrep;
  if (prep) {
    const qList = (prep.technicalQuestions || []).map((tq, i) => `
      <div class="qa-item" style="background:var(--bg);padding:10px;border-radius:8px;margin-top:8px;border:1px solid var(--bg3)">
        <div style="font-weight:600;color:var(--text);font-size:0.86rem">Q${i+1}: ${escHtml(tq.question)}</div>
        <div style="font-size:0.75rem;color:var(--text2);margin-top:2px"><em>Goal: ${escHtml(tq.whyTheyAsk || "")}</em></div>
        <div class="copy-block" style="margin-top:6px" id="prep-q-${i}">
          <button class="copy-btn" onclick="copyText('prep-q-${i}')">Copy</button>
          <strong>Your Tailored Answer:</strong><br>${escHtml(tq.suggestedAnswer)}
        </div>
      </div>
    `).join("");

    const askList = (prep.questionsForInterviewer || []).map((q, i) => `
      <div class="copy-block" style="margin-top:6px" id="prep-ask-${i}">
        <button class="copy-btn" onclick="copyText('prep-ask-${i}')">Copy</button>
        ${escHtml(q)}
      </div>
    `).join("");

    prepHtml = `
      <div class="modal-section prep-box">
        <h3>🎙️ AI Technical Interview Prep</h3>
        ${prep.summary ? `<div style="font-size:0.83rem;color:var(--text);background:rgba(59,130,246,0.1);padding:8px 10px;border-radius:6px;border:1px solid rgba(59,130,246,0.25);margin-bottom:8px"><strong>Focus:</strong> ${escHtml(prep.summary)}</div>` : ""}
        ${qList}
        ${prep.systemDesignScenario?.scenario ? `
          <div style="margin-top:12px">
            <strong style="font-size:0.8rem;color:var(--accent)">🏗️ System Design Scenario:</strong>
            <div style="font-size:0.83rem;margin-top:2px">${escHtml(prep.systemDesignScenario.scenario)}</div>
            ${copyBlock("Recommended Architectural Approach", prep.systemDesignScenario.approach)}
          </div>
        ` : ""}
        ${askList ? `
          <div style="margin-top:12px">
            <strong style="font-size:0.8rem;color:var(--green)">💡 High-Impact Questions To Ask The Interviewer:</strong>
            ${askList}
          </div>
        ` : ""}
      </div>`;
  }

  // Draft Application Answers from Section H of career-ops
  let answersHtml = "";
  const answerKeys = Object.keys(answers);
  if (answerKeys.length > 0) {
    answersHtml = `
      <div class="modal-section">
        <h3>📝 Draft Application Answers (career-ops Section H)</h3>
        ${answerKeys.map((q) => copyBlock(q, answers[q])).join("")}
      </div>`;
  }

  // Tailored Personal Resume Section
  let resumeHtml = "";
  const tailored = job._tailoredResume;
  if (tailored) {
    resumeHtml = `
      <div class="modal-section resume-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="color:var(--green);margin-bottom:0">📄 Tailored Personal Resume</h3>
          <span class="tag tag-time" style="background:rgba(34,197,94,0.2);color:#4ade80">Ready for ${escHtml(jobRole)}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text);margin-bottom:4px;font-weight:600">
          Target Role: <span style="color:#38bdf8">${escHtml(tailored.headline || jobRole)}</span>
        </div>
        <p style="font-size:0.8rem;color:var(--text2);margin-bottom:10px">
          Tailored strictly for <strong>${escHtml(company)}</strong> using your verified track record (YOLOv8/v9 92%+ mAP, Mayonix Innovation, TensorRT, AlphaSense, IEEE papers). Zero hallucinations.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.pdf" target="_blank" download="Prakhar_Chaubey_Resume_${escHtml(company)}.pdf" class="btn btn-success btn-small" style="text-decoration:none">
            ⬇️ Download PDF Resume
          </a>
          <a href="/api/jobs/${encodeURIComponent(job._id)}/resume.html" target="_blank" class="btn btn-outline btn-small" style="text-decoration:none">
            🖨️ Preview / Save as PDF
          </a>
          <button class="btn btn-outline btn-small" onclick="tailorResume('${job._id}')">
            ↻ Re-tailor for Role
          </button>
        </div>
      </div>`;
  } else {
    resumeHtml = `
      <div class="modal-section resume-box" style="border-style:dashed;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="color:var(--accent);margin-bottom:0">📄 Tailored Personal Resume</h3>
          <span class="tag tag-time">Unique for ${escHtml(jobRole)}</span>
        </div>
        <p style="font-size:0.82rem;color:var(--text2);margin-bottom:8px">
          Generate an ATS-compliant tailored resume highlighting your matching achievements in <strong>${escHtml(jobRole)}</strong>.
        </p>
        <button class="btn btn-primary btn-small" onclick="tailorResume('${job._id}')">
          📄 Generate Role-Specific Resume (PDF &amp; HTML)
        </button>
      </div>`;
  }

  // Form Answers Pack
  const fAnswers = job._tailoredResume?.formAnswers || {};
  const whyInterested = fAnswers.whyInterested || `I am excited to apply for the ${jobRole} role at ${company}. With hands-on experience deploying edge-optimized YOLOv8/v9 models (92%+ mAP, sub-100ms latency) and multi-branch deep learning systems, I am eager to contribute to ${company}'s engineering goals.`;
  const relevantExperience = fAnswers.relevantExperience || `At Mayonix Innovation, I developed on-device computer vision models with TensorFlow Lite and YOLOv8/v9, optimizing them via INT8/FP16 quantization for sub-100ms mobile latency. I also engineered AlphaSense AI, integrating PyTorch, Transformers, Mamba, and FastAPI.`;
  const whyHireMe = fAnswers.whyHireMe || `I combine practical production experience optimizing edge models to sub-100ms latencies with published IEEE research in machine learning. I can immediately contribute to ${company}'s computer vision and ML pipelines.`;
  const coverLetter = fAnswers.coverLetter || `Dear Hiring Team at ${company},\n\nI am writing to express my strong interest in the ${job.title || jobRole} role. As a Machine Learning Engineer at Mayonix Innovation and published IEEE researcher, I specialize in computer vision, real-time object detection (YOLOv8/v9, 92%+ mAP), and edge model optimization (INT8/FP16 quantization, TensorRT, TFLite).\n\nMy background matches your requirements for high-performance ML engineering and latency-critical systems. I look forward to the opportunity to discuss how my hands-on experience can support ${company}'s engineering goals.\n\nSincerely,\nPrakhar Pragyan Chaubey`;

  // Mobile & Web Form Assistant Section
  let mobileAssistantHtml = `
    <div class="modal-section mobile-assistant-box" style="background:rgba(30, 41, 59, 0.7); border:1px solid rgba(59, 130, 246, 0.35); border-radius:10px; padding:12px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="color:#38bdf8; margin-bottom:0; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
          📱 Mobile Form Auto-Fill &amp; 1-Tap Copy
        </h3>
        <span class="tag" style="background:rgba(56, 189, 248, 0.2); color:#38bdf8; font-size:0.72rem;">Phone Ready</span>
      </div>
      <p style="font-size:0.8rem; color:var(--text2); margin-bottom:10px;">
        Applying on your phone? Tap <strong>Copy All</strong> to copy everything at once, or tap any individual pill below to copy that specific answer.
      </p>

      <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
        <button class="btn btn-primary btn-small" onclick="copyAllJobFormInfo('${job._id}')" style="flex:1; min-width:180px; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
          ⚡ Copy All Form Info (1-Tap)
        </button>
        <button class="btn btn-outline btn-small" onclick="copyJobBookmarklet('${job._id}')" style="display:inline-flex; align-items:center; gap:4px;">
          📲 Copy Mobile Bookmarklet
        </button>
      </div>

      <div style="font-size:0.73rem; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">
        1-Tap Copy Candidate Details:
      </div>
      <div class="profile-pill-row" style="margin-bottom:12px;">
        <button class="profile-pill" onclick="copyDirect('Prakhar Pragyan Chaubey', this)">👤 Name</button>
        <button class="profile-pill" onclick="copyDirect('prakharpragyan1000@gmail.com', this)">✉️ Email</button>
        <button class="profile-pill" onclick="copyDirect('+91-8853511579', this)">📞 Phone</button>
        <button class="profile-pill" onclick="copyDirect('Ghaziabad, Uttar Pradesh, India', this)">📍 Location</button>
        <button class="profile-pill" onclick="copyDirect('https://linkedin.com/in/prakhar-b045b91ab', this)">🔗 LinkedIn</button>
        <button class="profile-pill" onclick="copyDirect('https://github.com/pieby2', this)">🐙 GitHub</button>
        <button class="profile-pill" onclick="copyDirect('Mayonix Innovation', this)">🏢 Current Co.</button>
        <button class="profile-pill" onclick="copyDirect('Machine Learning Engineer', this)">💼 Current Title</button>
        <button class="profile-pill" onclick="copyDirect('Immediately available (15-30 days)', this)">⏱️ Notice Period</button>
        <button class="profile-pill" onclick="copyDirect('₹15,00,000 INR (Negotiable)', this)">💵 Expected CTC</button>
        <button class="profile-pill" onclick="copyDirect('Yes', this)">🛡️ Auth to Work: Yes</button>
        <button class="profile-pill" onclick="copyDirect('No', this)">🚫 Sponsorship: No</button>
      </div>

      <div style="font-size:0.73rem; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:6px;">
        Job-Specific Screening Answers (1-Tap Copy):
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${copyBlock("❓ Why are you interested in this role & company?", whyInterested)}
        ${copyBlock("💼 Describe your relevant experience", relevantExperience)}
        ${copyBlock("🎯 Why should we hire you? (Proof points)", whyHireMe)}
        ${copyBlock("📝 Cover Letter / Note to Hiring Team", coverLetter)}
      </div>

      <!-- Cloud Headless Auto-Fill Option -->
      <div style="margin-top:14px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="font-size:0.78rem; font-weight:600; color:#93c5fd;">🤖 Cloud Auto-Fill Application (Playwright)</span>
        </div>
        <p style="font-size:0.75rem; color:var(--text2); margin-bottom:8px;">
          Navigates to the portal, fills fields and answers questions, and snapshots the filled page.
        </p>
        <button class="btn btn-autofill btn-small" onclick="autofillForm('${job._id}')">
          🚀 Run Cloud Auto-Fill &amp; Get Screenshot
        </button>
        <div id="autofill-feedback-${job._id}" style="margin-top:8px; font-size:0.82rem; display:none;"></div>
      </div>
    </div>`;

  // Portal Form Question Solver Section
  let solverHtml = `
    <div class="modal-section solver-box">
      <h3 style="color:var(--yellow)">📝 Portal Form Question Solver</h3>
      <p style="font-size:0.8rem;color:var(--text2);margin-bottom:8px">
        Asked custom questions on the portal (Workday, Greenhouse, Lever, Naukri)? Paste them below to get instant tailored answers:
      </p>
      <textarea id="custom-questions-input-${job._id}" class="input" style="width:100%;height:68px;resize:vertical;font-size:0.82rem;margin-bottom:8px" placeholder="Paste questions here (e.g. 'Why do you want to work at ${escHtml(company)}?', 'Describe your experience with YOLO', 'Expected salary?')..."></textarea>
      <button class="btn btn-primary btn-small" onclick="solveQuestions('${job._id}')">
        ✨ Solve Form Questions with DeepSeek
      </button>
      <div id="solved-questions-container-${job._id}" style="margin-top:8px">
        ${(job._customQuestions || []).map((qa) => copyBlock(qa.question, qa.answer)).join("")}
      </div>
    </div>`;

  const jobUrl = job.job_url || job.link || "";
  const jobRole = job.target_role || detectRoleClient(job.title, job.description);

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-title">${escHtml(job.title || "Untitled")}</div>
    <div class="modal-company">${escHtml(company)} · ${escHtml(job.location || "")}</div>
    <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);padding:4px 10px;border-radius:6px;font-size:0.82rem;color:#93c5fd;font-weight:600;margin:6px 0 10px;">
      🎯 Target Job Role: ${escHtml(jobRole)}
    </div>

    ${security ? `
    <div style="font-size:0.75rem;color:#4ade80;margin-bottom:8px">
      🛡️ ai-job-search posting_guard: ${escHtml(security.verdict)}
    </div>` : ""}

    ${evalHtml}

    ${resumeHtml}

    ${mobileAssistantHtml}

    ${solverHtml}

    ${salaryHtml}

    <!-- Quick Action Tool Buttons -->
    <div class="quick-tools-row" style="display:flex;gap:6px;margin:12px 0 6px;flex-wrap:wrap">
      <button class="btn ${tailored ? 'btn-outline' : 'btn-primary'} btn-small" onclick="tailorResume('${job._id}')">
        ${tailored ? "📄 Re-tailor Resume" : "📄 Tailor My Resume (PDF)"}
      </button>
      <button class="btn ${outreach ? 'btn-outline' : 'btn-primary'} btn-small" onclick="generateColdOutreach('${job._id}')">
        ${outreach ? "✉️ View Outreach DMs" : "✉️ Draft Cold DMs & Email"}
      </button>
      <button class="btn ${prep ? 'btn-outline' : 'btn-primary'} btn-small" onclick="generateInterviewPrep('${job._id}')">
        ${prep ? "🎙️ View Interview Prep" : "🎙️ Generate Interview Prep"}
      </button>
    </div>

    ${outreachHtml}

    ${prepHtml}

    ${answersHtml}

    <div class="modal-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <h3 style="margin-bottom:0">Job Description</h3>
        <span class="tag tag-role" style="background:rgba(59,130,246,0.2);color:#93c5fd;font-size:0.75rem">🎯 ${escHtml(jobRole)}</span>
      </div>
      <div style="background:var(--bg3);padding:8px 12px;border-radius:6px;font-size:0.82rem;color:var(--text);margin-bottom:10px;border-left:3px solid var(--accent)">
        <strong>Target Job Role:</strong> ${escHtml(jobRole)}
      </div>
      <div style="max-height:220px;overflow-y:auto;font-size:0.83rem;color:var(--text2);line-height:1.5;white-space:pre-wrap">${escHtml(desc.substring(0, 3000))}</div>
    </div>

    <div class="modal-actions">
      ${!eval_ ? `<button class="btn btn-primary" onclick="evaluateJobCard('${job._id}')">⚡ Evaluate (career-ops)</button>` : ""}
      ${jobUrl ? `<a href="${escHtml(jobUrl)}" target="_blank" rel="noopener" class="btn btn-success" style="text-decoration:none">🔗 Open Portal & Apply</a>` : ""}
      <button class="btn btn-outline" onclick="markApplied('${job._id}')">✅ Mark Applied</button>
    </div>
  `;

  document.getElementById("job-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("job-modal").classList.add("hidden");
}

// --- Generate Cold Outreach ---
async function generateColdOutreach(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  if (job._coldOutreach) {
    openJobDetail(jobId);
    return;
  }

  showLoading("AI is crafting high-converting cold DMs & emails...\nInjecting your Mayonix & AlphaSense metrics...");
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
    openJobDetail(jobId);
  } catch (e) {
    hideLoading();
    alert("Outreach generation failed: " + e.message);
  }
}

// --- Generate Technical Interview Prep ---
async function generateInterviewPrep(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  if (job._interviewPrep) {
    openJobDetail(jobId);
    return;
  }

  showLoading("AI is preparing your technical interview cheat sheet...\nFormulating questions, tailored answers, and system design...");
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
    openJobDetail(jobId);
  } catch (e) {
    hideLoading();
    alert("Interview prep failed: " + e.message);
  }
}

// --- Tailor Personal Resume (HTML + PDF) ---
async function tailorResume(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("Tailoring role-specific personal resume with DeepSeek...\nReformulating experience bullets with JD vocabulary (strict anti-fabrication)...\nCompiling ATS-compliant PDF via Playwright Chromium...\nGenerating application form answers pack...");

  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/tailor-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    job._tailoredResume = data;
    hideLoading();
    openJobDetail(jobId);
    refreshJobs();
  } catch (err) {
    hideLoading();
    alert("Resume tailoring notice: " + err.message);
  }
}

// --- Autonomous Browser Form Auto-Filler (Playwright) ---
async function autofillForm(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  showLoading("Navigating to portal and auto-filling candidate details...\nAttaching tailored PDF resume...\nAnswering screening questions with DeepSeek...");

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
      feedback.style.color = "var(--green)";
      let html = `<div>✅ <strong>Auto-Fill Completed!</strong> Filled ${data.filledFields?.length || 0} fields and answered ${data.answeredQuestions?.length || 0} questions.</div>`;
      if (data.screenshot) {
        html += `<div style="margin-top:8px;"><strong style="font-size:0.75rem;color:#94a3b8;">Captured Form Snapshot:</strong><br><img src="${data.screenshot}" style="width:100%;max-height:260px;object-fit:cover;border-radius:6px;border:1px solid #334155;margin-top:4px;" alt="Filled form screenshot"/></div>`;
      }
      feedback.innerHTML = html;
    }

    if (data.isHeadless) {
      alert(`✅ Cloud Auto-Fill Complete!\n\nFilled ${data.filledFields?.length || 0} fields and ${data.answeredQuestions?.length || 0} questions.\n\nSnapshot preview has been loaded below. Tap 'Open Portal & Apply' to complete your final review and submission!`);
    } else {
      alert(`🚀 Auto-Fill complete!\n\nYour headed browser is currently open on your screen with candidate details, tailored resume PDF, and screening questions filled in.\n\nPlease inspect the page and click Submit when satisfied.`);
    }
  } catch (err) {
    hideLoading();
    alert("Auto-fill notice: " + err.message + "\n\nTip: You can use the '⚡ Copy All Form Info' button or individual field pills to fill the form in seconds on your phone!");
  }
}

// --- Portal Form Question Solver ---
async function solveQuestions(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  const input = document.getElementById(`custom-questions-input-${jobId}`);
  const questionsText = input ? input.value.trim() : "";
  if (!questionsText) {
    alert("Please paste one or more questions from the application form first.");
    return;
  }

  showLoading("DeepSeek is analyzing your CV & job description to generate tailored, authentic answers...");
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/solve-questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: questionsText }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    if (!job._customQuestions) job._customQuestions = [];
    for (const item of (data.answers || [])) {
      const idx = job._customQuestions.findIndex((q) => q.question === item.question);
      if (idx !== -1) job._customQuestions[idx] = item;
      else job._customQuestions.push(item);
    }

    hideLoading();
    openJobDetail(jobId);
  } catch (err) {
    hideLoading();
    alert("Question solving failed: " + err.message);
  }
}

// --- 1-Tap Copy All Form Answers Package (Mobile & Web) ---
async function copyAllJobFormInfo(jobId) {
  const job = allJobs.find((j) => j._id === jobId);
  if (!job) return;

  if (navigator.vibrate) navigator.vibrate(50);

  let text = job._tailoredResume?.copyAllText;
  if (!text) {
    try {
      showLoading("Preparing complete form info package...");
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
          openJobDetail(jobId);
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
Name: Prakhar Pragyan Chaubey
Email: prakharpragyan1000@gmail.com
Phone: +91-8853511579
Location: Ghaziabad, Uttar Pradesh, India
LinkedIn: https://linkedin.com/in/prakhar-b045b91ab
GitHub: https://github.com/pieby2
Current Company: Mayonix Innovation
Current Title: Machine Learning Engineer
Notice Period: Immediately available (15-30 days)
Expected CTC: ₹15,00,000 INR (Negotiable)
Work Authorization: Yes (No visa sponsorship required)

WHY INTERESTED:
I am excited to apply for the ${role} role at ${company}. With hands-on experience deploying edge-optimized YOLOv8/v9 models (92%+ mAP, sub-100ms latency) and multi-model AI architectures, I am eager to contribute to ${company}'s engineering goals.

RELEVANT EXPERIENCE:
At Mayonix Innovation, I developed on-device computer vision models with TensorFlow Lite and YOLOv8/v9, optimizing them via INT8/FP16 quantization for sub-100ms mobile latency. I also engineered AlphaSense AI, integrating PyTorch, Transformers, Mamba, and FastAPI.

WHY HIRE ME:
I combine practical production experience optimizing edge models to sub-100ms latencies with published IEEE research in machine learning. I can immediately contribute to ${company}'s computer vision and ML pipelines.`;
  }

  try {
    await navigator.clipboard.writeText(text);
    alert("⚡ Complete Application Form Package copied to clipboard!\n\nYou can now paste all your details and answers into the job application form with 1 tap.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("⚡ Complete Application Form Package copied to clipboard!\n\nYou can now paste all your details and answers into the job application form with 1 tap.");
  }
}

// --- Copy Mobile Auto-Fill Bookmarklet ---
async function copyJobBookmarklet(jobId) {
  try {
    const res = await fetch(`/api/bookmarklet?jobId=${encodeURIComponent(jobId)}`);
    const data = await res.json();
    if (data.bookmarklet) {
      await navigator.clipboard.writeText(data.bookmarklet);
      alert("📲 Mobile Auto-Fill Bookmarklet copied!\n\n📱 HOW TO USE ON YOUR PHONE:\n1. Bookmark any page in Mobile Chrome or Safari.\n2. Edit the bookmark: rename to '⚡ Auto-Fill' and paste this script into the URL field.\n3. Open any job application page (Workday, Greenhouse, Lever, Naukri, LinkedIn) on your phone.\n4. Type '⚡ Auto-Fill' in the URL bar (or select it from Bookmarks) -> All candidate details and screening answers will auto-fill instantly!");
    }
  } catch (err) {
    alert("Could not copy bookmarklet: " + err.message);
  }
}

// --- Copy 1-Click Universal Bookmarklet ---
async function copyBookmarklet() {
  await copyJobBookmarklet("");
}

// --- 1-Tap Copy Direct Helper with Haptic Feedback ---
function copyDirect(text, btn) {
  if (navigator.vibrate) navigator.vibrate(40);
  const orig = btn.innerText;

  function markCopied() {
    btn.innerText = "✅ Copied!";
    btn.style.background = "var(--green)";
    btn.style.color = "#000";
    setTimeout(() => {
      btn.innerText = orig;
      btn.style.background = "";
      btn.style.color = "";
    }, 1500);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(markCopied).catch(() => {
      fallbackCopy(text);
      markCopied();
    });
  } else {
    fallbackCopy(text);
    markCopied();
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

document.addEventListener("click", (e) => {
  if (e.target.id === "job-modal") closeModal();
});

// --- Status Updates (Synced with career-ops) ---
async function skipJob(jobId) {
  await updateStatus(jobId, "skipped");
  refreshJobs();
}

async function markApplied(jobId) {
  await updateStatus(jobId, "applied");
  closeModal();
  refreshJobs();
  await loadStats();
}

async function updateStatus(jobId, status) {
  try {
    await fetch(`/api/jobs/${jobId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const job = allJobs.find((j) => j._id === jobId);
    if (job) job._status = status;
  } catch { /* ignore */ }
}

// --- Official career-ops Tracker ---
async function loadTracked() {
  const list = document.getElementById("history-list");
  list.innerHTML = '<p class="empty-state">Syncing with career-ops/applications.md...</p>';

  try {
    const res = await fetch("/api/tracked");
    trackedApplications = await res.json();
    filterTracked("all");
  } catch (e) {
    list.innerHTML = `<p class="empty-state">Failed to load tracker: ${e.message}</p>`;
  }
}

function filterTracked(filter) {
  document.querySelectorAll(".filter-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.filter === filter);
  });

  const list = document.getElementById("history-list");
  let filtered = trackedApplications;
  if (filter !== "all") {
    filtered = trackedApplications.filter((a) => a.status === filter);
  }

  if (!filtered.length) {
    list.innerHTML = `<p class="empty-state">No ${filter === "all" ? "" : filter} entries in career-ops tracker.</p>`;
    return;
  }

  list.innerHTML = filtered.map((entry) => `
    <div class="job-card">
      <div class="job-card-header">
        <div>
          <div class="job-title">${escHtml(entry.role || "Role")}</div>
          <div class="job-company">${escHtml(entry.company || "Company")} · #${entry.id}</div>
        </div>
        <div class="score-badge ${parseFloat(entry.score) >= 4 ? 'score-high' : 'score-mid'}">
          ${escHtml(entry.score?.replace("/5", "") || "?")}
        </div>
      </div>
      <div class="job-meta">
        <span class="tag" style="background:var(--accent);color:white">Status: ${escHtml(entry.status)}</span>
        <span class="tag">📅 ${escHtml(entry.date || "")}</span>
        ${entry.notes ? `<span class="tag">📝 ${escHtml(entry.notes)}</span>` : ""}
      </div>
    </div>
  `).join("");
}

// --- Helpers ---
function copyBlock(label, text) {
  if (!text) return "";
  const id = "cb-" + Math.random().toString(36).slice(2, 8);
  return `
    <div style="margin-top:8px">
      <strong style="font-size:0.78rem;color:var(--text2)">${escHtml(label)}</strong>
      <div class="copy-block" id="${id}">
        <button class="copy-btn" onclick="copyText('${id}')">Copy</button>
        ${escHtml(text)}
      </div>
    </div>`;
}

function copyText(id) {
  const block = document.getElementById(id);
  const btn = block.querySelector(".copy-btn");
  const text = block.textContent.replace("Copy", "").replace("Copied!", "").trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500);
  });
}

function showLoading(text) {
  document.getElementById("loading-text").textContent = text;
  document.getElementById("loading").classList.remove("hidden");
}
function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
