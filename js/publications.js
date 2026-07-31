// ==========================================================================
// Builds the publication list on publications.html from bibliography.bib.
// No build step: the .bib file is fetched and parsed in the browser.
// Edit bibliography.bib and push — the list updates automatically.
// ==========================================================================

// Your surname(s) as they appear in the .bib file's author fields — any author
// entry containing one of these (case-insensitive) is bolded in the byline.
const MY_NAME_MATCHES = ["Reichert"];

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
      entries.sort((a, b) => (parseInt(b.fields.year) || 0) - (parseInt(a.fields.year) || 0));
      listEl.innerHTML = entries.map(renderEntry).join("");
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
// titles are handled) and block comments/whitespace between entries.

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

// -------------------- Categorization & rendering --------------------

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

function stripBraces(s) {
  return (s || "").replace(/[{}]/g, "");
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function formatAuthor(a) {
  a = stripBraces(a).trim();
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
  const html = authors.map(name => {
    const isMe = MY_NAME_MATCHES.some(n => name.toLowerCase().includes(n.toLowerCase()));
    const safe = escapeHtml(name);
    return isMe ? `<span class="me">${safe}</span>` : safe;
  }).join(", ");
  return html;
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
    let s = stripBraces(f.journal || "");
    if (f.volume) s += ` ${f.volume}`;
    if (f.pages) s += `, ${f.pages}`;
    if (year) s += ` (${year})`;
    return escapeHtml(s);
  }
  if (cat === "proceedings") {
    let s = stripBraces(f.booktitle || "");
    if (f.volume) s += `, vol. ${f.volume}`;
    if (f.pages) s += `, ${f.pages}`;
    if (year) s += ` (${year})`;
    return escapeHtml(s);
  }
  if (entry.type === "phdthesis") return escapeHtml(`PhD Dissertation, ${stripBraces(f.school || "")}${year ? " (" + year + ")" : ""}`);
  if (entry.type === "mastersthesis") return escapeHtml(`Master's Thesis, ${stripBraces(f.school || "")}${year ? " (" + year + ")" : ""}`);
  let s = stripBraces(f.howpublished || f.journal || f.booktitle || "");
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
  const title = escapeHtml(stripBraces(entry.fields.title || "Untitled"));
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
        <button class="bibtex-toggle">[ bibtex ]</button>
      </div>
      <div class="bibtex-block">${escapeHtml(entry.raw)}</div>
    </li>`;
}