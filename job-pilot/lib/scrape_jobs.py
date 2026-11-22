#!/usr/bin/env python3
"""
Job scraper combining JobSpy, Wellfound, and Y Combinator (Work at a Startup),
integrated with ai-job-search posting_guard and accurate multi-portal experience parsing.

Supported sites:
- indeed, linkedin, naukri, glassdoor, zip_recruiter (via JobSpy)
- wellfound (AngelList Talent startup jobs)
- yc (Y Combinator Work at a Startup)
"""

import sys
import os
import re
import json
import argparse
from datetime import datetime

# Integrate ai-job-search tools
AI_JOB_SEARCH_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ai-job-search"))
if AI_JOB_SEARCH_DIR not in sys.path:
    sys.path.insert(0, AI_JOB_SEARCH_DIR)

try:
    from tools.posting_guard import guard as posting_guard
except ImportError:
    posting_guard = None

# Integrate startup scrapers
sys.path.insert(0, os.path.dirname(__file__))
from startup_scrapers import scrape_wellfound, scrape_yc

from jobspy import scrape_jobs


def detect_job_role(title="", desc=""):
    """Detect matching candidate target role category from title and description."""
    t = f"{title} {desc}".lower()
    if any(k in t for k in ["computer vision", "opencv", "yolo", "image processing", "perception", "segmentation", "camera", "video analytics"]):
        return "Computer Vision Engineer"
    if any(k in t for k in ["edge ai", "embedded ml", "tensorrt", "tflite", "quantization", "on-device", "edge device", "sub-100ms", "cuda"]):
        return "Edge AI / Embedded ML Engineer"
    if any(k in t for k in ["deep learning", "neural network", "transformer", "diffusion", "llm", "large language", "generative ai"]):
        return "Deep Learning / Generative AI Engineer"
    if any(k in t for k in ["mlops", "model serving", "triton", "pipeline", "infrastructure", "kubeflow"]):
        return "MLOps / AI Platform Engineer"
    if any(k in t for k in ["machine learning", "ml engineer", "data scientist"]):
        return "Machine Learning Engineer"
    if any(k in t for k in ["data engineer", "etl", "spark", "sql", "airflow"]):
        return "Data / ML Systems Engineer"
    if any(k in t for k in ["full stack", "software engineer", "backend", "python developer", "developer"]):
        return "Software / AI Systems Engineer"
    return "Machine Learning / AI Engineer"


