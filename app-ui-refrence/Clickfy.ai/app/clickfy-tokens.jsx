// clickfy-tokens.jsx — design tokens, asset library, helpers

// ─── Theme tokens ──────────────────────────────────────────────
const CLICKFY_THEMES = {
  light: {
    bg: '#F4F2EE',           // warm paper canvas behind app
    surface: '#FFFFFF',
    surfaceElev: '#FFFFFF',
    surfaceMuted: '#F7F6F3',
    ink: '#0B0B12',
    inkMuted: '#6E6B78',
    inkSubtle: '#A09DAA',
    border: '#ECEAE3',
    borderStrong: '#D9D6CD',
    chipBg: '#0B0B12',       // dark chip on light theme
    chipInk: '#FFFFFF',
    pill: '#0B0B12',
  },
  dark: {
    bg: '#0A0A10',
    surface: '#14141C',
    surfaceElev: '#1B1B25',
    surfaceMuted: '#101019',
    ink: '#FFFFFF',
    inkMuted: '#9B98A8',
    inkSubtle: '#62606E',
    border: '#22222E',
    borderStrong: '#2C2C3A',
    chipBg: '#FFFFFF',
    chipInk: '#0B0B12',
    pill: '#FFFFFF',
  },
};

// Curated accent palettes — primary tints. The first is the main brand.
const CLICKFY_ACCENTS = {
  violet:  { solid: '#6E3CFF', soft: '#EDE5FF', deep: '#3B1AAD', ink: '#FFFFFF', glow: 'rgba(110,60,255,.35)' },
  coral:   { solid: '#FF5A3C', soft: '#FFE6DF', deep: '#C7361B', ink: '#FFFFFF', glow: 'rgba(255,90,60,.30)' },
  citrus:  { solid: '#D8E83C', soft: '#F4F8C6', deep: '#7C8A0E', ink: '#0B0B12', glow: 'rgba(216,232,60,.45)' },
  ocean:   { solid: '#2B7BFF', soft: '#E3EEFF', deep: '#0F4DC4', ink: '#FFFFFF', glow: 'rgba(43,123,255,.30)' },
};

// Pro/plan gold
const CLICKFY_GOLD = { solid: '#F0B33A', soft: '#FFEFC8', ink: '#3D2A00' };

const clickfyFontStack = '"Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
const clickfyMonoStack = '"Geist Mono", "JetBrains Mono", ui-monospace, monospace';
const clickfyDisplayStack = '"Instrument Serif", "Times New Roman", serif';

// ─── Asset library — Unsplash hot-links ───────────────────────
// Sized small (w=600) for performance. Photographs chosen to read as
// "AI-template thumbnail" — clean isolated subjects, strong color.
const cf_img = (id, w = 600) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

// Category hero photos (small circular thumbs)
const CLICKFY_CATEGORIES = [
  { id: 'all',      label: 'All',       img: null, color: '#0B0B12' },
  { id: 'skincare', label: 'Skincare',  img: cf_img('1556228720-195a672e8a03', 200), color: '#F4D9C9' },
  { id: 'product',  label: 'Product',   img: cf_img('1542291026-7eec264c27ff', 200), color: '#E8E4DA' },
  { id: 'food',     label: 'Food',      img: cf_img('1565299624946-b28f40a0ae38', 200), color: '#E2C9A0' },
  { id: 'beverage', label: 'Beverage',  img: cf_img('1551024601-bec78aea704b', 200), color: '#FFD1A8' },
  { id: 'fashion',  label: 'Fashion',   img: cf_img('1539109136881-3be0616acf4b', 200), color: '#D8CFC2' },
  { id: 'beauty',   label: 'Beauty',    img: cf_img('1596462502278-27bfdc403348', 200), color: '#F2C5C0' },
  { id: 'tech',     label: 'Tech',      img: cf_img('1550009158-9ebf69173e03', 200), color: '#1E2230' },
  { id: 'home',     label: 'Home',      img: cf_img('1513519245088-0e12902e5a38', 200), color: '#E5D6C5' },
  { id: 'auto',     label: 'Auto',      img: cf_img('1494976388531-d1058494cdd8', 200), color: '#1F2326' },
];

