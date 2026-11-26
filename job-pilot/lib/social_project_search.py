#!/usr/bin/env python3
"""
social_project_search.py — Live Social & Developer Showcase Search for Recommended Projects

Searches real posts where engineers showcased projects for a target role across:
- X / Twitter & LinkedIn posts (best-effort web index search)
- Hacker News ("Show HN" project launches via Algolia API)
- Dev.to (project showcase & build-log articles via Forem API)
- Hugging Face Spaces (live deployed AI/ML project demos)
- GitHub Repositories (open-source showcased projects with descriptions & demo links)

Sanitizes untrusted fetched text via ai-job-search/tools/posting_guard.py when available.
"""

import sys
import os
import re
import json
import html
import argparse
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

# Integrate ai-job-search posting_guard for untrusted text sanitization
AI_JOB_SEARCH_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ai-job-search"))
if AI_JOB_SEARCH_DIR not in sys.path:
    sys.path.insert(0, AI_JOB_SEARCH_DIR)

try:
    from tools.posting_guard import guard as posting_guard
except ImportError:
    posting_guard = None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def sanitize_text(text):
    if not text:
        return ""
    cleaned = html.unescape(str(text))
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if posting_guard:
        try:
            cleaned, _ = posting_guard(cleaned, "text")
        except Exception:
            pass
    return cleaned


