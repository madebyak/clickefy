// clickfy-home-variants.jsx — three distinct home-screen directions
// Each takes the same shared primitives but recomposes them with a
// different visual rhythm so the user can pick a direction.

// ─── Variant A — "Studio" (the default home, shipped via CFHome) ───
// Already defined in clickfy-screens.jsx as CFHome. Re-export under
// the variant naming so the canvas can use one consistent prop set.
const CFHomeStudio = (props) => <CFHome {...props}/>;

// ─── Variant B — "Editorial" — bold serif, single-column, magazine ──
function CFHomeEditorial({ dark, accent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const cats = CLICKFY_CATEGORIES.filter((x) => x.id !== 'all').slice(0, 6);
  const trending = CLICKFY_SECTIONS.trending.map(cf_template).filter(Boolean);

  return (
    <>
      <CFTopBar dark={dark} accent={accent} credits={248} plan="Pro"/>
      <CFBody dark={dark} padTop={4}>
        {/* Editorial title */}
        <div style={{ padding: '4px 22px 6px' }}>
          <div style={{ fontSize: 11, color: c.inkMuted, fontWeight: 700,
            letterSpacing: 1, textTransform: 'uppercase' }}>Issue 12 · May 2026</div>
        </div>
        <div style={{ padding: '0 22px 4px' }}>
          <h1 style={{ margin: 0, fontFamily: clickfyDisplayStack, fontWeight: 400,
            fontSize: 60, lineHeight: 0.95, letterSpacing: -2.4, color: c.ink }}>
            Today, in <em style={{ color: a.solid, fontStyle: 'italic' }}>motion</em>.
          </h1>
          <p style={{ marginTop: 14, fontSize: 14.5, lineHeight: 1.55, color: c.inkMuted, maxWidth: 320 }}>
            Hand-picked templates from our editors. Tap any cover to clone it for your brand.
          </p>
        </div>

        {/* Search as a slim line */}
        <div style={{ padding: '18px 22px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10,
            paddingBottom: 12, borderBottom: `1px solid ${c.border}` }}>
            <IconSearch color={c.inkMuted} size={18}/>
            <span style={{ flex: 1, fontSize: 14.5, color: c.inkMuted }}>Search 12,400+ templates</span>
            <span style={{ fontSize: 12, color: c.inkMuted, fontWeight: 600 }}>⌘ K</span>
          </div>
        </div>

        {/* Hero feature */}
        <div style={{ padding: '0 22px 26px' }}>
          <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden',
            aspectRatio: '4/5' }}>
            <img src={trending[0].img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            <div style={{ position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,.7) 100%)' }}/>
            <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18, color: '#FFF' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
                textTransform: 'uppercase', opacity: .8 }}>Cover · Trending</div>
              <div style={{ fontFamily: clickfyDisplayStack, fontSize: 28, fontWeight: 400,
                lineHeight: 1.05, letterSpacing: -0.6, marginTop: 6 }}>{trending[0].title}</div>
              <div style={{ marginTop: 8, fontSize: 12.5, opacity: .85 }}>by {trending[0].by} · {trending[0].uses} uses</div>
            </div>
          </div>
        </div>

        {/* Sections — wide single column */}
        <div style={{ padding: '0 22px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontFamily: clickfyDisplayStack, fontSize: 26, fontWeight: 400,
              letterSpacing: -0.6, color: c.ink }}>The Edit</h3>
            <span style={{ fontSize: 12, color: c.inkMuted, fontWeight: 600 }}>05 picks →</span>
          </div>
          {trending.slice(1, 5).map((tpl, i) => (
            <div key={tpl.id} style={{ display: 'flex', gap: 14, padding: '14px 0',
              borderTop: i === 0 ? `1px solid ${c.border}` : 'none',
              borderBottom: `1px solid ${c.border}` }}>
              <div style={{ width: 88, height: 110, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                <img src={tpl.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
              </div>
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: a.solid,
                  letterSpacing: 0.5, textTransform: 'uppercase' }}>{tpl.cat}</div>
                <div style={{ marginTop: 4, fontFamily: clickfyDisplayStack, fontSize: 22,
                  fontWeight: 400, lineHeight: 1.05, letterSpacing: -0.4, color: c.ink }}>
                  {tpl.title}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: c.inkMuted }}>
                  {tpl.uses} uses · {tpl.credits} credits
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Category index */}
        <div style={{ padding: '0 22px 30px' }}>
          <h3 style={{ margin: '0 0 14px', fontFamily: clickfyDisplayStack,
            fontSize: 26, fontWeight: 400, letterSpacing: -0.6, color: c.ink }}>Departments</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {cats.map((cat) => (
              <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden',
                  background: cat.color }}>
                  <img src={cat.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                </div>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: c.ink, letterSpacing: -0.2 }}>{cat.label}</div>
                  <div style={{ fontSize: 11.5, color: c.inkMuted, marginTop: 1 }}>
                    {CLICKFY_TEMPLATES.filter(t => t.cat === cat.id).length} templates
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CFBody>
      <CFBottomNav active="explore" dark={dark} accent={accent}/>
    </>
  );
}

