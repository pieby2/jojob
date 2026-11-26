/**
 * tailor-engine.mjs — Multi-Project Job-Specific Resume Tailoring Engine
 *
 * Major overhaul: Instead of a fixed single-project resume that only updates the summary,
 * this engine now:
 * 1. Loads a PROJECT PORTFOLIO from data/projects.json (user-uploaded multi-domain projects)
 * 2. Sends ALL projects + the JD to DeepSeek and asks it to SELECT the most relevant ones
 * 3. Crafts a FULLY CUSTOM resume: headline, summary, competencies, experience bullets,
 *    project selection & ordering, skills — ALL tailored to the specific JD
 * 4. Renders ATS-optimized HTML + PDF via Playwright
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS_DIR = resolve(join(__dirname, "..", "..", "career-ops"));
const RESUMES_DIR = resolve(join(__dirname, "..", "data", "resumes"));
const PROJECTS_FILE = resolve(join(__dirname, "..", "data", "projects.json"));

// --- Playwright resolution ---
async function getPlaywrightChromium() {
  const attempts = [
    () => import("playwright"),
    () => import("../../career-ops/node_modules/playwright/index.mjs"),
    () => import("../../career-ops/node_modules/playwright/index.js"),
    () => import("../node_modules/playwright/index.mjs"),
  ];
  for (const fn of attempts) {
    try {
      const pw = await fn();
      if (pw?.chromium) return pw.chromium;
      if (pw?.default?.chromium) return pw.default.chromium;
    } catch {
      // try next
    }
  }
  return null;
}

// --- Env loading ---
function ensureEnvLoaded() {
  if (process.env.DEEPSEEK_API_KEY) return;
  const envPaths = [
    join(__dirname, "..", ".env"),
    join(CAREER_OPS_DIR, ".env"),
    join(__dirname, "..", "..", "ai-job-search", ".env"),
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

// --- Load candidate data ---
function loadCandidateData() {
  ensureEnvLoaded();
  const cvPath = join(CAREER_OPS_DIR, "cv.md");
  const profilePath = join(CAREER_OPS_DIR, "config", "profile.yml");

  const cv = existsSync(cvPath) ? readFileSync(cvPath, "utf-8") : "";
  const profile = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";

  return { cv, profile };
}

// --- Load project portfolio ---
export function loadProjects() {
  if (existsSync(PROJECTS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
    } catch (e) {
      console.warn("[tailor-engine] Failed to parse projects.json:", e.message);
    }
  }
  return [];
}

export function saveProjects(projects) {
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

// --- DeepSeek API call ---
async function callDeepSeekChat(messages, temperature = 0.25) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
  const endpoint = "https://api.deepseek.com/v1/chat/completions";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Build a formatted portfolio block for the AI prompt.
 */
function formatProjectsForPrompt(projects) {
  if (!projects || projects.length === 0) return "No projects available.";

  return projects.map((p, i) => `
PROJECT ${i + 1} [ID: ${p.id}]
Domain: ${p.domain}
Name: ${p.name}
Period: ${p.period}
Description: ${p.description}
Tech Stack: ${p.techStack.join(", ")}
Key Bullets:
${p.bullets.map((b) => `  • ${b}`).join("\n")}
Keywords: ${p.keywords.join(", ")}
`).join("\n---\n");
}

/**
 * MAIN: Generate a fully custom, multi-project resume tailored to a specific JD.
 */
