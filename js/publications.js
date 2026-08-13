// ==========================================================================
// Builds the publication list on publications.html from bibliography.bib.
// No build step: the .bib file is fetched and parsed in the browser.
// Edit bibliography.bib and push — the list updates automatically.
// ==========================================================================

const MY_NAME_MATCHES = ["Reichert", "Reichert, Tom", "Reichert, T.", "Tom Reichert", "T. Reichert"];

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

  // Fetched once, shared between the citation stat line, the chart-view
  // toggle (which doesn't depend on the publication list), and the
  // per-paper citation counts (which do -- so entries only render once this
  // has resolved, avoiding a race where counts could arrive before their
  // DOM elements exist).
  const citationsPromise = fetchCitationsData();
  citationsPromise.then(renderCitationStat);

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
      // Sort newest -> oldest by resolveYear (arXiv year when available).
      entries.sort((a, b) => (resolveYear(b) || 0) - (resolveYear(a) || 0));

      return citationsPromise.then(citationsData => {
        setupChartViews(entries, citationsData);

        const citationLookup = buildCitationLookup(citationsData);
        renderGroupedList(entries, listEl, citationLookup);
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
      });
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
    i++;
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
  s = s.replace(/\\(["'`^~])\{?([a-zA-Z])\}?/g, (m, acc, ch) => ACCENT_MAP[acc + ch] || ch);
  s = s.replace(/\\c\{([a-zA-Z])\}/g, (m, c) => CEDILLA_MAP[c] || c);
  s = s.replace(/\\v\{([a-zA-Z])\}/g, (m, c) => CARON_MAP[c] || c);
  s = s.replace(/\\(aa|AA|ss|ae|AE|oe|OE|o|O|l|L|i|j)(?![a-zA-Z])\{?\}?/g, (m, cmd) => LONE_MACRO_MAP[cmd] || m);
  s = s.replace(/---/g, "—").replace(/--/g, "–");
  s = s.replace(/``/g, "\u201C").replace(/''/g, "\u201D");
  s = s.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\_/g, "_").replace(/\\#/g, "#");
  s = s.replace(/~/g, " ");
  return s;
}

function stripBraces(s) {
  return (s || "").replace(/[{}]/g, "");
}

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

function latexField(raw) {
  if (!raw) return "";
  const { placeholder, maths } = protectMath(raw);
  const decoded = decodeLatexAccents(placeholder);
  const stripped = stripBraces(decoded);
  return restoreMath(stripped, maths);
}

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

// The year used for sorting, section-heading, and the publications-per-year
// chart: prefers the arXiv posting year (decoded from the eprint ID's YYMM)
// over the bibtex `year` field, since the latter is often the (sometimes
// much later) journal publication year. This matches how INSPIRE orders
// and groups papers on author pages. Note: the meta line under each entry
// still shows its own `year` field as-is (that's the citation year, which
// is correctly the journal year) -- only ordering/grouping changes here.
function resolveYear(entry) {
  const eprint = entry.fields.eprint || "";
  const m = eprint.match(/^(\d{2})(\d{2})/);
  if (m) {
    const yy = parseInt(m[1], 10);
    return 2000 + yy; // all modern arXiv IDs (post-2007) are 20xx
  }
  return parseInt(entry.fields.year, 10) || null;
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

function buildBibtexText(entry, excludeFields = []) {
  const keys = Object.keys(entry.fields).filter(k => !excludeFields.includes(k));
  const width = keys.reduce((max, k) => Math.max(max, k.length), 0);
  const lines = keys.map(k => `  ${k.padEnd(width)} = {${entry.fields[k]}},`);
  return `@${entry.type}{${entry.key},\n${lines.join("\n")}\n}`;
}

function renderEntry(entry, citationLookup) {
  const cat = categorize(entry);
  const tag = TAG_MAP[cat] || TAG_MAP.other;
  const title = escapeHtml(latexField(entry.fields.title || "Untitled"));
  const meta = buildMeta(entry);
  const authorsHtml = buildAuthorsHtml(entry);
  const links = buildLinks(entry);
  const linksHtml = links.map(l =>
    `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${l.label}</a>`
  ).join("");

  const hasAbstract = Boolean(entry.fields.abstract);
  const abstractHtml = hasAbstract ? escapeHtml(latexField(entry.fields.abstract)) : "";
  const abstractBtn = hasAbstract ? `<button class="abstract-toggle" type="button">[ abstract ]</button>` : "";
  const abstractBlock = hasAbstract ? `<div class="abstract-block"><p>${abstractHtml}</p></div>` : "";

  const bibtexText = buildBibtexText(entry, ["abstract"]);

  const citeCount = citationLookup ? citationLookup.get(entry.key) : undefined;
  const citeCountHtml = citeCount != null
    ? `<span class="pub-citecount">${citeCount} citation${citeCount === 1 ? "" : "s"}</span>`
    : "";

  return `
    <li class="pub-item" data-type="${cat}" data-key="${escapeHtml(entry.key)}">
      <div class="pub-top">
        <h3 class="pub-title">${title}</h3>
        <div class="pub-top-right">
          <span class="tag ${tag.cls}">${tag.label}</span>
          ${citeCountHtml}
        </div>
      </div>
      <p class="pub-meta">${meta}</p>
      ${authorsHtml ? `<p class="pub-authors">${authorsHtml}</p>` : ""}
      <div class="pub-links">
        ${linksHtml}
        ${abstractBtn}
        <button class="bibtex-toggle" type="button">[ bibtex ]</button>
      </div>
      ${abstractBlock}
      <div class="bibtex-block">${escapeHtml(bibtexText)}</div>
    </li>`;
}

// -------------------- Grouped, foldable year sections --------------------

function renderGroupedList(entries, listEl, citationLookup) {
  const groups = new Map(); // year (number|"Undated") -> entries[]
  entries.forEach(e => {
    const y = resolveYear(e) || "Undated";
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
    const itemsHtml = groupEntries.map(e => renderEntry(e, citationLookup)).join("");
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

// -------------------- Generic per-year bar chart --------------------
// Shared by the "publications per year" and "citations per year" charts.

function renderBarChart(counts, chartEl, { ariaLabel, onBarClick, unitLabel = "" } = {}) {
  if (!chartEl) return;
  if (!counts || counts.size === 0) { chartEl.style.display = "none"; return; }
  chartEl.style.display = "";

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

  const gradId = `grad_${Math.random().toString(36).slice(2, 9)}`;

  const bars = allYears.map((year, i) => {
    const count = counts.get(year) || 0;
    const h = count === 0 ? 0 : Math.max(4, (count / maxCount) * chartH);
    const x = padL + i * (barW + gap);
    const y = baseY - h;
    const cx = x + barW / 2;
    const label = count === 0 ? "" :
      `<text x="${cx}" y="${y - 6}" text-anchor="middle" class="pub-chart-count">${count}</text>`;
    return `
      <g class="pub-chart-bar" data-year="${year}" style="transform-origin: ${cx}px ${baseY}px; transition-delay:${i * 28}ms;">
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="url(#${gradId})"></rect>
        ${label}
        <title>${year}: ${count} ${unitLabel}${count === 1 ? "" : (unitLabel ? "s" : "")}</title>
      </g>
      <text x="${cx}" y="${baseY + 18}" text-anchor="middle" class="pub-chart-year">${String(year).slice(2)}</text>`;
  }).join("");

  chartEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ariaLabel || "Chart"}">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="var(--violet)"/>
          <stop offset="55%" stop-color="var(--magenta)"/>
          <stop offset="100%" stop-color="var(--gold)"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>
      ${bars}
    </svg>`;

  requestAnimationFrame(() => requestAnimationFrame(() => chartEl.classList.add("loaded")));

  if (onBarClick) {
    chartEl.querySelectorAll(".pub-chart-bar").forEach(bar => {
      bar.addEventListener("click", () => onBarClick(bar.dataset.year));
    });
  }
}

// -------------------- Chart views (publications <-> citations, toggled by arrows) --------------------

let chartViews = [];
let chartViewIndex = 0;

function computePubCounts(entries) {
  const counts = new Map();
  entries.forEach(e => {
    const y = resolveYear(e);
    if (!y) return;
    counts.set(y, (counts.get(y) || 0) + 1);
  });
  return counts;
}

function pubBarClickHandler(year) {
  const group = document.querySelector(`.pub-year-group[data-year="${year}"]`);
  if (!group) return;
  group.classList.remove("collapsed");
  group.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Called once both bibliography.bib and citations.json have resolved. Builds
// the list of chart "views" to cycle through -- publications-per-year is
// always first/default; citations-per-year is only added if citations.json
// actually has per-year data (i.e. the script's been run and found at least
// one INSPIRE-tracked paper).
function setupChartViews(entries, citationsData) {
  chartViews = [
    { title: "Publications per year", counts: computePubCounts(entries), unitLabel: "publication", onBarClick: pubBarClickHandler },
  ];
  if (citationsData && citationsData.citations_by_year && Object.keys(citationsData.citations_by_year).length) {
    const counts = new Map(Object.entries(citationsData.citations_by_year).map(([y, c]) => [parseInt(y, 10), c]));
    chartViews.push({ title: "Citations per year", counts, unitLabel: "citation" });
  }
  chartViewIndex = 0;
  renderCurrentChartView();
  wireChartArrows();
}

function renderCurrentChartView() {
  const cardEl = document.getElementById("pub-chart-card");
  const bodyEl = document.getElementById("pub-chart-body");
  const titleEl = document.getElementById("pub-chart-title");
  const prevBtn = document.getElementById("pub-chart-prev");
  const nextBtn = document.getElementById("pub-chart-next");
  if (!cardEl || !bodyEl || chartViews.length === 0) return;

  const view = chartViews[chartViewIndex];
  if (titleEl) titleEl.textContent = view.title;
  renderBarChart(view.counts, bodyEl, { ariaLabel: view.title, unitLabel: view.unitLabel, onBarClick: view.onBarClick });

  const showArrows = chartViews.length > 1;
  if (prevBtn) prevBtn.style.display = showArrows ? "" : "none";
  if (nextBtn) nextBtn.style.display = showArrows ? "" : "none";
}

let chartArrowsWired = false;
function wireChartArrows() {
  if (chartArrowsWired) return; // only need to attach the listeners once
  chartArrowsWired = true;
  const prevBtn = document.getElementById("pub-chart-prev");
  const nextBtn = document.getElementById("pub-chart-next");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    chartViewIndex = (chartViewIndex - 1 + chartViews.length) % chartViews.length;
    renderCurrentChartView();
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    chartViewIndex = (chartViewIndex + 1) % chartViews.length;
    renderCurrentChartView();
  });
}

// -------------------- Citations (from citations.json, see scripts/fetch_citations.py) --------------------

function fetchCitationsData() {
  return fetch("citations.json")
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
}

function buildCitationLookup(data) {
  const map = new Map();
  if (data && Array.isArray(data.papers)) {
    data.papers.forEach(p => {
      if (p.citation_count != null) map.set(p.key, p.citation_count);
    });
  }
  return map;
}

// Just the total-citations stat line; the citations-per-year chart is
// handled by setupChartViews() above since it shares the chart card with
// the publications-per-year chart.
function renderCitationStat(data) {
  const statEl = document.getElementById("citation-stat");
  if (!statEl) return;
  if (!data) { statEl.style.display = "none"; return; }
  const total = data.total_citations ?? 0;
  const exclSelf = data.total_citations_excl_self_citations;
  statEl.innerHTML = `<strong>${total}</strong> citation${total === 1 ? "" : "s"}` +
    (exclSelf != null && exclSelf !== total ? ` <span class="muted">(${exclSelf} excl. self-citations)</span>` : "");
  statEl.style.display = "";
}