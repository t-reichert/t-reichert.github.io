// ==========================================================================
// Builds the publication list on publications.html from bibliography.bib.
// No build step: the .bib file is fetched and parsed in the browser.
// Edit bibliography.bib and push — the list updates automatically.
// ==========================================================================

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
  statEl.innerHTML = `<strong>${total}</strong> citation${total === 1 ? "" : "s"}`;
  statEl.style.display = "";
}