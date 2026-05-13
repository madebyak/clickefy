// flex-canvas.jsx — minimal stand-in for design-canvas.
// Just lays out artboards in horizontal rows with section titles.
// Pan via two-finger trackpad scroll, no zoom (for now).

function FlexCanvas({ children, style = {} }) {
  return (
    <div className="fc-root" style={{
      width: '100vw', height: '100vh', overflow: 'auto',
      background: '#0B0B12',
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='120' height='120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M120 0H0v120' fill='none' stroke='rgba(255,255,255,0.05)' stroke-width='1'/%3E%3C/svg%3E\")",
      backgroundSize: '120px 120px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      padding: '60px 60px 120px',
      ...style,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 80, width: 'max-content' }}>
        {children}
      </div>
    </div>
  );
}

function FCSection({ title, subtitle, children, gap = 48 }) {
  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: 'rgba(255,255,255,0.92)', letterSpacing: -0.4, marginBottom: 6 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)' }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', gap, alignItems: 'flex-start', width: 'max-content' }}>
        {children}
      </div>
    </div>
  );
}

function FCArtboard({ label, width = 402, height = 874, children, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', letterSpacing: 0, paddingLeft: 4 }}>
        {label}
      </div>
      <div style={{ width, height, position: 'relative', ...style }}>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { FlexCanvas, FCSection, FCArtboard });
