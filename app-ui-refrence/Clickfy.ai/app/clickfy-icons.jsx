// clickfy-icons.jsx — line iconography (1.6 stroke, 24px viewBox)
// All icons take {size, color, strokeWidth, fill}.

const cf_icon = (paths, vb = '0 0 24 24') => ({ size = 22, color = 'currentColor', strokeWidth = 1.6, fill = 'none', style }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke={color} strokeWidth={strokeWidth}
    strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    {paths}
  </svg>
);

const IconMenu      = cf_icon(<><path d="M3 7h18"/><path d="M3 12h18"/><path d="M3 17h12"/></>);
const IconSearch    = cf_icon(<><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></>);
const IconPlus      = cf_icon(<><path d="M12 5v14"/><path d="M5 12h14"/></>);
const IconClose     = cf_icon(<><path d="M6 6l12 12"/><path d="M18 6L6 18"/></>);
const IconChevR     = cf_icon(<path d="M9 5l7 7-7 7"/>);
const IconChevL     = cf_icon(<path d="M15 5l-7 7 7 7"/>);
const IconChevD     = cf_icon(<path d="M5 9l7 7 7-7"/>);
const IconArrowR    = cf_icon(<><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></>);
const IconHeart     = cf_icon(<path d="M12 20s-7.5-4.5-7.5-10A4.5 4.5 0 0112 6a4.5 4.5 0 017.5 4c0 5.5-7.5 10-7.5 10z"/>);
const IconBookmark  = cf_icon(<path d="M6 4h12v17l-6-4-6 4z"/>);
const IconShare     = cf_icon(<><circle cx="6" cy="12" r="2.4"/><circle cx="17" cy="6" r="2.4"/><circle cx="17" cy="18" r="2.4"/><path d="M8.2 11l6.6-3.8"/><path d="M8.2 13l6.6 3.8"/></>);
const IconDownload  = cf_icon(<><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></>);
const IconUpload    = cf_icon(<><path d="M12 20V8"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/></>);
const IconCamera    = cf_icon(<><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></>);
const IconImage     = cf_icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M5 18l5-5 4 4 2-2 4 4"/></>);
const IconVideo     = cf_icon(<><rect x="3" y="6" width="14" height="12" rx="2.5"/><path d="M17 10l4-2v8l-4-2z"/></>);
const IconLayers    = cf_icon(<><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17l9 5 9-5" opacity=".55"/></>);
const IconStar      = cf_icon(<path d="M12 3l2.7 5.5 6 .9-4.3 4.2 1 6L12 16.8 6.5 19.6l1-6L3.3 9.4l6-.9z"/>);
const IconSpark     = cf_icon(<><path d="M12 3v6"/><path d="M12 15v6"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M5.6 5.6L9 9"/><path d="M15 15l3.4 3.4"/><path d="M5.6 18.4L9 15"/><path d="M15 9l3.4-3.4"/></>);
const IconBolt      = cf_icon(<path d="M13 3L4 14h6l-1 7 9-11h-6z"/>);
const IconClock     = cf_icon(<><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>);
const IconFolder    = cf_icon(<path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>);
const IconCompass   = cf_icon(<><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z" fill="currentColor" stroke="none"/></>);
const IconGrid      = cf_icon(<><rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/></>);
const IconUser      = cf_icon(<><circle cx="12" cy="8" r="3.8"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/></>);
const IconCheck     = cf_icon(<path d="M5 12.5l4.5 4.5L19 7.5"/>);
const IconRefresh   = cf_icon(<><path d="M3 12a9 9 0 0115.5-6.3L21 8"/><path d="M21 4v4h-4"/><path d="M21 12a9 9 0 01-15.5 6.3L3 16"/><path d="M3 20v-4h4"/></>);
const IconSliders   = cf_icon(<><path d="M5 6h7"/><path d="M16 6h3"/><path d="M5 12h3"/><path d="M12 12h7"/><path d="M5 18h11"/><path d="M19 18h0"/><circle cx="14" cy="6" r="1.8"/><circle cx="10" cy="12" r="1.8"/><circle cx="18" cy="18" r="1.8"/></>);
const IconWand      = cf_icon(<><path d="M4 20l9-9"/><path d="M14 4l1.5 3.5L19 9l-3.5 1.5L14 14l-1.5-3.5L9 9l3.5-1.5z" fill="currentColor" stroke="none" opacity=".9"/><path d="M19 14l.8 1.8L21.5 17l-1.7.8L19 19.5l-.8-1.7L16.5 17l1.7-1.2z" fill="currentColor" stroke="none" opacity=".9"/></>);
const IconBell      = cf_icon(<><path d="M6 17h12l-1.5-2V11a4.5 4.5 0 10-9 0v4z"/><path d="M10 20a2 2 0 004 0"/></>);
const IconLogout    = cf_icon(<><path d="M14 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h7a2 2 0 002-2v-3"/><path d="M10 12h11"/><path d="M18 8l3 4-3 4"/></>);
const IconCard      = cf_icon(<><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M7 15h4"/></>);
const IconHelp      = cf_icon(<><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 015 .3c0 1.5-2.5 1.8-2.5 3.5"/><path d="M12 17h.01"/></>);
const IconGift      = cf_icon(<><rect x="3.5" y="9.5" width="17" height="11" rx="1.5"/><path d="M3.5 14h17"/><path d="M12 9.5V21"/><path d="M8 9.5C5 9.5 5 5 8 5c1.5 0 4 4.5 4 4.5"/><path d="M16 9.5c3 0 3-4.5 0-4.5-1.5 0-4 4.5-4 4.5"/></>);
const IconLock      = cf_icon(<><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/></>);
const IconShield    = cf_icon(<path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/>);
const IconMoon      = cf_icon(<path d="M20 14a8 8 0 01-10-10 8.5 8.5 0 1010 10z"/>);
const IconHash      = cf_icon(<><path d="M5 9h14"/><path d="M5 15h14"/><path d="M10 4l-2 16"/><path d="M16 4l-2 16"/></>);
const IconType      = cf_icon(<><path d="M5 6h14"/><path d="M12 6v14"/><path d="M9 20h6"/></>);
const IconPlay      = cf_icon(<path d="M7 5l12 7-12 7z" fill="currentColor"/>);

// Custom logo mark — Clickfy "C" with a click pulse
function ClickfyMark({ size = 28, color = '#0B0B12', accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M16 4a12 12 0 100 24 12 12 0 008.5-3.5" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <circle cx="24" cy="8" r="3.6" fill={accent || color}/>
    </svg>
  );
}

// Wordmark — "Clickfy" in heavy weight + accent dot
function ClickfyWordmark({ color = '#0B0B12', accent = '#6E3CFF', size = 18 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontFamily: clickfyFontStack,
      fontSize: size, fontWeight: 700, letterSpacing: -0.6, color, lineHeight: 1 }}>
      Clickfy<span style={{ width: size * 0.22, height: size * 0.22, borderRadius: '50%',
        background: accent, marginLeft: 3, marginBottom: -2 }}/>
    </span>
  );
}

Object.assign(window, {
  IconMenu, IconSearch, IconPlus, IconClose, IconChevR, IconChevL, IconChevD, IconArrowR,
  IconHeart, IconBookmark, IconShare, IconDownload, IconUpload, IconCamera, IconImage, IconVideo,
  IconLayers, IconStar, IconSpark, IconBolt, IconClock, IconFolder, IconCompass, IconGrid,
  IconUser, IconCheck, IconRefresh, IconSliders, IconWand, IconBell, IconLogout, IconCard,
  IconHelp, IconGift, IconLock, IconShield, IconMoon, IconHash, IconType, IconPlay,
  ClickfyMark, ClickfyWordmark,
});
