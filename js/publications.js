// ==========================================================================
// Builds the publication list on publications.html from bibliography.bib.
// No build step: the .bib file is fetched and parsed in the browser.
// Edit bibliography.bib and push — the list updates automatically.
// ==========================================================================

// Your surname(s) as they appear in the .bib file's author fields — any author
// entry containing one of these (case-insensitive) is bolded in the byline.
const MY_NAME_MATCHES = ["Rieger"];

const TAG_MAP = {
  journal:     { label: "Journal",     cls: "tag-gold" },
  proceedings: { label: "Proceedings", cls: "tag-magenta" },
  preprint:    { label: "Preprint",    cls: "tag-violet" },
  thesis:      { label: "Thesis",      cls: "tag-gold" },
  other:       { label: "Other",       cls: "tag-violet" },
};

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("pub-list");
  if (!listEl) return; // not on the publications page
  const chartEl = document.getElementById("pub-chart");

  fetch("bibliography.bib")
    .then(res => {
      if (!res.ok) throw new Error(`bibliography.bib returned ${res.status}`);
      return res.text();
    })
    .then(text => {
      const entries = parseBibtex(text);
      if (entries.length === 0) {
        listEl.innerHTML = emptyState("No entries found in bibliography.bib yet.");
        return;
      }
      // Sort newest -> oldest by the entry's own `year` field (matches what's
      // printed in each entry's meta line).
      entries.sort((a, b) => (parseInt(b.fields.year) || 0) - (parseInt(a.fields.year) || 0));

      renderChart(entries, chartEl);
      renderGroupedList(entries, listEl);
      wireYearToggles();

      // KaTeX: render any $...$ math found inside the list (titles etc.)
      if (window.renderMathInElement) {
        window.renderMathInElement(listEl, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
          ],
          throwOnError: false,
        });
      }

      if (window.applyPubFilters) window.applyPubFilters();
    })
    .catch(err => {
      listEl.innerHTML = emptyState(
        `Couldn't load bibliography.bib (${escapeHtml(err.message)}). ` +
        `If you're opening this file directly (file://), browsers block that fetch — ` +
        `run a local server instead (see README.md), or check the file is deployed alongside this page.`
      );
    });
});

function emptyState(msg) {
  return `<li class="pub-item"><p class="muted small">${msg}</p></li>`;
}

// -------------------- BibTeX parsing --------------------
// A compact, tolerant parser: handles @type{key, field = {value}, field = "value",
// field = 123, ...}, with brace-balanced values (so nested {Protected} words in
// titles are handled) and comment lines between entries.

function parseBibtex(text) {
  const entries = [];
  const entryStart = /@(\w+)\s*\{/g;
  let m;
  while ((m = entryStart.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const braceOpen = text.indexOf("{", m.index);
    let depth = 1, i = braceOpen + 1;
    while (depth > 0 && i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    const body = text.slice(braceOpen + 1, i - 1);
    const raw = text.slice(m.index, i).trim();
    entryStart.lastIndex = i;
    const parsed = parseEntryBody(body);
    if (parsed) entries.push({ type, key: parsed.key, fields: parsed.fields, raw });
  }
  return entries;
}

function parseEntryBody(body) {
  let depth = 0, commaIdx = -1;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) { commaIdx = j; break; }
  }
  if (commaIdx === -1) return null;
  const key = body.slice(0, commaIdx).trim();
  const rest = body.slice(commaIdx + 1);
  const fields = {};
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /[\s,]/.test(rest[i])) i++;
    if (i >= rest.length) break;
    const fkStart = i;
    while (i < rest.length && rest[i] !== "=") i++;
    if (i >= rest.length) break;
    const fieldKey = rest.slice(fkStart, i).trim().toLowerCase();
    i++; // skip '='
    while (i < rest.length && /\s/.test(rest[i])) i++;
    let value = "";
    if (rest[i] === "{") {
      let d = 1; i++;
      const vStart = i;
      while (d > 0 && i < rest.length) {
        if (rest[i] === "{") d++;
        else if (rest[i] === "}") d--;
        if (d > 0) i++;
      }
      value = rest.slice(vStart, i);
      i++;
    } else if (rest[i] === '"') {
      i++;
      const vStart = i;
      while (i < rest.length && rest[i] !== '"') i++;
      value = rest.slice(vStart, i);
      i++;
    } else {
      const vStart = i;
      while (i < rest.length && rest[i] !== ",") i++;
      value = rest.slice(vStart, i).trim();
    }
    if (fieldKey) fields[fieldKey] = value.trim();
  }
  return { key, fields };
}

