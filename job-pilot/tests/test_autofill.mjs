import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { autofillJobApplication } from "../lib/form-autofiller.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Create a realistic ATS HTML application form
const sampleAtsHtml = `<!DOCTYPE html>
<html>
<head><title>Job Application - Machine Learning Engineer</title></head>
<body>
  <h1>Apply for Machine Learning Engineer at VisionTech</h1>
  <form id="job-app-form">
    <div class="form-group">
      <label for="first_name">First Name</label>
      <input type="text" id="first_name" name="first_name">
    </div>
    <div class="form-group">
      <label for="last_name">Last Name</label>
      <input type="text" id="last_name" name="last_name">
    </div>
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email">
    </div>
    <div class="form-group">
      <label for="phone">Phone Number</label>
      <input type="tel" id="phone" name="phone">
    </div>
    <div class="form-group">
      <label for="location">Location / City</label>
      <input type="text" id="location" name="location">
    </div>
    <div class="form-group">
      <label for="linkedin">LinkedIn Profile URL</label>
      <input type="text" id="linkedin" name="urls[linkedin]">
    </div>
    <div class="form-group">
      <label for="github">GitHub Profile URL</label>
      <input type="text" id="github" name="urls[github]">
    </div>
    <div class="form-group">
      <label for="resume">Attach Resume (PDF)</label>
      <input type="file" id="resume" name="resume" accept=".pdf">
    </div>
    <fieldset>
      <legend>Are you legally authorized to work in India?</legend>
      <label><input type="radio" name="work_auth" value="yes"> Yes</label>
      <label><input type="radio" name="work_auth" value="no"> No</label>
    </fieldset>
    <fieldset>
      <legend>Will you now or in the future require visa sponsorship?</legend>
      <label><input type="radio" name="sponsorship" value="yes"> Yes</label>
      <label><input type="radio" name="sponsorship" value="no"> No</label>
    </fieldset>
    <div class="form-group">
      <label for="why_interested">Why are you interested in this Machine Learning Engineer role?</label>
      <textarea id="why_interested" name="why_interested" rows="4"></textarea>
    </div>
    <div class="form-group">
      <label for="edge_exp">Describe your hands-on experience optimizing computer vision models for edge devices.</label>
      <textarea id="edge_exp" name="edge_exp" rows="4"></textarea>
    </div>
    <button type="submit" id="btn-submit">Submit Application</button>
  </form>
</body>
</html>`;

const tempFormPath = join(__dirname, "test-form.html");
writeFileSync(tempFormPath, sampleAtsHtml, "utf-8");

const mockJob = {
  _id: "test-mock-job",
  title: "Machine Learning Engineer",
  company_name: "VisionTech Labs",
  company: "VisionTech Labs",
  description: "Looking for an ML Engineer with YOLOv8, PyTorch, and TensorRT optimization experience.",
  job_url: `file://${tempFormPath.replace(/\\/g, "/")}`,
};

const pdfPath = join(__dirname, "..", "data", "resumes", "resume-mw9qdyz5ovb7v.pdf");

console.log("Running Playwright Form Autofill Test...");
autofillJobApplication({ job: mockJob, resumePdfPath: pdfPath })
  .then((res) => {
    console.log("=== AUTOFILL TEST RESULTS ===");
    console.log("Success:", res.success);
    console.log("Filled fields count:", res.filledFields.length);
    res.filledFields.forEach((f) => console.log(`  - ${f.field}: ${f.value}`));
    console.log("Answered questions count:", res.answeredQuestions.length);
    res.answeredQuestions.forEach((q) => console.log(`  - Q: "${q.question}"\n    A: "${q.answer.substring(0, 100)}..."`));
    setTimeout(() => {
      try { unlinkSync(tempFormPath); } catch {}
      process.exit(0);
    }, 4000);
  })
  .catch((err) => {
    console.error("Test error:", err);
    try { unlinkSync(tempFormPath); } catch {}
    process.exit(1);
  });
