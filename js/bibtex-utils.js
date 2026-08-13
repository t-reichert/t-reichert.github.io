// ==========================================================================
// bibtex-utils.js — shared BibTeX parsing, LaTeX decoding, and citation
// formatting used by both publications.js and research.js. Load this
// script BEFORE either of those on any page that needs it.
// ==========================================================================

// Your surname(s) as they appear in the .bib file's author fields — any author
// entry containing one of these (case-insensitive) is bolded in author lists.
const MY_NAME_MATCHES = ["Reichert", "Reichert, Tom", "Reichert, T.", "Tom Reichert", "T. Reichert"];

const TAG_MAP = {
  journal:     { label: "Journal",     cls: "tag-gold" },
  proceedings: { label: "Proceedings", cls: "tag-magenta" },
  preprint:    { label: "Preprint",    cls: "tag-violet" },
  thesis:      { label: "Thesis",      cls: "tag-gold" },
  other:       { label: "Other",       cls: "tag-violet" },
};

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
  if (["phdthesis", "mastersthesis", "thesis"].includes(t)) return "thesis";
  if (["misc", "unpublished"].includes(t)) return "preprint";
  return "other";
}

function resolveYear(entry) {
  const eprint = entry.fields.eprint || "";
  const m = eprint.match(/^(\d{2})(\d{2})/);
  if (m) {
    const yy = parseInt(m[1], 10);
    return 2000 + yy;
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