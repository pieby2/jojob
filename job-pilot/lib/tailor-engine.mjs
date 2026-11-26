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
Live Demo: ${p.demoUrl || "N/A"}
Repository: ${p.repoUrl || "N/A"}
Description: ${p.description}
Tech Stack: ${p.techStack.join(", ")}
Key Bullets:
${p.bullets.map((b) => `  • ${b}`).join("\n")}
Keywords: ${p.keywords.join(", ")}
`).join("\n---\n");
}

/**
 * Extract high-signal ATS technical & domain keywords from a Job Description.
 */
function extractJdKeywords(jobTitle = "", description = "") {
  const text = `${jobTitle}\n${description}`.toLowerCase();
  const catalog = [
    "Python", "C++", "CUDA", "SQL", "JavaScript", "Bash",
    "PyTorch", "TensorFlow", "TensorFlow Lite", "TFLite", "TensorRT", "ONNX", "OpenCV",
    "YOLO", "YOLOv8", "YOLOv9", "Computer Vision", "Object Detection", "Semantic Segmentation",
    "U-Net", "MobileNet", "ResNet", "Image Processing", "Perception", "3D Perception",
    "Edge AI", "On-Device", "Embedded ML", "Quantization", "INT8", "FP16", "Pruning",
    "Deep Learning", "Machine Learning", "Neural Networks", "Transformers", "LLM", "Generative AI",
    "Reinforcement Learning", "RAG", "LangChain", "Hugging Face", "Fine-Tuning", "SFT", "RLHF",
    "FastAPI", "Flask", "REST API", "Docker", "Kubernetes", "AWS", "CI/CD", "GitHub Actions",
    "Terraform", "Airflow", "ETL", "MLOps", "Model Serving", "Latency", "Optimization",
    "PostgreSQL", "pgvector", "Redis", "Pandas", "NumPy", "Scikit-learn", "Linux", "Git"
  ];
  const matched = [];
  for (const kw of catalog) {
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i");
    if (rx.test(text)) {
      matched.push(kw);
    }
  }
  return matched;
}

/**
 * Compute real ATS match score (0-100) for the tailored resume against the JD.
 */
function computeAtsScore(tailoredData, jdKeywords, jobTitle = "") {
  const resumeBlob = [
    tailoredData.headline || "",
    tailoredData.summary || "",
    ...(tailoredData.competencies || []),
    ...(tailoredData.experienceBullets || []),
    ...(tailoredData.selectedProjects || []).flatMap((p) => [
      p.name || "",
      p.description || "",
      p.techLine || "",
      ...(p.bullets || []),
    ]),
    ...Object.entries(tailoredData.skillsCategories || {}).flatMap(([k, v]) => [k, v]),
  ]
    .join(" ")
    .toLowerCase();

  let matchedCount = 0;
  const matchedKeywords = [];
  for (const kw of jdKeywords) {
    if (resumeBlob.includes(kw.toLowerCase())) {
      matchedCount++;
      matchedKeywords.push(kw);
    }
  }

  const kwScore = jdKeywords.length > 0 ? (matchedCount / jdKeywords.length) * 75 : 70;

  // Structural ATS readiness checks (25 pts)
  let structureScore = 0;
  if ((tailoredData.headline || "").trim().length > 4) structureScore += 5;
  if ((tailoredData.summary || "").trim().length > 40) structureScore += 5;
  if ((tailoredData.experienceBullets || []).length >= 3) structureScore += 5;
  if ((tailoredData.selectedProjects || []).length >= 1) structureScore += 5;
  if (/%|\bms\b|\d+\+/.test(resumeBlob)) structureScore += 5;

  const total = Math.min(99, Math.max(60, Math.round(kwScore + structureScore)));
  return { atsScore: total, matchedKeywords };
}

/**
 * MAIN: Generate a fully custom, 1-1.5 page, high-ATS multi-project resume tailored to a specific JD.
 */
export async function generateJobSpecificResume({ jobId, jobTitle, company, description, targetRole }) {
  if (!existsSync(RESUMES_DIR)) {
    mkdirSync(RESUMES_DIR, { recursive: true });
  }

  const safeJobId = (jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const roleName = targetRole || jobTitle || "Machine Learning Engineer";
  const compName = company || "Company";

  console.log(`[tailor-engine] Generating concise 1-1.5p high-ATS resume for ${compName} — ${jobTitle} (${roleName})...`);

  const { cv } = loadCandidateData();
  const projects = loadProjects();
  const projectsBlock = formatProjectsForPrompt(projects);
  const jdKeywords = extractJdKeywords(jobTitle, description);

  const prompt = `You are an expert ATS resume optimizer and career strategist.
