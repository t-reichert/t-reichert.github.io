# Personal academic website — starter site

A static, no-build personal website for a researcher (postdoc-ready): home, publications,
CV, talks, conferences, teaching, outreach, gallery, and contact. Plain HTML/CSS/JS —
no framework, no build step, works directly on GitHub Pages.

Design: dark "ink navy" background with a violet → magenta → gold accent gradient,
inspired by the QCD phase diagram / heavy-ion thermal scale. Fonts: Fraunces (display),
Inter (body), IBM Plex Mono (labels/data).

## 1. Find and replace your info

Every page currently uses **placeholder content** for a fictional researcher
("Alex Rieger," heavy-ion physics). Search each `.html` file for anything in
`[Square Brackets]` — those are the spots you need to fill in: institution, city,
advisor names, grant names, etc.

Also replace, site-wide (all 9 `.html` files):

| Find | Replace with |
|---|---|
| `Alex Rieger` | your name |
| `alex.rieger@example.edu` | your email |
| `heavy-ion physics` / QGP-specific copy | your field, if different |
| the `#` hrefs in nav/footer/contact (Scholar, ORCID, GitHub, LinkedIn, arXiv) | your real profile URLs |

**Fastest way:** open the folder in VS Code (or any editor) and use "Find in Files"
(Cmd/Ctrl+Shift+F) to replace `Alex Rieger` and `alex.rieger@example.edu` across all files
at once, then go page by page for the bracketed placeholders.

### Page-by-page content to update
- **index.html** — hero tagline, research-interest cards, phase-diagram blurb, news timeline, 2 selected publications
- **publications.html** — replace the sample entries with your real papers (keep the `data-type="journal|proceedings|preprint"` attribute on each `<li class="pub-item">` so the filter buttons keep working). Each entry has a matching `.bibtex-block` — edit the BibTeX text inside.
- **cv.html** — positions, education, grants, skills, service. Also replace `assets/cv/cv.pdf` with your real CV (see below).
- **talks.html** — table rows per talk; grouped by year.
- **conferences.html** — table rows per conference/workshop.
- **teaching.html** — courses and supervision.
- **outreach.html** — outreach cards.
- **gallery.html** — swap placeholder SVGs in `assets/images/` for real photos (see below).
- **contact.html** — email, address, profile links.

### Replace the CV PDF
`assets/cv/cv.pdf` is currently a one-page placeholder. Export your real CV as a PDF,
name it `cv.pdf`, and drop it into `assets/cv/`, overwriting the placeholder. The
"Download CV" buttons on `index.html` and `cv.html` already point to this path.

### Replace gallery photos
`assets/images/gallery-1.svg` through `gallery-6.svg` are placeholder graphics.
Add your own photos to `assets/images/` (e.g. `.jpg`/`.png`) and update the `src=` and
`alt=` attributes in `gallery.html` to match. Keep images roughly 4:3 and under ~500KB
each so the page stays fast.

### Favicon
`assets/images/favicon.svg` is a small gradient mark. Replace it with your own mark/photo,
or leave it as is.

## 2. Preview locally

No build step needed — but opening `index.html` directly via `file://` will work for most
of the site. For full correctness (fonts, relative paths), serve it locally:

```bash
cd site
python3 -m http.server 8000
# then open http://localhost:8000
```

## 3. Publish with GitHub Pages

1. Create a new repository on GitHub — for a **user/organization site**, name it exactly
   `your-username.github.io`; for a **project site**, name it anything (e.g. `homepage`).
2. Push this folder's contents to the repo root:
   ```bash
   cd site
   git init
   git add .
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages**.
4. Under "Build and deployment," set **Source** to `Deploy from a branch`, branch `main`,
   folder `/ (root)`. Save.
5. Wait a minute or two, then visit:
   - `https://YOUR-USERNAME.github.io/` (if you used the special repo name), or
   - `https://YOUR-USERNAME.github.io/YOUR-REPO/` (project site).

The included `.nojekyll` file tells GitHub Pages not to run Jekyll processing, which
isn't needed here and avoids it treating any file names oddly.

### Using a custom domain (optional)
In the same **Settings → Pages** screen, add your domain under "Custom domain," then
create a `CNAME` DNS record (or `A` records, per GitHub's docs) pointing at GitHub Pages.
GitHub will add a `CNAME` file to your repo automatically once you save the setting.

## 4. Structure

```
site/
  index.html            Home
  publications.html     Publication list (search + filter + BibTeX)
  cv.html                Web CV + PDF download
  talks.html             Talks & seminars
  conferences.html       Conference visits
  teaching.html          Teaching & supervision
  outreach.html          Public engagement
  gallery.html           Photo gallery (lightbox)
  contact.html           Contact details
  css/style.css          All styles (design tokens at the top)
  js/main.js             Nav toggle, pub filters/search, bibtex toggle, lightbox
  assets/cv/cv.pdf       Your CV (replace)
  assets/images/         Gallery photos + favicon (replace)
  .nojekyll
```

## 5. Customizing the look

All design tokens (colors, fonts, spacing) live at the top of `css/style.css` under
`:root`. Changing `--violet`, `--magenta`, `--gold`, or `--bg` there updates the whole
site consistently, including the animated hero graphic on the home page.

## 6. Adding a new publication

Copy an existing `<li class="pub-item" data-type="journal">…</li>` block in
`publications.html`, edit the title/venue/authors/links, and update (or remove) the
`.bibtex-block`. The search box and type filters work automatically on any element with
the `pub-item` class.
