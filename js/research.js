// ==========================================================================
// research.html only: fills in each project's "Related publications" list
// by matching the data-keys attribute on .related-pubs elements against
// entries in bibliography.bib. Relies on js/bibtex-utils.js being loaded
// first (parseBibtex, latexField, buildMeta, buildLinks, etc.)
//
// Usage in research.html:
//   <div class="related-pubs" data-keys="Reichert:2022mek, Reichert:2023eev">
//     <ul class="related-pubs-list"></ul>
//   </div>
// Leave data-keys="" empty and it shows a small instructional hint instead.
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
    const containers = document.querySelectorAll(".related-pubs");
    if (containers.length === 0) return; // not on a page that uses this
  
    fetch("bibliography.bib")
      .then(res => (res.ok ? res.text() : Promise.reject(new Error(`status ${res.status}`))))
      .then(text => {
        const entries = parseBibtex(text);
        const byKey = new Map(entries.map(e => [e.key, e]));
        containers.forEach(el => renderRelatedPubs(el, byKey));
      })
      .catch(() => {
        containers.forEach(el => {
          el.innerHTML = `<p class="muted small">Couldn't load bibliography.bib to look up related publications.</p>`;
        });
      });
  
    // KaTeX for any $...$ math in the project prose itself (titles pulled
    // from bib entries are handled separately, after they're inserted below).
    if (window.renderMathInElement) {
      window.renderMathInElement(document.querySelector("main"), {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    }
  });
  
  function renderRelatedPubs(container, byKey) {
    const listEl = container.querySelector(".related-pubs-list");
    if (!listEl) return;
  
    const keys = (container.dataset.keys || "")
      .split(",")
      .map(k => k.trim())
      .filter(Boolean);
  
    if (keys.length === 0) {
      listEl.innerHTML = `<li class="muted small">
        No linked publications yet — add <span class="mono">data-keys="YourBibKey, AnotherKey"</span>
        to this section's <span class="mono">.related-pubs</span> div, matching citation keys in bibliography.bib.
      </li>`;
      return;
    }
  
    const found = keys.map(k => byKey.get(k)).filter(Boolean);
    const missing = keys.filter(k => !byKey.has(k));
  
    if (found.length === 0) {
      listEl.innerHTML = `<li class="muted small">None of the keys in data-keys matched bibliography.bib (checked: ${escapeHtml(keys.join(", "))}).</li>`;
      return;
    }
  
    found.sort((a, b) => (resolveYear(b) || 0) - (resolveYear(a) || 0));
  
    listEl.innerHTML = found.map(renderRelatedPubItem).join("")
      + (missing.length ? `<li class="muted small">Also referenced but not found in bibliography.bib: ${escapeHtml(missing.join(", "))}</li>` : "");
  
    if (window.renderMathInElement) {
      window.renderMathInElement(listEl, {
        delimiters: [{ left: "$", right: "$", display: false }],
        throwOnError: false,
      });
    }
  }
  
  function renderRelatedPubItem(entry) {
    const cat = categorize(entry);
    const tag = TAG_MAP[cat] || TAG_MAP.other;
    const title = escapeHtml(latexField(entry.fields.title || "Untitled"));
    const meta = buildMeta(entry);
    const links = buildLinks(entry);
    const linksHtml = links.map(l =>
      `<a href="${escapeHtml(l.href)}" target="_blank" rel="noopener">${l.label}</a>`
    ).join("");
  
    return `
      <li class="related-pub">
        <span class="tag ${tag.cls}">${tag.label}</span>
        <span class="related-pub-title">${title}</span>
        <span class="related-pub-meta">${meta}</span>
        <span class="related-pub-links">${linksHtml}</span>
      </li>`;
  }