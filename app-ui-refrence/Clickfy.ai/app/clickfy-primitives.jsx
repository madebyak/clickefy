// clickfy-primitives.jsx — shared UI atoms used across screens.
// Depends on tokens + icons (loaded earlier).

// Resolve theme + accent from a single { dark, accent } prop pair so screens
// stay declarative.
const cfTheme = (dark) => CLICKFY_THEMES[dark ? 'dark' : 'light'];
const cfAccent = (key) => CLICKFY_ACCENTS[key] || CLICKFY_ACCENTS.violet;

// ─── Top bar ──────────────────────────────────────────────────────
// Hamburger | Wordmark | Credits pill (with plan badge)
function CFTopBar({ dark, accent, credits = 248, plan = 'Pro', onMenu, onProfile, transparent }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 16px 8px', gap: 12,
      background: transparent ? 'transparent' : c.bg,
    }}>
      <button onClick={onMenu} style={{
        width: 44, height: 44, borderRadius: 14, background: c.surface,
        border: `1px solid ${c.border}`, display: 'grid', placeItems: 'center',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)', cursor: 'pointer', padding: 0,
      }}>
        <IconMenu color={c.ink} size={20}/>
      </button>

      <ClickfyWordmark color={c.ink} accent={a.solid} size={20}/>

      <button onClick={onProfile} style={{
        height: 44, padding: '0 6px 0 14px', borderRadius: 22,
        background: c.surface, border: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 1px 2px rgba(0,0,0,.04)', cursor: 'pointer',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%',
            background: `radial-gradient(circle at 30% 30%, ${a.solid}, ${a.deep})`,
            boxShadow: `0 0 0 2px ${c.surface}, 0 0 8px ${a.glow}` }}/>
          <span style={{ fontFamily: clickfyMonoStack, fontSize: 14, fontWeight: 600,
            color: c.ink, letterSpacing: -0.2 }}>{credits}</span>
        </span>
        <span style={{
          height: 28, padding: '0 10px', borderRadius: 16,
          background: c.ink, color: c.surface,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
        }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: a.solid }}/>
          {plan}
        </span>
      </button>
    </div>
  );
}

// ─── Search bar ───────────────────────────────────────────────────
function CFSearchBar({ dark, value = '', placeholder = 'Search 12,400+ templates', onClick }) {
  const c = cfTheme(dark);
  return (
    <button onClick={onClick} style={{
      width: '100%', height: 52, padding: '0 16px',
      borderRadius: 18, background: c.surface, border: `1px solid ${c.border}`,
      display: 'flex', alignItems: 'center', gap: 12, cursor: 'text',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
    }}>
      <IconSearch color={c.inkMuted} size={20}/>
      <span style={{ flex: 1, textAlign: 'left', color: value ? c.ink : c.inkMuted,
        fontSize: 15, fontWeight: 450 }}>
        {value || placeholder}
      </span>
      <span style={{
        width: 32, height: 32, borderRadius: 10, background: c.surfaceMuted,
        display: 'grid', placeItems: 'center',
      }}>
        <IconSliders color={c.ink} size={16}/>
      </span>
    </button>
  );
}

// ─── Category chip — circular photo + label ──────────────────────
function CFCategoryChip({ cat, active, dark, accent, onClick }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const allChip = cat.id === 'all';
  return (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8, padding: 0, background: 'transparent', border: 0, cursor: 'pointer',
      flexShrink: 0,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', position: 'relative',
        background: allChip ? c.ink : cat.color,
        display: 'grid', placeItems: 'center',
        outline: active ? `2px solid ${a.solid}` : 'none',
        outlineOffset: 3,
        overflow: 'hidden',
      }}>
        {allChip ? (
          <IconGrid color={c.surface} size={26}/>
        ) : (
          <img src={cat.img} alt={cat.label} style={{
            width: '100%', height: '100%', objectFit: 'cover',
            filter: active ? 'none' : 'saturate(.92)',
          }}/>
        )}
        {active && !allChip && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
            border: `2px solid ${a.solid}`, boxShadow: `0 0 0 4px ${c.bg}` }}/>
        )}
      </div>
      <span style={{
        fontSize: 12.5, fontWeight: active ? 600 : 500, letterSpacing: -0.1,
        color: active ? c.ink : c.inkMuted,
      }}>{cat.label}</span>
    </button>
  );
}

