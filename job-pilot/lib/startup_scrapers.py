"""
startup_scrapers.py — Scrapers for Wellfound and Y Combinator (Work at a Startup)
"""

import sys
import json
import re
import urllib.request
from datetime import datetime
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def _resolve_role_slugs(query="machine-learning-engineer"):
    """Map query string to 1 or more Wellfound role slugs."""
    q = (query or "").lower().strip()
    if not q or q in ("all", "all roles", "all target roles"):
        return ["machine-learning-engineer", "computer-vision-engineer", "ai-engineer"]
    
    slugs = []
    if "vision" in q or "opencv" in q or "yolo" in q or "image" in q or "perception" in q:
        slugs.append("computer-vision-engineer")
    if "machine" in q or "ml" in q:
        slugs.append("machine-learning-engineer")
    if "ai" in q or "deep" in q or "generative" in q or "llm" in q:
        slugs.append("ai-engineer")
    if "data" in q:
        slugs.append("data-engineer")
    if "software" in q or "backend" in q or "full" in q:
        slugs.append("software-engineer")

    return slugs if slugs else ["machine-learning-engineer", "ai-engineer"]


def _resolve_loc_slug(location="india"):
    """Map location to Wellfound location slug."""
    loc = (location or "india").lower().strip()
    if "remote" in loc:
        return "remote"
    if "bengaluru" in loc or "bangalore" in loc:
        return "bangalore"
    if "delhi" in loc or "ncr" in loc or "gurgaon" in loc or "noida" in loc:
        return "delhi"
    if "mumbai" in loc:
        return "mumbai"
    if "hyderabad" in loc:
        return "hyderabad"
    if "pune" in loc:
        return "pune"
    if "san francisco" in loc or "bay area" in loc:
        return "san-francisco"
    if "united states" in loc or "us" == loc or "usa" in loc:
        return "united-states"
    return "india"


def scrape_wellfound(query="machine-learning-engineer", location="india", max_results=20):
    """
    Scrape Wellfound (formerly AngelList Talent) job listings.
    Accurately maps startups to listings via Apollo state graph and captures
    native yearsExperienceMin/Max, logos, company sizes, and full descriptions.
    """
    role_slugs = _resolve_role_slugs(query)
    loc_slug = _resolve_loc_slug(location)
    jobs = []
    seen_ids = set()

    for r_slug in role_slugs:
        if len(jobs) >= max_results:
            break

        url = f"https://wellfound.com/role/l/{r_slug}/{loc_slug}"
        req = urllib.request.Request(url, headers=HEADERS)

        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                html = resp.read().decode("utf-8", errors="ignore")

            soup = BeautifulSoup(html, "html.parser")
            next_data = soup.find("script", id="__NEXT_DATA__")
            if not next_data or not next_data.string:
                continue

            data = json.loads(next_data.string)
            apollo = data.get("props", {}).get("pageProps", {}).get("apolloState", {}).get("data", {})
            if not apollo:
                continue

            # Build reverse lookup: listing_id -> startup info
            listing_to_startup = {}
            for k, v in apollo.items():
                if isinstance(v, dict) and v.get("__typename") == "StartupResult":
                    s_info = {
                        "name": v.get("name") or v.get("highlightedName") or "Wellfound Startup",
                        "companySize": v.get("companySize"),
                        "logoUrl": v.get("logoUrl"),
                        "slug": v.get("slug"),
                        "highConcept": v.get("highConcept")
                    }
                    for ref in (v.get("highlightedJobListings") or []):
                        if isinstance(ref, dict) and "__ref" in ref:
                            ref_id = ref["__ref"].split(":")[-1]
                            listing_to_startup[ref_id] = s_info
                    for ref in (v.get("jobListings") or []):
                        if isinstance(ref, dict) and "__ref" in ref:
                            ref_id = ref["__ref"].split(":")[-1]
                            listing_to_startup[ref_id] = s_info

            # Extract job listings
            for k, v in apollo.items():
                if isinstance(v, dict) and v.get("__typename") == "JobListingSearchResult":
                    job_id = str(v.get("id") or "")
                    if not job_id or job_id in seen_ids:
                        continue
                    seen_ids.add(job_id)

                    startup = listing_to_startup.get(job_id, {})
                    company = startup.get("name") or "Wellfound Startup"
                    company_logo = startup.get("logoUrl")
                    company_size = startup.get("companySize")

                    title = v.get("title") or "Engineering Role"
                    desc = v.get("description") or ""
                    slug = v.get("slug") or "job"
                    comp = v.get("compensation") or ""
                    locs = v.get("locationNames") or []
                    loc_str = ", ".join(locs) if locs else location

                    exp_min = v.get("yearsExperienceMin")
                    exp_max = v.get("yearsExperienceMax")

                    live_start = v.get("liveStartAt")
                    date_str = None
                    if live_start:
                        try:
                            date_str = datetime.fromtimestamp(live_start).strftime("%Y-%m-%d")
                        except Exception:
                            pass
                    if not date_str:
                        date_str = datetime.utcnow().strftime("%Y-%m-%d")

                    jobs.append({
                        "site": "wellfound",
                        "title": title,
                        "company": company,
                        "company_name": company,
                        "company_logo": company_logo,
                        "company_size": company_size,
                        "location": loc_str,
                        "job_url": f"https://wellfound.com/jobs/{job_id}-{slug}",
                        "description": desc,
                        "compensation": comp,
                        "job_type": v.get("jobType", "full-time"),
                        "yearsExperienceMin": exp_min,
                        "yearsExperienceMax": exp_max,
                        "date_posted": date_str,
                    })

                    if len(jobs) >= max_results:
                        break

        except Exception as e:
            print(f"[Wellfound Scraper] Error querying '{r_slug}': {e}", file=sys.stderr)

    return jobs