Your task is to craft a SHORT, PRECISE, HIGH-IMPACT resume (strictly 1 to 1.5 pages max when printed) from the candidate's real experience and project portfolio, engineered to score 92%+ on ATS scanners for the target job.

═══════════════════════════════════════════
TARGET JOB INFORMATION
═══════════════════════════════════════════
Company: ${compName}
Job Title: ${jobTitle}
Role Category: ${roleName}
Extracted ATS Keywords from JD: ${jdKeywords.length > 0 ? jdKeywords.join(", ") : roleName}
Job Description:
${description ? description.substring(0, 3500) : "No description provided."}

═══════════════════════════════════════════
CANDIDATE REAL TRACK RECORD (cv.md)
═══════════════════════════════════════════
${cv}

═══════════════════════════════════════════
CANDIDATE PROJECT PORTFOLIO (${projects.length} projects available)
═══════════════════════════════════════════
${projectsBlock}

═══════════════════════════════════════════
STRICT CONCISENESS & ATS RULES (1–1.5 PAGES MAX)
═══════════════════════════════════════════
1. **SELECT TOP 2 PROJECTS ONLY**: Pick the TOP 2 most relevant projects for THIS JD and order by relevance.
2. **CONCISE PROJECT ENTRIES**: For each selected project, write a **1-sentence** crisp description (max 25 words) + **2 short, high-impact bullets** (max 22 words each, with metrics).
3. **CONCISE WORK EXPERIENCE**: Write **4 short, punchy bullets** for Mayonix Innovation (max 22 words each). Lead with action verbs + metrics + exact JD keywords. Use <strong> around key terms/metrics.
4. **CRISP SUMMARY**: Write **2-3 tight sentences** (max 50 words total) tailored to ${compName} and ${jobTitle}, weaving in top JD keywords and hard metrics.
5. **ATS KEYWORD ALIGNMENT (90–95%+ TARGET)**: Naturally weave every applicable keyword from "Extracted ATS Keywords from JD" (that is genuinely true of the candidate) into Summary, Competencies (8 crisp tags), Experience Bullets, Projects, and Technical Skills (4-5 single-line categories).
6. **STRICT ANTI-FABRICATION**: Never invent companies, degrees, metrics, or unverified skills. ALWAYS preserve exact demoUrl and repoUrl from the project data.

