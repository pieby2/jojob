/**
 * Job Pilot — Frontend Logic (career-ops + ai-job-search dual engine)
 */

// --- State ---
let allJobs = [];
let trackedApplications = [];

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

// --- Jobs List Rendering ---
async function refreshJobs() {
  try {
    const res = await fetch("/api/jobs");
    allJobs = await res.json();
    renderJobs(allJobs.filter((j) => j._status === "new" || j._status === "saved"));
  } catch { /* ignore */ }
}

function renderJobs(jobs) {
  const list = document.getElementById("jobs-list");
  if (!jobs.length) {
    list.innerHTML = '<p class="empty-state">No active jobs yet. Tap Scan on the Home tab! 🔍</p>';
    return;
  }
  list.innerHTML = jobs.map((job) => createJobCard(job)).join("");
}

function createJobCard(job) {
  const eval_ = job._evaluation;
  const score = eval_?.score;
  const scoreClass = score >= 4 ? "score-high" : score >= 3 ? "score-mid" : score > 0 ? "score-low" : "score-none";
  const scoreText = score ? score.toFixed(1) : "?";

  const location = job.location || job.city || "";
  const site = job.site || "";
  const company = job.company_name || job.company || "Unknown";
  const dateStr = job.date_posted ? new Date(job.date_posted).toLocaleDateString() : "";
  const security = job._security;
  const salary = job._salaryBenchmark;

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
        ${location ? `<span class="tag">📍 ${escHtml(location)}</span>` : ""}
        ${siteBadge}
        ${compTag}
        ${security ? `<span class="tag tag-security" title="${escHtml(security.verdict)}">🛡️ Verified Safe</span>` : ""}
        ${eval_?.archetype ? `<span class="tag tag-archetype">🎯 ${escHtml(eval_.archetype.split("/")[0])}</span>` : ""}
        ${dateStr ? `<span class="tag">📅 ${dateStr}</span>` : ""}
      </div>
      <div class="job-actions" onclick="event.stopPropagation()">
        <button class="btn btn-primary btn-small" onclick="evaluateJobCard('${job._id}')">
          ${eval_ ? "📄 Report" : "⚡ Evaluate (career-ops)"}
        </button>
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

  const jobUrl = job.job_url || job.link || "";

  document.getElementById("modal-body").innerHTML = `
    <div class="modal-title">${escHtml(job.title || "Untitled")}</div>
    <div class="modal-company">${escHtml(company)} · ${escHtml(job.location || "")}</div>

    ${security ? `
    <div style="font-size:0.75rem;color:#4ade80;margin-bottom:8px">
      🛡️ ai-job-search posting_guard: ${escHtml(security.verdict)}
    </div>` : ""}

    ${evalHtml}

    ${salaryHtml}

    ${answersHtml}

    <div class="modal-section">
      <h3>Job Description</h3>
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
