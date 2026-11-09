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