// ─── Template card — cover + title + meta ─────────────────────────
function CFTemplateCard({ t, dark, accent, w, onClick, hideMeta }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const KindGlyph = t.kind === 'video' ? IconPlay : t.kind === 'set' ? IconLayers : IconImage;
  return (
    <button onClick={onClick} style={{
      width: w || '100%', textAlign: 'left', background: 'transparent',
      border: 0, padding: 0, cursor: 'pointer',
      display: 'flex', flexDirection: 'column', gap: 10,
      flexShrink: 0,
    }}>
      <div style={{
        width: '100%', aspectRatio: t.aspect, borderRadius: 18,
        position: 'relative', overflow: 'hidden',
        background: c.surfaceMuted,
        boxShadow: '0 1px 2px rgba(0,0,0,.06), 0 8px 22px rgba(20,18,30,.06)',
      }}>
        <img src={t.img} alt={t.title} style={{
          width: '100%', height: '100%', objectFit: 'cover',
        }}/>
        {/* kind chip */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          height: 26, padding: '0 10px 0 8px', borderRadius: 13,
          background: 'rgba(11,11,18,.6)', backdropFilter: 'blur(12px)',
          color: '#FFF', display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, fontWeight: 600, letterSpacing: 0.2, textTransform: 'uppercase',
        }}>
          <KindGlyph color="#FFF" size={12}/>
          {t.kind === 'set' ? `Set · ${t.kind === 'set' ? '6' : ''}` : t.kind}
        </div>
        {/* credit chip */}
        <div style={{
          position: 'absolute', bottom: 10, right: 10,
          height: 26, padding: '0 9px', borderRadius: 13,
          background: a.solid, color: a.ink,
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11.5, fontWeight: 700, fontFamily: clickfyMonoStack,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: a.ink, opacity: .9 }}/>
          {t.credits}
        </div>
      </div>
      {!hideMeta && (
        <div style={{ padding: '0 2px' }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: c.ink,
            letterSpacing: -0.2, lineHeight: 1.25,
            display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{t.title}</div>
          <div style={{ marginTop: 3, fontSize: 12, color: c.inkMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{t.by}</span>
            <span style={{ width: 2, height: 2, borderRadius: '50%', background: c.inkMuted, opacity: .6 }}/>
            <span>{t.uses} uses</span>
          </div>
        </div>
      )}
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────
function CFSectionHeader({ title, subtitle, action = 'See all', dark, onAction }) {
  const c = cfTheme(dark);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      padding: '0 20px', marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: c.ink, letterSpacing: -0.6,
          fontFamily: clickfyFontStack, lineHeight: 1.05 }}>{title}</div>
        {subtitle && (
          <div style={{ marginTop: 4, fontSize: 13, color: c.inkMuted }}>{subtitle}</div>
        )}
      </div>
      {action && (
        <button onClick={onAction} style={{
          background: 'transparent', border: 0, color: c.inkMuted, cursor: 'pointer',
          fontSize: 13, fontWeight: 600, padding: 4, display: 'inline-flex', alignItems: 'center', gap: 2,
        }}>
          {action}<IconChevR color={c.inkMuted} size={14}/>
        </button>
      )}
    </div>
  );
}

// ─── Bottom navigation ───────────────────────────────────────────
function CFBottomNav({ active = 'explore', dark, accent, onChange }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const items = [
    { id: 'explore',  label: 'Explore',   Icon: IconCompass },
    { id: 'library',  label: 'Library',   Icon: IconGrid },
    { id: 'create',   label: 'Create',    Icon: null,    big: true },
    { id: 'projects', label: 'Projects',  Icon: IconFolder },
    { id: 'me',       label: 'Profile',   Icon: IconUser },
  ];
  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 14,
      height: 72, borderRadius: 28, padding: '0 8px',
      background: dark ? 'rgba(20,20,28,.85)' : 'rgba(255,255,255,.92)',
      border: `1px solid ${c.border}`,
      backdropFilter: 'blur(20px) saturate(160%)',
      WebkitBackdropFilter: 'blur(20px) saturate(160%)',
      boxShadow: '0 12px 30px rgba(15,12,30,.12), 0 1px 0 rgba(255,255,255,.6) inset',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 10,
    }}>
      {items.map((it) => {
        if (it.big) {
          return (
            <button key={it.id} onClick={() => onChange?.(it.id)} style={{
              width: 56, height: 56, borderRadius: 20,
              background: `linear-gradient(140deg, ${a.solid}, ${a.deep})`,
              boxShadow: `0 8px 22px ${a.glow}, inset 0 1px 0 rgba(255,255,255,.35)`,
              border: 0, display: 'grid', placeItems: 'center', cursor: 'pointer',
              flexShrink: 0,
            }}>
              <IconPlus color={a.ink} size={26} strokeWidth={2.4}/>
            </button>
          );
        }
        const on = active === it.id;
        return (
          <button key={it.id} onClick={() => onChange?.(it.id)} style={{
            flex: 1, height: 56, borderRadius: 18,
            background: 'transparent', border: 0, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, padding: 0,
          }}>
            <it.Icon color={on ? c.ink : c.inkMuted} size={22} strokeWidth={on ? 2 : 1.6}/>
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500,
              color: on ? c.ink : c.inkMuted, letterSpacing: 0.1 }}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Generic button ──────────────────────────────────────────────
function CFButton({ children, dark, accent, kind = 'primary', icon, full, onClick, size = 'md' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const h = size === 'lg' ? 56 : size === 'sm' ? 36 : 48;
  const styles = {
    primary: {
      background: c.ink, color: c.surface,
      boxShadow: `0 6px 14px rgba(11,11,18,.18)`,
    },
    accent: {
      background: `linear-gradient(140deg, ${a.solid}, ${a.deep})`,
      color: a.ink,
      boxShadow: `0 10px 24px ${a.glow}, inset 0 1px 0 rgba(255,255,255,.4)`,
    },
    ghost: {
      background: c.surface, color: c.ink, border: `1px solid ${c.border}`,
    },
    soft: {
      background: a.soft, color: a.deep,
    },
  }[kind];
  return (
    <button onClick={onClick} style={{
      width: full ? '100%' : 'auto', height: h, padding: `0 ${size === 'sm' ? 14 : 22}px`,
      borderRadius: h / 2, border: 0, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontSize: size === 'sm' ? 13.5 : 15.5, fontWeight: 700, letterSpacing: -0.2,
      ...styles,
    }}>
      {icon}{children}
    </button>
  );
}

// ─── Section pill chip ─────────────────────────────────────────────
function CFPill({ children, active, dark, accent, onClick, size = 'md' }) {
  const c = cfTheme(dark);
  const a = cfAccent(accent);
  const h = size === 'sm' ? 30 : 34;
  return (
    <button onClick={onClick} style={{
      height: h, padding: `0 ${size === 'sm' ? 12 : 14}px`, borderRadius: h / 2,
      border: `1px solid ${active ? c.ink : c.border}`,
      background: active ? c.ink : c.surface, color: active ? c.surface : c.ink,
      fontSize: size === 'sm' ? 12.5 : 13, fontWeight: 600, letterSpacing: -0.1,
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      flexShrink: 0,
    }}>
      {children}
    </button>
  );
}

// ─── Status bar (faux iOS for non-IOSDevice screens — when needed) ─
// We let IOSDevice provide its own; this is for inner overlays.

Object.assign(window, {
  cfTheme, cfAccent,
  CFTopBar, CFSearchBar, CFCategoryChip, CFTemplateCard, CFSectionHeader,
  CFBottomNav, CFButton, CFPill,
});