// -------------------- LaTeX -> plain text / math --------------------
// Handles two independent things BibTeX exports often contain:
//   1. Accent macros for names/titles, e.g. Bergstr{\"o}m, {\'e}cole, Schr{\"o}dinger
//   2. Inline math, e.g. $\sqrt{s_{NN}} = 200$ GeV — this is left untouched and
//      handed to KaTeX for real typesetting rather than being decoded as text.

const ACCENT_MAP = {
  '"a':'ä','"o':'ö','"u':'ü','"A':'Ä','"O':'Ö','"U':'Ü',
  "'a":'á',"'e":'é',"'i":'í',"'o":'ó',"'u":'ú',"'y":'ý',"'c":'ć',"'n":'ń',"'s":'ś',"'z":'ź',
  "'A":'Á',"'E":'É',"'I":'Í',"'O":'Ó',"'U":'Ú',"'C":'Ć',"'N":'Ń',
  '`a':'à','`e':'è','`i':'ì','`o':'ò','`u':'ù','`A':'À','`E':'È','`O':'Ò','`U':'Ù',
  '^a':'â','^e':'ê','^i':'î','^o':'ô','^u':'û','^A':'Â','^E':'Ê','^O':'Ô','^U':'Û',
  '~n':'ñ','~a':'ã','~o':'õ','~N':'Ñ','~A':'Ã','~O':'Õ',
};
const CEDILLA_MAP = { c:'ç', C:'Ç' };
const CARON_MAP = { s:'š', S:'Š', c:'č', C:'Č', z:'ž', Z:'Ž', r:'ř', R:'Ř', e:'ě', E:'Ě', n:'ň', N:'Ň' };
const LONE_MACRO_MAP = {
  aa:'å', AA:'Å', o:'ø', O:'Ø', l:'ł', L:'Ł',
  ss:'ß', ae:'æ', AE:'Æ', oe:'œ', OE:'Œ', i:'ı', j:'ȷ',
};

