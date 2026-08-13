#!/usr/bin/env python3
"""
fetch_citations.py

Run this manually whenever you want to refresh citation numbers on the site:

    pip install requests
    python3 scripts/fetch_citations.py

It reads ../bibliography.bib, looks up each paper's citation count, and
writes ../citations.json, which publications.js fetches at page load (same
pattern as bibliography.bib itself). Nothing on the live site talks to
INSPIRE or Crossref directly -- this script is the only thing that does,
and only when you run it.

How each entry is resolved, in order:
  1. If the entry has a `citecount_manual = {N}` field, that number is used
     directly as the total citation count. No per-year breakdown -- use this
     for papers with no other source (e.g. not on INSPIRE, no DOI, or you
     just want to hand-enter a number you saw on a journal page).
  2. Else if the entry has an `eprint` field, it's looked up on INSPIRE-HEP
     by arXiv ID. This gives both a total count AND a real per-year
     breakdown, via INSPIRE's citation graph (found by asking "who cites
     this record", then reading the citing papers' own dates).
  3. Else if the entry has a `doi` field, it's looked up on Crossref, which
     gives a total citation count (`is-referenced-by-count`) but no
     per-year breakdown (Crossref doesn't expose the citing-paper list).
  4. Else: skipped, with a warning printed.

Concretely, your REICHERT2021117526 entry (not on INSPIRE) should have a
`doi` field so step 3 picks it up automatically -- no special-casing needed
in this script. If it doesn't have a DOI either, add `citecount_manual`
with whatever number you find on the journal's page.

Rate limits: INSPIRE allows 15 requests / 5s per IP; this script paces
itself well under that and backs off automatically on HTTP 429.
"""

