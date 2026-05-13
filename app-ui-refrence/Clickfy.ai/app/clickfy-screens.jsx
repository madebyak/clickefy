// clickfy-screens.jsx — every screen in the Clickfy flow.
// Each screen is a self-contained component that renders inside an IOSDevice.
// They share theme via { dark, accent } props.

const CF_SCREEN_W = 402;
const CF_SCREEN_H = 874;

// ─── Helper: scrollable body that stops above bottom nav ──────────
function CFBody({ children, pad = 16, dark, withBottomNav = true, padTop = 0 }) {
  const c = cfTheme(dark);
  return (
    <div style={{
      flex: 1, overflow: 'auto', background: c.bg,
      paddingTop: padTop, paddingBottom: withBottomNav ? 110 : 24,
    }}>
      {children}
    </div>
  );
}

// Shared horizontal scroll row
function CFHRow({ children, pad = 20, gap = 12 }) {
  return (
    <div style={{
      display: 'flex', gap, padding: `0 ${pad}px`,
      overflowX: 'auto', scrollSnapType: 'x mandatory',
      scrollbarWidth: 'none',
    }}>{children}</div>
  );
}

// ════════════════════════════════════════════════════════════════
// 1. HOME
// ════════════════════════════════════════════════════════════════
function CFHome({ dark, accent, density = 'regular' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const [activeCat, setActiveCat] = React.useState('all');
  const cats = CLICKFY_CATEGORIES;
  const t = (id) => cf_template(id);

  // pick sections based on activeCat
  const sections = activeCat === 'all'
    ? [
        { key: 'trending', title: 'Trending now', subtitle: 'What everyone is cloning today', tids: CLICKFY_SECTIONS.trending, kind: 'bento' },
        { key: 'videos',   title: 'Video templates', subtitle: '4–8 second product motion', tids: CLICKFY_SECTIONS.videos,   kind: 'h' },
        { key: 'food',     title: 'Food & menu',     subtitle: 'Plates, drinks, full menus',  tids: CLICKFY_SECTIONS.food,     kind: 'h' },
        { key: 'sets',     title: 'Multi-image sets', subtitle: 'Carousels, lookbooks, e-com', tids: CLICKFY_SECTIONS.sets,     kind: 'h' },
        { key: 'beauty',   title: 'Beauty & skincare', subtitle: 'Hero shots & macro reveals', tids: CLICKFY_SECTIONS.beauty, kind: 'h' },
      ]
    : [
        { key: activeCat, title: 'Featured',  subtitle: 'Top picks in this category', tids: CLICKFY_TEMPLATES.filter(x => x.cat === activeCat).slice(0, 6).map(x => x.id), kind: 'bento' },
        { key: activeCat + '-new', title: 'New this week', subtitle: '', tids: CLICKFY_TEMPLATES.filter(x => x.cat === activeCat).slice(0, 4).map(x => x.id), kind: 'h' },
      ];

  return (
    <>
      <CFTopBar dark={dark} accent={accent} credits={248} plan="Pro"/>
      <div style={{ padding: '4px 16px 14px' }}>
        <CFSearchBar dark={dark}/>
      </div>

      <CFBody dark={dark}>
        {/* Categories rail */}
        <div style={{ paddingBottom: 24 }}>
          <CFHRow pad={16} gap={12}>
            {cats.map((cat) => (
              <CFCategoryChip key={cat.id} cat={cat} dark={dark} accent={accent}
                active={activeCat === cat.id} onClick={() => setActiveCat(cat.id)}/>
            ))}
          </CFHRow>
        </div>

        {/* Quick-create banner */}
        <div style={{ padding: '0 20px 22px' }}>
          <div style={{
            position: 'relative', borderRadius: 22, padding: 18,
            background: `linear-gradient(120deg, ${a.deep}, ${a.solid})`,
            color: a.ink, overflow: 'hidden',
            boxShadow: `0 18px 40px ${a.glow}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 14,
                background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center',
                backdropFilter: 'blur(10px)',
              }}>
                <IconWand color={a.ink} size={22}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: -0.3 }}>Need a fresh angle?</div>
                <div style={{ marginTop: 2, fontSize: 12.5, opacity: .85 }}>Describe your product, we'll match templates.</div>
              </div>
              <IconArrowR color={a.ink} size={20}/>
            </div>
            <div aria-hidden style={{
              position: 'absolute', right: -30, top: -40, width: 160, height: 160,
              borderRadius: '50%', background: 'rgba(255,255,255,.12)',
            }}/>
          </div>
        </div>

        {/* Sections */}
        {sections.map((sec, i) => (
          <div key={sec.key} style={{ marginBottom: 30 }}>
            <CFSectionHeader title={sec.title} subtitle={sec.subtitle} dark={dark}/>
            {sec.kind === 'bento' ? (
              <CFBento tids={sec.tids} dark={dark} accent={accent}/>
            ) : (
              <CFHRow pad={20} gap={14}>
                {sec.tids.map((id) => {
                  const tpl = t(id); if (!tpl) return null;
                  return <div key={id} style={{ width: 200, flexShrink: 0 }}>
                    <CFTemplateCard t={tpl} dark={dark} accent={accent}/>
                  </div>;
                })}
                <div style={{ width: 4, flexShrink: 0 }}/>
              </CFHRow>
            )}
          </div>
        ))}
      </CFBody>

      <CFBottomNav active="explore" dark={dark} accent={accent}/>
    </>
  );
}

// Bento 5-up: 1 hero + 2 + 2
function CFBento({ tids, dark, accent }) {
  const t0 = cf_template(tids[0]);
  const small = tids.slice(1, 5).map(cf_template).filter(Boolean);
  const c = cfTheme(dark);
  if (!t0) return null;
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Hero */}
      <CFTemplateCard t={{ ...t0, aspect: '16/10' }} dark={dark} accent={accent}/>
      {/* Pair */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {small.slice(0, 2).map((tpl) => (
          <CFTemplateCard key={tpl.id} t={{ ...tpl, aspect: '4/5' }} dark={dark} accent={accent}/>
        ))}
      </div>
      {/* Trio (smaller) */}
      {small.slice(2, 5).length === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {small.slice(2, 4).map((tpl) => (
            <CFTemplateCard key={tpl.id} t={{ ...tpl, aspect: '4/5' }} dark={dark} accent={accent}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 2. CATEGORY DETAIL — filtered list
// ════════════════════════════════════════════════════════════════
function CFCategoryDetail({ dark, accent, catId = 'product' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const cat = CLICKFY_CATEGORIES.find((x) => x.id === catId);
  const list = CLICKFY_TEMPLATES.filter((x) => x.cat === catId).concat(
    CLICKFY_TEMPLATES.filter((x) => x.cat !== catId).slice(0, 6)
  );
  const filters = ['All', 'Image', 'Video', 'Set', 'Trending'];
  const [filter, setFilter] = React.useState('All');

  return (
    <>
      {/* Header w/ back + cat name */}
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconChevL color={c.ink} size={20}/>
        </button>
        <div style={{ flex: 1 }}/>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconSliders color={c.ink} size={20}/>
        </button>
      </div>

      {/* Title block */}
      <div style={{ padding: '8px 20px 16px' }}>
        <div style={{ fontSize: 13, color: c.inkMuted, fontWeight: 600,
          letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>
          Category
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: c.ink, letterSpacing: -1.2,
            lineHeight: 1, fontFamily: clickfyFontStack }}>
            {cat?.label || 'Templates'}
          </div>
          {cat?.img && (
            <div style={{ width: 52, height: 52, borderRadius: '50%', overflow: 'hidden',
              background: cat.color }}>
              <img src={cat.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            </div>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 13.5, color: c.inkMuted, lineHeight: 1.4 }}>
          {list.length} templates · sorted by popular
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ paddingBottom: 14 }}>
        <CFHRow pad={20} gap={8}>
          {filters.map((f) => (
            <CFPill key={f} dark={dark} accent={accent}
              active={filter === f} onClick={() => setFilter(f)}>{f}</CFPill>
          ))}
        </CFHRow>
      </div>

      <CFBody dark={dark} padTop={4}>
        <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {list.map((tpl) => (
            <CFTemplateCard key={tpl.id} t={{ ...tpl, aspect: '4/5' }} dark={dark} accent={accent}/>
          ))}
        </div>
      </CFBody>
      <CFBottomNav active="library" dark={dark} accent={accent}/>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 3. TEMPLATE DETAIL — preview before use
// ════════════════════════════════════════════════════════════════
function CFTemplateDetail({ dark, accent, tid = 't4' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const t = cf_template(tid) || CLICKFY_TEMPLATES[0];

  return (
    <div style={{ height: '100%', position: 'relative', overflow: 'hidden', background: c.bg }}>
      {/* Full-bleed cover */}
      <div style={{ position: 'relative', height: 520, overflow: 'hidden' }}>
        <img src={cf_img(t.img.match(/photo-([^?]+)/)?.[1] || '', 1000)} alt={t.title}
          onError={(e)=>{e.target.src = t.img}}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
        <div style={{ position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 60%, rgba(0,0,0,.55) 100%)' }}/>
        {/* top controls */}
        <div style={{ position: 'absolute', top: 64, left: 16, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button style={{ width: 44, height: 44, borderRadius: 22,
            background: 'rgba(255,255,255,.92)', border: 0,
            display: 'grid', placeItems: 'center',
            backdropFilter: 'blur(10px)', cursor: 'pointer' }}>
            <IconChevL color="#0B0B12" size={20}/>
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {[IconHeart, IconShare].map((Ic, i) => (
              <button key={i} style={{ width: 44, height: 44, borderRadius: 22,
                background: 'rgba(255,255,255,.92)', border: 0,
                display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <Ic color="#0B0B12" size={20}/>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: 480, background: c.surface,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        boxShadow: '0 -10px 30px rgba(0,0,0,.12)',
        padding: '16px 20px 24px',
        overflow: 'auto',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: c.borderStrong,
          margin: '0 auto 14px' }}/>

        {/* meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ height: 26, padding: '0 10px', borderRadius: 13,
            background: a.soft, color: a.deep, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
          }}>
            <IconImage color={a.deep} size={12}/>{t.kind}
          </span>
          <span style={{ fontSize: 12.5, color: c.inkMuted }}>{t.uses} uses</span>
          <span style={{ fontSize: 12.5, color: c.inkMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconStar color={'#F0B33A'} size={12} fill={'#F0B33A'}/>4.9
          </span>
        </div>

        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: c.ink, letterSpacing: -0.6,
          lineHeight: 1.1, fontFamily: clickfyFontStack }}>{t.title}</h2>

        <div style={{ marginTop: 6, fontSize: 13, color: c.inkMuted }}>
          by <span style={{ color: c.ink, fontWeight: 600 }}>{t.by}</span>
        </div>

        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: c.inkMuted }}>
          Drop your product on a soft pedestal in a controlled studio. Generates a hero
          image with editorial lighting and a clean shadow ground.
        </p>

        {/* Inputs preview */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
            textTransform: 'uppercase', color: c.inkMuted }}>You'll provide</div>
          {[
            { Ic: IconCamera, l: 'Product photo',     d: 'Plain background, well lit' },
            { Ic: IconType,   l: 'Brand name',        d: 'Optional · added subtly' },
            { Ic: IconHash,   l: 'Mood',              d: '3 of 8 presets' },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
              padding: 14, borderRadius: 16, border: `1px solid ${c.border}`, background: c.surfaceMuted }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: c.surface,
                display: 'grid', placeItems: 'center', border: `1px solid ${c.border}` }}>
                <row.Ic color={c.ink} size={18}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: c.ink, letterSpacing: -0.2 }}>{row.l}</div>
                <div style={{ fontSize: 12.5, color: c.inkMuted, marginTop: 1 }}>{row.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky CTA */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '14px 16px 22px',
        background: `linear-gradient(180deg, transparent 0%, ${c.surface} 30%)`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: c.inkMuted, fontWeight: 600,
            letterSpacing: 0.4, textTransform: 'uppercase' }}>Costs</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: c.ink, fontFamily: clickfyMonoStack }}>
            {t.credits} credits
          </span>
        </div>
        <CFButton dark={dark} accent={accent} kind="accent" size="lg"
          icon={<IconWand color={cfAccent(accent).ink} size={20}/>}>
          Use template
        </CFButton>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 4. USE TEMPLATE — upload & inputs form
// ════════════════════════════════════════════════════════════════
function CFUseTemplate({ dark, accent, tid = 't4' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const t = cf_template(tid) || CLICKFY_TEMPLATES[0];
  const [moods, setMoods] = React.useState(['Editorial', 'Warm']);
  const moodOptions = ['Editorial', 'Warm', 'Studio', 'Outdoor', 'Sunset', 'Pastel', 'Neon', 'Mono'];
  const toggle = (m) => setMoods((s) => s.includes(m) ? s.filter(x=>x!==m) : [...s, m].slice(-3));

  return (
    <>
      {/* Header */}
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconClose color={c.ink} size={20}/>
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: c.inkMuted, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase' }}>Step 1 of 1</div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink, marginTop: 2 }}>Use template</div>
        </div>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconHelp color={c.ink} size={20}/>
        </button>
      </div>

      <CFBody dark={dark} withBottomNav={false}>
        {/* Template thumb header */}
        <div style={{ padding: '0 20px 18px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 64, height: 80, borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
            <img src={t.img} alt="" style={{ width:'100%', height:'100%', objectFit: 'cover' }}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: c.ink, letterSpacing: -0.3 }}>{t.title}</div>
            <div style={{ fontSize: 12.5, color: c.inkMuted, marginTop: 2 }}>by {t.by}</div>
            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 12, background: a.soft, color: a.deep,
              fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.solid }}/>
              {t.credits} credits
            </div>
          </div>
        </div>

        {/* Photo dropzone */}
        <div style={{ padding: '0 20px 18px' }}>
          <Label dark={dark}>Product photo <Req/></Label>
          <div style={{
            position: 'relative',
            height: 200, borderRadius: 22,
            background: c.surfaceMuted,
            border: `1.5px dashed ${c.borderStrong}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8,
            backgroundImage: `radial-gradient(circle at 50% 40%, ${a.soft} 0%, transparent 60%)`,
          }}>
            <div style={{ width: 56, height: 56, borderRadius: 18,
              background: c.surface, display: 'grid', placeItems: 'center',
              boxShadow: '0 6px 18px rgba(0,0,0,.07)' }}>
              <IconUpload color={a.solid} size={24}/>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.ink, letterSpacing: -0.2 }}>
              Drop your product photo
            </div>
            <div style={{ fontSize: 12.5, color: c.inkMuted }}>PNG, JPG up to 8MB · Plain bg works best</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <CFButton dark={dark} accent={accent} kind="primary" size="sm"
                icon={<IconUpload color="#FFF" size={14}/>}>Upload</CFButton>
              <CFButton dark={dark} accent={accent} kind="ghost" size="sm"
                icon={<IconCamera color={c.ink} size={14}/>}>Take photo</CFButton>
            </div>
          </div>
        </div>

        {/* Brand name input */}
        <div style={{ padding: '0 20px 18px' }}>
          <Label dark={dark}>Brand name <Optional/></Label>
          <div style={{
            height: 56, borderRadius: 16, background: c.surface,
            border: `1px solid ${c.border}`,
            display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10,
          }}>
            <span style={{ fontSize: 16, color: c.ink, fontWeight: 500 }}>AirGlide</span>
            <span style={{ width: 1.5, height: 20, background: a.solid, animation: 'cf-blink 1s steps(2) infinite' }}/>
          </div>
        </div>

        {/* Mood multi-select */}
        <div style={{ padding: '0 20px 22px' }}>
          <Label dark={dark}>Mood <span style={{ color: c.inkMuted, fontWeight: 500 }}>· choose up to 3</span></Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {moodOptions.map((m) => {
              const on = moods.includes(m);
              return (
                <button key={m} onClick={() => toggle(m)} style={{
                  height: 38, padding: '0 14px', borderRadius: 19,
                  border: `1px solid ${on ? c.ink : c.border}`,
                  background: on ? c.ink : c.surface,
                  color: on ? c.surface : c.ink,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  {on && <IconCheck color={c.surface} size={13} strokeWidth={2.5}/>}
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        {/* Output count stepper */}
        <div style={{ padding: '0 20px 22px' }}>
          <Label dark={dark}>How many to generate</Label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 4].map((n, i) => (
              <button key={n} style={{
                flex: 1, height: 56, borderRadius: 16,
                border: `1px solid ${i === 1 ? c.ink : c.border}`,
                background: i === 1 ? c.ink : c.surface,
                color: i === 1 ? c.surface : c.ink,
                fontSize: 16, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6,
              }}>
                {n}
                <span style={{ fontSize: 11, opacity: .6, fontWeight: 600 }}>
                  · {n * t.credits} cr
                </span>
              </button>
            ))}
          </div>
        </div>
      </CFBody>

      {/* Sticky generate */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '14px 16px 26px',
        background: `linear-gradient(180deg, transparent 0%, ${c.bg} 30%)`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <CFButton dark={dark} accent={accent} kind="accent" size="lg" full
          icon={<IconWand color={a.ink} size={20}/>}>
          Generate · 8 credits
        </CFButton>
      </div>
      <style>{`@keyframes cf-blink{50%{opacity:0}}`}</style>
    </>
  );
}

function Label({ children, dark }) {
  const c = cfTheme(dark);
  return <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, letterSpacing: 0.2,
    textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>;
}
function Req() { return <span style={{ color: '#FF5A3C', fontWeight: 700 }}>*</span>; }
function Optional() { return <span style={{ color: '#A09DAA', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· optional</span>; }

// ════════════════════════════════════════════════════════════════
// 5. GENERATING / LOADING
// ════════════════════════════════════════════════════════════════
function CFGenerating({ dark, accent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const steps = [
    { label: 'Reading your photo',         done: true  },
    { label: 'Composing the scene',        done: true  },
    { label: 'Applying mood · Editorial',  done: false, active: true },
    { label: 'Final pass · upscaling',     done: false },
  ];

  return (
    <div style={{ height: '100%', background: c.bg, position: 'relative',
      display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px' }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconChevL color={c.ink} size={20}/>
        </button>
      </div>

      {/* Hero — animated halo */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: '0 24px', textAlign: 'center', gap: 24 }}>
        <div style={{ position: 'relative', width: 220, height: 220 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
            background: `conic-gradient(from 0deg, ${a.solid}, ${a.deep}, ${a.solid})`,
            filter: 'blur(28px)', opacity: .55, animation: 'cf-spin 6s linear infinite' }}/>
          <div style={{ position: 'absolute', inset: 28, borderRadius: '50%',
            background: c.surface, boxShadow: '0 30px 60px rgba(0,0,0,.18)' }}/>
          <div style={{ position: 'absolute', inset: 28, borderRadius: '50%',
            display: 'grid', placeItems: 'center' }}>
            <IconWand color={a.solid} size={48}/>
          </div>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
            border: `2px dashed ${a.solid}`, opacity: .5, animation: 'cf-spin 14s linear infinite' }}/>
        </div>

        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: c.ink, letterSpacing: -0.6,
            fontFamily: clickfyFontStack, lineHeight: 1.1 }}>
            Cooking your shot…
          </div>
          <div style={{ marginTop: 8, fontSize: 14, color: c.inkMuted, lineHeight: 1.5,
            maxWidth: 280, marginInline: 'auto' }}>
            Usually takes 20–40 seconds. Feel free to leave — we'll ping you when it's ready.
          </div>
        </div>

        {/* Progress card */}
        <div style={{ width: '100%', maxWidth: 340, padding: 18, borderRadius: 22,
          background: c.surface, border: `1px solid ${c.border}`,
          boxShadow: '0 8px 22px rgba(0,0,0,.05)' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 0',
              opacity: s.done || s.active ? 1 : 0.45,
              borderBottom: i < steps.length - 1 ? `1px solid ${c.border}` : 'none',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: s.done ? a.solid : s.active ? c.surface : c.surfaceMuted,
                border: s.done ? 'none' : s.active ? `2px solid ${a.solid}` : `1px solid ${c.border}`,
                display: 'grid', placeItems: 'center',
                animation: s.active ? 'cf-pulse 1.4s ease-in-out infinite' : 'none',
              }}>
                {s.done && <IconCheck color={a.ink} size={14} strokeWidth={3}/>}
              </div>
              <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: c.ink, textAlign: 'left' }}>
                {s.label}
              </div>
              {s.active && <span style={{ fontSize: 12, color: a.solid, fontWeight: 600 }}>Working…</span>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 20px 30px', display: 'flex', justifyContent: 'center' }}>
        <CFButton dark={dark} accent={accent} kind="ghost" size="md">
          Run in background
        </CFButton>
      </div>
      <style>{`
        @keyframes cf-spin { to { transform: rotate(360deg); } }
        @keyframes cf-pulse { 50% { transform: scale(1.1); box-shadow: 0 0 0 6px ${a.glow}; } }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// 6. RESULTS
// ════════════════════════════════════════════════════════════════
function CFResults({ dark, accent, tid = 't4' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const t = cf_template(tid) || CLICKFY_TEMPLATES[0];
  const variants = [
    cf_template('t4'), cf_template('t5'), cf_template('t1'), cf_template('t14'),
  ].filter(Boolean);
  const hero = variants[0];
  const others = variants.slice(1);

  return (
    <>
      {/* Header */}
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconChevL color={c.ink} size={20}/>
        </button>
        <div style={{ flex: 1 }}/>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconRefresh color={c.ink} size={20}/>
        </button>
      </div>

      <div style={{ padding: '0 20px 14px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          borderRadius: 12, background: a.soft, color: a.deep, fontSize: 11.5, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <IconCheck color={a.deep} size={12} strokeWidth={3}/> Ready
        </div>
        <h2 style={{ margin: '8px 0 4px', fontSize: 30, fontWeight: 700, color: c.ink,
          letterSpacing: -0.8, lineHeight: 1.05, fontFamily: clickfyFontStack }}>
          AirGlide spotlight
        </h2>
        <div style={{ fontSize: 13, color: c.inkMuted }}>
          4 variations · {t.title} template
        </div>
      </div>

      <CFBody dark={dark} padTop={6}>
        {/* Hero */}
        <div style={{ padding: '0 20px 14px' }}>
          <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden',
            aspectRatio: '4/5',
            boxShadow: '0 14px 40px rgba(0,0,0,.18)' }}>
            <img src={hero.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            {/* floating actions */}
            <div style={{
              position: 'absolute', left: 14, right: 14, bottom: 14,
              display: 'flex', gap: 10,
            }}>
              {[
                { Ic: IconBookmark, tip: 'Save' },
                { Ic: IconShare, tip: 'Share' },
              ].map((it, i) => (
                <button key={i} style={{
                  width: 44, height: 44, borderRadius: 22, border: 0,
                  background: 'rgba(255,255,255,.92)', display: 'grid', placeItems: 'center',
                  backdropFilter: 'blur(12px)', cursor: 'pointer',
                }}>
                  <it.Ic color="#0B0B12" size={18}/>
                </button>
              ))}
              <div style={{ flex: 1 }}/>
              <button style={{
                height: 44, padding: '0 16px', borderRadius: 22, border: 0,
                background: '#0B0B12', color: '#FFF',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                <IconDownload color="#FFF" size={16}/>Download
              </button>
            </div>
          </div>
        </div>

        {/* Variations */}
        <div style={{ padding: '6px 20px 14px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, letterSpacing: 0.3,
            textTransform: 'uppercase', marginBottom: 12 }}>
            Variations
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {others.map((v, i) => (
              <div key={v.id + i} style={{ position: 'relative', aspectRatio: '4/5',
                borderRadius: 14, overflow: 'hidden', cursor: 'pointer',
                boxShadow: '0 4px 10px rgba(0,0,0,.08)' }}>
                <img src={v.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
              </div>
            ))}
          </div>
        </div>

        {/* Action row */}
        <div style={{ padding: '6px 20px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CFButton dark={dark} accent={accent} kind="accent" size="lg" full
            icon={<IconRefresh color={a.ink} size={18}/>}>
            Regenerate · 8 credits
          </CFButton>
          <CFButton dark={dark} accent={accent} kind="ghost" size="md" full
            icon={<IconSliders color={c.ink} size={16}/>}>
            Tweak inputs
          </CFButton>
        </div>
      </CFBody>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 7. PROJECTS — my generations
// ════════════════════════════════════════════════════════════════
function CFProjects({ dark, accent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  return (
    <>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconSearch color={c.ink} size={20}/>
        </button>
        <div style={{ flex: 1 }}/>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconSliders color={c.ink} size={20}/>
        </button>
      </div>

      <div style={{ padding: '8px 20px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: c.inkMuted, letterSpacing: 0.5,
          textTransform: 'uppercase', marginBottom: 6 }}>Library</div>
        <h2 style={{ margin: 0, fontSize: 36, fontWeight: 700, color: c.ink,
          letterSpacing: -1.2, lineHeight: 1, fontFamily: clickfyFontStack }}>
          Your projects
        </h2>
        <div style={{ marginTop: 8, fontSize: 13, color: c.inkMuted }}>
          {CLICKFY_PROJECTS.length} generations · 19 outputs total
        </div>
      </div>

      <div style={{ padding: '0 20px 14px' }}>
        <CFHRow pad={0} gap={8}>
          {['All', 'Today', 'Saved', 'Sets', 'Videos'].map((f, i) => (
            <CFPill key={f} dark={dark} accent={accent} active={i === 0}>{f}</CFPill>
          ))}
        </CFHRow>
      </div>

      <CFBody dark={dark}>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {CLICKFY_PROJECTS.map((p) => {
            const tpl = cf_template(p.tplId);
            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: 12, borderRadius: 20,
                background: c.surface, border: `1px solid ${c.border}`,
              }}>
                <div style={{ width: 64, height: 80, borderRadius: 14, overflow: 'hidden', position: 'relative',
                  flexShrink: 0 }}>
                  <img src={tpl.img} alt="" style={{ width:'100%', height:'100%', objectFit: 'cover' }}/>
                  {p.count > 1 && (
                    <div style={{ position: 'absolute', top: 4, right: 4,
                      padding: '2px 6px', borderRadius: 6,
                      background: 'rgba(11,11,18,.7)', backdropFilter: 'blur(6px)',
                      color: '#FFF', fontSize: 10.5, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <IconLayers color="#FFF" size={10}/>{p.count}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: c.ink,
                    letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis' }}>{p.title}</div>
                  <div style={{ marginTop: 3, fontSize: 12.5, color: c.inkMuted,
                    display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{tpl.title}</span>
                    <span style={{ width: 2, height: 2, borderRadius: '50%', background: c.inkMuted, opacity: .6 }}/>
                    <span>{p.when}</span>
                  </div>
                </div>
                <button style={{ width: 36, height: 36, borderRadius: 12, background: c.surfaceMuted,
                  border: 0, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                  <IconChevR color={c.inkMuted} size={16}/>
                </button>
              </div>
            );
          })}
        </div>
      </CFBody>

      <CFBottomNav active="projects" dark={dark} accent={accent}/>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 8. PROFILE / SUBSCRIPTION
// ════════════════════════════════════════════════════════════════
function CFProfile({ dark, accent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const tiers = [
    { name: 'Free',     credits: 10,  price: '$0', cycle: '',         active: false, dim: true },
    { name: 'Pro',      credits: 250, price: '$19',cycle: '/ month', active: true,  highlight: true },
    { name: 'Ultimate', credits: 1500,price: '$59',cycle: '/ month', active: false },
  ];
  return (
    <>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconChevL color={c.ink} size={20}/>
        </button>
        <button style={{ width: 44, height: 44, borderRadius: 14, background: c.surface,
          border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <IconBell color={c.ink} size={20}/>
        </button>
      </div>

      <CFBody dark={dark}>
        {/* Identity */}
        <div style={{ padding: '6px 20px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%',
            background: `radial-gradient(circle at 30% 30%, ${a.solid}, ${a.deep})`,
            display: 'grid', placeItems: 'center',
            color: '#FFF', fontSize: 24, fontWeight: 700, letterSpacing: -0.5,
            boxShadow: `0 10px 24px ${a.glow}` }}>SR</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: c.ink, letterSpacing: -0.4 }}>Sara Reyes</div>
            <div style={{ fontSize: 13, color: c.inkMuted, marginTop: 2 }}>sara@studioforma.co</div>
          </div>
        </div>

        {/* Credits hero */}
        <div style={{ padding: '0 20px 22px' }}>
          <div style={{
            position: 'relative', borderRadius: 26, overflow: 'hidden',
            background: dark ? '#101019' : '#0B0B12', color: '#FFF',
            padding: 22,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11.5, opacity: .6, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase' }}>Credits left this cycle</div>
                <div style={{ marginTop: 6, fontFamily: clickfyMonoStack,
                  fontSize: 56, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>248</div>
                <div style={{ fontSize: 12.5, opacity: .65, marginTop: 4 }}>of 250 · resets in 18 days</div>
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: 16,
                background: a.solid, display: 'grid', placeItems: 'center',
                boxShadow: `0 12px 24px ${a.glow}`,
              }}>
                <IconBolt color={a.ink} size={24} fill={a.ink}/>
              </div>
            </div>
            {/* progress */}
            <div style={{ marginTop: 16, height: 6, borderRadius: 3,
              background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '99%', borderRadius: 3,
                background: `linear-gradient(90deg, ${a.solid}, ${a.deep})` }}/>
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button style={{
                flex: 1, height: 44, borderRadius: 14, border: 0,
                background: a.solid, color: a.ink,
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <IconPlus color={a.ink} size={16} strokeWidth={2.6}/>Top up
              </button>
              <button style={{
                flex: 1, height: 44, borderRadius: 14, border: '1px solid rgba(255,255,255,.18)',
                background: 'transparent', color: '#FFF',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}>
                Manage plan
              </button>
            </div>
          </div>
        </div>

        {/* Tier cards */}
        <div style={{ padding: '0 20px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, letterSpacing: 0.3,
            textTransform: 'uppercase', marginBottom: 12 }}>Plan</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tiers.map((tier) => (
              <div key={tier.name} style={{
                position: 'relative', padding: 16, borderRadius: 20,
                background: tier.highlight ? c.ink : c.surface,
                color: tier.highlight ? c.surface : c.ink,
                border: tier.highlight ? 'none' : `1px solid ${c.border}`,
                opacity: tier.dim ? 0.65 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{tier.name}</div>
                    {tier.active && (
                      <span style={{ height: 22, padding: '0 8px', borderRadius: 11,
                        background: a.solid, color: a.ink, fontSize: 10.5, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: 0.5,
                        display: 'inline-flex', alignItems: 'center' }}>Current</span>
                    )}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.4,
                    fontFamily: clickfyMonoStack }}>
                    {tier.price}<span style={{ fontSize: 12, opacity: .55, fontFamily: clickfyFontStack }}>{tier.cycle}</span>
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: .7 }}>
                  {tier.credits} credits / month
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Settings list */}
        <div style={{ padding: '14px 20px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, letterSpacing: 0.3,
            textTransform: 'uppercase', marginBottom: 12 }}>Account</div>
          <div style={{ borderRadius: 18, background: c.surface, border: `1px solid ${c.border}`, overflow: 'hidden' }}>
            {[
              { Ic: IconCard,    l: 'Billing & invoices', r: 'Visa · 4242' },
              { Ic: IconGift,    l: 'Refer a friend',     r: '+50 cr each' },
              { Ic: IconShield,  l: 'Privacy',            r: '' },
              { Ic: IconHelp,    l: 'Help center',        r: '' },
              { Ic: IconLogout,  l: 'Sign out',           r: '', last: true, danger: true },
            ].map((row, i, arr) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                borderBottom: i < arr.length - 1 ? `1px solid ${c.border}` : 'none',
                cursor: 'pointer',
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: c.surfaceMuted,
                  display: 'grid', placeItems: 'center' }}>
                  <row.Ic color={row.danger ? '#FF5A3C' : c.ink} size={16}/>
                </div>
                <div style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: row.danger ? '#FF5A3C' : c.ink,
                  letterSpacing: -0.2 }}>{row.l}</div>
                {row.r && <div style={{ fontSize: 13, color: c.inkMuted }}>{row.r}</div>}
                {!row.danger && <IconChevR color={c.inkSubtle} size={14}/>}
              </div>
            ))}
          </div>
        </div>
      </CFBody>
      <CFBottomNav active="me" dark={dark} accent={accent}/>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 9. MENU DRAWER (overlay)
// ════════════════════════════════════════════════════════════════
function CFMenuDrawer({ dark, accent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  return (
    <div style={{ height: '100%', position: 'relative', background: 'rgba(11,11,18,.45)' }}>
      {/* dim of underlying page */}
      <div style={{ position: 'absolute', inset: 0,
        backgroundImage: `url(${cf_img('1542291026-7eec264c27ff', 800)})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        opacity: 0.18, filter: 'blur(8px)' }}/>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(11,11,18,.55)',
        backdropFilter: 'blur(8px)' }}/>

      {/* Drawer */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 320,
        background: c.bg, padding: '60px 20px 30px',
        borderTopRightRadius: 28, borderBottomRightRadius: 28,
        boxShadow: '14px 0 40px rgba(0,0,0,.25)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 26 }}>
          <ClickfyWordmark color={c.ink} accent={a.solid} size={22}/>
          <button style={{ width: 36, height: 36, borderRadius: 12, background: c.surface,
            border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <IconClose color={c.ink} size={16}/>
          </button>
        </div>

        {/* Identity card */}
        <div style={{ padding: 14, borderRadius: 18, background: c.surface,
          border: `1px solid ${c.border}`, marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%',
            background: `radial-gradient(circle at 30% 30%, ${a.solid}, ${a.deep})`,
            color: '#FFF', display: 'grid', placeItems: 'center',
            fontWeight: 700, fontSize: 16 }}>SR</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink, letterSpacing: -0.2 }}>Sara Reyes</div>
            <div style={{ fontSize: 12, color: c.inkMuted, marginTop: 1 }}>Pro · 248 credits</div>
          </div>
        </div>

        {/* Nav list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { Ic: IconCompass, l: 'Explore', on: true },
            { Ic: IconGrid,    l: 'Categories' },
            { Ic: IconFolder,  l: 'Projects' },
            { Ic: IconBookmark,l: 'Saved templates' },
            { Ic: IconBolt,    l: 'Buy credits' },
            { Ic: IconGift,    l: 'Refer a friend' },
            { Ic: IconBell,    l: 'Notifications' },
            { Ic: IconSliders, l: 'Settings' },
          ].map((row, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
              borderRadius: 14,
              background: row.on ? c.surface : 'transparent',
              border: row.on ? `1px solid ${c.border}` : '1px solid transparent',
              cursor: 'pointer',
            }}>
              <row.Ic color={row.on ? a.solid : c.ink} size={20} strokeWidth={row.on ? 2 : 1.6}/>
              <div style={{ flex: 1, fontSize: 15, fontWeight: row.on ? 700 : 500,
                color: c.ink, letterSpacing: -0.2 }}>{row.l}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }}/>

        {/* Footer dark mode toggle */}
        <div style={{ padding: 14, borderRadius: 16, background: c.surface,
          border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <IconMoon color={c.ink} size={18}/>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: c.ink }}>Dark mode</div>
          <div style={{ width: 36, height: 22, borderRadius: 11, background: dark ? a.solid : c.borderStrong,
            position: 'relative', transition: 'background .2s' }}>
            <div style={{ position: 'absolute', top: 2, left: dark ? 16 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#FFF', transition: 'left .2s',
              boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  CF_SCREEN_W, CF_SCREEN_H,
  CFHome, CFCategoryDetail, CFTemplateDetail, CFUseTemplate,
  CFGenerating, CFResults, CFProjects, CFProfile, CFMenuDrawer,
});
