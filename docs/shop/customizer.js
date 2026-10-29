/* ==========================================================
   Salem shirt customizer
   Reads styles from shop/shirt-styles.js. No server, no libraries.
   ========================================================== */
(function () {
  "use strict";

  const STYLES = window.SALEM_SHIRT_STYLES || [];
  const INKS = window.SALEM_INK_COLORS || [];
  const FONTS = [
    { id: "dm-serif", name: "DM Serif Display", css: '"DM Serif Display", Georgia, serif', weight: 400 },
    { id: "inter", name: "Inter", css: '"Inter", system-ui, sans-serif', weight: 600 },
    { id: "bebas", name: "Bebas Neue", css: '"Bebas Neue", Impact, sans-serif', weight: 400 },
    { id: "caveat", name: "Caveat", css: '"Caveat", cursive', weight: 600 }
  ];
  const STORAGE_KEY = "salem-shirt-design-v1";
  const MAX_HISTORY = 60;
  const MAX_UPLOAD_PX = 1200;
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const LINE_HEIGHT = 1.15;
  const MIN_IMAGE_W = 0.08;
  const MIN_TEXT_SIZE = 0.03;
  const EXPORT_PX = 1200;

  const el = (id) => document.getElementById(id);
  const frame = el("mockup-frame");
  const printArea = el("print-area");
  if (!frame || !printArea || !STYLES.length) return;

  /* ---------- State ---------- */
  function defaultState() {
    const style = STYLES[0];
    return {
      styleId: style.id,
      colorId: style.colors[0].id,
      size: null,
      side: "front",
      ink: INKS.length ? INKS[0].hex : "#f7f4ec",
      font: FONTS[0].id,
      textSize: 0.12,
      layers: []
    };
  }

  let state = loadState() || defaultState();
  let selectedId = null;
  let history = [];
  let lastGroup = null;
  let lastGroupTime = 0;
  const imageCache = {};

  function getStyle() { return STYLES.find((s) => s.id === state.styleId) || STYLES[0]; }
  function getColor() {
    const style = getStyle();
    return style.colors.find((c) => c.id === state.colorId) || style.colors[0];
  }
  function getFont(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }
  function inkName(hex) {
    const ink = INKS.find((i) => i.hex.toLowerCase() === String(hex).toLowerCase());
    return ink ? ink.name : "Custom " + hex;
  }
  function sideLayers() { return state.layers.filter((l) => l.side === state.side); }
  function getLayer(id) { return state.layers.find((l) => l.id === id); }
  function newId() { return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.layers)) return null;
      const base = defaultState();
      const style = STYLES.find((s) => s.id === saved.styleId) || STYLES[0];
      const merged = Object.assign(base, saved, { styleId: style.id });
      if (!style.colors.some((c) => c.id === merged.colorId)) merged.colorId = style.colors[0].id;
      if (!style.sizes.includes(merged.size)) merged.size = null;
      if (merged.side !== "back") merged.side = "front";
      merged.layers = merged.layers.filter((l) => l && (l.type === "text" || (l.type === "image" && l.src)));
      return merged;
    } catch (err) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      announce("Couldn’t auto-save this design. Your browser may be blocking storage, or an uploaded image is too large.");
    }
  }

  /* ---------- History ---------- */
  // Group rapid edits (typing, sliders) into one undo step.
  function pushHistory(group) {
    const now = Date.now();
    if (group && group === lastGroup && now - lastGroupTime < 1200) {
      lastGroupTime = now;
      return;
    }
    lastGroup = group || null;
    lastGroupTime = now;
    history.push(JSON.stringify(state));
    if (history.length > MAX_HISTORY) history.shift();
  }

  function change(mutate, options) {
    const opts = options || {};
    pushHistory(opts.group);
    mutate();
    saveState();
    render();
  }

  function undo() {
    if (!history.length) return;
    state = JSON.parse(history.pop());
    lastGroup = null;
    if (selectedId && !getLayer(selectedId)) selectedId = null;
    saveState();
    render();
    announce("Undone.");
  }

  /* ---------- Announcements ---------- */
  function announce(message) {
    const status = el("customizer-status");
    status.textContent = "";
    window.setTimeout(() => { status.textContent = message; }, 30);
  }

  /* ---------- Geometry ---------- */
  function getPrintArea(style, side) {
    return (style || getStyle()).printArea[side || state.side];
  }

  const measureCtx = document.createElement("canvas").getContext("2d");

  function fontString(layer, px) {
    const font = getFont(layer.font);
    return font.weight + " " + px + "px " + font.css;
  }

  // Unrotated box of a layer in px, for a print area `areaW` px wide.
  function layerBox(layer, areaW) {
    if (layer.type === "image") {
      const w = layer.w * areaW;
      return { w: w, h: w * layer.aspect };
    }
    const px = layer.size * areaW;
    measureCtx.font = fontString(layer, px);
    const lines = (layer.text || " ").split("\n");
    const width = Math.max.apply(null, lines.map((line) => measureCtx.measureText(line || " ").width));
    return { w: Math.max(width, px * 0.5), h: lines.length * px * LINE_HEIGHT };
  }

  // Keep a layer's rotated bounds inside the print area, shrinking it if needed.
  function clampLayer(layer, areaW, areaH) {
    for (let pass = 0; pass < 3; pass++) {
      const box = layerBox(layer, areaW);
      const rad = (layer.rot * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const hx = (box.w * cos + box.h * sin) / 2;
      const hy = (box.w * sin + box.h * cos) / 2;
      const fit = Math.min(1, areaW / (2 * hx), areaH / (2 * hy));
      if (fit < 0.999) {
        if (layer.type === "image") layer.w *= fit;
        else layer.size *= fit;
        continue;
      }
      layer.x = clamp(layer.x * areaW, hx, areaW - hx) / areaW;
      layer.y = clamp(layer.y * areaH, hy, areaH - hy) / areaH;
      return;
    }
  }

  function clamp(value, min, max) {
    if (min > max) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
  }

  function areaSize() {
    return { w: printArea.clientWidth || 1, h: printArea.clientHeight || 1 };
  }

  /* ---------- Rendering ---------- */
  // Shirt image: a real photo when the color provides one, else a tinted mockup.
  function paintShirt(container, style, color, side) {
    const tint = container.querySelector(".shirt-tint");
    const shading = container.querySelector(".shirt-shading");
    const photo = container.querySelector(".shirt-photo");
    const photoSrc = color.images && color.images[side];
    if (photoSrc) {
      photo.src = photoSrc;
      photo.hidden = false;
      tint.hidden = true;
      shading.hidden = true;
    } else {
      const mockup = style.mockup[side];
      tint.style.setProperty("--mockup", 'url("' + mockup + '")');
      tint.style.backgroundColor = color.hex;
      shading.src = mockup;
      photo.hidden = true;
      tint.hidden = false;
      shading.hidden = false;
    }
  }

  function render() {
    const style = getStyle();
    const color = getColor();

    // Preview frame
    paintShirt(el("shirt-render"), style, color, state.side);
    const area = getPrintArea(style);
    printArea.style.left = area.x * 100 + "%";
    printArea.style.top = area.y * 100 + "%";
    printArea.style.width = area.w * 100 + "%";
    printArea.style.height = area.h * 100 + "%";
    el("preview-badge").textContent = state.side.toUpperCase() + " · DESIGN PREVIEW";
    document.querySelectorAll(".side-toggle button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.side === state.side));
    });

    renderLayers();
    renderCards();
    renderControls();
    renderSummary();
  }

  function renderLayers() {
    const { w: areaW, h: areaH } = areaSize();
    const focusedId = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.layerId : null;
    printArea.replaceChildren();
    sideLayers().forEach((layer) => {
      clampLayer(layer, areaW, areaH);
      const node = document.createElement("div");
      node.className = "design-layer" + (layer.id === selectedId ? " is-selected" : "");
      node.dataset.layerId = layer.id;
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-describedby", "layer-help");
      if (layer.type === "image") {
        const img = document.createElement("img");
        img.src = layer.src;
        img.alt = "";
        img.draggable = false;
        node.appendChild(img);
        node.setAttribute("aria-label", "Artwork " + layer.name);
      } else {
        const text = document.createElement("span");
        text.className = "layer-text";
        text.textContent = layer.text;
        node.appendChild(text);
        node.setAttribute("aria-label", "Text " + (layer.text || "(empty)"));
      }
      ["resize", "rotate"].forEach((kind) => {
        const handle = document.createElement("span");
        handle.className = "layer-handle handle-" + kind;
        handle.dataset.handle = kind;
        handle.setAttribute("aria-hidden", "true");
        node.appendChild(handle);
      });
      positionLayer(node, layer, areaW, areaH);
      printArea.appendChild(node);
      if (layer.id === focusedId) node.focus({ preventScroll: true });
    });
    const count = sideLayers().length;
    el("preview-description").textContent = getStyle().name + " in " + getColor().name + ", " + state.side +
      " side, " + (count ? count + " design " + (count === 1 ? "element" : "elements") : "no design yet") + ".";
  }

  function positionLayer(node, layer, areaW, areaH) {
    const box = layerBox(layer, areaW);
    node.style.width = box.w + "px";
    node.style.height = box.h + "px";
    node.style.left = layer.x * areaW + "px";
    node.style.top = layer.y * areaH + "px";
    node.style.transform = "translate(-50%, -50%) rotate(" + layer.rot + "deg)";
    if (layer.type === "text") {
      const text = node.querySelector(".layer-text");
      const font = getFont(layer.font);
      text.style.fontFamily = font.css;
      text.style.fontWeight = font.weight;
      text.style.fontSize = layer.size * areaW + "px";
      text.style.lineHeight = String(LINE_HEIGHT);
      text.style.color = layer.color;
    }
  }

  function selectLayer(id, options) {
    selectedId = id;
    printArea.querySelectorAll(".design-layer").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.layerId === id);
    });
    renderControls();
    if (!(options && options.quiet)) {
      const layer = getLayer(id);
      if (layer) announce((layer.type === "text" ? "Text" : "Artwork") + " selected.");
    }
  }

  /* ---------- Style cards ---------- */
  function renderCards() {
    const container = el("style-cards");
    if (!container.children.length) {
      STYLES.forEach((style) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "style-card";
        card.dataset.styleId = style.id;
        const first = style.colors[0];
        const visual = style.cardImage
          ? '<img class="style-card-photo" src="' + style.cardImage + '" alt="">'
          : '<div class="shirt-render"><div class="shirt-tint"></div><img class="shirt-shading" alt=""><img class="shirt-photo" alt="" hidden></div>';
        card.innerHTML =
          '<span class="style-card-image" role="img" aria-label="' + escapeAttr(style.name + " in " + first.name) + '">' + visual + "</span>" +
          '<span class="style-card-name"></span><span class="style-card-description"></span>' +
          '<span class="style-card-action">Customize this style →</span>';
        card.querySelector(".style-card-name").textContent = style.name;
        card.querySelector(".style-card-description").textContent = style.description;
        if (!style.cardImage) paintShirt(card.querySelector(".shirt-render"), style, first, "front");
        card.addEventListener("click", () => {
          if (state.styleId !== style.id) {
            change(() => setStyle(style.id));
            announce(style.name + " selected.");
          }
          el("customizer").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
          el("customizer-heading").focus({ preventScroll: true });
        });
        container.appendChild(card);
      });
    }
    container.querySelectorAll(".style-card").forEach((card) => {
      card.setAttribute("aria-pressed", String(card.dataset.styleId === state.styleId));
    });
  }

  function setStyle(id) {
    const style = STYLES.find((s) => s.id === id);
    if (!style) return;
    state.styleId = style.id;
    if (!style.colors.some((c) => c.id === state.colorId)) state.colorId = style.colors[0].id;
    if (!style.sizes.includes(state.size)) state.size = null;
  }

  /* ---------- Controls ---------- */
  function renderControls() {
    const style = getStyle();
    const color = getColor();
    const selected = getLayer(selectedId);
    const textLayer = selected && selected.type === "text" ? selected : null;

    // Garment dropdown
    const garment = el("garment-select");
    if (garment.options.length !== STYLES.length) {
      garment.replaceChildren.apply(garment, STYLES.map((s) => new Option(s.name, s.id)));
    }
    garment.value = style.id;

    // Shirt color swatches
    renderRadioGroup(el("shirt-swatches"), style.colors.map((c) => ({ id: c.id, label: c.name, hex: c.hex })),
      color.id, (id) => {
        change(() => { state.colorId = id; });
        announce("Shirt color " + getColor().name + ".");
      }, "swatch");
    el("shirt-color-name").textContent = color.name;
    el("selected-shirt").textContent = "Shirt: " + color.name;

    // Sizes
    renderRadioGroup(el("size-options"), style.sizes.map((s) => ({ id: s, label: s })), state.size, (id) => {
      change(() => { state.size = id; });
      announce("Size " + id + " noted.");
    }, "size");
    el("size-name").textContent = state.size || "not chosen";

    // Text controls reflect the selected text layer, or the defaults for new text
    const ink = textLayer ? textLayer.color : state.ink;
    const fontId = textLayer ? textLayer.font : state.font;
    const size = textLayer ? textLayer.size : state.textSize;
    renderRadioGroup(el("ink-swatches"), INKS.map((i) => ({ id: i.hex, label: i.name, hex: i.hex }))
      .concat([{ id: "custom", label: "Custom", custom: true }]),
      INKS.some((i) => i.hex.toLowerCase() === ink.toLowerCase()) ? INKS.find((i) => i.hex.toLowerCase() === ink.toLowerCase()).hex : "custom",
      (id) => { if (id !== "custom") setInk(id); }, "swatch", ink);
    el("ink-color-name").textContent = inkName(ink);
    el("selected-ink").textContent = "Ink: " + inkName(ink);

    const fontSelect = el("text-font");
    if (!fontSelect.options.length) {
      FONTS.forEach((f) => {
        const option = new Option(f.name, f.id);
        option.style.fontFamily = f.css;
        fontSelect.appendChild(option);
      });
    }
    fontSelect.value = fontId;
    el("text-size").value = String(Math.round(size * 100));
    el("text-size-value").textContent = Math.round(size * 100);

    const textarea = el("shirt-text");
    if (document.activeElement !== textarea) textarea.value = textLayer ? textLayer.text : "";

    el("delete-button").disabled = !selected;
    el("undo-button").disabled = !history.length;
    el("reset-button").disabled = !state.layers.length;
  }

  // Accessible radio group with roving tabindex and arrow-key navigation.
  function renderRadioGroup(container, items, selected, onSelect, kind, customHex) {
    const signature = items.map((i) => i.id).join("|");
    if (container.dataset.signature !== signature) {
      container.dataset.signature = signature;
      container.replaceChildren();
      items.forEach((item) => {
        const option = document.createElement("div");
        option.className = kind === "size" ? "size-option" : "labeled-swatch";
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.value = item.id;
        button.setAttribute("aria-label", item.label);
        if (kind === "size") {
          button.className = "size-button";
          button.textContent = item.label;
          option.appendChild(button);
        } else {
          button.className = "swatch-button" + (item.custom ? " is-custom" : "");
          if (item.custom) {
            // Hidden native picker, opened by the swatch button.
            const picker = document.createElement("input");
            picker.type = "color";
            picker.className = "swatch-picker";
            picker.tabIndex = -1;
            picker.setAttribute("aria-hidden", "true");
            picker.addEventListener("input", () => setInk(picker.value, true));
            option.appendChild(picker);
            button.setAttribute("aria-label", "Custom ink color");
            button.addEventListener("click", () => picker.click());
          } else {
            button.style.setProperty("--swatch", item.hex);
          }
          const label = document.createElement("span");
          label.className = "swatch-label";
          label.textContent = item.label;
          option.append(button, label);
        }
        button.addEventListener("click", () => onSelect(item.id));
        container.appendChild(option);
      });
    }
    if (!container.dataset.keys) {
      container.dataset.keys = "on";
      container.addEventListener("keydown", (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const buttons = Array.from(container.querySelectorAll('[role="radio"]'));
        const index = buttons.indexOf(document.activeElement);
        const next = buttons[(index + keys[event.key] + buttons.length) % buttons.length];
        next.focus();
        if (!next.classList.contains("is-custom")) next.click();
      });
    }
    const buttons = Array.from(container.querySelectorAll('[role="radio"]'));
    buttons.forEach((button) => {
      const checked = button.dataset.value === selected;
      button.setAttribute("aria-checked", String(checked));
      button.tabIndex = checked || (!selected && button === buttons[0]) ? 0 : -1;
      const label = button.parentElement.querySelector(".swatch-label");
      if (label) label.textContent = (checked ? "✓ " : "") + (button.classList.contains("is-custom") ? "Custom" : button.getAttribute("aria-label"));
      if (button.classList.contains("is-custom")) {
        const picker = button.parentElement.querySelector(".swatch-picker");
        if (customHex && /^#[0-9a-f]{6}$/i.test(customHex)) picker.value = customHex;
        button.style.setProperty("--swatch", checked ? customHex : "conic-gradient(#a44e30, #efe8d8, #2f5d8c, #1b2a41, #a44e30)");
      }
    });
  }

  function setInk(hex, isCustom) {
    const layer = getLayer(selectedId);
    change(() => {
      state.ink = hex;
      if (layer && layer.type === "text") layer.color = hex;
    }, { group: isCustom ? "ink-custom" : null });
    if (!isCustom) announce("Ink color " + inkName(hex) + ".");
  }

  /* ---------- Summary ---------- */
  function describeLayer(layer) {
    if (layer.type === "image") return "Artwork: " + layer.name;
    return "Text “" + (layer.text || "").replace(/\s+/g, " ").trim() + "” · " + getFont(layer.font).name + ", " + inkName(layer.color);
  }

  function renderSummary() {
    const style = getStyle();
    el("summary-title").textContent = style.name;
    const rows = [
      ["Style", style.name],
      ["Color", getColor().name],
      ["Size", state.size || "Not chosen yet"]
    ];
    ["front", "back"].forEach((side) => {
      const layers = state.layers.filter((l) => l.side === side);
      rows.push([side === "front" ? "Front" : "Back", layers.length ? layers.map(describeLayer) : ["Blank"]]);
    });
    const list = el("summary-list");
    list.replaceChildren();
    rows.forEach(([term, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      row.appendChild(dt);
      [].concat(value).forEach((v) => {
        const dd = document.createElement("dd");
        dd.textContent = v;
        row.appendChild(dd);
      });
      list.appendChild(row);
    });
  }

  /* ---------- Adding designs ---------- */
  function addTextLayer(text) {
    const layer = {
      id: newId(), type: "text", side: state.side, x: 0.5, y: 0.3, rot: 0,
      text: text, font: state.font, color: state.ink, size: state.textSize
    };
    change(() => { state.layers.push(layer); });
    selectLayer(layer.id, { quiet: true });
    return layer;
  }

  function handleFile(file) {
    if (!file) return;
    const okType = /^image\/(png|jpeg|svg\+xml)$/.test(file.type) || /\.(png|jpe?g|svg)$/i.test(file.name);
    if (!okType) { announce("Please choose a PNG, JPG, or SVG file."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { announce("That file is over 10 MB. Please choose a smaller image."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale so the design fits in localStorage; keep transparency.
        const naturalW = img.naturalWidth || 800;
        const naturalH = img.naturalHeight || 800;
        const scale = Math.min(1, MAX_UPLOAD_PX / Math.max(naturalW, naturalH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(naturalW * scale));
        canvas.height = Math.max(1, Math.round(naturalH * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const isJpeg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
        const src = isJpeg ? canvas.toDataURL("image/jpeg", 0.88) : canvas.toDataURL("image/png");
        const layer = {
          id: newId(), type: "image", side: state.side, x: 0.5, y: 0.5, rot: 0,
          src: src, name: file.name, aspect: canvas.height / canvas.width, w: 0.8
        };
        change(() => { state.layers.push(layer); });
        selectLayer(layer.id, { quiet: true });
        announce("Artwork " + file.name + " added to the " + state.side + ".");
      };
      img.onerror = () => announce("That image couldn’t be read. Try a different file.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Direct manipulation (mouse + touch) ---------- */
  let gesture = null;

  printArea.addEventListener("pointerdown", (event) => {
    const node = event.target.closest(".design-layer");
    if (!node) return;
    event.preventDefault();
    const layer = getLayer(node.dataset.layerId);
    if (!layer) return;
    if (selectedId !== layer.id) selectLayer(layer.id, { quiet: true });
    node.focus({ preventScroll: true });
    const rect = printArea.getBoundingClientRect();
    const cx = rect.left + layer.x * rect.width;
    const cy = rect.top + layer.y * rect.height;
    gesture = {
      kind: event.target.dataset.handle || "move",
      node: node, layer: layer, rect: rect, cx: cx, cy: cy,
      startX: event.clientX, startY: event.clientY,
      start: { x: layer.x, y: layer.y, w: layer.w, size: layer.size, rot: layer.rot },
      startDist: Math.hypot(event.clientX - cx, event.clientY - cy) || 1,
      startAngle: Math.atan2(event.clientY - cy, event.clientX - cx),
      snapshot: JSON.stringify(state),
      moved: false
    };
    node.setPointerCapture(event.pointerId);
  });

  printArea.addEventListener("pointermove", (event) => {
    if (!gesture) return;
    const g = gesture;
    const layer = g.layer;
    if (g.kind === "move") {
      layer.x = g.start.x + (event.clientX - g.startX) / g.rect.width;
      layer.y = g.start.y + (event.clientY - g.startY) / g.rect.height;
    } else if (g.kind === "resize") {
      const factor = Math.hypot(event.clientX - g.cx, event.clientY - g.cy) / g.startDist;
      if (layer.type === "image") layer.w = Math.max(MIN_IMAGE_W, g.start.w * factor);
      else layer.size = Math.max(MIN_TEXT_SIZE, g.start.size * factor);
    } else if (g.kind === "rotate") {
      const angle = Math.atan2(event.clientY - g.cy, event.clientX - g.cx);
      let rot = g.start.rot + ((angle - g.startAngle) * 180) / Math.PI;
      rot = ((rot % 360) + 540) % 360 - 180;
      const snap = Math.round(rot / 90) * 90;
      layer.rot = Math.abs(rot - snap) < 4 ? snap : Math.round(rot);
    }
    g.moved = true;
    clampLayer(layer, g.rect.width, g.rect.height);
    positionLayer(g.node, layer, g.rect.width, g.rect.height);
  });

  function endGesture() {
    if (!gesture) return;
    if (gesture.moved) {
      history.push(gesture.snapshot);
      if (history.length > MAX_HISTORY) history.shift();
      lastGroup = null;
      saveState();
      renderControls();
      renderSummary();
    }
    gesture = null;
  }
  printArea.addEventListener("pointerup", endGesture);
  printArea.addEventListener("pointercancel", endGesture);

  // Clicking the shirt outside a design clears the selection.
  frame.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".design-layer")) selectLayer(null, { quiet: true });
  });

  printArea.addEventListener("focusin", (event) => {
    const node = event.target.closest(".design-layer");
    if (node && node.dataset.layerId !== selectedId) selectLayer(node.dataset.layerId);
  });

  printArea.addEventListener("keydown", (event) => {
    const node = event.target.closest(".design-layer");
    const layer = node && getLayer(node.dataset.layerId);
    if (!layer) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const turn = event.shiftKey ? 15 : 5;
    const scale = (factor) => {
      if (layer.type === "image") layer.w = Math.max(MIN_IMAGE_W, layer.w * factor);
      else layer.size = Math.max(MIN_TEXT_SIZE, layer.size * factor);
    };
    const actions = {
      ArrowLeft: () => { layer.x -= step; },
      ArrowRight: () => { layer.x += step; },
      ArrowUp: () => { layer.y -= step; },
      ArrowDown: () => { layer.y += step; },
      "+": () => scale(1.06),
      "=": () => scale(1.06),
      "-": () => scale(1 / 1.06),
      "[": () => { layer.rot -= turn; },
      "]": () => { layer.rot += turn; }
    };
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === "Escape") {
      selectLayer(null, { quiet: true });
      node.blur();
    } else if (actions[event.key]) {
      event.preventDefault();
      change(actions[event.key], { group: "key-" + layer.id });
    }
  });

  function deleteSelected() {
    const layer = getLayer(selectedId);
    if (!layer) return;
    change(() => { state.layers = state.layers.filter((l) => l.id !== layer.id); });
    selectedId = null;
    renderControls();
    announce((layer.type === "text" ? "Text" : "Artwork") + " deleted. Press Undo to bring it back.");
  }

  /* ---------- Download preview ---------- */
  function loadImage(src) {
    if (!imageCache[src]) {
      imageCache[src] = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }
    return imageCache[src];
  }

  async function downloadPreview() {
    const button = el("download-button");
    button.disabled = true;
    try {
      if (document.fonts) {
        await Promise.all(FONTS.map((f) => document.fonts.load(f.weight + " 40px " + f.css)));
      }
      const style = getStyle();
      const color = getColor();
      const S = EXPORT_PX;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#eaedef";
      ctx.fillRect(0, 0, S, S);

      const photoSrc = color.images && color.images[state.side];
      if (photoSrc) {
        drawCover(ctx, await loadImage(photoSrc), S);
      } else {
        const mockup = await loadImage(style.mockup[state.side]);
        const tinted = document.createElement("canvas");
        tinted.width = S;
        tinted.height = S;
        const tctx = tinted.getContext("2d");
        tctx.fillStyle = color.hex;
        tctx.fillRect(0, 0, S, S);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(mockup, 0, 0, S, S);
        ctx.drawImage(tinted, 0, 0);
        ctx.globalCompositeOperation = "multiply";
        ctx.drawImage(mockup, 0, 0, S, S);
        ctx.globalCompositeOperation = "source-over";
      }

      const area = getPrintArea(style);
      const areaW = area.w * S;
      const areaH = area.h * S;
      for (const layer of sideLayers()) {
        const box = layerBox(layer, areaW);
        ctx.save();
        ctx.translate(area.x * S + layer.x * areaW, area.y * S + layer.y * areaH);
        ctx.rotate((layer.rot * Math.PI) / 180);
        if (layer.type === "image") {
          ctx.drawImage(await loadImage(layer.src), -box.w / 2, -box.h / 2, box.w, box.h);
        } else {
          const px = layer.size * areaW;
          ctx.font = fontString(layer, px);
          ctx.fillStyle = layer.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          layer.text.split("\n").forEach((line, i) => {
            ctx.fillText(line, 0, -box.h / 2 + px * LINE_HEIGHT * (i + 0.5));
          });
        }
        ctx.restore();
      }

      ctx.font = '500 22px "Inter", system-ui, sans-serif';
      ctx.fillStyle = "#1b2a41";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(["SALEM", style.name, color.name, state.size ? "Size " + state.size : null, state.side === "front" ? "Front" : "Back"]
        .filter(Boolean).join("  ·  "), 36, S - 36);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("export failed");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "salem-" + style.id + "-" + color.id + "-" + state.side + ".png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      announce("Preview downloaded.");
    } catch (err) {
      announce("The preview couldn’t be saved. Open the site from a web server (quarto preview or GitHub Pages), not as a local file.");
    } finally {
      button.disabled = false;
    }
  }

  function drawCover(ctx, img, S) {
    const scale = Math.max(S / img.naturalWidth, S / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
  }

  /* ---------- Wiring ---------- */
  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  el("garment-select").addEventListener("change", (event) => {
    change(() => setStyle(event.target.value));
    announce(getStyle().name + " selected.");
  });

  document.querySelectorAll(".side-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.side === button.dataset.side) return;
      selectedId = null;
      change(() => { state.side = button.dataset.side; });
      announce("Showing the " + state.side + ".");
    });
  });

  el("add-text-button").addEventListener("click", () => {
    addTextLayer("GATHER IN GRACE");
    const textarea = el("shirt-text");
    textarea.value = "GATHER IN GRACE";
    textarea.focus();
    textarea.select();
    announce("Text added to the " + state.side + ". Type to change it.");
  });

  el("shirt-text").addEventListener("input", (event) => {
    const value = event.target.value;
    const selected = getLayer(selectedId);
    if (selected && selected.type === "text") {
      change(() => { selected.text = value; }, { group: "text-" + selected.id });
    } else if (value.trim()) {
      addTextLayer(value);
    }
  });

  el("text-font").addEventListener("change", (event) => {
    const layer = getLayer(selectedId);
    change(() => {
      state.font = event.target.value;
      if (layer && layer.type === "text") layer.font = event.target.value;
    });
  });

  el("text-size").addEventListener("input", (event) => {
    const layer = getLayer(selectedId);
    const size = Number(event.target.value) / 100;
    change(() => {
      state.textSize = size;
      if (layer && layer.type === "text") layer.size = size;
    }, { group: "size-" + (layer ? layer.id : "default") });
  });

  const fileInput = el("art-file");
  el("upload-button").addEventListener("click", () => fileInput.click());
  el("art-drop").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    handleFile(fileInput.files[0]);
    fileInput.value = "";
  });
  const drop = el("art-drop");
  ["dragenter", "dragover"].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-dragging")));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    handleFile(event.dataTransfer.files[0]);
  });

  el("undo-button").addEventListener("click", undo);
  el("delete-button").addEventListener("click", deleteSelected);
  el("reset-button").addEventListener("click", () => {
    selectedId = null;
    change(() => { state.layers = []; });
    announce("Design cleared from both sides. Press Undo to bring it back.");
  });
  el("download-button").addEventListener("click", downloadPreview);

  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey && !typing) {
      event.preventDefault();
      undo();
    }
  });

  // The quote form isn't connected to a service yet.
  el("quote-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const status = el("quote-status");
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    status.textContent = "Quote requests aren’t connected yet, so nothing was sent. Download your preview and message Salem on Instagram in the meantime.";
  });

  // Re-render when the preview resizes (layout changes, rotation) and once fonts load.
  if (window.ResizeObserver) {
    let lastWidth = 0;
    new ResizeObserver(() => {
      if (printArea.clientWidth !== lastWidth && !gesture) {
        lastWidth = printArea.clientWidth;
        renderLayers();
      }
    }).observe(printArea);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderLayers());

  render();
})();
