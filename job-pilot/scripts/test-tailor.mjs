import { generateJobSpecificResume } from "../lib/tailor-engine.mjs";
import { readFileSync, statSync, existsSync } from "fs";

async function run() {
  console.log("=== Testing Tailor Resume Function on Real Internet Job ===");
  const testJob = {
    jobId: "test-caseguard-cv-2026",
    jobTitle: "Machine Learning Engineer - Computer Vision",
    company: "CaseGuard",
    targetRole: "Computer Vision Engineer",
    description: `About the Role:
CaseGuard is seeking a talented Machine Learning Engineer - Computer Vision to design, develop, and deploy computer vision models tailored for image and video processing tasks such as object detection, object tracking, video segmentation, and facial recognition.

Responsibilities:
- Design, develop, and deploy computer vision models tailored for image and video processing tasks such as object detection, object tracking, video segmentation, and facial recognition.
- Optimize and fine-tune deep learning algorithms to achieve real-time performance on edge and cloud environments.
- Clean, preprocess, and manage large-scale datasets for model training and evaluation using OpenCV and NumPy.
- Deploy machine learning models into production environments, ensuring reliability, scalability, and performance tracking using ONNX, Triton, and Docker.
- Collaborate with software engineering teams in Python and C++ to integrate AI-driven vision solutions into core product offerings.

Qualifications:
- Bachelor's or Master's in Computer Science or related field.
- Strong proficiency in Python and C++.
- Hands-on experience with PyTorch, TensorFlow, OpenCV, YOLO, and semantic segmentation (U-Net).
- Experience with model optimization, quantization (INT8/FP16), ONNX, and latency reduction for real-time video analytics.`
  };

  const startTime = Date.now();
  const res = await generateJobSpecificResume(testJob);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nExecution completed in ${elapsed} seconds.`);
  console.log("Response summary:");
  console.log("- Success:", res.success);
  console.log("- Job Title:", res.jobTitle);
  console.log("- Company:", res.company);
  console.log("- Target Role:", res.targetRole);
  console.log("- Custom Headline:", res.headline);
  console.log("- HTML file:", res.htmlFile, "Path:", res.destHtmlPath);
  console.log("- PDF file:", res.pdfFile, "Path:", res.destPdfPath);
  console.log("- Has PDF:", res.hasPdf);

  // Verify HTML file
  if (existsSync(res.destHtmlPath)) {
    const htmlStats = statSync(res.destHtmlPath);
    console.log(`- HTML exists: ${htmlStats.size} bytes`);
  } else {
    console.error("- HTML does NOT exist!");
  }

  // Verify PDF file
  if (existsSync(res.destPdfPath)) {
    const pdfStats = statSync(res.destPdfPath);
    const pdfHeader = readFileSync(res.destPdfPath).slice(0, 5).toString("utf-8");
    console.log(`- PDF exists: ${pdfStats.size} bytes, Header: '${pdfHeader}'`);
  } else {
    console.error("- PDF does NOT exist!");
  }

  console.log("\n--- Screening Form Answers Generated ---");
  console.log("Why Interested:\n", res.formAnswers?.whyInterested);
  console.log("\nRelevant Experience:\n", res.formAnswers?.relevantExperience);
  console.log("\nWhy Hire Me:\n", res.formAnswers?.whyHireMe);
  console.log("\nCover Letter Snippet:\n", res.formAnswers?.coverLetter?.substring(0, 200) + "...");
}

run().catch(console.error);