export async function generateJobSpecificResume({ jobId, jobTitle, company, description, targetRole }) {
  if (!existsSync(RESUMES_DIR)) {
    mkdirSync(RESUMES_DIR, { recursive: true });
  }

  const safeJobId = (jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const roleName = targetRole || jobTitle || "Machine Learning Engineer";
  const compName = company || "Company";

  console.log(`[tailor-engine] Generating FULLY TAILORED multi-project resume for ${compName} — ${jobTitle} (${roleName})...`);

  const { cv } = loadCandidateData();
  const projects = loadProjects();
  const projectsBlock = formatProjectsForPrompt(projects);

  const prompt = `You are an expert ATS resume optimizer and career strategist.
Your task is to craft a FULLY CUSTOM resume from the candidate's real experience and project portfolio, tailored specifically for the target job.

═══════════════════════════════════════════
TARGET JOB INFORMATION
═══════════════════════════════════════════
Company: ${compName}
Job Title: ${jobTitle}
Role Category: ${roleName}
Job Description:
${description ? description.substring(0, 4000) : "No description provided."}

═══════════════════════════════════════════
CANDIDATE REAL TRACK RECORD (cv.md)
═══════════════════════════════════════════
${cv}

═══════════════════════════════════════════
CANDIDATE PROJECT PORTFOLIO (${projects.length} projects available)
═══════════════════════════════════════════
${projectsBlock}

═══════════════════════════════════════════
YOUR TASK — BUILD A CUSTOM RESUME
═══════════════════════════════════════════

1. **SELECT PROJECTS**: From the ${projects.length} projects above, pick the TOP 1-3 most relevant projects for THIS specific job. Order them by relevance to the JD. A Computer Vision job should lead with CV projects; a Forward Deployed Engineering job should lead with deployment/infra projects; a Deep Learning / Quant job should lead with AlphaSense AI, etc.

2. **REWRITE EXPERIENCE BULLETS**: Don't just copy — rewrite the Mayonix experience bullets using vocabulary and keywords from the JD. Emphasize the aspects of real experience that align with what this employer wants. If the JD mentions "deployment" or "production systems", emphasize deployment work. If it mentions "real-time" or "edge", emphasize latency optimization.

3. **CUSTOM SUMMARY**: Write a 3-4 sentence professional summary that reads as if this candidate was BORN for this specific role. Reference specific achievements and metrics that match the JD.

4. **CUSTOM COMPETENCIES**: Pick 8 competency tags that are both TRUE of the candidate AND appear in the JD or are highly relevant to it.

5. **CUSTOM SKILLS**: Reorder and emphasize the skills categories to lead with what the JD cares about most.

6. **PROJECT BULLETS**: For each selected project, rewrite 2-4 bullets emphasizing the aspects most relevant to this JD. Use JD keywords naturally.

═══════════════════════════════════════════
STRICT ANTI-FABRICATION RULES
═══════════════════════════════════════════
- NEVER invent companies, degrees, institutions, metrics, or claims not in the CV/projects above.
- NEVER add experience the candidate doesn't have. Only reframe and emphasize REAL experience.
- You may reword bullets to use JD terminology, but the underlying facts must be true.

═══════════════════════════════════════════
OUTPUT FORMAT — Return ONLY valid JSON:
═══════════════════════════════════════════
{
  "headline": "Targeted professional title for this specific role",
  "summary": "3-4 sentence custom professional summary with metrics and proof points matching the JD",
  "competencies": ["Tag 1", "Tag 2", "Tag 3", "Tag 4", "Tag 5", "Tag 6", "Tag 7", "Tag 8"],
  "experienceBullets": [
    "Rewritten Mayonix bullet 1 emphasizing JD-relevant aspects (use <strong> for key terms)",
    "Rewritten bullet 2",
    "Rewritten bullet 3",
    "Rewritten bullet 4",
    "Rewritten bullet 5",
    "Rewritten bullet 6"
  ],
  "selectedProjects": [
    {
      "id": "project-id from portfolio",
      "name": "Project Name",
      "period": "Date range",
      "description": "2-3 sentence description rewritten to emphasize JD-relevant aspects",
      "techLine": "Comma-separated tech most relevant to this JD",
      "bullets": [
        "Rewritten project bullet 1 emphasizing JD relevance",
        "Rewritten project bullet 2",
        "Rewritten project bullet 3"
      ]
    }
  ],
  "skillsCategories": {
    "Category most relevant to JD": "Skills list",
    "Second category": "Skills list",
    "Third category": "Skills list",
    "Fourth category": "Skills list",
    "Fifth category": "Skills list"
  },
  "formAnswers": {
    "whyInterested": "2-3 sentences explaining genuine interest in this company and role",
    "relevantExperience": "2-3 sentences about matching experience from Mayonix + selected projects",
    "coverLetter": "Compelling 3-paragraph cover letter for this specific role",
    "whyHireMe": "2 sentences on immediate value the candidate brings"
  }
}`;

  let tailoredData;
  try {
    const raw = await callDeepSeekChat([{ role: "user", content: prompt }]);
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    tailoredData = JSON.parse(jsonStr);
  } catch (err) {
    console.warn("[tailor-engine] DeepSeek tailoring parse fallback:", err.message);
    // Intelligent fallback: select projects by keyword overlap with JD
    const jdLower = (description || "").toLowerCase();
    const scored = projects.map((p) => ({
      ...p,
      score: p.keywords.filter((k) => jdLower.includes(k.toLowerCase())).length,
    }));
    scored.sort((a, b) => b.score - a.score);
    const topProjects = scored.slice(0, 2);

    tailoredData = {
      headline: roleName,
      summary: `Machine Learning Engineer at Mayonix Innovation with production experience in edge-optimized computer vision (92%+ mAP YOLOv8/v9, sub-100ms inference via TensorRT/TFLite/INT8 quantization), deep learning systems, and full-stack ML deployment. Published IEEE researcher seeking to contribute to ${compName} as ${jobTitle}.`,
      competencies: [
        "Real-Time Object Detection (YOLOv8/v9)",
        "Edge Optimization (TensorRT, TFLite, ONNX)",
        "INT8/FP16 Model Quantization & Pruning",
        "PyTorch & Deep Learning Systems",
        "FastAPI & Production ML Serving",
        "Docker, Kubernetes & CI/CD",
        "Data Engineering & ETL Pipelines",
        "Published IEEE Research",
      ],
      experienceBullets: [
        "Trained and evaluated <strong>YOLOv8 and YOLOv9</strong> object detection models for item recognition, achieving <strong>92%+ mAP</strong> on real-world mobile camera inputs.",
        "Optimized models for edge deployment through <strong>INT8 and FP16 quantization</strong>, structured pruning, and GPU delegate configuration, reaching <strong>sub-100ms inference latency</strong> on Android and iOS.",
        "Developed on-device CV features using <strong>TensorFlow Lite, MobileNetV3-Small, and U-Net segmentation</strong> for real-time mobile inference.",
        "Designed image/video preprocessing pipelines for classification, segmentation, and color extraction using <strong>OpenCV and NumPy</strong>.",
        "Built an image-embedding-based recommendation system using deep feature extraction and cosine similarity search.",
        "Designed a feedback-loop pipeline for continuous model improvement through online learning under distribution shift.",
      ],
      selectedProjects: topProjects.map((p) => ({
        id: p.id,
        name: p.name,
        period: p.period,
        description: p.description,
        techLine: p.techStack.slice(0, 6).join(", "),
        bullets: p.bullets.slice(0, 3),
      })),
      skillsCategories: {
        "Core ML & Vision": "PyTorch, TensorFlow, YOLOv8/v9, OpenCV, TensorRT, TFLite, ONNX",
        "Edge & Optimization": "INT8/FP16 quantization, structured pruning, CUDA, GPU delegates",
        "Languages": "Python, C++, CUDA, SQL, Bash, JavaScript",
        "Deployment & Infra": "FastAPI, Docker, Kubernetes, AWS, GitHub Actions, CI/CD",
        "Databases & Data": "PostgreSQL, pgvector, Redis, Pandas, NumPy, Apache Airflow",
      },
      formAnswers: {
        whyInterested: `I am excited to apply for the ${jobTitle} role at ${compName}. My production ML experience deploying edge-optimized models and full-stack ML systems directly aligns with your technical requirements.`,
        relevantExperience: `At Mayonix Innovation, I developed and deployed production computer vision models with YOLOv8/v9 (92%+ mAP, sub-100ms edge latency) and built full-stack ML systems with FastAPI, Docker, and cloud infrastructure.`,
        coverLetter: `Dear Hiring Team at ${compName},\n\nI am writing to express my strong interest in the ${jobTitle} role. As a Machine Learning Engineer at Mayonix Innovation and published IEEE researcher, I bring hands-on production experience in computer vision, edge optimization, and full-stack ML deployment.\n\nMy technical background and project portfolio directly match your requirements. I look forward to discussing how I can contribute to ${compName}'s engineering goals.\n\nSincerely,\nPrakhar Pragyan Chaubey`,
        whyHireMe: `I bring proven production experience taking deep learning models from research to deployment, backed by IEEE publications and a diverse project portfolio spanning computer vision, deep learning, and ML systems engineering.`,
      },
    };
  }

  // Ensure selectedProjects exists (backward compat)
  if (!tailoredData.selectedProjects || tailoredData.selectedProjects.length === 0) {
    tailoredData.selectedProjects = projects.slice(0, 2).map((p) => ({
      id: p.id,
      name: p.name,
      period: p.period,
      description: p.description,
      techLine: p.techStack.slice(0, 6).join(", "),
      bullets: p.bullets.slice(0, 3),
    }));
  }

  // Build the HTML resume
  const htmlContent = buildResumeHtml({ tailoredData, compName, jobTitle, roleName, jobId, safeJobId });

  // Save tailored HTML
  const destHtmlPath = join(RESUMES_DIR, `resume-${safeJobId}.html`);
  const destPdfPath = join(RESUMES_DIR, `resume-${safeJobId}.pdf`);
  writeFileSync(destHtmlPath, htmlContent, "utf-8");
  console.log(`[tailor-engine] Tailored HTML saved: ${destHtmlPath}`);

  // Compile to PDF via Playwright
  let pdfGenerated = false;
  try {
    const chromium = await getPlaywrightChromium();
    if (chromium) {
      console.log(`[tailor-engine] Launching Chromium to render PDF...`);
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "load" });
      await page.pdf({
        path: destPdfPath,
        format: "Letter",
        margin: { top: "0.35in", bottom: "0.35in", left: "0.35in", right: "0.35in" },
        printBackground: true,
      });
      await browser.close();
      pdfGenerated = true;
      console.log(`[tailor-engine] Tailored PDF generated: ${destPdfPath}`);
    }
  } catch (err) {
    console.warn(`[tailor-engine] Playwright PDF notice: ${err.message}`);
  }

  // Build form answers payload
  const candidateAnswers = buildCandidateAnswers(tailoredData, compName, roleName, jobTitle);
  const copyAllText = buildCopyAllText(candidateAnswers);
  const bookmarklet = buildBookmarklet(candidateAnswers);

  return {
    success: true,
    jobId,
    jobTitle,
    company: compName,
    targetRole: roleName,
    headline: tailoredData.headline,
    selectedProjectIds: (tailoredData.selectedProjects || []).map((p) => p.id),
    selectedProjectCount: (tailoredData.selectedProjects || []).length,
    htmlFile: `resume-${safeJobId}.html`,
    pdfFile: `resume-${safeJobId}.pdf`,
    destHtmlPath,
    destPdfPath: pdfGenerated ? destPdfPath : destHtmlPath,
    hasPdf: pdfGenerated,
    htmlUrl: `/api/jobs/${encodeURIComponent(jobId)}/resume.html`,
    pdfUrl: `/api/jobs/${encodeURIComponent(jobId)}/resume.pdf`,
    formAnswers: candidateAnswers,
    copyAllText,
    bookmarklet,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════
// HTML RESUME BUILDER
// ═══════════════════════════════════════════
function buildResumeHtml({ tailoredData, compName, jobTitle, roleName, jobId, safeJobId }) {
  const projectSections = (tailoredData.selectedProjects || []).map((proj) => `
    <div class="project-entry">
      <div class="project-header">
        <span class="project-title">${escHtml(proj.name)}</span>
        <span class="job-period">${escHtml(proj.period)}</span>
      </div>
      <div class="project-desc">${escHtml(proj.description)}</div>
      <div class="project-tech">Tech: ${escHtml(proj.techLine)}</div>
      ${proj.bullets && proj.bullets.length > 0 ? `
      <ul class="bullets">
        ${proj.bullets.map((b) => `<li>${b}</li>`).join("")}
      </ul>` : ""}
    </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prakhar Pragyan Chaubey — CV for ${escHtml(compName)} (${escHtml(jobTitle)})</title>
<style>
  :root {
    --accent: #0284c7;
    --secondary: #6366f1;
    --dark: #0f172a;
    --text: #1e293b;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --bg-tag: #f0f9ff;
    --tag-border: #bae6fd;
    --tag-color: #0369a1;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Liberation Sans", Arial, sans-serif;
    color: var(--text);
    background: #f8fafc;
    line-height: 1.5;
    font-size: 11pt;
    padding-bottom: 40px;
  }
  .resume-toolbar {
    position: sticky; top: 0; z-index: 1000;
    background: #0f172a; color: #fff;
    padding: 10px 20px;
    display: flex; justify-content: space-between; align-items: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border-bottom: 2px solid var(--accent);
  }
  .toolbar-title { font-size: 13px; font-weight: 600; }
  .toolbar-badge {
    background: rgba(2, 132, 199, 0.2); color: #38bdf8;
    padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }
  .toolbar-projects-badge {
    background: rgba(99, 102, 241, 0.2); color: #a5b4fc;
    padding: 3px 8px; border-radius: 4px; font-size: 11px; margin-left: 6px;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }
  .toolbar-actions { display: flex; gap: 8px; }
  .tb-btn {
    background: #0284c7; color: #fff; border: none;
    padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
    cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;
    transition: background 0.15s;
  }
  .tb-btn:hover { background: #0369a1; }
  .tb-btn-outline {
    background: transparent; border: 1px solid #475569; color: #cbd5e1;
  }
  .tb-btn-outline:hover { background: #1e293b; color: #fff; }

  .page {
    max-width: 8.5in;
    margin: 20px auto;
    background: #ffffff;
    padding: 0.55in 0.65in;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    border-radius: 8px;
  }

  .header h1 {
    font-size: 26pt; font-weight: 800; color: var(--dark);
    letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 4px;
  }
  .header-role {
    font-size: 13pt; font-weight: 600; color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
  }
  .header-divider {
    height: 2px;
    background: linear-gradient(to right, var(--accent), var(--secondary));
    margin-bottom: 10px;
  }
  .contact-bar {
    display: flex; flex-wrap: wrap; gap: 6px 12px;
    font-size: 9.5pt; color: var(--text-muted); margin-bottom: 16px;
  }
  .contact-bar a { color: var(--text-muted); text-decoration: none; }
  .contact-bar a:hover { color: var(--accent); text-decoration: underline; }

  .section { margin-bottom: 16px; }
  .section-title {
    font-size: 11pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--accent);
    border-bottom: 1.5px solid var(--border);
    padding-bottom: 3px; margin-bottom: 8px;
  }
  .summary-text { font-size: 10pt; line-height: 1.55; color: #334155; }
  .summary-text strong { color: var(--dark); }

  .competencies-grid {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .competency-tag {
    font-size: 9pt; font-weight: 600; color: var(--tag-color);
    background: var(--bg-tag); border: 1px solid var(--tag-border);
    padding: 3px 8px; border-radius: 4px;
  }

  .job-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 2px;
  }
  .job-company { font-size: 11pt; font-weight: 700; color: var(--dark); }
  .job-period { font-size: 9.5pt; color: var(--text-muted); font-weight: 500; }
  .job-role { font-size: 10pt; font-weight: 600; color: #475569; margin-bottom: 6px; }
  .job-location { font-size: 9pt; color: var(--text-muted); font-style: italic; }
  ul.bullets { padding-left: 18px; margin-top: 4px; }
  ul.bullets li {
    font-size: 9.5pt; line-height: 1.55; color: #334155; margin-bottom: 4px;
  }
  ul.bullets li strong { color: var(--dark); }

  .project-entry { margin-bottom: 14px; }
  .project-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 2px;
  }
  .project-title { font-size: 10.5pt; font-weight: 700; color: var(--dark); }
  .project-desc { font-size: 9.5pt; line-height: 1.55; color: #334155; margin-top: 2px; }
  .project-tech { font-size: 9pt; color: var(--accent); font-weight: 600; margin-top: 3px; }

  .item-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 4px; font-size: 9.5pt;
  }
  .item-title { font-weight: 600; color: var(--dark); }
  .item-sub { color: var(--text-muted); font-size: 9pt; }

  .skills-list { display: flex; flex-direction: column; gap: 4px; }
  .skill-line { font-size: 9.5pt; line-height: 1.5; color: #334155; }
  .skill-label { font-weight: 700; color: var(--dark); }

  @media print {
    body { background: #ffffff; padding: 0; }
    .resume-toolbar { display: none !important; }
    .page {
      margin: 0; padding: 0.4in 0.4in;
      box-shadow: none; max-width: 100%; border-radius: 0;
    }
    @page { margin: 0.35in; size: letter; }
  }
</style>
</head>
<body>

<div class="resume-toolbar">
  <div style="display:flex;align-items:center;flex-wrap:wrap;">
    <span class="toolbar-title">📄 Tailored for <strong>${escHtml(compName)}</strong></span>
    <span class="toolbar-badge">🎯 ${escHtml(roleName)}</span>
    <span class="toolbar-projects-badge">📂 ${(tailoredData.selectedProjects || []).length} projects selected</span>
  </div>
  <div class="toolbar-actions">
    <button class="tb-btn" onclick="window.print()">🖨️ Save as PDF</button>
    <a href="/api/jobs/${encodeURIComponent(jobId)}/resume.pdf" target="_blank" class="tb-btn tb-btn-outline" download="Prakhar_Chaubey_Resume_${escHtml(compName)}.pdf">⬇️ Download PDF</a>
  </div>
</div>

<div class="page">
  <!-- HEADER -->
  <div class="header">
    <h1>Prakhar Pragyan Chaubey</h1>
    <div class="header-role">${escHtml(tailoredData.headline)}</div>
    <div class="header-divider"></div>
    <div class="contact-bar">
      <span>📞 +91-8853511579</span>
      <span>•</span>
      <a href="mailto:prakharpragyan1000@gmail.com">✉️ prakharpragyan1000@gmail.com</a>
      <span>•</span>
      <a href="https://linkedin.com/in/prakhar-b045b91ab" target="_blank">🔗 linkedin.com/in/prakhar-b045b91ab</a>
      <span>•</span>
      <a href="https://github.com/pieby2" target="_blank">🐙 github.com/pieby2</a>
      <span>•</span>
      <span>📍 Ghaziabad, Uttar Pradesh, India</span>
    </div>
  </div>

  <!-- PROFESSIONAL SUMMARY -->
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">${tailoredData.summary}</div>
  </div>

  <!-- CORE COMPETENCIES -->
  <div class="section">
    <div class="section-title">Core Competencies</div>
    <div class="competencies-grid">
      ${(tailoredData.competencies || []).map((c) => `<span class="competency-tag">${escHtml(c)}</span>`).join("")}
    </div>
  </div>

  <!-- WORK EXPERIENCE -->
  <div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job-header">
      <span class="job-company">Mayonix Innovation</span>
      <span class="job-period">February 2026 – Present</span>
    </div>
    <div class="job-role">Machine Learning Engineer · <span class="job-location">Remote</span></div>
    <ul class="bullets">
      ${(tailoredData.experienceBullets || []).map((b) => `<li>${b}</li>`).join("")}
    </ul>
  </div>

  <!-- PROJECTS (AI-SELECTED & ORDERED) -->
  <div class="section">
    <div class="section-title">Projects</div>
    ${projectSections}
  </div>

  <!-- PUBLICATIONS -->
  <div class="section">
    <div class="section-title">Publications</div>
    <div class="item-row">
      <div>
        <div class="item-title">Machine Learning-Ready Computer-Aided Butler Matrix Designer</div>
        <div class="item-sub">R. K. Arya, P. P. Chaubey, et al. — IEEE Workshop on Antenna and Microwave Systems (WAMS), Chennai</div>
      </div>
      <div class="job-period">2025</div>
    </div>
    <div class="item-row" style="margin-top:6px;">
      <div>
        <div class="item-title">Log-Gabor and Wavelet-Based Transform for Enhanced CT-MRI Image Fusion</div>
        <div class="item-sub">P. P. Chaubey, et al. — INCSTIC-2025 (Accepted)</div>
      </div>
      <div class="job-period">2025</div>
    </div>
  </div>

  <!-- EDUCATION -->
  <div class="section">
    <div class="section-title">Education</div>
    <div class="item-row">
      <div>
        <div class="item-title">Bachelor of Technology in Computer Science and Engineering</div>
        <div class="item-sub">ABES Engineering College — Ghaziabad, Uttar Pradesh, India</div>
      </div>
      <div class="job-period">Expected July 2026</div>
    </div>
  </div>

  <!-- TECHNICAL SKILLS -->
  <div class="section">
    <div class="section-title">Technical Skills</div>
    <div class="skills-list">
      ${Object.entries(tailoredData.skillsCategories || {}).map(([cat, sk]) => `
        <div class="skill-line"><span class="skill-label">${escHtml(cat)}:</span> ${escHtml(sk)}</div>
      `).join("")}
    </div>
  </div>
</div>

</body>
</html>`;
}

// ═══════════════════════════════════════════
// CANDIDATE ANSWERS & HELPERS
// ═══════════════════════════════════════════
function buildCandidateAnswers(tailoredData, compName, roleName, jobTitle) {
  return {
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
    whyInterested: tailoredData.formAnswers?.whyInterested || `I am excited to apply for the ${jobTitle} role at ${compName}.`,
    relevantExperience: tailoredData.formAnswers?.relevantExperience || `At Mayonix Innovation, I engineered production ML systems.`,
    coverLetter: tailoredData.formAnswers?.coverLetter || `Dear Hiring Team at ${compName},\n\nI am writing to express my interest in the ${jobTitle} role.\n\nSincerely,\nPrakhar Pragyan Chaubey`,
    whyHireMe: tailoredData.formAnswers?.whyHireMe || `I bring proven production ML experience.`,
  };
}

function buildCopyAllText(a) {
  return `APPLICANT INFORMATION:
Name: ${a.fullName}
Email: ${a.email}
Phone: ${a.phone}
Location: ${a.location}
LinkedIn: ${a.linkedin}
GitHub: ${a.github}
Current Company: ${a.currentCompany}
Current Title: ${a.currentTitle}
Notice Period: ${a.noticePeriod}
Expected CTC: ${a.salaryExpectation}
Work Authorization: ${a.workAuth} (No sponsorship required)

WHY INTERESTED:
${a.whyInterested}

RELEVANT EXPERIENCE:
${a.relevantExperience}

WHY HIRE ME:
${a.whyHireMe}

COVER LETTER:
${a.coverLetter}`;
}

function buildBookmarklet(c) {
  const cl = (s) => (s || "").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `javascript:(function(){var c={name:"${c.fullName}",first:"${c.firstName}",last:"${c.lastName}",email:"${c.email}",phone:"${c.phone}",city:"${c.city}",location:"${c.location}",linkedin:"${c.linkedin}",github:"${c.github}",portfolio:"${c.portfolio}",company:"${c.currentCompany}",title:"${c.currentTitle}",notice:"${c.noticePeriod}",salary:"${c.salaryExpectation}",why:"${cl(c.whyInterested)}",exp:"${cl(c.relevantExperience)}",cl:"${cl(c.coverLetter)}"};var f=0;function fill(sel,val){if(!val)return;document.querySelectorAll(sel).forEach(function(el){if(!el.value||el.value.length===0){el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.style.border="2px solid #22c55e";f++;}});}fill('input[type="email"],input[name*="email" i]',c.email);fill('input[type="tel"],input[name*="phone" i]',c.phone);fill('input[name*="name" i]:not([name*="first" i]):not([name*="last" i])',c.name);fill('input[name*="first_name" i],input[autocomplete="given-name"]',c.first);fill('input[name*="last_name" i],input[autocomplete="family-name"]',c.last);fill('input[name*="linkedin" i]',c.linkedin);fill('input[name*="github" i]',c.github);alert("✅ Job Pilot: Filled "+f+" fields!");})();`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
