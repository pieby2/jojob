/**
 * form-autofiller.mjs — Autonomous Job Application Form Auto-Filler
 *
 * Uses Playwright Chromium (headed mode) to:
 * 1. Open the job application page
 * 2. Auto-fill personal details (Name, Email, Phone, Location, URLs)
 * 3. Attach the tailored PDF resume
 * 4. Detect screening questions / textareas and generate tailored answers with DeepSeek + cv.md
 * 5. Highlight filled fields in green and show a safety review banner
 * 6. STOP before submit so the candidate can inspect and submit with peace of mind.
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { answerFormQuestions } from "./deepseek.mjs";

// Dynamically resolve Playwright
async function getPlaywrightChromium() {
  try {
    const pw = await import("playwright");
    return pw.chromium;
  } catch {
    const pw = await import("../../career-ops/node_modules/playwright/index.mjs");
    return pw.chromium;
  }
}

function loadCandidateProfile() {
  const profilePath = join(process.cwd(), "..", "career-ops", "config", "profile.yml");
  const candidate = {
    fullName: "Prakhar Pragyan Chaubey",
    firstName: "Prakhar Pragyan",
    lastName: "Chaubey",
    email: "prakharpragyan1000@gmail.com",
    phone: "+91-8853511579",
    phoneWithoutPlus: "8853511579",
    location: "Ghaziabad, Uttar Pradesh, India",
    city: "Ghaziabad",
    country: "India",
    linkedin: "https://linkedin.com/in/prakhar-b045b91ab",
    github: "https://github.com/pieby2",
    portfolio: "https://github.com/pieby2",
    currentCompany: "Mayonix Innovation",
    currentTitle: "Machine Learning Engineer",
    noticePeriod: "Immediately available (within 15-30 days)",
    salaryExpectation: "₹15,00,000 INR",
    workAuth: "Yes",
    sponsorship: "No",
  };

  if (existsSync(profilePath)) {
    try {
      const yaml = readFileSync(profilePath, "utf-8");
      const nameMatch = yaml.match(/full_name:\s*["']?([^"'\n]+)/);
      if (nameMatch) {
        candidate.fullName = nameMatch[1].trim();
        const parts = candidate.fullName.split(" ");
        candidate.lastName = parts.pop();
        candidate.firstName = parts.join(" ");
      }
      const emailMatch = yaml.match(/email:\s*["']?([^"'\n]+)/);
      if (emailMatch) candidate.email = emailMatch[1].trim();
      const phoneMatch = yaml.match(/phone:\s*["']?([^"'\n]+)/);
      if (phoneMatch) candidate.phone = phoneMatch[1].trim();
      const locMatch = yaml.match(/location:\s*["']?([^"'\n]+)/);
      if (locMatch) candidate.location = locMatch[1].trim();
      const liMatch = yaml.match(/linkedin:\s*["']?([^"'\n]+)/);
      if (liMatch) candidate.linkedin = liMatch[1].trim();
      const ghMatch = yaml.match(/github:\s*["']?([^"'\n]+)/);
      if (ghMatch) candidate.github = ghMatch[1].trim();
    } catch { /* use defaults */ }
  }

  return candidate;
}

function loadCandidateCv() {
  const cvPath = join(process.cwd(), "..", "career-ops", "cv.md");
  if (existsSync(cvPath)) return readFileSync(cvPath, "utf-8");
  return "";
}

/**
 * Launch browser, navigate to application page, and auto-fill details + custom questions.
 */