def detect_experience(job_record):
    """
    Extract exact years of experience required from native portal fields,
    URL slugs (e.g., Naukri 4-to-7-years), title seniority keywords, and JD text.
    Handles Unicode en-dash, em-dash, and never falls back to hallucinated values.
    """
    title = str(job_record.get("title") or "")
    desc = str(job_record.get("description") or "")
    url = str(job_record.get("job_url") or job_record.get("link") or "")

    # 0. Native fields from portal (Wellfound, etc.)
    w_min = job_record.get("yearsExperienceMin")
    w_max = job_record.get("yearsExperienceMax")
    if w_min is not None or w_max is not None:
        if w_min is not None and w_max is not None:
            lvl = "entry" if w_max <= 2 else ("mid" if w_min < 5 else "senior")
            badge = "Ideal Match (0-2 yrs)" if w_min <= 1 else ("Good Match (1-3 yrs)" if w_min <= 2 else ("Mid Level (3-5 yrs)" if w_min < 5 else "Senior Level (5+ yrs)"))
            return {"text": f"{w_min}-{w_max} yrs", "min": w_min, "max": w_max, "level": lvl, "matchBadge": badge}
        elif w_min is not None:
            lvl = "entry" if w_min <= 2 else ("mid" if w_min < 5 else "senior")
            badge = "Ideal Match (0-2 yrs)" if w_min <= 1 else ("Good Match (1-3 yrs)" if w_min <= 2 else ("Mid Level (3-5 yrs)" if w_min < 5 else "Senior Level (5+ yrs)"))
            return {"text": f"{w_min}+ yrs", "min": w_min, "max": w_min + 3, "level": lvl, "matchBadge": badge}

    # 1. URL slug range (e.g., Naukri '4-to-7-years', '9-to-13-years')
    url_m = re.search(r"(\d+)-to-(\d+)-years", url, re.IGNORECASE)
    if url_m:
        mn = int(url_m.group(1))
        mx = int(url_m.group(2))
        lvl = "entry" if mx <= 2 else ("senior" if mn >= 5 else "mid")
        badge = "Ideal Match (0-2 yrs)" if mn <= 1 else ("Good Match (1-3 yrs)" if mn <= 2 else ("Senior Level (5+ yrs)" if mn >= 5 else "Mid Level (3-5 yrs)"))
        return {"text": f"{mn}-{mx} yrs", "min": mn, "max": mx, "level": lvl, "matchBadge": badge}

    full_text = f"{title}\n{desc}"

    # 2. Explicit range with ASCII dash, Unicode en-dash (\u2013), em-dash (\u2014), 'to', or '/'
    # e.g., '3–6 Years', '2–5 Years', '0-2 years', '4 to 7 years'
    range_match = re.search(r"\b([0-9]|1[0-9])\s*(?:-|–|—|to|\/)\s*([0-9]|[1-2][0-9])\s*\+?\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:relevant\s+)?experience)?\b", full_text, re.IGNORECASE)
    if range_match:
        mn = int(range_match.group(1))
        mx = int(range_match.group(2))
        if mn < mx and mx <= 30:
            lvl = "entry" if mx <= 2 else ("senior" if mn >= 5 else "mid")
            badge = "Ideal Match (0-2 yrs)" if mn <= 1 else ("Good Match (1-3 yrs)" if mn <= 2 else ("Senior Level (5+ yrs)" if mn >= 5 else "Mid Level (3-5 yrs)"))
            return {"text": f"{mn}-{mx} yrs", "min": mn, "max": mx, "level": lvl, "matchBadge": badge}

    # 3. Explicit plus pattern: e.g., '3+ years', '5+ yrs', '8+ years'
    plus_match = re.search(r"\b([0-9]|1[0-9])\s*\+\s*(?:years?|yrs?)(?:\s*(?:of\s*)?(?:relevant\s+)?experience)?\b", full_text, re.IGNORECASE)
    if plus_match:
        mn = int(plus_match.group(1))
        if mn <= 25:
            lvl = "entry" if mn <= 2 else ("mid" if mn < 5 else "senior")
            badge = "Ideal Match (0-2 yrs)" if mn <= 1 else ("Good Match (1-3 yrs)" if mn <= 2 else ("Senior Level (5+ yrs)" if mn >= 5 else "Mid Level (3-5 yrs)"))
            return {"text": f"{mn}+ yrs", "min": mn, "max": mn + 3, "level": lvl, "matchBadge": badge}

    # 4. At least / minimum N years
    min_match = re.search(r"\b(?:at\s*least|minimum|min\.?)\s*([0-9]|1[0-9])\s*(?:years?|yrs?)\b", full_text, re.IGNORECASE)
    if min_match:
        mn = int(min_match.group(1))
        if mn <= 25:
            lvl = "entry" if mn <= 2 else ("mid" if mn < 5 else "senior")
            badge = "Ideal Match (0-2 yrs)" if mn <= 1 else ("Good Match (1-3 yrs)" if mn <= 2 else ("Senior Level (5+ yrs)" if mn >= 5 else "Mid Level (3-5 yrs)"))
            return {"text": f"{mn}+ yrs", "min": mn, "max": mn + 3, "level": lvl, "matchBadge": badge}

    # 5. 'N years of experience' or 'experience: N years'
    of_exp = re.search(r"\b([0-9]|1[0-9])\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience\b", full_text, re.IGNORECASE)
    if not of_exp:
        of_exp = re.search(r"\b(?:experience|exp)[\s:]+([0-9]|1[0-9])\+?\s*(?:years?|yrs?)\b", full_text, re.IGNORECASE)
    if of_exp:
        mn = int(of_exp.group(1))
        if mn <= 25:
            lvl = "entry" if mn <= 2 else ("mid" if mn < 5 else "senior")
            badge = "Ideal Match (0-2 yrs)" if mn <= 1 else ("Good Match (1-3 yrs)" if mn <= 2 else ("Senior Level (5+ yrs)" if mn >= 5 else "Mid Level (3-5 yrs)"))
            return {"text": f"{mn}+ yrs", "min": mn, "max": mn + 2, "level": lvl, "matchBadge": badge}

    # 6. Seniority heuristics from title (when JD does not specify explicit years)
    t_lower = title.lower()
    if re.search(r"(?:^|[\s_-])(?:lead|principal|staff|director|architect|head\s+of)(?:$|[\s_-])", t_lower):
        return {"text": "6+ yrs (Lead / Senior)", "min": 6, "max": 12, "level": "senior", "matchBadge": "Senior Level (6+ yrs)"}
    if re.search(r"(?:^|[\s_-])(?:senior|sr\.?)(?:[a-z\s_-]|$)", t_lower) or "senior" in t_lower:
        return {"text": "4+ yrs (Senior)", "min": 4, "max": 8, "level": "senior", "matchBadge": "Senior Level (4+ yrs)"}
    if re.search(r"\b(?:engineer\s*3|engineer\s*iii|sde\s*3|sde\s*iii|level\s*3|l3)\b", t_lower):
        return {"text": "4+ yrs (Level 3 / Senior)", "min": 4, "max": 8, "level": "senior", "matchBadge": "Senior Level (4+ yrs)"}
    if re.search(r"\b(?:engineer\s*2|engineer\s*ii|sde\s*2|sde\s*ii|level\s*2|l2)\b", t_lower):
        return {"text": "2-5 yrs (Mid Level)", "min": 2, "max": 5, "level": "mid", "matchBadge": "Mid Level (2-5 yrs)"}
    if re.search(r"\b(?:intern|internship|trainee|fresher|graduate\s+engineer)\b", t_lower):
        return {"text": "0-1 yrs (Fresher / Intern)", "min": 0, "max": 1, "level": "entry", "matchBadge": "Ideal Match (0-2 yrs)"}

    # 7. Explicit Fresher in text (ensuring not 'mentor entry-level')
    if re.search(r"\b(fresher|freshers|campus\s+hire|entry[- ]level)\b", full_text, re.IGNORECASE):
        if not re.search(r"mentor\s+(?:junior|entry|intern)", full_text, re.IGNORECASE):
            return {"text": "0-1 yrs (Fresher / Entry)", "min": 0, "max": 1, "level": "entry", "matchBadge": "Ideal Match (0-2 yrs)"}

    # 8. Title hints for Junior
    if re.search(r"\b(junior|jr\.?|associate)\b", t_lower):
        return {"text": "0-2 yrs (Junior)", "min": 0, "max": 2, "level": "entry", "matchBadge": "Ideal Match (0-2 yrs)"}

    # 9. Conservative fallback: Do NOT hallucinate '1-3 yrs (Standard)'
    return {"text": "Not specified", "min": None, "max": None, "level": "unspecified", "matchBadge": "Check JD"}