def normalize_role_keywords(query):
    """Strip generic title suffixes so project searches match real showcase posts."""
    q = (query or "Machine Learning").strip()
    cleaned = re.sub(r"\b(engineer|developer|intern|senior|junior|lead|specialist|architect|role|jobs?)\b", "", q, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    lower = cleaned.lower()
    if "forward deployed" in lower:
        return "enterprise AI deployment FastAPI"
    return cleaned if len(cleaned) >= 2 else q


def fetch_hn_showcases(query, limit=6):
    items = []
    kw = normalize_role_keywords(query)
    try:
        r = requests.get(
            "https://hn.algolia.com/api/v1/search",
            params={"query": kw, "tags": "show_hn", "hitsPerPage": limit * 2},
            headers=HEADERS,
            timeout=8,
        )
        if r.status_code != 200:
            return items
        for hit in r.json().get("hits", []):
            title = sanitize_text(hit.get("title", ""))
            story_text = sanitize_text(hit.get("story_text", ""))
            hn_url = f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"
            ext_url = hit.get("url") or hn_url
            if not title:
                continue
            if re.search(r"\b(jobs?|hiring|job board|careers?)\b", title, re.I):
                continue
            items.append({
                "id": f"hn-{hit.get('objectID', '')}",
                "platform": "Hacker News",
                "platformKey": "hackernews",
                "postTitle": title,
                "rawDescription": story_text or f"Show HN project showcase: {title}",
                "author": f"@{hit.get('author', 'hn_builder')}",
                "postUrl": hn_url,
                "demoUrl": ext_url if ext_url != hn_url else "",
                "engagement": f"{hit.get('points', 0) or 0} pts · {hit.get('num_comments', 0) or 0} comments",
                "createdAt": hit.get("created_at", ""),
                "tags": ["Show HN"],
            })
            if len(items) >= limit:
                break
    except Exception:
        pass
    return items


def fetch_devto_showcases(query, limit=6):
    items = []
    kw = normalize_role_keywords(query).lower()
    words = [w for w in re.split(r"\W+", kw) if len(w) > 1]
    tag_candidates = []
    if "vision" in kw or "opencv" in kw or "yolo" in kw:
        tag_candidates = ["computervision", "machinelearning", "python"]
    elif "forward" in kw or "deploy" in kw or "mlops" in kw or "devops" in kw:
        tag_candidates = ["devops", "docker", "machinelearning"]
    elif "edge" in kw or "embedded" in kw:
        tag_candidates = ["iot", "ai", "python"]
    else:
        tag_candidates = ["machinelearning", "ai", "showdev"]

    seen_ids = set()
    for tag in tag_candidates[:2]:
        try:
            r = requests.get(
                "https://dev.to/api/articles",
                params={"tag": tag, "per_page": 20, "top": 30},
                headers=HEADERS,
                timeout=8,
            )
            if r.status_code != 200:
                continue
            for art in r.json():
                aid = art.get("id")
                if aid in seen_ids:
                    continue
                title = sanitize_text(art.get("title", ""))
                desc = sanitize_text(art.get("description", ""))
                tags = art.get("tag_list") or []
                haystack = f"{title} {desc} {' '.join(tags)}".lower()
                # Prefer articles matching query words or showcase/project wording
                word_hits = sum(1 for w in words if w in haystack)
                is_project = any(k in haystack for k in ["built", "building", "project", "demo", "showdev", "open source", "how i", "created", "deploy"])
                if word_hits == 0 and not is_project:
                    continue
                seen_ids.add(aid)
                user = art.get("user") or {}
                author = user.get("twitter_username")
                author_str = f"@{author}" if author else (user.get("name") or "Dev.to Author")
                items.append({
                    "id": f"devto-{aid}",
                    "platform": "Dev.to",
                    "platformKey": "devto",
                    "postTitle": title,
                    "rawDescription": desc or title,
                    "author": author_str,
                    "postUrl": art.get("url", ""),
                    "demoUrl": "",
                    "engagement": f"{art.get('public_reactions_count', 0) or 0} reactions · {art.get('comments_count', 0) or 0} comments",
                    "createdAt": art.get("published_at", ""),
                    "tags": tags[:5],
                    "_score": word_hits * 2 + (1 if is_project else 0),
                })
        except Exception:
            continue

    items.sort(key=lambda x: x.pop("_score", 0), reverse=True)
    return items[:limit]


def fetch_hf_spaces(query, limit=5):
    items = []
    kw = normalize_role_keywords(query)
    try:
        r = requests.get(
            "https://huggingface.co/api/spaces",
            params={"search": kw, "sort": "likes", "direction": "-1", "limit": limit},
            headers=HEADERS,
            timeout=8,
        )
        if r.status_code != 200:
            return items
        for sp in r.json():
            sid = sp.get("id", "")
            if not sid:
                continue
            card = sp.get("cardData") or {}
            title = sanitize_text(card.get("title") or sid.split("/")[-1].replace("-", " "))
            short_desc = sanitize_text(card.get("short_description") or "")
            tags = [t for t in (sp.get("tags") or []) if not t.startswith("region:")][:5]
            sdk = sp.get("sdk") or "gradio"
            space_url = f"https://huggingface.co/spaces/{sid}"
            items.append({
                "id": f"hf-{sid.replace('/', '_')}",
                "platform": "Hugging Face",
                "platformKey": "huggingface",
                "postTitle": title,
                "rawDescription": short_desc or f"Interactive {sdk} AI/ML demo space '{title}' hosted on Hugging Face Spaces ({', '.join(tags[:4])}).",
                "author": f"@{sid.split('/')[0]}" if "/" in sid else "HF Builder",
                "postUrl": space_url,
                "demoUrl": space_url,
                "engagement": f"{sp.get('likes', 0) or 0} likes · SDK: {sdk}",
                "createdAt": sp.get("createdAt", ""),
                "tags": tags,
            })
    except Exception:
        pass
    return items


def fetch_github_showcases(query, limit=5):
    items = []
    kw = normalize_role_keywords(query)
    try:
        r = requests.get(
            "https://api.github.com/search/repositories",
            params={"q": f"{kw} project", "sort": "stars", "order": "desc", "per_page": limit},
            headers={**HEADERS, "Accept": "application/vnd.github+json"},
            timeout=8,
        )
        if r.status_code != 200:
            return items
        for repo in r.json().get("items", []):
            full_name = repo.get("full_name", "")
            desc = sanitize_text(repo.get("description", ""))
            topics = repo.get("topics") or []
            homepage = (repo.get("homepage") or "").strip()
            items.append({
                "id": f"gh-{repo.get('id', '')}",
                "platform": "GitHub",
                "platformKey": "github",
                "postTitle": full_name,
                "rawDescription": desc or f"Open-source project repository {full_name}",
                "author": f"@{(repo.get('owner') or {}).get('login', 'github')}",
                "postUrl": repo.get("html_url", ""),
                "demoUrl": homepage if homepage.startswith("http") else "",
                "engagement": f"{repo.get('stargazers_count', 0) or 0:,} stars · {repo.get('language') or 'Code'}",
                "createdAt": repo.get("updated_at", ""),
                "tags": topics[:5],
            })
    except Exception:
        pass
    return items


def fetch_medium_showcases(query, limit=5):
    items = []
    kw = normalize_role_keywords(query).lower()
    if "vision" in kw or "opencv" in kw or "yolo" in kw:
        tags = ["computer-vision", "machine-learning"]
    elif "forward" in kw or "deploy" in kw or "mlops" in kw:
        tags = ["mlops", "software-engineering"]
    elif "edge" in kw or "embedded" in kw:
        tags = ["edge-computing", "machine-learning"]
    else:
        tags = ["machine-learning", "artificial-intelligence"]

    seen_links = set()
    for tag in tags[:1]:
        try:
            r = requests.get(
                f"https://medium.com/feed/tag/{tag}",
                headers=HEADERS,
                timeout=8,
            )
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.text)
            ns = {
                "dc": "http://purl.org/dc/elements/1.1/",
                "content": "http://purl.org/rss/1.0/modules/content/",
            }
            for it in root.findall(".//item")[: limit * 2]:
                title = sanitize_text(it.findtext("title") or "")
                link = (it.findtext("link") or "").split("?")[0].strip()
                if not title or not link or link in seen_links:
                    continue
                seen_links.add(link)
                raw_body = it.findtext("content:encoded", namespaces=ns) or it.findtext("description") or ""
                desc = sanitize_text(raw_body)[:480]
                creator = sanitize_text(it.findtext("dc:creator", namespaces=ns) or "Medium Author")
                cats = [sanitize_text(c.text) for c in it.findall("category") if c.text][:4]
                items.append({
                    "id": f"medium-{abs(hash(link)) % 10000000}",
                    "platform": "Medium",
                    "platformKey": "medium",
                    "postTitle": title,
                    "rawDescription": desc or title,
                    "author": creator,
                    "postUrl": link,
                    "demoUrl": "",
                    "engagement": "Medium Engineering Post",
                    "createdAt": it.findtext("pubDate") or "",
                    "tags": cats or [tag],
                })
                if len(items) >= limit:
                    break
        except Exception:
            pass
    return items


