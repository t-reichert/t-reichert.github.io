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
  3. Else if the entry has a `doi` field, it's looked up on INSPIRE-HEP by
     DOI first (same total + per-year breakdown as step 2 -- many papers are
     on INSPIRE even when the .bib entry itself has no `eprint` field, e.g.
     an incomplete entry or a proceedings entry with only a DOI). Only if
     INSPIRE genuinely has no record for that DOI does it fall back to
     Crossref's `is-referenced-by-count`, which gives a total but no
     per-year breakdown (Crossref doesn't expose a citing-paper list, and
     it only sees citations from other Crossref-registered, mostly
     published works -- never from arXiv preprints, which is how most HEP
     citations actually happen, often long before journal publication. So
     this fallback path will typically undercount vs. the real INSPIRE
     number, which is exactly why INSPIRE is always tried first).
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


def inspire_lookup_by_doi(doi):
    """Returns (recid, citation_count, citation_count_excl_self) or None.
    Unlike inspire_lookup_by_arxiv, a failure here is the expected/common
    case (the DOI just isn't on INSPIRE) rather than a real error, so this
    doesn't print anything on failure -- the caller falls back to Crossref
    silently."""
    safe_doi = urllib.parse.quote(doi, safe="")
    try:
        data = inspire_get(f"/doi/{safe_doi}")
    except requests.HTTPError:
        return None
    meta = data.get("metadata", {})
    recid = meta.get("control_number")
    cc = meta.get("citation_count", 0)
    cc_excl = meta.get("citation_count_without_self_citations", cc)
    return recid, cc, cc_excl


def inspire_citations_by_year(recid, floor_year=None):
    """Returns ({year: count}, missing_date_count, corrected_count) for
    papers citing this record.

    floor_year is this (cited) paper's own year -- a citation can't
    legitimately predate the paper it cites. In practice a few records on
    INSPIRE have a wrong `earliest_date` (e.g. an old, never-published arXiv
    preprint that got replaced years later with a new version including the
    citation -- the citing record's own earliest_date wasn't updated to
    match). When a citing paper's year comes back earlier than floor_year,
    this tries that citing paper's own journal publication year instead
    (from publication_info), and only falls back to floor_year itself if
    that's unavailable or also too early."""
    by_year = {}
    missing = 0
    corrected = 0
    page = 1
    while True:
        data = inspire_get(
            "/literature",
            params={"q": f"refersto:recid:{recid}", "fields": "earliest_date,publication_info", "size": 250, "page": page},
        )
        hits = data.get("hits", {}).get("hits", [])
        if not hits:
            break
        for hit in hits:
            meta = hit.get("metadata", {})
            date = meta.get("earliest_date")
            if not date:
                missing += 1
                continue
            year = int(date[:4])
            if floor_year and year < floor_year:
                pub_years = [int(p["year"]) for p in meta.get("publication_info", []) if p.get("year")]
                better = next((y for y in pub_years if y >= floor_year), None)
                year = better if better else floor_year
                corrected += 1
            year_str = str(year)
            by_year[year_str] = by_year.get(year_str, 0) + 1
        total = data.get("hits", {}).get("total", 0)
        if page * 250 >= total:
            break
        page += 1
    return by_year, missing, corrected


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
# Semantic Scholar (tried before Crossref for papers not on INSPIRE -- it
# indexes more broadly than Crossref, e.g. citations from arXiv preprints
# and interdisciplinary venues Crossref doesn't see, so it's often a
# meaningfully better estimate for a paper outside your main field that
# INSPIRE doesn't track.)
# -------------------------------------------------------------------------

SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1"


def semantic_scholar_citation_count(doi):
    url = f"{SEMANTIC_SCHOLAR_BASE}/paper/DOI:{urllib.parse.quote(doi, safe='')}"
    try:
        resp = requests.get(url, params={"fields": "citationCount"}, timeout=20)
        time.sleep(REQUEST_PAUSE)
        if resp.status_code == 404:
            return None  # not on Semantic Scholar either -- not an error
        resp.raise_for_status()
    except requests.HTTPError as e:
        print(f"    Semantic Scholar lookup failed for doi:{doi}: {e}")
        return None
    return resp.json().get("citationCount")


# -------------------------------------------------------------------------
# Main
# -------------------------------------------------------------------------

def merge_year_counts(target, source):
    for year, count in source.items():
        target[year] = target.get(year, 0) + count