export async function autofillJobApplication({ job, resumePdfPath }) {
  const url = job.job_url || job.link;
  if (!url) {
    throw new Error("Job has no application URL.");
  }

  const chromium = await getPlaywrightChromium();
  const candidate = loadCandidateProfile();
  const cvText = loadCandidateCv();

  const isHeadless = Boolean(process.env.RENDER || process.platform === "linux" || !process.env.DISPLAY);
  console.log(`[autofill] Launching Chromium (headless: ${isHeadless}) for ${job.company || "Job"} at ${url}...`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--start-maximized"],
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const filledFields = [];
  const answeredQuestions = [];

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    // If there is an obvious "Apply" / "Apply for this job" / "Apply now" button that hasn't opened form, click it
    try {
      const applyBtn = await page.$(
        'a:has-text("Apply Now"), button:has-text("Apply Now"), a:has-text("Apply for this job"), button:has-text("Apply for this job"), a:has-text("Apply"), button:has-text("Apply")'
      );
      if (applyBtn && await applyBtn.isVisible()) {
        const text = (await applyBtn.textContent()) || "";
        if (!text.toLowerCase().includes("applied")) {
          console.log(`[autofill] Clicking apply button: "${text.trim()}"`);
          await applyBtn.click();
          await page.waitForTimeout(2500);
        }
      }
    } catch { /* proceed */ }

    // Helper to fill and record
    async function tryFill(selector, value, fieldLabel) {
      try {
        const el = await page.$(selector);
        if (el && await el.isVisible()) {
          const currentVal = await el.inputValue().catch(() => "");
          if (!currentVal) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await el.fill(value);
            await el.evaluate((node) => {
              node.style.border = "2px solid #22c55e";
              node.style.boxShadow = "0 0 8px rgba(34, 197, 94, 0.4)";
              node.style.backgroundColor = "#f0fdf4";
            }).catch(() => {});
            filledFields.push({ field: fieldLabel, value });
            console.log(`[autofill] Filled ${fieldLabel}: ${value}`);
            return true;
          }
        }
      } catch { /* ignore */ }
      return false;
    }

    // 1. Fill First Name and Last Name
    const firstNameFilled = await tryFill('input[name*="first_name" i], input[name*="firstName" i], input[id*="first_name" i], input[autocomplete="given-name"]', candidate.firstName, "First Name");
    const lastNameFilled = await tryFill('input[name*="last_name" i], input[name*="lastName" i], input[id*="last_name" i], input[autocomplete="family-name"]', candidate.lastName, "Last Name");

    // If separate fields not found, try Full Name
    if (!firstNameFilled || !lastNameFilled) {
      await tryFill('input[name*="name" i]:not([name*="first" i]):not([name*="last" i]), input[id*="name" i]:not([id*="first" i]):not([id*="last" i]), input[autocomplete="name"]', candidate.fullName, "Full Name");
    }

    // 2. Fill Email
    await tryFill('input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]', candidate.email, "Email");

    // 3. Fill Phone
    const phoneFilled = await tryFill('input[type="tel"], input[name*="phone" i], input[id*="phone" i], input[autocomplete="tel"]', candidate.phone, "Phone");
    if (!phoneFilled) {
      await tryFill('input[name*="mobile" i], input[id*="mobile" i]', candidate.phoneWithoutPlus, "Mobile");
    }

    // 4. Fill Location / City
    await tryFill('input[name*="city" i], input[id*="city" i], input[autocomplete="address-level2"]', candidate.city, "City");
    await tryFill('input[name*="location" i], input[id*="location" i]', candidate.location, "Location");

    // 5. Fill URLs (LinkedIn, GitHub, Portfolio)
    await tryFill('input[name*="linkedin" i], input[id*="linkedin" i], input[placeholder*="linkedin" i]', candidate.linkedin, "LinkedIn URL");
    await tryFill('input[name*="github" i], input[id*="github" i], input[placeholder*="github" i]', candidate.github, "GitHub URL");
    await tryFill('input[name*="website" i], input[id*="website" i], input[name*="portfolio" i], input[id*="portfolio" i], input[placeholder*="portfolio" i]', candidate.portfolio, "Portfolio URL");

    // 6. Fill Current Role / Current Company
    await tryFill('input[name*="current_company" i], input[id*="current_company" i], input[placeholder*="current company" i]', candidate.currentCompany, "Current Company");
    await tryFill('input[name*="current_title" i], input[id*="current_title" i], input[placeholder*="job title" i]', candidate.currentTitle, "Current Title");

    // 7. Attach Resume File (Tailored PDF)
    let resumePath = resumePdfPath;
    if (!resumePath || !existsSync(resumePath)) {
      // Look in career-ops/output for the latest PDF
      const outDir = join(process.cwd(), "..", "career-ops", "output");
      if (existsSync(outDir)) {
        const pdfs = (await import("fs")).readdirSync(outDir).filter((f) => f.endsWith(".pdf"));
        if (pdfs.length > 0) {
          resumePath = join(outDir, pdfs[pdfs.length - 1]);
        }
      }
    }

    if (resumePath && existsSync(resumePath)) {
      try {
        const fileInput = await page.$('input[type="file"][name*="resume" i], input[type="file"][id*="resume" i], input[type="file"][accept*="pdf" i], input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(resumePath);
          filledFields.push({ field: "Resume File (PDF)", value: resumePath.split(/[\\/]/).pop() });
          console.log(`[autofill] Attached tailored resume: ${resumePath}`);
        }
      } catch (err) {
        console.warn("[autofill] Resume file upload warning:", err.message);
      }
    }

    // 8. Handle Standard Radios / Checkboxes (Work Authorization, Sponsorship, Notice Period)
    try {
      const radios = await page.$$('input[type="radio"]');
      for (const radio of radios) {
        const labelText = await page.evaluate((el) => {
          const parent = el.closest("label") || el.closest(".form-group") || el.closest("fieldset") || el.parentElement;
          return parent ? parent.innerText : "";
        }, radio);

        const lowerLabel = labelText.toLowerCase();
        const radioVal = (await radio.getAttribute("value") || "").toLowerCase();

        // Work authorization: "Are you authorized to work in [Country]?" -> YES
        if (lowerLabel.includes("authorized") || lowerLabel.includes("legally eligible") || lowerLabel.includes("right to work")) {
          if (radioVal === "yes" || radioVal === "true" || lowerLabel.includes("yes")) {
            await radio.check().catch(() => {});
            filledFields.push({ field: "Work Authorization", value: "Yes" });
          }
        }

        // Sponsorship: "Will you require visa sponsorship?" -> NO
        if (lowerLabel.includes("sponsorship") || lowerLabel.includes("require visa")) {
          if (radioVal === "no" || radioVal === "false" || lowerLabel.includes("no")) {
            await radio.check().catch(() => {});
            filledFields.push({ field: "Visa Sponsorship", value: "No" });
          }
        }
      }
    } catch { /* proceed */ }

    // 9. Detect Screening Questions and Textareas
    const textareas = await page.$$("textarea");
    console.log(`[autofill] Found ${textareas.length} textarea elements.`);

    for (const ta of textareas) {
      try {
        if (!await ta.isVisible()) continue;
        const currentVal = await ta.inputValue().catch(() => "");
        if (currentVal && currentVal.length > 5) continue; // Already filled

        // Get question prompt from label, aria-label, placeholder, or previous header
        const questionPrompt = await page.evaluate((el) => {
          const aria = el.getAttribute("aria-label") || el.getAttribute("placeholder");
          if (aria && aria.length > 10) return aria;

          const id = el.getAttribute("id");
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label && label.innerText.trim().length > 5) return label.innerText.trim();
          }

          const parent = el.closest(".form-group, .field, .question, label, div");
          if (parent) {
            const label = parent.querySelector("label, h3, h4, .label, p");
            if (label && label.innerText.trim().length > 5) return label.innerText.trim();
            const text = parent.innerText.split("\n")[0].trim();
            if (text.length > 5 && text.length < 200) return text;
          }
          return el.getAttribute("name") || "General Screening Question";
        }, ta);

        console.log(`[autofill] Generating tailored answer for question: "${questionPrompt}"`);

        // Check if report Section H already has an answer
        let answerText = "";
        const reportAnswers = job._evaluation?.answers || {};
        for (const [qKey, aVal] of Object.entries(reportAnswers)) {
          if (questionPrompt.toLowerCase().includes(qKey.toLowerCase()) || qKey.toLowerCase().includes(questionPrompt.toLowerCase())) {
            answerText = aVal;
            break;
          }
        }

        // If not found in report, ask DeepSeek
        if (!answerText) {
          const aiAnswers = await answerFormQuestions([questionPrompt], job.title, job.company_name || job.company, job.description, cvText);
          if (aiAnswers.length > 0 && aiAnswers[0].answer) {
            answerText = aiAnswers[0].answer;
          }
        }

        if (answerText) {
          await ta.scrollIntoViewIfNeeded().catch(() => {});
          await ta.fill(answerText);
          await ta.evaluate((node) => {
            node.style.border = "2px solid #22c55e";
            node.style.boxShadow = "0 0 8px rgba(34, 197, 94, 0.4)";
            node.style.backgroundColor = "#f0fdf4";
          }).catch(() => {});

          answeredQuestions.push({ question: questionPrompt, answer: answerText });
          console.log(`[autofill] Answered: "${questionPrompt.substring(0, 40)}..."`);
        }
      } catch (err) {
        console.warn("[autofill] Textarea answer error:", err.message);
      }
    }

    // 10. Inject Job Pilot Safety Banner into the page
    await page.evaluate(({ filledCount, qCount }) => {
      const existing = document.getElementById("jobpilot-banner");
      if (existing) existing.remove();

      const banner = document.createElement("div");
      banner.id = "jobpilot-banner";
      banner.innerHTML = `
        <div style="position:fixed;top:0;left:0;right:0;z-index:9999999;background:#0f172a;color:#f8fafc;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);border-bottom:3px solid #22c55e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="background:#22c55e;color:#0f172a;font-weight:800;padding:4px 10px;border-radius:6px;font-size:13px;letter-spacing:0.5px;">JOB PILOT</div>
            <div style="font-size:14px;font-weight:600;">
              ✅ Auto-Filled: <span style="color:#4ade80;">${filledCount} personal fields</span> and <span style="color:#38bdf8;">${qCount} screening questions</span>.
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-size:12.5px;color:#cbd5e1;background:#1e293b;padding:6px 14px;border-radius:6px;border:1px solid #334155;">
              🛡️ <strong>Safety Check:</strong> Review highlighted fields &amp; click <strong>Submit Application</strong> below when ready.
            </div>
          </div>
        </div>
      `;
      document.body.prepend(banner);
      document.body.style.paddingTop = "60px";
    }, { filledCount: filledFields.length, qCount: answeredQuestions.length }).catch(() => {});

    console.log(`[autofill] Finished auto-filling! Filled ${filledFields.length} fields and answered ${answeredQuestions.length} questions.`);

    let screenshotBase64 = null;
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 75, fullPage: false });
      screenshotBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
    } catch (e) {
      console.warn("[autofill] Screenshot capture notice:", e.message);
    }

    if (isHeadless) {
      await browser.close().catch(() => {});
    }

    return {
      success: true,
      url,
      isHeadless,
      screenshot: screenshotBase64,
      filledFields,
      answeredQuestions,
      message: isHeadless
        ? `Cloud auto-fill complete! Filled ${filledFields.length} candidate fields and answered ${answeredQuestions.length} questions on the portal.`
        : `Successfully auto-filled ${filledFields.length} candidate fields and ${answeredQuestions.length} custom questions in your open browser window. Please inspect and submit!`,
    };
  } catch (err) {
    console.error("[autofill] Form filling error:", err.message);
    throw err;
  }
}
