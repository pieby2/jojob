/**
 * social-projects.mjs — Searches real social/developer showcase posts for a role
 * and uses DeepSeek (with safe deterministic fallback) to summarize what each project was
 * and its description for the user.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map();

function getPythonBin() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  if (existsSync("/opt/venv/bin/python")) return "/opt/venv/bin/python";
  if (existsSync("/opt/venv/bin/python3")) return "/opt/venv/bin/python3";
  if (existsSync("/usr/bin/python3")) return "/usr/bin/python3";
  if (existsSync("/usr/bin/python")) return "/usr/bin/python";
  return process.platform === "win32" ? "python" : "python3";
}

function runPythonSocialSearch(query, platform = "all", timeoutMs = 22000) {
  return new Promise((resolve, reject) => {
    const pyBin = getPythonBin();
    const scriptPath = join(__dirname, "social_project_search.py");
    const py = spawn(pyBin, [scriptPath, "--query", query, "--platform", platform], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { py.kill("SIGTERM"); } catch {}
        reject(new Error("Social project search timed out"));
      }
    }, timeoutMs);

    py.stdout.on("data", (d) => (stdout += d.toString()));
    py.stderr.on("data", (d) => (stderr += d.toString()));

    py.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    py.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr || `social_project_search exited with ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Invalid JSON from social_project_search: ${e.message}`));
      }
    });
  });
}

async function enrichWithDeepSeek(items, roleQuery) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey || items.length === 0) return null;

  const compactInput = items.slice(0, 14).map((it, idx) => ({
    index: idx,
    platform: it.platform,
    postTitle: it.postTitle,
    rawDescription: (it.rawDescription || "").slice(0, 500),
    tags: it.tags || [],
  }));

  const prompt = `You are analyzing REAL social media & developer showcase posts fetched for someone researching projects for the role: "${roleQuery}".

Below is a JSON list of real posts/projects fetched from X/Twitter, LinkedIn, Hacker News, Dev.to, Hugging Face, and GitHub.
For EACH item, extract and clarify strictly from the provided text (DO NOT invent features or fake details):
1. "projectName": What the project was (clean, specific project title without clickbait/prefixes like "Show HN:").
2. "projectDescription": Clear 2-3 sentence description of what the project was, how it works, and what problem it solves based on the post text.
3. "roleRelevance": 1 crisp sentence explaining why showcasing a project like this is valuable for a "${roleQuery}" role.
4. "techTags": 2-5 tech/domain tags mentioned or clearly implied by the post.

Input items:
${JSON.stringify(compactInput)}

Return ONLY valid JSON array matching the indices:
[
  {
    "index": 0,
    "projectName": "...",
    "projectDescription": "...",
    "roleRelevance": "...",
    "techTags": ["..."]
  }
]`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 16000);
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 2500,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn("[social-projects] DeepSeek enrichment fallback:", err.message);
    return null;
  }
}

export async function searchRecommendedProjects(query = "Computer Vision Engineer", platform = "all") {
  const cleanQuery = (query || "Computer Vision Engineer").trim();
  const cleanPlatform = (platform || "all").trim().toLowerCase();
  const cacheKey = `${cleanQuery.toLowerCase()}|${cleanPlatform}`;

  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const rawResult = await runPythonSocialSearch(cleanQuery, cleanPlatform);
  const items = rawResult.items || [];

  const enrichedList = await enrichWithDeepSeek(items, cleanQuery);
  const enrichedByIndex = new Map();
  if (enrichedList) {
    for (const entry of enrichedList) {
      if (typeof entry?.index === "number") {
        enrichedByIndex.set(entry.index, entry);
      }
    }
  }

  const projects = items.map((it, idx) => {
    const ai = enrichedByIndex.get(idx);
    const fallbackName = (it.postTitle || "Showcased Project")
      .replace(/^Show HN:\s*/i, "")
      .trim();
    return {
      id: it.id,
      platform: it.platform,
      platformKey: it.platformKey,
      author: it.author,
      postTitle: it.postTitle,
      projectName: ai?.projectName || fallbackName,
      projectDescription: ai?.projectDescription || it.rawDescription || fallbackName,
      roleRelevance:
        ai?.roleRelevance ||
        `Demonstrates hands-on engineering & public proof-of-work aligned with ${cleanQuery} roles.`,
      techTags: (ai?.techTags && ai.techTags.length > 0 ? ai.techTags : it.tags || []).slice(0, 5),
      postUrl: it.postUrl,
      demoUrl: it.demoUrl || "",
      engagement: it.engagement || "",
      createdAt: it.createdAt || "",
      targetRole: cleanQuery,
    };
  });

  const payload = {
    query: cleanQuery,
    keywords: rawResult.keywords || cleanQuery,
    platform: cleanPlatform,
    count: projects.length,
    sources: rawResult.sources || {},
    socialSearchLinks: rawResult.socialSearchLinks || {},
    projects,
    searchedAt: new Date().toISOString(),
  };

  searchCache.set(cacheKey, { ts: Date.now(), data: payload });
  return payload;
}
