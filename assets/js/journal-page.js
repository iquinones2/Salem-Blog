/* Journal filters and sort (index.qmd and es/index.qmd). Builds category pills from data-cats. */
document.addEventListener("DOMContentLoaded", function () {
  const grid = document.querySelector(".salem-journal .story-grid");
  const filters = document.querySelector(".category-filters");
  const select = document.getElementById("sort-post");
  if (!grid || !filters || !select) return;

  const posts = Array.from(grid.querySelectorAll(".journal-story"));
  const ALL = SalemList.pick({ en: "All", es: "Todas" });
  let active = "All"; // internal key; the pill shows ALL

  function getCats(post) {
    const raw = post.getAttribute("data-cats");
    return raw ? raw.split("|") : [];
  }

  // Build a pill for "All" plus each category, with post counts
  const counts = { All: posts.length };
  posts.forEach(function (post) {
    getCats(post).forEach(function (cat) { counts[cat] = (counts[cat] || 0) + 1; });
  });
  ["All"].concat(Object.keys(counts).filter(function (c) { return c !== "All"; }).sort()).forEach(function (cat) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "category-filter";
    pill.dataset.cat = cat;
    pill.textContent = (cat === "All" ? ALL : cat) + " (" + counts[cat] + ")";
    pill.setAttribute("aria-pressed", cat === active);
    filters.appendChild(pill);
  });

  filters.addEventListener("click", function (event) {
    const pill = event.target.closest(".category-filter");
    if (!pill) return;
    active = pill.dataset.cat;
    filters.querySelectorAll(".category-filter").forEach(function (p) {
      p.setAttribute("aria-pressed", p === pill);
    });
    posts.forEach(function (post) {
      post.hidden = active !== "All" && !getCats(post).includes(active);
    });
  });

  function getTitle(post) {
    return (post.getAttribute("data-title") || "").toLowerCase();
  }

  function getDate(post) {
    return Number(post.getAttribute("data-listing-date-sort")) || 0;
  }

  select.addEventListener("change", function () {
    const mode = select.value;
    posts.sort(function (a, b) {
      if (mode === "date-desc") return getDate(b) - getDate(a);
      if (mode === "date-asc") return getDate(a) - getDate(b);
      if (mode === "title-asc") return getTitle(a).localeCompare(getTitle(b));
      if (mode === "title-desc") return getTitle(b).localeCompare(getTitle(a));
      return 0;
    });
    posts.forEach(function (post) { grid.appendChild(post); });
  });
});