def sanitize_with_guard(text):
    """Run text through ai-job-search posting_guard."""
    if not text or not posting_guard:
        return text, {"verdict": "guard_unavailable", "invisible_flagged": 0}
    try:
        clean_text, findings = posting_guard(text, "text")
        return clean_text, {
            "verdict": findings.get("verdict", "posting_guard: clean"),
            "invisible_flagged": findings.get("invisible_flagged", 0),
            "hidden_blocks": len(findings.get("hidden_blocks", [])),
            "instruction_like": len(findings.get("instruction_like", [])),
        }
    except Exception as e:
        return text, {"verdict": f"guard_error: {str(e)}", "invisible_flagged": 0}


def main():
    parser = argparse.ArgumentParser(description="Scrape and guard job listings")
    parser.add_argument("--search", default="all", help="Search query or 'all' for all target roles")
    parser.add_argument("--location", default="India", help="Location filter")
    parser.add_argument("--results", type=int, default=15, help="Max results per site")
    parser.add_argument("--sites", default="indeed,linkedin,naukri,wellfound,yc", help="Comma-separated sites")
    parser.add_argument("--hours-old", type=int, default=72, help="Max age of listings in hours")
    args = parser.parse_args()

    site_list = [s.strip().lower() for s in args.sites.split(",") if s.strip()]

    search_queries = [args.search]
    if args.search.lower() in ("all", "all roles", "all target roles"):
        search_queries = [
            "Machine Learning Engineer",
            "Computer Vision Engineer",
        ]

    all_records = []
    seen_urls = set()

    # 1. Scrape Wellfound if requested
    if "wellfound" in site_list:
        try:
            wf_jobs = scrape_wellfound(args.search, args.location, args.results)
            for j in wf_jobs:
                url = j.get("job_url") or j.get("link")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_records.append(j)
        except Exception as e:
            print(f"[Wellfound] error: {e}", file=sys.stderr)

    # 2. Scrape YC if requested
    if any(s in site_list for s in ("yc", "workatastartup", "ycombinator")):
        try:
            yc_jobs = scrape_yc(args.search, args.location, args.results)
            for j in yc_jobs:
                url = j.get("job_url") or j.get("link")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_records.append(j)
        except Exception as e:
            print(f"[YC] error: {e}", file=sys.stderr)

    # 3. Scrape JobSpy sites (Indeed, LinkedIn, Naukri, Glassdoor, ZipRecruiter)
    jobspy_supported = {"indeed", "linkedin", "naukri", "glassdoor", "zip_recruiter", "google", "bayt"}
    jobspy_sites = [s for s in site_list if s in jobspy_supported]

    if jobspy_sites:
        loc_lower = args.location.lower()
        indian_locations = ["india", "bengaluru", "bangalore", "delhi", "ncr", "hyderabad", "pune", "mumbai", "noida", "gurgaon", "remote"]
        is_india = any(city in loc_lower for city in indian_locations)

        for query in search_queries:
            try:
                per_query_results = max(4, min(8, args.results // len(search_queries)))
                jobs = scrape_jobs(
                    site_name=jobspy_sites,
                    search_term=query,
                    location=args.location,
                    results_wanted=per_query_results,
                    hours_old=args.hours_old,
                    country_indeed="India" if is_india else args.location,
                )

                if not jobs.empty:
                    for _, row in jobs.iterrows():
                        record = {}
                        for col in jobs.columns:
                            val = row[col]
                            if hasattr(val, "isoformat"):
                                record[col] = val.isoformat()
                            elif isinstance(val, float) and (val != val):
                                record[col] = None
                            else:
                                record[col] = val

                        url = record.get("job_url") or record.get("link")
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            all_records.append(record)
                        elif not url:
                            all_records.append(record)
            except Exception as e:
                print(f"[JobSpy] error for '{query}': {e}", file=sys.stderr)

    # 4. Annotate role category, experience, and run security sanitization via ai-job-search posting_guard
    for record in all_records:
        # Normalize company name
        c_name = record.get("company_name") or record.get("company") or "Company"
        record["company"] = c_name
        record["company_name"] = c_name

        title = record.get("title") or ""
        raw_desc = record.get("description") or ""
        clean_desc, sec_report = sanitize_with_guard(raw_desc)
        record["description"] = clean_desc
        record["_security"] = sec_report
        record["target_role"] = detect_job_role(title, clean_desc)

        exp = detect_experience(record)
        record["experience_required"] = exp["text"]
        record["experience_min"] = exp["min"]
        record["experience_max"] = exp["max"]
        record["experience_level"] = exp["level"]
        record["experience_match"] = exp["matchBadge"]

    # Ensure UTF-8 output
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(all_records, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
