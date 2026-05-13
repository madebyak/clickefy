// clickfy-app.jsx — main composition. Wraps every screen in IOSDevice
// and lays them out across DesignCanvas sections. Hosts the Tweaks panel
// for theme + accent + density.

const { FlexCanvas, FCSection, FCArtboard } = window;
const DesignCanvas = FlexCanvas;
const DCSection = FCSection;
const DCArtboard = FCArtboard;

const CFTW_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "accent": "violet",
  "density": "regular",
  "showVariants": true
}/*EDITMODE-END*/;

function ClickfyApp() {
  const [tw, setTweak] = useTweaks(CFTW_DEFAULTS);
  const { dark, accent, density, showVariants } = tw;

  // tiny artboard wrapper so every iOS frame is identical
  const Frame = ({ children }) => (
    <div style={{ display: 'grid', placeItems: 'center', padding: 18,
      width: '100%', height: '100%' }}>
      <IOSDevice width={CF_SCREEN_W} height={CF_SCREEN_H} dark={dark}>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
          paddingTop: 54, position: 'relative', background: cfTheme(dark).bg }}>
          {children}
        </div>
      </IOSDevice>
    </div>
  );

  const ABW = CF_SCREEN_W + 36;
  const ABH = CF_SCREEN_H + 36;

  return (
    <>
      <DesignCanvas>
        <DCSection id="flow" title="Clickfy · Core flow"
          subtitle="Discover → preview → fill → generate → review">
          <DCArtboard id="home"      label="01 · Home"            width={ABW} height={ABH}>
            <Frame><CFHome dark={dark} accent={accent} density={density}/></Frame>
          </DCArtboard>
          <DCArtboard id="category"  label="02 · Category"        width={ABW} height={ABH}>
            <Frame><CFCategoryDetail dark={dark} accent={accent} catId="product"/></Frame>
          </DCArtboard>
          <DCArtboard id="detail"    label="03 · Template detail" width={ABW} height={ABH}>
            <Frame><CFTemplateDetail dark={dark} accent={accent} tid="t4"/></Frame>
          </DCArtboard>
          <DCArtboard id="use"       label="04 · Use template"    width={ABW} height={ABH}>
            <Frame><CFUseTemplate dark={dark} accent={accent} tid="t4"/></Frame>
          </DCArtboard>
          <DCArtboard id="generating" label="05 · Generating"     width={ABW} height={ABH}>
            <Frame><CFGenerating dark={dark} accent={accent}/></Frame>
          </DCArtboard>
          <DCArtboard id="results"   label="06 · Results"         width={ABW} height={ABH}>
            <Frame><CFResults dark={dark} accent={accent} tid="t4"/></Frame>
          </DCArtboard>
        </DCSection>

        <DCSection id="account" title="Account & library"
          subtitle="Where projects live, plan & credits, side menu">
          <DCArtboard id="projects"  label="07 · Projects"        width={ABW} height={ABH}>
            <Frame><CFProjects dark={dark} accent={accent}/></Frame>
          </DCArtboard>
          <DCArtboard id="profile"   label="08 · Profile + plan"  width={ABW} height={ABH}>
            <Frame><CFProfile dark={dark} accent={accent}/></Frame>
          </DCArtboard>
          <DCArtboard id="menu"      label="09 · Side menu"       width={ABW} height={ABH}>
            <Frame><CFMenuDrawer dark={dark} accent={accent}/></Frame>
          </DCArtboard>
        </DCSection>

        {showVariants && (
          <DCSection id="variants" title="Home — three directions"
            subtitle="Pick a visual rhythm for the explore feed">
            <DCArtboard id="v-studio"  label="A · Studio (current)" width={ABW} height={ABH}>
              <Frame><CFHomeStudio dark={dark} accent={accent}/></Frame>
            </DCArtboard>
            <DCArtboard id="v-edito"   label="B · Editorial"        width={ABW} height={ABH}>
              <Frame><CFHomeEditorial dark={dark} accent={accent}/></Frame>
            </DCArtboard>
            <DCArtboard id="v-cinema"  label="C · Cinematic dark"   width={ABW} height={ABH}>
              <Frame><CFHomeCinematic accent={accent}/></Frame>
            </DCArtboard>
          </DCSection>
        )}
      </DesignCanvas>

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Theme">
          <TweakToggle label="Dark mode"
            value={dark} onChange={(v) => setTweak('dark', v)}/>
          <TweakColor label="Accent" value={accent}
            options={[
              { value: 'violet', color: '#6E3CFF' },
              { value: 'amber',  color: '#F59022' },
              { value: 'lime',   color: '#B2E63A' },
              { value: 'rose',   color: '#FF4D87' },
              { value: 'sky',    color: '#2A8DFF' },
              { value: 'graphite', color: '#0B0B12' },
            ].map(o => o.value)}
            onChange={(v) => setTweak('accent', v)}/>
        </TweakSection>
        <TweakSection title="Layout">
          <TweakRadio label="Density" value={density}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={(v) => setTweak('density', v)}/>
          <TweakToggle label="Show home variants section"
            value={showVariants} onChange={(v) => setTweak('showVariants', v)}/>
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ClickfyApp/>);