def fetch_social_posts_ddg(query, site_filter, platform_label, platform_key, limit=6):
    """Best-effort lookup of real indexed Twitter/X and LinkedIn showcase posts."""
    items = []
    if cffi_requests is None:
        return items
    kw = normalize_role_keywords(query)
    search_q = f"{site_filter} {kw} project built"
    try:
        r = cffi_requests.get(
            "https://lite.duckduckgo.com/lite/",
            params={"q": search_q},
            impersonate="chrome120",
            timeout=6,
        )
        if r.status_code != 200:
            return items
        soup = BeautifulSoup(r.text, "html.parser")
        links = soup.select("a.result-link")
        snips = soup.select("td.result-snippet")
        for a, s in list(zip(links, snips))[:limit]:
            raw_href = a.get("href", "")
            if "uddg=" in raw_href:
                raw_href = urllib.parse.unquote(raw_href.split("uddg=")[1].split("&")[0])
            if not raw_href.startswith("http"):
                continue
            title = sanitize_text(a.get_text(" ", strip=True))
            snippet = sanitize_text(s.get_text(" ", strip=True))
            if not title and not snippet:
                continue

            lower_href = raw_href.lower()
            detected_label = platform_label
            detected_key = platform_key
            if "linkedin.com" in lower_href:
                detected_label = "LinkedIn"
                detected_key = "linkedin"
            elif "x.com" in lower_href or "twitter.com" in lower_href:
                detected_label = "X / Twitter"
                detected_key = "x"

            author = detected_label
            m = re.search(r"(?:x\.com|twitter\.com)/([^/?#]+)", raw_href, re.I)
            if m and m.group(1).lower() not in ("search", "explore", "hashtag", "i"):
                author = f"@{m.group(1)}"
            else:
                m_li = re.search(r"linkedin\.com/(?:posts|in)/([^/?#_]+)", raw_href, re.I)
                if m_li:
                    author = m_li.group(1).replace("-", " ").title()[:32]
            items.append({
                "id": f"{detected_key}-{abs(hash(raw_href)) % 10000000}",
                "platform": detected_label,
                "platformKey": detected_key,
                "postTitle": title,
                "rawDescription": snippet or title,
                "author": author,
                "postUrl": raw_href,
                "demoUrl": "",
                "engagement": f"Indexed {detected_label} post",
                "createdAt": "",
                "tags": [detected_label],
            })
    except Exception:
        pass
    return items