def scrape_yc(query="engineering", location="india", max_results=15):
    """Scrape Y Combinator (Work at a Startup) job listings."""
    loc_lower = location.lower()
    role_path = "software-engineer"
    q_lower = query.lower()

    if "ai" in q_lower or "machine" in q_lower or "deep" in q_lower or "vision" in q_lower:
        role_path = "ai-engineer"

    if "india" in loc_lower or "bengaluru" in loc_lower or "delhi" in loc_lower:
        url = f"https://www.ycombinator.com/jobs/role/{role_path}/india"
    else:
        url = f"https://www.ycombinator.com/jobs/role/{role_path}"

    req = urllib.request.Request(url, headers=HEADERS)
    jobs = []

    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            html = r.read().decode("utf-8", errors="ignore")

        soup = BeautifulSoup(html, "html.parser")

        for a in soup.find_all("a", href=re.compile(r"/companies/[^/]+/jobs/[^/]+")):
            raw_title = a.get_text(strip=True)
            if not raw_title:
                continue

            href = a["href"]
            job_url = "https://www.ycombinator.com" + href if href.startswith("/") else href

            comp_match = re.search(r"/companies/([^/]+)/jobs", href)
            company = comp_match.group(1).replace("-", " ").title() if comp_match else "YC Startup"

            comp = None
            comp_search = re.search(r"(\$[\d,]+k?[\s–-]+[\$\d,]+k?/yr|\$[\d,]+k?/yr)", raw_title, re.IGNORECASE)
            if comp_search:
                comp = comp_search.group(1)

            today_str = datetime.utcnow().strftime("%Y-%m-%d")

            jobs.append({
                "site": "yc",
                "title": raw_title,
                "company": company,
                "company_name": company,
                "location": "India / Remote" if "india" in url else "Remote",
                "job_url": job_url,
                "description": f"Role at YC-backed startup {company}: {raw_title}.\nApply directly through Y Combinator Work at a Startup.",
                "compensation": comp,
                "job_type": "full-time",
                "date_posted": today_str,
            })
            if len(jobs) >= max_results:
                break

    except Exception as e:
        print(f"[YC Scraper] Error: {e}", file=sys.stderr)

    return jobs