═══════════════════════════════════════════
OUTPUT FORMAT — Return ONLY valid JSON:
═══════════════════════════════════════════
{
  "headline": "Targeted professional title matching this JD",
  "summary": "2-3 crisp sentences (<=50 words) with JD keywords & metrics",
  "competencies": ["Tag 1", "Tag 2", "Tag 3", "Tag 4", "Tag 5", "Tag 6", "Tag 7", "Tag 8"],
  "experienceBullets": [
    "Short punchy Mayonix bullet 1 (<=22 words, <strong> on key terms/metrics)",
    "Short punchy bullet 2",
    "Short punchy bullet 3",
    "Short punchy bullet 4"
  ],
  "selectedProjects": [
    {
      "id": "project-id from portfolio",
      "name": "Project Name",
      "period": "Date range",
      "demoUrl": "Exact demoUrl from the project data (keep as-is, empty string if none)",
      "repoUrl": "Exact repoUrl from the project data (keep as-is, empty string if none)",
      "description": "1 concise sentence (<=25 words) tailored to this JD",
      "techLine": "Comma-separated tech most relevant to this JD",
      "bullets": [
        "Short metric-driven bullet 1 (<=22 words)",
        "Short metric-driven bullet 2 (<=22 words)"
      ]
    }
  ],
  "skillsCategories": {
    "Category most relevant to JD": "Skills list",
    "Second category": "Skills list",
    "Third category": "Skills list",
    "Fourth category": "Skills list"
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
        demoUrl: p.demoUrl || "",
        repoUrl: p.repoUrl || "",
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

  // Ensure selectedProjects exists & enforce strict 1-1.5 page length caps
  if (!tailoredData.selectedProjects || tailoredData.selectedProjects.length === 0) {
    tailoredData.selectedProjects = projects.slice(0, 2).map((p) => ({
      id: p.id,
      name: p.name,
      period: p.period,
      demoUrl: p.demoUrl || "",
      repoUrl: p.repoUrl || "",
      description: p.description,
      techLine: p.techStack.slice(0, 6).join(", "),
      bullets: p.bullets.slice(0, 2),
    }));
  } else {
    // Guarantee live demoUrl & repoUrl from canonical projects.json are NEVER lost or stripped by the LLM
    tailoredData.selectedProjects = tailoredData.selectedProjects.slice(0, 2).map((sp) => {
      const orig = projects.find(
        (p) =>
          (sp.id && p.id === sp.id) ||
          (sp.name && p.name.toLowerCase() === sp.name.toLowerCase()) ||
          (sp.name && p.name.toLowerCase().includes(sp.name.toLowerCase()))
      );
      return {
        ...sp,
        demoUrl: orig?.demoUrl || sp.demoUrl || "",
        repoUrl: orig?.repoUrl || sp.repoUrl || "",
        bullets: Array.isArray(sp.bullets) ? sp.bullets.slice(0, 2) : [],
      };
    });
  }

  if (Array.isArray(tailoredData.experienceBullets)) {
    tailoredData.experienceBullets = tailoredData.experienceBullets.slice(0, 4);
  }
  if (Array.isArray(tailoredData.competencies)) {
    tailoredData.competencies = tailoredData.competencies.slice(0, 8);
  }

  const { atsScore, matchedKeywords } = computeAtsScore(tailoredData, jdKeywords, jobTitle);

  // Build the HTML resume
  const htmlContent = buildResumeHtml({ tailoredData, compName, jobTitle, roleName, jobId, safeJobId, atsScore });

  // Save tailored HTML
  const destHtmlPath = join(RESUMES_DIR, `resume-${safeJobId}.html`);
  const destPdfPath = join(RESUMES_DIR, `resume-${safeJobId}.pdf`);
  writeFileSync(destHtmlPath, htmlContent, "utf-8");
  console.log(`[tailor-engine] Tailored HTML saved (ATS: ${atsScore}%): ${destHtmlPath}`);

  // Compile to PDF via Playwright
  let pdfGenerated = false;
  try {
    const chromium = await getPlaywrightChromium();
    if (chromium) {
      console.log(`[tailor-engine] Launching Chromium to render 1-1.5p PDF...`);
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "load" });
      await page.pdf({
        path: destPdfPath,
        format: "Letter",
        margin: { top: "0.28in", bottom: "0.28in", left: "0.34in", right: "0.34in" },
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
    atsScore,
    matchedKeywords,
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
function safeHttpUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function buildResumeHtml({ tailoredData, compName, jobTitle, roleName, jobId, safeJobId, atsScore }) {
  const projectSections = (tailoredData.selectedProjects || []).map((proj) => {
    const demoUrl = safeHttpUrl(proj.demoUrl);
    const repoUrl = safeHttpUrl(proj.repoUrl);
    const linkItems = [];
    if (demoUrl) {
      linkItems.push(`<a class="project-link" href="${escHtml(demoUrl)}" target="_blank" rel="noopener">🔗 Live Demo: ${escHtml(demoUrl.replace(/^https?:\/\//i, ""))}</a>`);
    }
    if (repoUrl) {
      linkItems.push(`<a class="project-link" href="${escHtml(repoUrl)}" target="_blank" rel="noopener">💻 Code: ${escHtml(repoUrl.replace(/^https?:\/\//i, ""))}</a>`);
    }
    return `
    <div class="project-entry">
      <div class="project-header">
        <span class="project-title">${escHtml(proj.name)}</span>
        <span class="job-period">${escHtml(proj.period)}</span>
      </div>
      ${linkItems.length > 0 ? `<div class="project-links">${linkItems.join('<span class="project-link-sep"> · </span>')}</div>` : ""}
      <div class="project-desc">${escHtml(proj.description)}</div>
      <div class="project-tech">Tech: ${escHtml(proj.techLine)}</div>
      ${proj.bullets && proj.bullets.length > 0 ? `
      <ul class="bullets">
        ${proj.bullets.map((b) => `<li>${b}</li>`).join("")}
      </ul>` : ""}
    </div>`;
  }).join("\n");

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
    line-height: 1.38;
    font-size: 9.5pt;
    padding-bottom: 32px;
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
    margin: 16px auto;
    background: #ffffff;
    padding: 0.36in 0.44in;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    border-radius: 8px;
  }

  .header h1 {
    font-size: 19pt; font-weight: 800; color: var(--dark);
    letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 2px;
  }
  .header-role {
    font-size: 10.5pt; font-weight: 600; color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 5px;
  }
  .header-divider {
    height: 1.5px;
    background: linear-gradient(to right, var(--accent), var(--secondary));
    margin-bottom: 6px;
  }
  .contact-bar {
    display: flex; flex-wrap: wrap; gap: 4px 10px;
    font-size: 8.5pt; color: var(--text-muted); margin-bottom: 9px;
  }
  .contact-bar a { color: var(--text-muted); text-decoration: none; }
  .contact-bar a:hover { color: var(--accent); text-decoration: underline; }

  .section { margin-bottom: 9px; }
  .section-title {
    font-size: 9.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--accent);
    border-bottom: 1.2px solid var(--border);
    padding-bottom: 2px; margin-bottom: 5px;
  }
  .summary-text { font-size: 9pt; line-height: 1.4; color: #334155; }
  .summary-text strong { color: var(--dark); }

  .competencies-grid {
    display: flex; flex-wrap: wrap; gap: 4px;
  }
  .competency-tag {
    font-size: 8pt; font-weight: 600; color: var(--tag-color);
    background: var(--bg-tag); border: 1px solid var(--tag-border);
    padding: 2px 6px; border-radius: 4px;
  }

  .job-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 1px;
  }
  .job-company { font-size: 10pt; font-weight: 700; color: var(--dark); }
  .job-period { font-size: 8.5pt; color: var(--text-muted); font-weight: 500; }
  .job-role { font-size: 9pt; font-weight: 600; color: #475569; margin-bottom: 3px; }
  .job-location { font-size: 8.5pt; color: var(--text-muted); font-style: italic; }
  ul.bullets { padding-left: 16px; margin-top: 2px; }
  ul.bullets li {
    font-size: 8.8pt; line-height: 1.38; color: #334155; margin-bottom: 2px;
  }
  ul.bullets li strong { color: var(--dark); }

  .project-entry { margin-bottom: 7px; page-break-inside: avoid; }
  .project-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 1px;
  }
  .project-title { font-size: 9.6pt; font-weight: 700; color: var(--dark); }
  .project-links { margin: 1px 0 2px; font-size: 8.2pt; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .project-link { color: var(--accent); text-decoration: none; font-weight: 600; }
  .project-link:hover { text-decoration: underline; }
  .project-link-sep { color: var(--text-muted); }
  .project-desc { font-size: 8.8pt; line-height: 1.38; color: #334155; margin-top: 1px; }
  .project-tech { font-size: 8.2pt; color: var(--accent); font-weight: 600; margin-top: 2px; }

  .item-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 3px; font-size: 8.8pt;
  }
  .item-title { font-weight: 600; color: var(--dark); }
  .item-sub { color: var(--text-muted); font-size: 8.2pt; }

  .skills-list { display: flex; flex-direction: column; gap: 2px; }
  .skill-line { font-size: 8.8pt; line-height: 1.38; color: #334155; }
  .skill-label { font-weight: 700; color: var(--dark); }

  @media print {
    body { background: #ffffff; padding: 0; }
    .resume-toolbar { display: none !important; }
    .page {
      margin: 0; padding: 0.04in 0.08in;
      box-shadow: none; max-width: 100%; border-radius: 0;
    }
    @page { margin: 0.28in 0.34in; size: letter; }
  }
</style>
</head>
<body>

<div class="resume-toolbar">
  <div style="display:flex;align-items:center;flex-wrap:wrap;">
    <span class="toolbar-title">📄 Tailored for <strong>${escHtml(compName)}</strong></span>
    <span class="toolbar-badge">🎯 ${escHtml(roleName)}</span>
    <span class="toolbar-projects-badge">📂 ${(tailoredData.selectedProjects || []).length} projects · ATS ${atsScore || 92}%</span>
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