def run_search(query, platform="all"):
    kw = normalize_role_keywords(query)
    tasks = {}
    all_items = []
    sources_status = {}

    with ThreadPoolExecutor(max_workers=6) as pool:
        if platform == "all":
            tasks[pool.submit(fetch_social_posts_ddg, query, "(site:linkedin.com/posts OR site:x.com)", "Social (X / LinkedIn)", "x", 6)] = "X / LinkedIn"
        elif platform in ("x", "twitter"):
            tasks[pool.submit(fetch_social_posts_ddg, query, "site:x.com", "X / Twitter", "x", 6)] = "X / Twitter"
        elif platform == "linkedin":
            tasks[pool.submit(fetch_social_posts_ddg, query, "site:linkedin.com/posts", "LinkedIn", "linkedin", 6)] = "LinkedIn"
        if platform in ("all", "hackernews"):
            tasks[pool.submit(fetch_hn_showcases, query, 6)] = "Hacker News"
        if platform in ("all", "devto"):
            tasks[pool.submit(fetch_devto_showcases, query, 6)] = "Dev.to"
        if platform in ("all", "huggingface"):
            tasks[pool.submit(fetch_hf_spaces, query, 5)] = "Hugging Face"
        if platform in ("all", "medium"):
            tasks[pool.submit(fetch_medium_showcases, query, 5)] = "Medium"
        if platform in ("all", "github"):
            tasks[pool.submit(fetch_github_showcases, query, 5)] = "GitHub"

        for fut in as_completed(tasks):
            src = tasks[fut]
            try:
                res = fut.result()
                sources_status[src] = len(res)
                all_items.extend(res)
            except Exception:
                sources_status[src] = 0

    # Interleave across platforms so X/LinkedIn/HN/Dev.to/HF/Medium/GitHub appear balanced at the top
    by_plat = {}
    for it in all_items:
        by_plat.setdefault(it["platformKey"], []).append(it)

    order = ["x", "linkedin", "hackernews", "devto", "huggingface", "medium", "github"]
    interleaved = []
    idx = 0
    while len(interleaved) < len(all_items):
        added = False
        for k in order:
            bucket = by_plat.get(k, [])
            if idx < len(bucket):
                interleaved.append(bucket[idx])
                added = True
        if not added:
            break
        idx += 1

    # Pre-built live social search URLs for X/Twitter & LinkedIn
    encoded_social_q = urllib.parse.quote(f'("{kw}" OR "{query}") (built OR project OR showcase OR demo)')
    encoded_li_q = urllib.parse.quote(f"{kw} project built demo")

    return {
        "query": query,
        "keywords": kw,
        "platform": platform,
        "count": len(interleaved),
        "sources": sources_status,
        "socialSearchLinks": {
            "xUrl": f"https://x.com/search?q={encoded_social_q}&f=live",
            "linkedinUrl": f"https://www.linkedin.com/search/results/content/?keywords={encoded_li_q}&sortBy=%22relevance%22",
        },
        "items": interleaved[:18],
    }


def main():
    parser = argparse.ArgumentParser(description="Search social & developer project showcases for a role")
    parser.add_argument("--query", default="Computer Vision Engineer", help="Target role or topic")
    parser.add_argument("--platform", default="all", help="Platform filter")
    args = parser.parse_args()

    result = run_search(args.query, args.platform)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
