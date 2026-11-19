import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateJobSpecificResume } from "../lib/tailor-engine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOBS_FILE = join(__dirname, "..", "data", "jobs.json");

async function injectAndTailorLiveJob() {
  console.log("Loading jobs from", JOBS_FILE);
  const jobs = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));

  const caseGuardJobId = "caseguard-cv-2026";
  let existingIndex = jobs.findIndex(j => j._id === caseGuardJobId || j.id === caseGuardJobId);

  const jobObj = {
    id: caseGuardJobId,
    site: "greenhouse",
    job_url: "https://boards.greenhouse.io/caseguard/jobs/4329012",
    job_url_direct: "https://boards.greenhouse.io/caseguard",
    title: "Machine Learning Engineer - Computer Vision",
    company: "CaseGuard",
    location: "Arlington, VA (Remote / Hybrid Eligible)",
    date_posted: new Date().toISOString().split("T")[0],
    job_type: "fulltime",
    is_remote: true,
    description: `About CaseGuard:
CaseGuard is an innovative leader in AI-driven media redaction and computer vision intelligence software. We serve law enforcement, federal agencies, healthcare organizations, and educational institutions worldwide.

Role Overview:
We are looking for a Machine Learning Engineer - Computer Vision to develop, train, and deploy real-time vision algorithms across video and image modalities.

Key Responsibilities:
- Design, develop, and deploy computer vision models tailored for image and video processing tasks such as object detection, object tracking, video segmentation, and facial recognition.
- Optimize and fine-tune deep learning algorithms to achieve real-time performance on edge and cloud environments.
- Clean, preprocess, and manage large-scale datasets for model training and evaluation using OpenCV and NumPy.
- Deploy machine learning models into production environments, ensuring reliability, scalability, and performance tracking using ONNX, Triton, and Docker.
- Collaborate closely with software engineering, backend, and product teams in Python and C++ to integrate AI-driven vision solutions into core product offerings.

Required Qualifications:
- Bachelor's or Master's degree in Computer Science, Artificial Intelligence, or a related field.
- Strong proficiency in Python and C++.
- Deep experience with PyTorch, TensorFlow, OpenCV, and YOLO object detection models.
- Hands-on experience with semantic segmentation (U-Net) and edge optimization (INT8/FP16 quantization, TensorRT/ONNX).
- 1-3 years of relevant machine learning and computer vision engineering experience.`,
    company_url: "https://caseguard.com",
    company_rating: 4.6,
    _id: caseGuardJobId,
    _status: "new",
    _scannedAt: new Date().toISOString(),
    target_role: "Computer Vision Engineer",
    experience_required: "1-3 yrs",
    experience_min: 1,
    experience_max: 3,
    experience_level: "entry",
    experience_match: "Good Match (1-3 yrs)"
  };

  console.log(`[test] Tailoring personal resume specifically for ${jobObj.company} — ${jobObj.title}...`);
  const tailored = await generateJobSpecificResume({
    jobId: caseGuardJobId,
    jobTitle: jobObj.title,
    company: jobObj.company,
    description: jobObj.description,
    targetRole: jobObj.target_role
  });

  jobObj._tailoredResume = tailored;
  jobObj._customQuestions = [
    {
      question: "Why are you interested in joining CaseGuard?",
      answer: tailored.formAnswers.whyInterested
    },
    {
      question: "Describe your relevant computer vision experience.",
      answer: tailored.formAnswers.relevantExperience
    },
    {
      question: "Why should we hire you for this role?",
      answer: tailored.formAnswers.whyHireMe
    }
  ];

  if (existingIndex >= 0) {
    jobs[existingIndex] = jobObj;
    console.log(`Updated existing job entry at index ${existingIndex}`);
  } else {
    // Put at top of list so it is immediately prominent
    jobs.unshift(jobObj);
    console.log(`Added new job entry at top of list (total jobs: ${jobs.length})`);
  }

  writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
  console.log("Successfully wrote updated jobs.json!");
  console.log("Tailored result:", {
    jobId: tailored.jobId,
    headline: tailored.headline,
    hasPdf: tailored.hasPdf,
    pdfPath: tailored.destPdfPath,
    htmlPath: tailored.destHtmlPath
  });
}

injectAndTailorLiveJob().catch(console.error);
