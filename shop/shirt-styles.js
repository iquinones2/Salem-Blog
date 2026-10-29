/* ==========================================================
   Salem shirt styles — edit this file to add or change styles.
   No other code needs to change.

   Each style:
     id          Unique, lowercase, no spaces (used in saved designs).
     name        Shown on the card, dropdown, and summary.
     description One short sentence for the style card.
     sizes       Size buttons offered for this style, in order.
     mockup      Transparent shirt images (PNG or SVG) for each side.
                 Light/white shirts work best: the page tints them
                 with each color's hex.
     printArea   Where designs may go, as fractions of the preview
                 square: x/y = top-left corner, w/h = width/height.
     colors      Swatches. `hex` tints the mockup. Add
                 `images: { front: "...", back: "..." }` to use a real
                 photo of that color instead of tinting.
     cardImage   (optional) Photo for the style card. If left out, the
                 card shows the front mockup in the first color.

   Image paths are relative to the site root (where shop.qmd lives).
   ========================================================== */

window.SALEM_SHIRT_STYLES = [
  {
    id: "crew-tee",
    name: "Classic crew tee",
    description: "Soft everyday cotton with a ribbed crew neck. Our most-printed shirt.",
    sizes: ["S", "M", "L", "XL", "XXL"],
    mockup: {
      front: "images/shop/crew-tee-front.svg",
      back: "images/shop/crew-tee-back.svg"
    },
    printArea: {
      front: { x: 0.35, y: 0.26, w: 0.30, h: 0.44 },
      back: { x: 0.35, y: 0.22, w: 0.30, h: 0.48 }
    },
    colors: [
      { id: "navy", name: "Navy", hex: "#1b2a41" },
      { id: "cream", name: "Cream", hex: "#efe8d8" },
      { id: "denim", name: "Denim", hex: "#2f5d8c" },
      { id: "black", name: "Black", hex: "#1c1c1e" }
      // Example with real photos:
      // { id: "heather", name: "Heather grey", hex: "#9ea3a8",
      //   images: { front: "images/shop/crew-heather-front.jpg",
      //             back: "images/shop/crew-heather-back.jpg" } }
    ]
  },
  {
    id: "v-neck-tee",
    name: "V-neck tee",
    description: "A lighter, relaxed fit with a clean V neckline for warm-weather events.",
    sizes: ["S", "M", "L", "XL", "XXL"],
    mockup: {
      front: "images/shop/v-neck-tee-front.svg",
      back: "images/shop/v-neck-tee-back.svg"
    },
    printArea: {
      front: { x: 0.36, y: 0.30, w: 0.28, h: 0.40 },
      back: { x: 0.35, y: 0.22, w: 0.30, h: 0.48 }
    },
    colors: [
      { id: "cream", name: "Cream", hex: "#efe8d8" },
      { id: "sage", name: "Sage", hex: "#8f9f86" },
      { id: "denim", name: "Denim", hex: "#2f5d8c" },
      { id: "rust", name: "Rust", hex: "#a44e30" }
    ]
  },
  {
    id: "long-sleeve",
    name: "Long sleeve tee",
    description: "Midweight cotton with ribbed cuffs, made for fall gatherings and camp nights.",
    sizes: ["S", "M", "L", "XL", "XXL"],
    mockup: {
      front: "images/shop/long-sleeve-front.svg",
      back: "images/shop/long-sleeve-back.svg"
    },
    printArea: {
      front: { x: 0.35, y: 0.26, w: 0.30, h: 0.44 },
      back: { x: 0.35, y: 0.22, w: 0.30, h: 0.48 }
    },
    colors: [
      { id: "black", name: "Black", hex: "#1c1c1e" },
      { id: "navy", name: "Navy", hex: "#1b2a41" },
      { id: "forest", name: "Forest", hex: "#2f4a3a" },
      { id: "white", name: "White", hex: "#f7f8f6" }
    ]
  }
];

/* Ink colors offered for text (a custom color picker is also shown). */
window.SALEM_INK_COLORS = [
  { id: "warm-white", name: "Warm white", hex: "#f7f4ec" },
  { id: "navy", name: "Navy", hex: "#1b2a41" },
  { id: "denim", name: "Denim", hex: "#2f5d8c" },
  { id: "rust", name: "Rust", hex: "#a44e30" },
  { id: "black", name: "Black", hex: "#1c1c1e" }
];