function decodeLatexAccents(s) {
  if (!s) return s;
  // \"a, \'e, \`a, \^o, \~n  (with or without braces: \"{a} / \"a)
  s = s.replace(/\\(["'`^~])\{?([a-zA-Z])\}?/g, (m, acc, ch) => ACCENT_MAP[acc + ch] || ch);
  // \c{c} cedilla, \v{s} caron — these need the braces to disambiguate
  s = s.replace(/\\c\{([a-zA-Z])\}/g, (m, c) => CEDILLA_MAP[c] || c);
  s = s.replace(/\\v\{([a-zA-Z])\}/g, (m, c) => CARON_MAP[c] || c);
  // lone macros: \aa \AA \ss \ae \AE \oe \OE \o \O \l \L \i \j (not followed by a letter)
  s = s.replace(/\\(aa|AA|ss|ae|AE|oe|OE|o|O|l|L|i|j)(?![a-zA-Z])\{?\}?/g, (m, cmd) => LONE_MACRO_MAP[cmd] || m);
  // dashes, smart quotes, escaped specials
  s = s.replace(/---/g, "—").replace(/--/g, "–");
  s = s.replace(/``/g, "\u201C").replace(/''/g, "\u201D");
  s = s.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\_/g, "_").replace(/\\#/g, "#");
  s = s.replace(/~/g, " "); // non-breaking space in LaTeX source -> normal space
  return s;
}

function stripBraces(s) {
  return (s || "").replace(/[{}]/g, "");
}

// Pulls out $...$ / $$...$$ math spans so accent-decoding and brace-stripping
// don't mangle LaTeX math syntax (which relies on braces, e.g. s_{NN}).
function protectMath(s) {
  const maths = [];
  const placeholder = (s || "").replace(/\$\$[^$]*\$\$|\$[^$]*\$/g, (match) => {
    maths.push(match);
    return `\u0000MATH${maths.length - 1}\u0000`;
  });
  return { placeholder, maths };
}
function restoreMath(s, maths) {
  return s.replace(/\u0000MATH(\d+)\u0000/g, (m, i) => maths[+i]);
}

// Full pipeline for a display field: protect math -> decode accents -> strip
// leftover protective braces -> restore math untouched.
function latexField(raw) {
  if (!raw) return "";
  const { placeholder, maths } = protectMath(raw);
  const decoded = decodeLatexAccents(placeholder);
  const stripped = stripBraces(decoded);
  return restoreMath(stripped, maths);
}

// Author names don't contain math; just decode accents + strip braces.
function latexPlain(raw) {
  return stripBraces(decodeLatexAccents(raw || ""));
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// -------------------- Categorization & year resolution --------------------

function categorize(entry) {
  const t = entry.type;
  if (t === "article") {
    const journal = (entry.fields.journal || "").toLowerCase();
    if (!entry.fields.journal || journal.includes("arxiv")) return "preprint";
    return "journal";
  }
  if (["inproceedings", "proceedings", "conference"].includes(t)) return "proceedings";
  if (["phdthesis", "mastersthesis"].includes(t)) return "thesis";
  if (["misc", "unpublished"].includes(t)) return "preprint";
  return "other";
}

// The year shown in each entry's own meta line — used to group/sort the list.
function headingYear(entry) {
  return parseInt(entry.fields.year, 10) || null;
}

// arXiv IDs encode YYMM (e.g. 2607.xxxxx -> posted 2026-07). The chart uses
// this "went public" year when available, since that's usually more useful
// for a career timeline than the (often later) journal publication year.
function chartYear(entry) {
  const eprint = entry.fields.eprint || "";
  const m = eprint.match(/^(\d{2})(\d{2})/);
  if (m) {
    const yy = parseInt(m[1], 10);
    return 2000 + yy; // all modern arXiv IDs (post-2007) are 20xx
  }
  return headingYear(entry);
}

// -------------------- Author / meta / links --------------------

function formatAuthor(a) {
  a = latexPlain(a).trim();
  if (a.includes(",")) {
    const [last, first] = a.split(",").map(s => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return a;
}

function buildAuthorsHtml(entry) {
  const raw = entry.fields.author;
  if (!raw) return "";
  const authors = raw.split(/\s+and\s+/i).map(formatAuthor);
  return authors.map(name => {
    const isMe = MY_NAME_MATCHES.some(n => name.toLowerCase().includes(n.toLowerCase()));
    const safe = escapeHtml(name);
    return isMe ? `<span class="me">${safe}</span>` : safe;
  }).join(", ");
}

function buildMeta(entry) {
  const f = entry.fields;
  const year = f.year || "";
  const cat = categorize(entry);

  if (cat === "preprint") {
    const arxivId = f.eprint || "";
    const src = f.archiveprefix || (arxivId ? "arXiv" : "");
    return escapeHtml(`${src ? src + ":" : ""}${arxivId || "preprint"}${year ? " (" + year + ")" : ""}`);
  }
  if (entry.type === "article") {
    let s = latexField(f.journal || "");
    if (f.volume) s += ` ${f.volume}`;
    if (f.pages) s += `, ${f.pages}`;
    if (year) s += ` (${year})`;
    return escapeHtml(s);
  }
  if (cat === "proceedings") {
    let s = latexField(f.booktitle || "");
    if (f.volume) s += `, vol. ${f.volume}`;
    if (f.pages) s += `, ${f.pages}`;
    if (year) s += ` (${year})`;
    return escapeHtml(s);
  }
  if (entry.type === "phdthesis") return escapeHtml(`PhD Dissertation, ${latexField(f.school || "")}${year ? " (" + year + ")" : ""}`);
  if (entry.type === "mastersthesis") return escapeHtml(`Master's Thesis, ${latexField(f.school || "")}${year ? " (" + year + ")" : ""}`);
  let s = latexField(f.howpublished || f.journal || f.booktitle || "");
  if (year) s += ` (${year})`;
  return escapeHtml(s);
}

function buildLinks(entry) {
  const f = entry.fields;
  const links = [];
  if (f.doi) links.push({ label: "DOI", href: `https://doi.org/${f.doi}` });
  if (f.eprint) {
    const prefix = (f.archiveprefix || "arxiv").toLowerCase();
    if (prefix.includes("arxiv")) links.push({ label: "arXiv", href: `https://arxiv.org/abs/${f.eprint}` });
  }
  if (f.pdf) links.push({ label: "PDF", href: f.pdf });
  if (f.url && !links.some(l => l.href === f.url)) links.push({ label: "Link", href: f.url });
  return links;
}

function renderEntry(entry) {
  const cat = categorize(entry);
  const tag = TAG_MAP[cat] || TAG_MAP.other;
  // NOTE: title is left with its $...$ math spans intact (escaped for HTML
  // safety, but not stripped) — KaTeX's auto-render finds and typesets them
  // after this HTML is inserted into the page.
  const title = escapeHtml(latexField(entry.fields.title || "Untitled"));
  const meta = buildMeta(entry);
  const authorsHtml = buildAuthorsHtml(entry);
  const links = buildLinks(entry);
  const linksHtml = links.map(l =>
    `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${l.label}</a>`
  ).join("");

  return `
    <li class="pub-item" data-type="${cat}">
      <div class="pub-top">
        <h3 class="pub-title">${title}</h3>
        <span class="tag ${tag.cls}">${tag.label}</span>
      </div>
      <p class="pub-meta">${meta}</p>
      ${authorsHtml ? `<p class="pub-authors">${authorsHtml}</p>` : ""}
      <div class="pub-links">
        ${linksHtml}
        <button class="bibtex-toggle" type="button">[ bibtex ]</button>
      </div>
      <div class="bibtex-block">${escapeHtml(entry.raw)}</div>
    </li>`;
}

// -------------------- Grouped, foldable year sections --------------------

function renderGroupedList(entries, listEl) {
  const groups = new Map(); // year (number|"Undated") -> entries[]
  entries.forEach(e => {
    const y = headingYear(e) || "Undated";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(e);
  });

  const years = [...groups.keys()].sort((a, b) => {
    if (a === "Undated") return 1;
    if (b === "Undated") return -1;
    return b - a;
  });

  listEl.innerHTML = years.map(year => {
    const groupEntries = groups.get(year);
    const itemsHtml = groupEntries.map(renderEntry).join("");
    return `
      <li class="pub-year-group" data-year="${year}">
        <button class="pub-year-toggle" type="button" aria-expanded="true">
          <span class="chevron">▾</span>
          <span class="pub-year-label">${year}</span>
          <span class="pub-year-count">${groupEntries.length} paper${groupEntries.length === 1 ? "" : "s"}</span>
        </button>
        <ul class="pub-year-items">${itemsHtml}</ul>
      </li>`;
  }).join("");
}

function wireYearToggles() {
  document.querySelectorAll(".pub-year-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const group = btn.closest(".pub-year-group");
      const collapsed = group.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!collapsed));
    });
  });

  // Search/filter hook (called from main.js's applyPubFilters): hide groups
  // with zero visible entries, and force-expand groups during an active
  // search/filter so matches inside a collapsed year are still visible.
  window.onPubFiltersApplied = (query, type) => {
    const searching = Boolean(query) || (type && type !== "all");
    document.querySelectorAll(".pub-year-group").forEach(group => {
      const items = group.querySelectorAll(".pub-item");
      const anyVisible = [...items].some(item => item.style.display !== "none");
      group.classList.toggle("no-match", !anyVisible);
      group.classList.toggle("force-open", searching);
    });
  };
}

// -------------------- Publications-per-year bar chart --------------------

function renderChart(entries, chartEl) {
  if (!chartEl) return;

  const counts = new Map();
  entries.forEach(e => {
    const y = chartYear(e);
    if (!y) return;
    counts.set(y, (counts.get(y) || 0) + 1);
  });
  if (counts.size === 0) { chartEl.style.display = "none"; return; }

  const years = [...counts.keys()];
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const allYears = [];
  for (let y = minYear; y <= maxYear; y++) allYears.push(y);
  const maxCount = Math.max(...counts.values());

  const W = 720, H = 190;
  const padL = 30, padR = 16, padT = 18, padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = allYears.length;
  const gap = 10;
  const barW = Math.max(10, (chartW - gap * (n - 1)) / n);
  const baseY = padT + chartH;

  const bars = allYears.map((year, i) => {
    const count = counts.get(year) || 0;
    const h = count === 0 ? 0 : Math.max(4, (count / maxCount) * chartH);
    const x = padL + i * (barW + gap);
    const y = baseY - h;
    const cx = x + barW / 2;
    const label = count === 0 ? "" :
      `<text x="${cx}" y="${y - 6}" text-anchor="middle" class="pub-chart-count">${count}</text>`;
    return `
      <g class="pub-chart-bar" style="transform-origin: ${cx}px ${baseY}px; transition-delay:${i * 28}ms;">
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="url(#pubChartGrad)"></rect>
        ${label}
        <title>${year}: ${count} publication${count === 1 ? "" : "s"}</title>
      </g>
      <text x="${cx}" y="${baseY + 18}" text-anchor="middle" class="pub-chart-year">${String(year).slice(2)}</text>`;
  }).join("");

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Publications per year">
      <defs>
        <linearGradient id="pubChartGrad" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#8a63d2"/>
          <stop offset="55%" stop-color="#e2496b"/>
          <stop offset="100%" stop-color="#f2a93b"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#2b2f42" stroke-width="1"/>
      ${bars}
    </svg>`;

  // Trigger the grow-in transition on the next frame.
  requestAnimationFrame(() => requestAnimationFrame(() => chartEl.classList.add("loaded")));

  // Clicking a bar jumps to (and expands) that year's section in the list below.
  chartEl.querySelectorAll(".pub-chart-bar").forEach((bar, i) => {
    bar.addEventListener("click", () => {
      const year = allYears[i];
      const group = document.querySelector(`.pub-year-group[data-year="${year}"]`);
      if (!group) return;
      group.classList.remove("collapsed");
      group.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}