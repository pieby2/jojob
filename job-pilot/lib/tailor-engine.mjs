/**
 * tailor-engine.mjs — Job-Specific Personal Resume Tailoring Engine
 *
 * Generates role-specific tailored resumes (HTML & PDF) for EACH unique job:
 * - Reads candidate track record strictly from cv.md & profile.yml (zero hallucination)
 * - DeepSeek customizes Summary, Competencies, Experience ordering, and Skills for the JD
 * - Produces beautiful ATS-optimized HTML with print-to-PDF support
 * - Compiles to clean A4/Letter PDF via Playwright
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS_DIR = resolve(join(__dirname, "..", "..", "career-ops"));
const RESUMES_DIR = resolve(join(__dirname, "..", "data", "resumes"));

// Dynamically resolve Playwright
async function getPlaywrightChromium() {
  try {
    const pw = await import("playwright");
    return pw.chromium;
  } catch {
    try {
      const pw = await import("../../career-ops/node_modules/playwright/index.mjs");
      return pw.chromium;
    } catch {
      return null;
    }
  }
}

function loadCandidateData() {
  const cvPath = join(CAREER_OPS_DIR, "cv.md");
  const profilePath = join(CAREER_OPS_DIR, "config", "profile.yml");
  const templatePath = join(CAREER_OPS_DIR, "templates", "cv-template.html");

  const cv = existsSync(cvPath) ? readFileSync(cvPath, "utf-8") : "";
  const profile = existsSync(profilePath) ? readFileSync(profilePath, "utf-8") : "";
  const template = existsSync(templatePath) ? readFileSync(templatePath, "utf-8") : "";

  return { cv, profile, template };
}

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
      max_tokens: 3000,
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
 * Tailor personal resume specifically for this job role and company.
 */
