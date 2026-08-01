// ---------- Mobile nav ----------
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
    links.querySelectorAll("a").forEach(a =>
      a.addEventListener("click", () => links.classList.remove("open"))
    );
  }

  // ---------- Theme toggle (dark <-> Paper & Ink light) ----------
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    const getTheme = () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    const setTheme = (t) => {
      if (t === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      themeToggle.setAttribute("aria-pressed", t === "light" ? "true" : "false");
    };
    setTheme(getTheme());
    themeToggle.addEventListener("click", () => {
      const next = getTheme() === "light" ? "dark" : "light";
      try { localStorage.setItem("site-theme", next); } catch (e) {}
      setTheme(next);
    });
  }

  // Highlight current page in nav
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(a => {
    const href = a.getAttribute("href");
    if (href === here || (here === "" && href === "index.html")) {
      a.classList.add("active");
    }
  });

  // ---------- Publications: search + filter ----------
  // NOTE: pub-items are rendered async from bibliography.bib (see publications.js),
  // so this queries .pub-item live on every call rather than caching a NodeList once.
  const pubSearch = document.querySelector(".pub-search");
  const chips = document.querySelectorAll(".filter-chip");

  function applyPubFilters() {
    const query = (pubSearch?.value || "").toLowerCase();
    const activeChip = document.querySelector(".filter-chip.active");
    const type = activeChip ? activeChip.dataset.type : "all";

    document.querySelectorAll(".pub-item").forEach(item => {
      const text = item.textContent.toLowerCase();
      const itemType = item.dataset.type;
      const matchesQuery = text.includes(query);
      const matchesType = type === "all" || itemType === type;
      item.style.display = matchesQuery && matchesType ? "" : "none";
    });

    // Optional hook: publications.js uses this to fold/unfold year-group
    // sections and hide empty ones once the list is grouped by year.
    if (window.onPubFiltersApplied) window.onPubFiltersApplied(query, type);
  }
  window.applyPubFilters = applyPubFilters; // publications.js calls this after rendering

  if (pubSearch) pubSearch.addEventListener("input", applyPubFilters);
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      applyPubFilters();
    });
  });

  // ---------- BibTeX toggles (event delegation, works for dynamically-added items) ----------
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".bibtex-toggle");
    if (!btn) return;
    const block = btn.closest(".pub-item").querySelector(".bibtex-block");
    block.classList.toggle("open");
    btn.textContent = block.classList.contains("open") ? "[ hide bibtex ]" : "[ bibtex ]";
  });

  // ---------- Gallery lightbox ----------
  const lightbox = document.querySelector(".lightbox");
  if (lightbox) {
    const lbImg = lightbox.querySelector("img");
    const lbCap = lightbox.querySelector(".lightbox-cap");
    document.querySelectorAll(".gallery-item").forEach(item => {
      item.addEventListener("click", () => {
        const img = item.querySelector("img");
        lbImg.src = img.src;
        lbImg.alt = img.alt;
        lbCap.textContent = img.alt;
        lightbox.classList.add("open");
      });
    });
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox || e.target.closest(".lightbox-close")) {
        lightbox.classList.remove("open");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") lightbox.classList.remove("open");
    });
  }
});