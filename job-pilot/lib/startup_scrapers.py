"""
startup_scrapers.py — Scrapers for Wellfound and Y Combinator (Work at a Startup)
"""

import json
import re
import urllib.request
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def scrape_wellfound(query="machine-learning-engineer", location="india", max_results=15):
    """Scrape Wellfound (formerly AngelList Talent) job listings."""
    role_slug = "machine-learning-engineer"
    q_lower = query.lower()
    if "vision" in q_lower:
        role_slug = "computer-vision-engineer"
    elif "ai" in q_lower or "deep" in q_lower:
        role_slug = "ai-engineer"
    elif "data" in q_lower:
        role_slug = "data-engineer"

    loc_slug = "india"
    loc_lower = location.lower()
    if "remote" in loc_lower:
        loc_slug = "remote"
    elif "bengaluru" in loc_lower or "bangalore" in loc_lower:
        loc_slug = "bangalore"
    elif "delhi" in loc_lower or "ncr" in loc_lower:
        loc_slug = "delhi"

    url = f"https://wellfound.com/role/l/{role_slug}/{loc_slug}"
    req = urllib.request.Request(url, headers=HEADERS)
    jobs = []

    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            html = r.read().decode("utf-8", errors="ignore")

        soup = BeautifulSoup(html, "html.parser")
        next_data = soup.find("script", id="__NEXT_DATA__")
        if not next_data:
            return jobs

        data = json.loads(next_data.string)
        apollo = data.get("props", {}).get("pageProps", {}).get("apolloState", {}).get("data", {})

        # Extract startups
        startups = {}
        for k, v in apollo.items():
            if isinstance(v, dict) and v.get("__typename") == "StartupResult":
                name = v.get("name") or v.get("highlightedName")
                if name:
                    startups[k] = name

        # Extract listings
        for k, v in apollo.items():
            if isinstance(v, dict) and v.get("__typename") == "JobListingSearchResult":
                title = v.get("title") or "Engineering Role"
                desc = v.get("description") or ""
                job_id = v.get("id") or ""
                slug = v.get("slug") or "job"
                comp = v.get("compensation") or ""
                locs = v.get("locationNames", [])
                loc_str = ", ".join(locs) if locs else location

                # Find company name
                company = "Wellfound Startup"
                for sname in startups.values():
                    if sname in desc[:300] or sname in title:
                        company = sname
                        break
                if company == "Wellfound Startup" and startups:
                    company = list(startups.values())[0]

                jobs.append({
                    "site": "wellfound",
                    "title": title,
                    "company_name": company,
                    "location": loc_str,
                    "job_url": f"https://wellfound.com/jobs/{job_id}-{slug}",
                    "description": desc,
                    "compensation": comp,
                    "job_type": v.get("jobType", "full-time"),
                })
                if len(jobs) >= max_results:
                    break

    except Exception as e:
        print(f"[Wellfound Scraper] Error: {e}", file=sys.stderr)

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

            # Clean title and comp if present in title string
            comp = None
            comp_search = re.search(r"(\$[\d,]+k?[\s–-]+[\$\d,]+k?/yr|\$[\d,]+k?/yr)", raw_title, re.IGNORECASE)
            if comp_search:
                comp = comp_search.group(1)

            jobs.append({
                "site": "yc",
                "title": raw_title,
                "company_name": company,
                "location": "India / Remote" if "india" in url else "Remote",
                "job_url": job_url,
                "description": f"Role at YC-backed startup {company}: {raw_title}.\nApply directly through Y Combinator Work at a Startup.",
                "compensation": comp,
                "job_type": "full-time",
            })
            if len(jobs) >= max_results:
                break

    except Exception as e:
        import sys
        print(f"[YC Scraper] Error: {e}", file=sys.stderr)

    return jobs