export async function generateJobSpecificResume({ jobId, jobTitle, company, description, targetRole }) {
  if (!existsSync(RESUMES_DIR)) {
    mkdirSync(RESUMES_DIR, { recursive: true });
  }

  const safeJobId = (jobId || `job-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const roleName = targetRole || jobTitle || "Machine Learning Engineer";
  const compName = company || "Company";

  console.log(`[tailor-engine] Generating tailored resume for ${compName} — ${jobTitle} (${roleName})...`);

  const { cv, template } = loadCandidateData();

  const prompt = `You are an expert ATS resume optimizer and career strategist.
Your task is to tailor a real software/AI candidate's CV for a SPECIFIC target job.

═══════════════════════════════════════════
TARGET JOB INFORMATION
═══════════════════════════════════════════
Company: ${compName}
Job Title: ${jobTitle}
Role Category: ${roleName}
Job Description:
${description ? description.substring(0, 3000) : "No description provided."}

═══════════════════════════════════════════
CANDIDATE REAL TRACK RECORD (cv.md)
═══════════════════════════════════════════
${cv}

═══════════════════════════════════════════
STRICT ANTI-FABRICATION RULES
═══════════════════════════════════════════
1. NEVER invent past companies, degrees, institutions, or unverified claims.
2. The candidate's real experience is:
   - Machine Learning Engineer at Mayonix Innovation (Feb 2026 - Present): YOLOv8/v9 item detection (92%+ mAP), sub-100ms edge inference latency on iOS/Android, INT8/FP16 quantization, structured pruning, MobileNetV3-Small, U-Net semantic segmentation, OpenCV/NumPy pipelines.
   - Project: AlphaSense AI (PyTorch, Temporal Fusion Transformer, Bidirectional Mamba, Stockformer, Stable-Baselines3 DRL ensemble PPO/A2C/DDPG, FastAPI backend, Hugging Face Spaces).
   - Publications: IEEE WAMS 2025 (Chennai) & INCSTIC-2025.
   - Education: B.Tech Computer Science & Engineering, ABES Engineering College (Expected July 2026).
3. Reformulate bullets using vocabulary and keywords from the Job Description to maximize ATS match.
4. Craft a custom Professional Summary specifically targeted at ${compName} and ${jobTitle}.

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════
Return ONLY valid JSON matching this exact structure:
{
  "headline": "Targeted Title (e.g. Computer Vision & Edge AI Engineer)",
  "summary": "3-4 sentence powerful summary highlighting proof points directly answering this JD",
  "competencies": [
    "Competency 1 (exact tech keyword from JD matching real experience)",
    "Competency 2",
    "Competency 3",
    "Competency 4",
    "Competency 5",
    "Competency 6",
    "Competency 7",
    "Competency 8"
  ],
  "experienceBullets": [
    "First strongest matching bullet for Mayonix Innovation emphasizing JD tech & metrics (use <strong> for keywords)",
    "Second matching bullet",
    "Third matching bullet",
    "Fourth matching bullet",
    "Fifth matching bullet",
    "Sixth matching bullet"
  ],
  "projectDescription": "2-3 sentences describing AlphaSense AI emphasizing technologies relevant to this JD (e.g. PyTorch, Transformers, Mamba, FastAPI, optimization)",
  "skillsCategories": {
    "Core Focus": "Comma-separated skills most critical to this JD",
    "Machine Learning & Frameworks": "PyTorch, TensorFlow, OpenCV, YOLOv8/v9, etc.",
    "Optimization & Edge": "TensorRT, TFLite, ONNX, INT8/FP16 quantization, structured pruning, CUDA",
    "Deployment & Backend": "FastAPI, Docker, REST APIs, AWS, CI/CD, Git",
    "Languages & Tools": "Python, C++, CUDA, SQL, Bash, JavaScript"
  },
  "formAnswers": {
    "whyInterested": "2-3 sentences explaining why you want to join this company and role, citing real candidate achievements",
    "relevantExperience": "2-3 sentences describing real Mayonix/AlphaSense experience matching this JD",
    "coverLetter": "Compelling 3-paragraph tailored cover letter for this company and role",
    "whyHireMe": "2 sentences summarizing candidate edge/ML skills and immediate value to the team"
  }
}`;

  let tailoredData;
  try {
    const raw = await callDeepSeekChat([{ role: "user", content: prompt }]);
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    tailoredData = JSON.parse(jsonStr);
  } catch (err) {
    console.warn("[tailor-engine] DeepSeek tailoring parse fallback:", err.message);
    tailoredData = {
      headline: `${roleName}`,
      summary: `Final-year Computer Science engineer and Machine Learning Engineer at Mayonix Innovation with hands-on experience deploying edge-optimized models (92%+ mAP, sub-100ms inference on iOS/Android via TensorRT, TFLite, and INT8/FP16 quantization). Published IEEE researcher seeking to contribute to ${compName} in ${jobTitle}.`,
      competencies: [
        "Real-Time Object Detection (YOLOv8/v9)",
        "Edge Optimization (TensorRT, TFLite, ONNX)",
        "INT8 / FP16 Model Quantization & Pruning",
        "Semantic Segmentation (U-Net)",
        "PyTorch, C++, and OpenCV Pipelines",
        "Sub-100ms On-Device Latency Acceleration",
        "FastAPI, Docker & Production ML Serving",
        "Published IEEE Computer Vision Research",
      ],
      experienceBullets: [
        "Optimized trained models for edge deployment through <strong>INT8 and FP16 quantization</strong>, structured pruning, and GPU delegate configuration, reaching <strong>sub-100ms end-to-end inference latency</strong> on Android and iOS edge devices.",
        "Trained and evaluated multiple object detection models (<strong>YOLOv8 and YOLOv9</strong> architectures) for garment and item recognition, tuning precision-recall trade-offs to <strong>92%+ mAP</strong> on real-world mobile camera inputs.",
        "Developed on-device computer vision features for a React Native mobile application using <strong>TensorFlow Lite, MobileNetV3-Small, and U-Net segmentation</strong> models optimized for real-time mobile inference.",
        "Designed image and video preprocessing pipelines for clothing classification, background removal via semantic segmentation, and automated RGB color extraction using <strong>OpenCV and NumPy</strong>.",
        "Built an image-embedding-based recommendation system using deep feature extraction and cosine similarity search to suggest visually similar items, improving click-through rates.",
        "Designed a feedback-loop pipeline capturing user corrections to enable continuous model improvement through online learning, improving model robustness under distribution shift.",
      ],
      projectDescription: "Built a multi-branch deep learning system fusing Temporal Fusion Transformer, Bidirectional Mamba, Stockformer (CNN-Transformer), and Graph Attention Network outputs with regime-conditioned gating. Implemented Deep Reinforcement Learning ensemble (PPO, A2C, DDPG) on Stable-Baselines3. Deployed the full-stack system with FastAPI on Hugging Face Spaces with real-time indicators and Gemini API integration.",
      skillsCategories: {
        "Core Technologies": "YOLOv8/v9, PyTorch, TensorRT, TensorFlow Lite, OpenCV, CUDA, ONNX",
        "Edge & Acceleration": "INT8/FP16 quantization, structured pruning, GPU delegates, sub-100ms latency",
        "Languages": "Python, C++, CUDA, SQL, Bash, JavaScript",
        "Deployment & Infra": "FastAPI, Docker, AWS (S3, Redshift, EKS), GitHub Actions, CI/CD",
        "Databases & Tools": "PostgreSQL, pgvector, Redis, Pandas, NumPy",
      },
      formAnswers: {
        whyInterested: `I am strongly drawn to ${compName}'s focus on innovation in ${roleName}. My hands-on experience optimizing YOLOv8/v9 computer vision models and edge inference to sub-100ms latency at Mayonix Innovation directly aligns with your technical requirements.`,
        relevantExperience: `At Mayonix Innovation, I engineered and deployed YOLOv8/v9 item detection models achieving 92%+ mAP and sub-100ms inference on mobile edge devices using INT8/FP16 quantization and TensorRT/TFLite. In addition, I built AlphaSense AI fusing multi-branch transformers with FastAPI serving.`,
        coverLetter: `Dear Hiring Team at ${compName},\n\nI am writing to express my strong interest in the ${jobTitle} role. As a Machine Learning Engineer at Mayonix Innovation and published IEEE researcher, I specialize in computer vision, real-time object detection (YOLOv8/v9, 92%+ mAP), and edge model optimization (INT8/FP16 quantization, TensorRT, TFLite).\n\nMy background matches your requirements for high-performance ML engineering and latency-critical systems. I look forward to the opportunity to discuss how my hands-on experience can support ${compName}'s engineering goals.\n\nSincerely,\nPrakhar Pragyan Chaubey`,
        whyHireMe: `I bring proven production experience taking deep learning models from training to sub-100ms edge deployment, backed by 2 published IEEE papers and a relentless drive for engineering excellence.`,
      },
    };
  }

  // Build clean, standalone, responsive HTML resume
  const htmlContent = `<!DOCTYPE html>
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
  /* Floating / Header Action Toolbar */
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

  /* Printable Page Sheet */
  .page {
    max-width: 8.5in;
    margin: 20px auto;
    background: #ffffff;
    padding: 0.55in 0.65in;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    border-radius: 8px;
  }

  /* Header */
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

  /* Section */
  .section { margin-bottom: 16px; }
  .section-title {
    font-size: 11pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--accent);
    border-bottom: 1.5px solid var(--border);
    padding-bottom: 3px; margin-bottom: 8px;
  }
  .summary-text { font-size: 10pt; line-height: 1.55; color: #334155; }
  .summary-text strong { color: var(--dark); }

  /* Competencies */
  .competencies-grid {
    display: flex; flex-wrap: wrap; gap: 6px;
  }
  .competency-tag {
    font-size: 9pt; font-weight: 600; color: var(--tag-color);
    background: var(--bg-tag); border: 1px solid var(--tag-border);
    padding: 3px 8px; border-radius: 4px;
  }

  /* Work Experience */
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

  /* Project */
  .project-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 2px;
  }
  .project-title { font-size: 10.5pt; font-weight: 700; color: var(--dark); }
  .project-desc { font-size: 9.5pt; line-height: 1.55; color: #334155; margin-top: 2px; }
  .project-tech { font-size: 9pt; color: var(--accent); font-weight: 600; margin-top: 3px; }

  /* Education & Publications */
  .item-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 4px; font-size: 9.5pt;
  }
  .item-title { font-weight: 600; color: var(--dark); }
  .item-sub { color: var(--text-muted); font-size: 9pt; }

  /* Skills */
  .skills-list { display: flex; flex-direction: column; gap: 4px; }
  .skill-line { font-size: 9.5pt; line-height: 1.5; color: #334155; }
  .skill-label { font-weight: 700; color: var(--dark); }

  /* Print Styles */
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

<!-- Interactive Mobile & Desktop Action Toolbar -->
<div class="resume-toolbar">
  <div style="display:flex;align-items:center;">
    <span class="toolbar-title">📄 Tailored for <strong>${escHtml(compName)}</strong></span>
    <span class="toolbar-badge">🎯 ${escHtml(roleName)}</span>
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

  <!-- PROJECTS -->
  <div class="section">
    <div class="section-title">Projects</div>
    <div class="project-header">
      <span class="project-title">AlphaSense AI — Multi-Model Deep Learning Trading System</span>
      <span class="job-period">2025 – 2026</span>
    </div>
    <div class="project-desc">${tailoredData.projectDescription}</div>
    <div class="project-tech">Tech: PyTorch, Temporal Fusion Transformer, Bidirectional Mamba, Stable-Baselines3, FastAPI, Hugging Face Spaces</div>
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
      console.log(`[tailor-engine] Tailored PDF generated successfully: ${destPdfPath}`);
    }
  } catch (err) {
    console.warn(`[tailor-engine] Playwright PDF compilation notice (HTML available): ${err.message}`);
  }

  const candidateAnswers = {
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
    whyInterested: tailoredData.formAnswers?.whyInterested || `I am excited to apply for the ${roleName} role at ${compName}. With my experience deploying edge-optimized YOLOv8/v9 models (92%+ mAP, sub-100ms latency) and multi-model AI architectures, I am eager to contribute to ${compName}'s engineering goals.`,
    relevantExperience: tailoredData.formAnswers?.relevantExperience || `At Mayonix Innovation, I developed on-device computer vision models with TensorFlow Lite and YOLOv8/v9, optimizing them via INT8/FP16 quantization for sub-100ms mobile latency. I also engineered AlphaSense AI, integrating PyTorch, Transformers, Mamba, and FastAPI.`,
    coverLetter: tailoredData.formAnswers?.coverLetter || `Dear Hiring Team at ${compName},\n\nI am writing to express my strong interest in the ${jobTitle} role. As a Machine Learning Engineer at Mayonix Innovation and published IEEE researcher, I specialize in computer vision, real-time object detection (YOLOv8/v9, 92%+ mAP), and edge model optimization (INT8/FP16 quantization, TensorRT, TFLite).\n\nMy background matches your requirements for high-performance ML engineering and latency-critical systems. I look forward to the opportunity to discuss how my hands-on experience can support ${compName}'s engineering goals.\n\nSincerely,\nPrakhar Pragyan Chaubey`,
    whyHireMe: tailoredData.formAnswers?.whyHireMe || `I combine practical production experience optimizing edge models to sub-100ms latencies with published IEEE research in machine learning. I can immediately contribute to ${compName}'s computer vision and ML pipelines.`
  };

  const copyAllText = `APPLICANT INFORMATION:
Name: ${candidateAnswers.fullName}
Email: ${candidateAnswers.email}
Phone: ${candidateAnswers.phone}
Location: ${candidateAnswers.location}
LinkedIn: ${candidateAnswers.linkedin}
GitHub: ${candidateAnswers.github}
Current Company: ${candidateAnswers.currentCompany}
Current Title: ${candidateAnswers.currentTitle}
Notice Period: ${candidateAnswers.noticePeriod}
Expected CTC: ${candidateAnswers.salaryExpectation}
Work Authorization: ${candidateAnswers.workAuth} (No sponsorship required)

WHY INTERESTED:
${candidateAnswers.whyInterested}

RELEVANT EXPERIENCE:
${candidateAnswers.relevantExperience}

WHY HIRE ME:
${candidateAnswers.whyHireMe}

COVER LETTER:
${candidateAnswers.coverLetter}`;

  const cleanAns = (str) => (str || "").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const bookmarklet = `javascript:(function(){var c={name:"${candidateAnswers.fullName}",first:"${candidateAnswers.firstName}",last:"${candidateAnswers.lastName}",email:"${candidateAnswers.email}",phone:"${candidateAnswers.phone}",city:"${candidateAnswers.city}",location:"${candidateAnswers.location}",linkedin:"${candidateAnswers.linkedin}",github:"${candidateAnswers.github}",portfolio:"${candidateAnswers.portfolio}",company:"${candidateAnswers.currentCompany}",title:"${candidateAnswers.currentTitle}",notice:"${candidateAnswers.noticePeriod}",salary:"${candidateAnswers.salaryExpectation}",why:"${cleanAns(candidateAnswers.whyInterested)}",exp:"${cleanAns(candidateAnswers.relevantExperience)}",cl:"${cleanAns(candidateAnswers.coverLetter)}"};var f=0;function fill(sel,val){if(!val)return;document.querySelectorAll(sel).forEach(function(el){if(!el.value||el.value.length===0){el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.style.border="2px solid #22c55e";el.style.backgroundColor="#f0fdf4";f++;}});}fill('input[name*="first_name" i],input[name*="firstName" i],input[id*="first_name" i],input[autocomplete="given-name"]',c.first);fill('input[name*="last_name" i],input[name*="lastName" i],input[id*="last_name" i],input[autocomplete="family-name"]',c.last);fill('input[name*="name" i]:not([name*="first" i]):not([name*="last" i]),input[id*="name" i]:not([id*="first" i]):not([id*="last" i]),input[autocomplete="name"]',c.name);fill('input[type="email"],input[name*="email" i],input[id*="email" i]',c.email);fill('input[type="tel"],input[name*="phone" i],input[id*="phone" i]',c.phone);fill('input[name*="city" i],input[id*="city" i]',c.city);fill('input[name*="location" i],input[id*="location" i]',c.location);fill('input[name*="linkedin" i],input[id*="linkedin" i],input[placeholder*="linkedin" i]',c.linkedin);fill('input[name*="github" i],input[id*="github" i],input[placeholder*="github" i]',c.github);fill('input[name*="portfolio" i],input[id*="portfolio" i],input[name*="website" i]',c.portfolio);fill('input[name*="company" i],input[id*="company" i]',c.company);fill('input[name*="title" i],input[id*="title" i]',c.title);fill('input[name*="notice" i],input[id*="notice" i]',c.notice);fill('input[name*="salary" i],input[id*="salary" i]',c.salary);document.querySelectorAll('input[type="radio"]').forEach(function(r){var t=((r.closest("label")||r.parentElement||{}).innerText||"").toLowerCase();var v=(r.value||"").toLowerCase();if(t.includes("authorized")||t.includes("right to work")){if(v==="yes"||v==="true"||t.includes("yes")){r.click();f++;}}if(t.includes("sponsorship")||t.includes("require visa")){if(v==="no"||v==="false"||t.includes("no")){r.click();f++;}}});document.querySelectorAll('textarea').forEach(function(ta){if(ta.value&&ta.value.length>5)return;var p=((ta.getAttribute("placeholder")||ta.getAttribute("aria-label")||(ta.closest("label,.form-group,div")||{}).innerText)||"").toLowerCase();if(p.includes("cover letter")||p.includes("note to hiring")){ta.value=c.cl;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));ta.style.border="2px solid #22c55e";f++;}else if(p.includes("why")&&(p.includes("role")||p.includes("company")||p.includes("interested"))){ta.value=c.why;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));ta.style.border="2px solid #22c55e";f++;}else if(p.includes("experience")||p.includes("background")){ta.value=c.exp;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));ta.style.border="2px solid #22c55e";f++;}});alert("✅ Job Pilot: Filled "+f+" fields on your screen!");})();`;

  return {
    success: true,
    jobId,
    jobTitle,
    company: compName,
    targetRole: roleName,
    headline: tailoredData.headline,
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

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