// Templates — a deep library so cards don't repeat across sections.
const CLICKFY_TEMPLATES = [
  // skincare
  { id: 't1',  cat: 'skincare', kind: 'image',  title: 'Glow Bottle Hero',     by: 'Clickfy Studio', uses: '12.4k', credits: 4, img: cf_img('1556228720-195a672e8a03'), aspect: '4/5' },
  { id: 't2',  cat: 'skincare', kind: 'set',    title: 'Serum Lifestyle Set',  by: 'Atelier Lab',    uses: '8.1k',  credits: 6, img: cf_img('1620916566398-39f1143ab7be'), aspect: '4/5' },
  { id: 't3',  cat: 'skincare', kind: 'video',  title: 'Cream Reveal · 6s',    by: 'Looma',          uses: '3.9k',  credits: 12, img: cf_img('1571781926291-c477ebfd024b'), aspect: '4/5' },
  // product
  { id: 't4',  cat: 'product',  kind: 'image',  title: 'Sneaker Pedestal',     by: 'Studio Forma',   uses: '21.2k', credits: 4, img: cf_img('1542291026-7eec264c27ff'), aspect: '1/1' },
  { id: 't5',  cat: 'product',  kind: 'image',  title: 'Watch on Marble',      by: 'Tide & Co',      uses: '6.0k',  credits: 4, img: cf_img('1523275335684-37898b6baf30'), aspect: '4/5' },
  { id: 't6',  cat: 'product',  kind: 'video',  title: 'Spin Showcase · 4s',   by: 'Clickfy Studio', uses: '5.5k',  credits: 10, img: cf_img('1505740420928-5e560c06d30e'), aspect: '4/5' },
  // food
  { id: 't7',  cat: 'food',     kind: 'image',  title: 'Top-down Hero Plate',  by: 'Pantry',         uses: '14.7k', credits: 4, img: cf_img('1565299624946-b28f40a0ae38'), aspect: '1/1' },
  { id: 't8',  cat: 'food',     kind: 'video',  title: 'Pasta Twirl · 5s',     by: 'Looma',          uses: '4.3k',  credits: 12, img: cf_img('1608897013039-887f21d8c804'), aspect: '4/5' },
  { id: 't9',  cat: 'food',     kind: 'set',    title: 'Menu 6-Pack',          by: 'Pantry',         uses: '9.2k',  credits: 8, img: cf_img('1546069901-ba9599a7e63c'), aspect: '4/5' },
  // beverage
  { id: 't10', cat: 'beverage', kind: 'image',  title: 'Pour Splash',          by: 'Atelier Lab',    uses: '11.1k', credits: 4, img: cf_img('1551024601-bec78aea704b'), aspect: '4/5' },
  { id: 't11', cat: 'beverage', kind: 'video',  title: 'Cold Brew Drip · 6s',  by: 'Studio Forma',   uses: '2.8k',  credits: 12, img: cf_img('1495474472287-4d71bcdd2085'), aspect: '4/5' },
  // fashion
  { id: 't12', cat: 'fashion',  kind: 'set',    title: 'Studio Portrait Set',  by: 'Looma',          uses: '18.0k', credits: 8, img: cf_img('1539109136881-3be0616acf4b'), aspect: '4/5' },
  { id: 't13', cat: 'fashion',  kind: 'image',  title: 'Streetwear Lookbook',  by: 'Atelier Lab',    uses: '7.4k',  credits: 4, img: cf_img('1483985988355-763728e1935b'), aspect: '4/5' },
  // beauty
  { id: 't14', cat: 'beauty',   kind: 'image',  title: 'Lipstick Macro',       by: 'Tide & Co',      uses: '5.2k',  credits: 4, img: cf_img('1596462502278-27bfdc403348'), aspect: '1/1' },
  { id: 't15', cat: 'beauty',   kind: 'video',  title: 'Powder Burst · 3s',    by: 'Clickfy Studio', uses: '3.1k',  credits: 12, img: cf_img('1503236823255-94609f598e71'), aspect: '4/5' },
  // tech
  { id: 't16', cat: 'tech',     kind: 'image',  title: 'Gadget Float',         by: 'Studio Forma',   uses: '6.6k',  credits: 4, img: cf_img('1550009158-9ebf69173e03'), aspect: '4/5' },
  // home
  { id: 't17', cat: 'home',     kind: 'image',  title: 'Candle Glow',          by: 'Pantry',         uses: '4.0k',  credits: 4, img: cf_img('1513519245088-0e12902e5a38'), aspect: '4/5' },
];

// Curated section feeds for the home screen.
const CLICKFY_SECTIONS = {
  trending: ['t4', 't1', 't12', 't10', 't7', 't13'],
  videos:   ['t6', 't8', 't3', 't11', 't15'],
  sets:     ['t2', 't9', 't12'],
  food:     ['t7', 't8', 't9', 't10'],
  product:  ['t4', 't5', 't6', 't16'],
  beauty:   ['t1', 't14', 't15', 't2'],
};

// User's recent generations (Projects screen + Home preview)
const CLICKFY_PROJECTS = [
  { id: 'p1', tplId: 't4',  title: 'AirGlide Spotlight',  when: '2 min ago',  status: 'ready',     count: 4 },
  { id: 'p2', tplId: 't7',  title: 'Sushi Tasting Menu',  when: '1 h ago',    status: 'ready',     count: 6 },
  { id: 'p3', tplId: 't1',  title: 'Velvet Serum Launch', when: 'Yesterday',  status: 'ready',     count: 1 },
  { id: 'p4', tplId: 't8',  title: 'Carbonara Promo',     when: '2 days ago', status: 'ready',     count: 1 },
  { id: 'p5', tplId: 't12', title: 'SS26 Lookbook',       when: '3 days ago', status: 'ready',     count: 8 },
];

const cf_template = (id) => CLICKFY_TEMPLATES.find((t) => t.id === id);

Object.assign(window, {
  CLICKFY_THEMES, CLICKFY_ACCENTS, CLICKFY_GOLD,
  CLICKFY_CATEGORIES, CLICKFY_TEMPLATES, CLICKFY_SECTIONS, CLICKFY_PROJECTS,
  clickfyFontStack, clickfyMonoStack, clickfyDisplayStack,
  cf_img, cf_template,
});
