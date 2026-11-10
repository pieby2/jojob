#!/usr/bin/env python3
"""
Job scraper combining JobSpy, Wellfound, and Y Combinator (Work at a Startup),
integrated with ai-job-search posting_guard.

Supported sites:
- indeed, linkedin, naukri, glassdoor, zip_recruiter (via JobSpy)
- wellfound (AngelList Talent startup jobs)
- yc (Y Combinator Work at a Startup)
"""

import sys
import os
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

    # If "all", search across all candidate target roles
    search_queries = [args.search]
    if args.search.lower() in ("all", "all roles", "all target roles"):
        search_queries = [
            "Machine Learning Engineer",
            "Computer Vision Engineer",
            "Edge AI Engineer",
            "Deep Learning Engineer"
        ]

    all_records = []
    seen_urls = set()

    for query in search_queries:
        # 1. Scrape Wellfound if requested
        if "wellfound" in site_list:
            try:
                wf_jobs = scrape_wellfound(query, args.location, max(5, args.results // len(search_queries)))
                for j in wf_jobs:
                    url = j.get("job_url") or j.get("link")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_records.append(j)
            except Exception as e:
                print(f"[Wellfound] error for '{query}': {e}", file=sys.stderr)

        # 2. Scrape YC if requested
        if "yc" in site_list or "workatastartup" in site_list or "ycombinator" in site_list:
            try:
                yc_jobs = scrape_yc(query, args.location, max(5, args.results // len(search_queries)))
                for j in yc_jobs:
                    url = j.get("job_url") or j.get("link")
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        all_records.append(j)
            except Exception as e:
                print(f"[YC] error for '{query}': {e}", file=sys.stderr)

        # 3. Scrape JobSpy sites (Indeed, LinkedIn, Naukri, Glassdoor, ZipRecruiter)
        jobspy_supported = {"indeed", "linkedin", "naukri", "glassdoor", "zip_recruiter", "google", "bayt"}
        jobspy_sites = [s for s in site_list if s in jobspy_supported]

        if jobspy_sites:
            loc_lower = args.location.lower()
            indian_locations = ["india", "bengaluru", "bangalore", "delhi", "ncr", "hyderabad", "pune", "mumbai", "noida", "gurgaon", "remote"]
            is_india = any(city in loc_lower for city in indian_locations)

            try:
                per_query_results = max(6, args.results // len(search_queries))
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
                            if hasattr(val, 'isoformat'):
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

    # 4. Annotate role category and run security sanitization via ai-job-search posting_guard
    for record in all_records:
        title = record.get("title") or ""
        raw_desc = record.get("description") or ""
        clean_desc, sec_report = sanitize_with_guard(raw_desc)
        record["description"] = clean_desc
        record["_security"] = sec_report
        record["target_role"] = detect_job_role(title, clean_desc)

    # Ensure UTF-8 output
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(all_records, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