def parse_citeyears_manual(raw):
    """Parses a hand-entered per-year breakdown like '2022:2, 2023:5, 2024:3'
    (e.g. transcribed from a Scopus 'cited by' list) into {year: count}."""
    result = {}
    for part in raw.split(","):
        part = part.strip()
        if not part or ":" not in part:
            continue
        year, count = part.split(":", 1)
        year = year.strip()
        count = re.sub(r"[^\d]", "", count)
        if year and count:
            result[year] = result.get(year, 0) + int(count)
    return result


def apply_citeyears_manual(fields, citations_by_year, papers):
    """Applies a `citeyears_manual` field (if present) to citations_by_year
    AND to this entry's own record in `papers` (so the site can show a
    per-paper chart, not just the site-wide aggregate). Called for every
    entry regardless of source/outcome, including lookup failures -- that's
    exactly when a manual override matters most. Assumes `papers[-1]` is
    this entry's just-appended record (true everywhere this is called)."""
    if "citeyears_manual" in fields:
        manual_years = parse_citeyears_manual(fields["citeyears_manual"])
        if manual_years:
            merge_year_counts(citations_by_year, manual_years)
            if papers:
                own = papers[-1].setdefault("citations_by_year", {})
                merge_year_counts(own, manual_years)
            print(f"    + manual per-year breakdown added: {manual_years}")


def process_inspire_record(key, recid, cc, cc_excl, via, seen_recids, totals, citations_by_year, papers, recid_year_cache, floor_year):
    """Shared handling for a record found on INSPIRE, whether we found it by
    arXiv ID or by DOI: dedup against recids already counted for the site-wide
    totals/chart, but every entry still gets its OWN per-paper year breakdown
    attached (via recid_year_cache, so a duplicate entry reuses the already-
    fetched breakdown instead of hitting the API again).

    floor_year clamps out impossible pre-publication "citations" (see
    inspire_citations_by_year). Note: if the same recid is reached from two
    .bib entries with different floor_years (e.g. a preprint entry and its
    later published-version entry, with different `year` fields), the floor
    actually applied is whichever entry's lookup happened first and got
    cached -- an acceptable simplification for how rare that combination is."""
    already_counted = recid in seen_recids
    print(f"    INSPIRE recid {recid} (via {via}): {cc} citations ({cc_excl} excl. self)"
          + ("  [already counted via another entry -- excluded from totals]" if already_counted else ""))

    if recid and cc > 0 and recid not in recid_year_cache:
        year_counts, missing, corrected = inspire_citations_by_year(recid, floor_year)
        recid_year_cache[recid] = year_counts
        totals["missing_dates"] += missing
        totals["corrected_years"] += corrected
        if corrected:
            print(f"    (corrected {corrected} citing paper(s) with an impossible pre-{floor_year} date)")
    year_counts = recid_year_cache.get(recid, {})

    if not already_counted:
        seen_recids.add(recid)
        totals["citations"] += cc
        totals["citations_excl_self"] += cc_excl
        merge_year_counts(citations_by_year, year_counts)

    papers.append({
        "key": key, "source": "inspire", "recid": recid, "found_via": via,
        "citation_count": cc, "citation_count_excl_self": cc_excl,
        "counted_in_totals": not already_counted,
        "citations_by_year": dict(year_counts),  # copy -- this paper's own history
    })


def resolve_floor_year(fields):
    """This bib entry's own year, preferring the arXiv-posting year decoded
    from `eprint` (YYMM) over the bibtex `year` field -- mirrors resolveYear()
    in js/publications.js, so "this paper's year" means the same thing on
    both sides. Used as the floor a citation year can't legitimately predate."""
    eprint = fields.get("eprint", "")
    m = re.match(r"^(\d{2})(\d{2})", eprint)
    if m:
        return 2000 + int(m.group(1))
    year = fields.get("year", "")
    digits = re.sub(r"[^\d]", "", year)
    return int(digits) if digits else None


