/**
 * DeepSeek API helper — evaluates jobs and generates application answers.
 */

const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
const API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

async function callDeepSeek(messages, temperature = 0.4) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: 2048 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Evaluate a job description against the candidate's CV.
 * Returns { score, verdict, summary, strengths, gaps }
 */
export async function evaluateJob(jobTitle, company, description, cvText) {
  const prompt = `You are a career advisor. Evaluate how well this candidate matches the job.

## Candidate CV
${cvText}

## Job
**Title:** ${jobTitle}
**Company:** ${company}
**Description:**
${description}

## Instructions
Rate the match from 1.0 to 5.0 (one decimal). Return ONLY valid JSON:
{
  "score": 4.2,
  "verdict": "APPLY" or "SKIP" or "STRETCH",
  "summary": "2-3 sentence match summary",
  "strengths": ["strength1", "strength2", "strength3"],
  "gaps": ["gap1", "gap2"]
}`;

  const raw = await callDeepSeek([{ role: "user", content: prompt }]);
  try {
    // Extract JSON from possible markdown code block
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return { score: 0, verdict: "ERROR", summary: raw, strengths: [], gaps: [] };
  }
}

/**
 * Generate application answers — cover letter + screening question answers.
 */
export async function generateAnswers(jobTitle, company, description, cvText) {
  const prompt = `You are a career coach helping a candidate apply for a job. Generate tailored application materials.

## Candidate CV
${cvText}

## Job
**Title:** ${jobTitle}
**Company:** ${company}
**Description:**
${description}

## Instructions
Generate application materials. Return ONLY valid JSON:
{
  "coverLetter": "A concise, compelling 3-paragraph cover letter tailored to this specific role. Be specific about matching skills.",
  "whyInterested": "2-3 sentences for 'Why are you interested in this role?'",
  "whyHireMe": "2-3 sentences for 'Why should we hire you?'",
  "relevantExperience": "2-3 sentences highlighting most relevant experience",
  "salaryExpectation": "A diplomatic answer about salary expectations for the Indian market",
  "availability": "Available to start immediately / within 2 weeks"
}`;

  const raw = await callDeepSeek([{ role: "user", content: prompt }], 0.5);
  try {
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return { coverLetter: raw, whyInterested: "", whyHireMe: "", relevantExperience: "", salaryExpectation: "", availability: "" };
  }
}

/**
 * Generate technical interview prep cheat sheet tailored to the job and candidate.
 */
export async function generateInterviewPrep(jobTitle, company, description, cvText) {
  const prompt = `You are a Principal AI & Computer Vision Staff Engineer interviewing this candidate for this exact job.
Generate an actionable, high-yield technical interview preparation cheat sheet.

## Candidate CV
${cvText}

## Target Job
**Title:** ${jobTitle}
**Company:** ${company}
**Description:**
${description}

## Instructions
Generate tailored technical interview prep. Return ONLY valid JSON:
{
  "summary": "1-2 sentence core technical focus of this interview (e.g. edge inference latency vs accuracy, TensorRT optimization, YOLO architectures)",
  "technicalQuestions": [
    {
      "question": "Deep technical question #1 they are likely to ask based on this JD",
      "whyTheyAsk": "What the interviewer is evaluating",
      "suggestedAnswer": "How to answer with confidence, referencing specific facts from the candidate's CV (e.g. Mayonix INT8/FP16 quantization, sub-100ms latency, YOLOv8/v9 92%+ mAP, IEEE papers, AlphaSense)"
    },
    {
      "question": "Deep technical question #2 based on their tech stack",
      "whyTheyAsk": "What the interviewer is evaluating",
      "suggestedAnswer": "Detailed answer connecting CV skills to their problem"
    },
    {
      "question": "Deep technical question #3 based on their tech stack",
      "whyTheyAsk": "What the interviewer is evaluating",
      "suggestedAnswer": "Detailed answer connecting CV skills to their problem"
    }
  ],
  "systemDesignScenario": {
    "scenario": "A real-world edge/cloud ML design problem relevant to this company",
    "approach": "Key architecture steps: data pipeline, model quantization (INT8/FP16), TensorRT/TFLite/ONNX acceleration, FastAPI/Docker serving, real-world monitoring"
  },
  "questionsForInterviewer": [
    "High-impact question #1 to ask the interviewer to demonstrate technical depth",
    "High-impact question #2 about their deployment constraints and edge hardware",
    "High-impact question #3 about their model iteration and production feedback loops"
  ]
}`;

  const raw = await callDeepSeek([{ role: "user", content: prompt }], 0.4);
  try {
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return {
      summary: "Interview prep generated",
      technicalQuestions: [],
      systemDesignScenario: { scenario: "", approach: "" },
      questionsForInterviewer: []
    };
  }
}

/**
 * Generate cold outreach messages (LinkedIn connection note, InMail, and Cold Email).
 */
export async function generateColdOutreach(jobTitle, company, description, cvText) {
  const prompt = `You are an executive tech recruiter and founder advisor. Write ultra-high-converting cold outreach messages for this candidate to send directly to founders, engineering directors, or tech recruiters at this company.

Rules:
- Be punchy, direct, and zero-fluff. Never use generic corporate openers like 'I hope this email finds you well'.
- Lead with high-impact proof of work and concrete metrics from candidate's CV (e.g., 92%+ mAP with YOLOv8/v9, sub-100ms mobile TensorRT/TFLite quantization, published IEEE papers).
- Include clear call to action.

## Candidate CV
${cvText}

## Target Job
**Title:** ${jobTitle}
**Company:** ${company}
**Description:**
${description}

## Instructions
Generate cold outreach templates. Return ONLY valid JSON:
{
  "linkedinNote": "Punchy LinkedIn connection request note under 280 characters with hook and metrics.",
  "linkedinInMail": "Concise 3-paragraph direct message for LinkedIn InMail or Twitter/X DM.",
  "emailSubject": "Compelling, high-open-rate email subject line (e.g. 'CV/Edge AI Engineer — 92% mAP / sub-100ms inference')",
  "emailBody": "3-paragraph cold email tailored specifically to this role and company.",
  "followUp": "1-sentence polite check-in message to send 5 days later if no reply."
}`;

  const raw = await callDeepSeek([{ role: "user", content: prompt }], 0.5);
  try {
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch {
    return {
      linkedinNote: "",
      linkedinInMail: raw,
      emailSubject: `Application for ${jobTitle}`,
      emailBody: raw,
      followUp: ""
    };
  }
}