import json
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("This script needs the 'requests' package: pip install requests", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
BIB_PATH = ROOT / "bibliography.bib"
OUT_PATH = ROOT / "citations.json"

INSPIRE_BASE = "https://inspirehep.net/api"
CROSSREF_BASE = "https://api.crossref.org/works"
REQUEST_PAUSE = 0.4  # seconds between requests, well under INSPIRE's 15-per-5s limit


# -------------------------------------------------------------------------
# A small BibTeX parser -- deliberately mirrors the tolerant parser in
# js/publications.js so entries are read the same way in both places.
# -------------------------------------------------------------------------

def parse_bibtex(text):
    entries = []
    for m in re.finditer(r"@(\w+)\s*\{", text):
        entry_type = m.group(1).lower()
        if entry_type in ("comment", "string", "preamble"):
            continue
        brace_open = text.index("{", m.start())
        depth, i = 1, brace_open + 1
        while depth > 0 and i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        body = text[brace_open + 1:i - 1]
        parsed = parse_entry_body(body)
        if parsed:
            entries.append({"type": entry_type, "key": parsed[0], "fields": parsed[1]})
    return entries


def parse_entry_body(body):
    depth, comma_idx = 0, -1
    for j, c in enumerate(body):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == "," and depth == 0:
            comma_idx = j
            break
    if comma_idx == -1:
        return None
    key = body[:comma_idx].strip()
    rest = body[comma_idx + 1:]
    fields = {}
    i, n = 0, len(rest)
    while i < n:
        while i < n and (rest[i].isspace() or rest[i] == ","):
            i += 1
        if i >= n:
            break
        fk_start = i
        while i < n and rest[i] != "=":
            i += 1
        if i >= n:
            break
        field_key = rest[fk_start:i].strip().lower()
        i += 1
        while i < n and rest[i].isspace():
            i += 1
        value = ""
        if i < n and rest[i] == "{":
            d, i = 1, i + 1
            v_start = i
            while d > 0 and i < n:
                if rest[i] == "{":
                    d += 1
                elif rest[i] == "}":
                    d -= 1
                if d > 0:
                    i += 1
            value = rest[v_start:i]
            i += 1
        elif i < n and rest[i] == '"':
            i += 1
            v_start = i
            while i < n and rest[i] != '"':
                i += 1
            value = rest[v_start:i]
            i += 1
        else:
            v_start = i
            while i < n and rest[i] != ",":
                i += 1
            value = rest[v_start:i].strip()
        if field_key:
            fields[field_key] = value.strip()
    return key, fields


# -------------------------------------------------------------------------
# INSPIRE-HEP
# -------------------------------------------------------------------------

def inspire_get(path, params=None):
    url = f"{INSPIRE_BASE}{path}"
    for attempt in range(4):
        resp = requests.get(url, params=params, timeout=20)
        time.sleep(REQUEST_PAUSE)
        if resp.status_code == 429:
            wait = 5 * (attempt + 1)
            print(f"    rate-limited, waiting {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()


def inspire_lookup_by_arxiv(eprint):
    """Returns (recid, citation_count, citation_count_excl_self) or None."""
    safe_id = urllib.parse.quote(eprint, safe="")
    try:
        data = inspire_get(f"/arxiv/{safe_id}")
    except requests.HTTPError as e:
        print(f"    INSPIRE lookup failed for arXiv:{eprint}: {e}")
        return None
    meta = data.get("metadata", {})
    recid = meta.get("control_number")
    cc = meta.get("citation_count", 0)
    cc_excl = meta.get("citation_count_without_self_citations", cc)
    return recid, cc, cc_excl


def inspire_citations_by_year(recid):
    """Returns {year: count} of papers citing this record, by their earliest_date."""
    by_year = {}
    page = 1
    while True:
        data = inspire_get(
            "/literature",
            params={"q": f"refersto:recid:{recid}", "fields": "earliest_date", "size": 250, "page": page},
        )
        hits = data.get("hits", {}).get("hits", [])
        if not hits:
            break
        for hit in hits:
            date = hit.get("metadata", {}).get("earliest_date")
            if date:
                year = date[:4]
                by_year[year] = by_year.get(year, 0) + 1
        total = data.get("hits", {}).get("total", 0)
        if page * 250 >= total:
            break
        page += 1
    return by_year


# -------------------------------------------------------------------------
# Crossref (fallback for papers not on INSPIRE, e.g. via DOI)
# -------------------------------------------------------------------------

def crossref_citation_count(doi):
    url = f"{CROSSREF_BASE}/{urllib.parse.quote(doi, safe='')}"
    try:
        resp = requests.get(url, timeout=20, headers={"User-Agent": "personal-site-citation-fetcher/1.0"})
        time.sleep(REQUEST_PAUSE)
        resp.raise_for_status()
    except requests.HTTPError as e:
        print(f"    Crossref lookup failed for doi:{doi}: {e}")
        return None
    return resp.json().get("message", {}).get("is-referenced-by-count")


# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------

def merge_year_counts(target, source):
    for year, count in source.items():
        target[year] = target.get(year, 0) + count


def main():
    if not BIB_PATH.exists():
        print(f"Couldn't find {BIB_PATH}", file=sys.stderr)
        sys.exit(1)

    entries = parse_bibtex(BIB_PATH.read_text(encoding="utf-8"))
    print(f"Found {len(entries)} entries in bibliography.bib\n")

    total_citations = 0
    total_excl_self = 0
    citations_by_year = {}
    papers = []

    for entry in entries:
        key = entry["key"]
        fields = entry["fields"]
        print(f"[{key}]")

        if "citecount_manual" in fields:
            count = int(re.sub(r"[^\d]", "", fields["citecount_manual"]) or 0)
            print(f"    manual override: {count} citations")
            total_citations += count
            total_excl_self += count
            papers.append({"key": key, "source": "manual", "citation_count": count})

        elif "eprint" in fields:
            result = inspire_lookup_by_arxiv(fields["eprint"])
            if result is None:
                papers.append({"key": key, "source": "inspire", "error": "lookup failed"})
                continue
            recid, cc, cc_excl = result
            print(f"    INSPIRE recid {recid}: {cc} citations ({cc_excl} excl. self)")
            total_citations += cc
            total_excl_self += cc_excl
            year_counts = {}
            if recid and cc > 0:
                year_counts = inspire_citations_by_year(recid)
                merge_year_counts(citations_by_year, year_counts)
            papers.append({
                "key": key, "source": "inspire", "recid": recid,
                "citation_count": cc, "citation_count_excl_self": cc_excl,
            })

        elif "doi" in fields:
            count = crossref_citation_count(fields["doi"])
            if count is None:
                papers.append({"key": key, "source": "crossref", "error": "lookup failed"})
                continue
            print(f"    Crossref: {count} citations (no per-year breakdown available)")
            total_citations += count
            total_excl_self += count  # Crossref doesn't distinguish self-citations
            papers.append({"key": key, "source": "crossref", "citation_count": count})

        else:
            print("    no eprint, doi, or citecount_manual field -- skipped")
            papers.append({"key": key, "source": None, "error": "no citation source available"})

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_citations": total_citations,
        "total_citations_excl_self_citations": total_excl_self,
        "citations_by_year": citations_by_year,
        "papers": papers,
        "notes": (
            "citations_by_year is built only from INSPIRE-tracked papers (via their "
            "citation graph). Papers resolved via Crossref or citecount_manual "
            "contribute to total_citations but not to the per-year breakdown, since "
            "neither source exposes a citing-paper list."
        ),
    }

    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {OUT_PATH}")
    print(f"Total citations: {total_citations} ({total_excl_self} excl. self-citations)")


if __name__ == "__main__":
    main()