def main():
    if not BIB_PATH.exists():
        print(f"Couldn't find {BIB_PATH}", file=sys.stderr)
        sys.exit(1)

    entries = parse_bibtex(BIB_PATH.read_text(encoding="utf-8"))
    print(f"Found {len(entries)} entries in bibliography.bib\n")

    citations_by_year = {}
    papers = []
    seen_recids = set()
    recid_year_cache = {}
    totals = {"citations": 0, "citations_excl_self": 0, "missing_dates": 0, "corrected_years": 0}

    for entry in entries:
        key = entry["key"]
        fields = entry["fields"]
        print(f"[{key}]")

        if "citecount_manual" in fields:
            count = int(re.sub(r"[^\d]", "", fields["citecount_manual"]) or 0)
            print(f"    manual override: {count} citations")
            totals["citations"] += count
            totals["citations_excl_self"] += count
            papers.append({"key": key, "source": "manual", "citation_count": count})

        elif "eprint" in fields:
            result = inspire_lookup_by_arxiv(fields["eprint"])
            if result is None:
                papers.append({"key": key, "source": "inspire", "error": "lookup failed"})
                apply_citeyears_manual(fields, citations_by_year, papers)
                continue
            recid, cc, cc_excl = result
            process_inspire_record(key, recid, cc, cc_excl, "arxiv", seen_recids, totals, citations_by_year, papers, recid_year_cache, resolve_floor_year(fields))

        elif "doi" in fields:
            # Try INSPIRE by DOI first -- entries without an `eprint` field
            # in the .bib are often still real INSPIRE-tracked papers (e.g.
            # incomplete bib entries, or proceedings entered without the
            # arXiv ID). This matters a lot: Crossref only sees citations
            # from other Crossref-registered (mostly published) works, never
            # from arXiv preprints -- which is how most HEP citations happen,
            # often long before journal publication. So skipping straight to
            # Crossref for these would badly undercount them.
            result = inspire_lookup_by_doi(fields["doi"])
            if result is not None:
                recid, cc, cc_excl = result
                process_inspire_record(key, recid, cc, cc_excl, "doi", seen_recids, totals, citations_by_year, papers, recid_year_cache, resolve_floor_year(fields))
            else:
                # Not on INSPIRE. Try Semantic Scholar and Crossref and take
                # the higher count -- Semantic Scholar indexes more broadly
                # (including some things Crossref misses), but coverage
                # varies by paper, so neither is reliably better than the
                # other across every field.
                s2_count = semantic_scholar_citation_count(fields["doi"])
                cr_count = crossref_citation_count(fields["doi"])
                candidates = [(n, src) for n, src in [(s2_count, "semanticscholar"), (cr_count, "crossref")] if n is not None]
                if not candidates:
                    papers.append({"key": key, "source": None, "error": "not found on INSPIRE, Semantic Scholar, or Crossref"})
                    apply_citeyears_manual(fields, citations_by_year, papers)
                    continue
                count, source = max(candidates, key=lambda c: c[0])
                print(f"    Not on INSPIRE. Semantic Scholar: {s2_count if s2_count is not None else 'n/a'}, "
                      f"Crossref: {cr_count if cr_count is not None else 'n/a'} -> using {source} ({count}) "
                      f"(no per-year breakdown available from either)")
                totals["citations"] += count
                totals["citations_excl_self"] += count  # neither source distinguishes self-citations
                papers.append({"key": key, "source": source, "citation_count": count})

        else:
            print("    no eprint, doi, or citecount_manual field -- skipped")
            papers.append({"key": key, "source": None, "error": "no citation source available"})

        apply_citeyears_manual(fields, citations_by_year, papers)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total_citations": totals["citations"],
        "total_citations_excl_self_citations": totals["citations_excl_self"],
        "citations_by_year": citations_by_year,
        "papers": papers,
        "notes": (
            "citations_by_year is built only from INSPIRE-tracked papers (via their "
            "citation graph), and counts each citation the year the CITING paper "
            "appeared, aggregated across all of your papers -- not the year your own "
            "paper was published. Papers resolved via Semantic Scholar, Crossref, or "
            "citecount_manual contribute to total_citations but not to the per-year "
            "breakdown, since none of those sources expose a citing-paper list. Entries "
            "that resolve to the same INSPIRE record as an earlier entry (e.g. a preprint "
            "+ its later published version) are only counted once in the totals/chart -- "
            "see each paper's 'counted_in_totals' flag."
            + (f" {totals['missing_dates']} citing paper(s) had no retrievable date and "
               f"couldn't be placed in the per-year breakdown, though they still count "
               f"toward each paper's own citation_count." if totals["missing_dates"] else "")
            + (f" {totals['corrected_years']} citing paper(s) had a date earlier than the "
               f"cited paper itself (likely bad INSPIRE metadata, e.g. a replaced arXiv "
               f"record) and had their year corrected to the citing paper's own journal "
               f"year, or failing that, the cited paper's year." if totals["corrected_years"] else "")
        ),
    }

    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {OUT_PATH}")
    print(f"Total citations: {totals['citations']} ({totals['citations_excl_self']} excl. self-citations)")
    if totals["missing_dates"]:
        print(f"Note: {totals['missing_dates']} citing paper(s) had no date and were excluded from the per-year breakdown.")
    if totals["corrected_years"]:
        print(f"Note: {totals['corrected_years']} citing paper(s) had an impossible pre-publication date and were corrected.")


if __name__ == "__main__":
    main()