// ─── Variant C — "Studio Dark" — cinematic dark with glow accents ──
function CFHomeCinematic({ accent }) {
  // force dark mode regardless of canvas tweak
  const dark = true;
  const c = cfTheme(true);
  const a = cfAccent(accent);
  const trending = CLICKFY_SECTIONS.trending.map(cf_template).filter(Boolean);
  const videos = CLICKFY_SECTIONS.videos.map(cf_template).filter(Boolean);
  const cats = CLICKFY_CATEGORIES;
  const [active, setActive] = React.useState('all');

  return (
    <div style={{ height: '100%', background: '#0A0A10', display: 'flex', flexDirection: 'column' }}>
      {/* radial halo top */}
      <div aria-hidden style={{ position: 'absolute', top: -120, left: -80, right: -80, height: 360,
        background: `radial-gradient(circle at 50% 0%, ${a.solid}40, transparent 60%)`,
        pointerEvents: 'none', zIndex: 0 }}/>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <CFTopBar dark={true} accent={accent} credits={248} plan="Pro" transparent/>
        <div style={{ padding: '4px 16px 14px' }}>
          <CFSearchBar dark={true}/>
        </div>
      </div>

      <CFBody dark={true} padTop={0}>
        <div style={{ padding: '0 22px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: a.solid, letterSpacing: 0.8,
            textTransform: 'uppercase' }}>Welcome back, Sara</div>
          <h1 style={{ margin: '8px 0 0', fontSize: 36, fontWeight: 700, letterSpacing: -1.2,
            color: '#FFF', lineHeight: 1.05, fontFamily: clickfyFontStack }}>
            What are we<br/>making today?
          </h1>
        </div>

        {/* Categories — capsule pills with glow */}
        <div style={{ paddingBottom: 22 }}>
          <CFHRow pad={20} gap={8}>
            {cats.map((cat) => {
              const on = active === cat.id;
              return (
                <button key={cat.id} onClick={() => setActive(cat.id)} style={{
                  height: 38, padding: '0 14px', borderRadius: 19,
                  border: `1px solid ${on ? a.solid : c.border}`,
                  background: on ? `${a.solid}25` : c.surface,
                  color: on ? '#FFF' : c.inkMuted,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0,
                  boxShadow: on ? `0 0 22px ${a.glow}` : 'none',
                }}>
                  {cat.id !== 'all' && (
                    <span style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', background: cat.color }}>
                      <img src={cat.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                    </span>
                  )}
                  {cat.label}
                </button>
              );
            })}
          </CFHRow>
        </div>

        {/* Big card hero */}
        <div style={{ padding: '0 20px 24px' }}>
          <div style={{ position: 'relative', borderRadius: 26, overflow: 'hidden',
            aspectRatio: '4/5',
            boxShadow: `0 18px 50px ${a.glow}, 0 0 0 1px ${c.border}` }}>
            <img src={trending[0].img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            <div style={{ position: 'absolute', inset: 0,
              background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.85) 100%)' }}/>
            <div style={{ position: 'absolute', left: 20, right: 20, bottom: 20 }}>
              <span style={{ height: 26, padding: '0 10px', borderRadius: 13,
                background: a.solid, color: a.ink, display: 'inline-flex', alignItems: 'center',
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.ink, marginRight: 6,
                  animation: 'cf-blink 1s steps(2) infinite' }}/>
                Trending #1
              </span>
              <div style={{ marginTop: 12, fontSize: 24, fontWeight: 700, letterSpacing: -0.6,
                color: '#FFF', lineHeight: 1.1 }}>{trending[0].title}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,.7)' }}>
                {trending[0].uses} cloned this week · {trending[0].credits} credits
              </div>
            </div>
          </div>
        </div>

        {/* Video rail */}
        <div style={{ marginBottom: 22 }}>
          <CFSectionHeader title="Made for motion" subtitle="Short product videos" dark={true}/>
          <CFHRow pad={20} gap={14}>
            {videos.map((v) => (
              <div key={v.id} style={{ width: 180, flexShrink: 0 }}>
                <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden',
                  aspectRatio: '9/16',
                  boxShadow: `0 0 0 1px ${c.border}, 0 10px 24px rgba(0,0,0,.4)` }}>
                  <img src={v.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  <div style={{ position: 'absolute', inset: 0,
                    background: 'linear-gradient(180deg, transparent 50%, rgba(0,0,0,.7) 100%)' }}/>
                  <div style={{ position: 'absolute', top: 10, left: 10,
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(255,255,255,.92)',
                    display: 'grid', placeItems: 'center' }}>
                    <IconPlay color="#0B0B12" size={14}/>
                  </div>
                  <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#FFF', letterSpacing: -0.2,
                      textShadow: '0 1px 8px rgba(0,0,0,.6)' }}>{v.title}</div>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ width: 4, flexShrink: 0 }}/>
          </CFHRow>
        </div>

        <div style={{ marginBottom: 24 }}>
          <CFSectionHeader title="Picked for you" dark={true}/>
          <div style={{ padding: '0 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {trending.slice(1, 5).map((tpl) => (
              <CFTemplateCard key={tpl.id} t={{ ...tpl, aspect: '4/5' }} dark={true} accent={accent}/>
            ))}
          </div>
        </div>
      </CFBody>
      <CFBottomNav active="explore" dark={true} accent={accent}/>
      <style>{`@keyframes cf-blink{50%{opacity:.4}}`}</style>
    </div>
  );
}

Object.assign(window, { CFHomeStudio, CFHomeEditorial, CFHomeCinematic });
