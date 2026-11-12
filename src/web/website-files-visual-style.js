// The editor writes ordinary declarations. The same rules are read by the
// canvas, an exported folder and a site hosted without Observanda.
const properties = {
  color: ['--page-text', '--page-muted'],
  'background-color': ['--page-background'],
  'font-family': ['--reading-font', '--heading-font'],
  'font-size': ['--body-size'],
  'font-weight': ['--reading-weight', '--heading-weight'],
  'line-height': ['--line-height'],
  'letter-spacing': ['--letter-spacing'],
  padding: [],
  'background-image': [],
  '--website-overlay-color': [],
  '--website-overlay-strength': [],
  'background-size': [],
  'background-position': [],
  'background-repeat': [],
  margin: [],
  opacity: [],
  'box-shadow': [],
  'text-align': ['--section-heading-align', '--section-body-align', '--section-item-heading-align', '--section-details-align', '--section-caption-align', '--section-button-align']
};
const classFormat = /^ow-visual-[a-f0-9-]{36}$/;
export const generatedAppearanceProperties = new Set(Object.entries(properties).flatMap(([property,aliases])=>[property,...aliases]));

export function visualClass(node) {
  return [...node.classList].find(name=>classFormat.test(name));
}
function selector(name) {
  if (name==='site') return 'body';
  if (!classFormat.test(name)) throw new TypeError('Invalid visual style');
  return '.'+name;
}
function rule(css, name) {
  const start='\n/* Observanda appearance '+name+' */\n'+selector(name)+' {';
  const from=css.indexOf(start);
  const to=from<0?-1:css.indexOf('}',from+start.length);
  return {from,to,body:to<0?'':css.slice(from+start.length,to),start};
}

export function applyVisualStyle(style, changes, {text = false} = {}) {
  for (const [property, value] of changes) {
    if (!Object.hasOwn(properties, property)) continue;
    for (const name of [property, ...(text ? [] : properties[property])]) {
      if (value) style.setProperty(name, value);
      else style.removeProperty(name);
    }
  }
}

export function readVisualStyle(document, css, name) {
  const style = document.createElement('div').style;
  if(name)style.cssText=rule(css,name).body;
  return style;
}

export function writeVisualStyle(css, name, style) {
  const {from,to,start}=rule(css,name);
  const replacement=style.length?start+style.cssText+'}':'';
  return to<0?css+replacement:css.slice(0,from)+replacement+css.slice(to+1);
}

// A site picture as a background, written relative to the stylesheet that
// holds the rule, so the published site and the canvas resolve it alike.
// The picture is drawn under an overlay layer whose colour and strength are
// separate controls, so a block can have an overlay and a drop shadow.
const overlayLayer='color-mix(in srgb, var(--website-overlay-color, #000000) calc(var(--website-overlay-strength, 0) * 100%), transparent)';
export function backgroundPictureValue(name, stylesheetPath) {
  return 'linear-gradient(' + overlayLayer + ', ' + overlayLayer + '), url("' + '../'.repeat(stylesheetPath.split('/').length - 1) + name + '")';
}

export function visualStyleFields(document, t, {pictures = [], stylesheetPath = 'style.css'} = {}) {
  const fonts = [
    ['system-ui, sans-serif', t('sectionSans')], ['Georgia, serif', t('sectionSerif')], ['ui-monospace, monospace', t('sectionMono')]
  ];
  // Only offer named faces present in this saved website's loaded styles.
  // A font in the editor installation need not be available when published.
  const seen = new Set();
  for (const face of document.fonts) {
    const family = face.family.replace(/^["']|["']$/g, '');
    if (!family || seen.has(family)) continue;
    seen.add(family);
    fonts.push([JSON.stringify(family) + ', sans-serif', family]);
  }
  return [
    {name:'color', label:'sectionText', type:'color'},
    {name:'background-color', label:'sectionBackground', type:'color'},
    {name:'font-family', label:'sectionFont', options:fonts},
    {name:'font-size', label:'sectionSize', type:'number', min:1, step:'any', unit:'px'},
    {name:'font-weight', label:'sectionWeight', type:'number', min:1, max:1000, step:'any'},
    {name:'line-height', label:'sectionLineHeight', type:'number', min:0, step:'any'},
    {name:'letter-spacing', label:'sectionLetterSpacing', type:'number', step:'any', unit:'px'},
    {name:'padding', label:'sectionPadding', type:'number', min:0, step:'any', unit:'px'},
    {group:'more', name:'background-image', label:'sectionBackgroundPicture', options:[['none',t('sectionNoPicture')],...pictures.map((name,i)=>[backgroundPictureValue(name,stylesheetPath),t('sectionPictureNumber',{number:i+1,name:name.slice(9,17)})])]},
    {group:'more', name:'--website-overlay-color', label:'sectionOverlayColour', type:'color'},
    {group:'more', name:'--website-overlay-strength', label:'sectionOverlayStrength', type:'number', min:0, max:0.9, step:0.05},
    {group:'more', name:'background-size', label:'sectionBackgroundSize', options:[['cover',t('sectionBackgroundCover')],['contain',t('sectionBackgroundContain')],['auto',t('sectionBackgroundNatural')]]},
    {group:'more', name:'background-position', label:'sectionBackgroundPosition', options:[['center center',t('sectionCenter')],['center top',t('sectionTop')],['center bottom',t('sectionBottom')],['left center',t('sectionLeft')],['right center',t('sectionRight')]]},
    {group:'more', name:'background-repeat', label:'sectionBackgroundRepeat', options:[['no-repeat',t('sectionRepeatOnce')],['repeat',t('sectionRepeatTile')]]},
    {group:'more', name:'margin', label:'sectionMargin', type:'number', step:'any', unit:'px'},
    {group:'more', name:'opacity', label:'sectionOpacity', type:'number', min:0, max:1, step:0.05},
    // Values in the browser's own serialization, so a saved shadow reads back.
    {group:'more', name:'box-shadow', label:'sectionShadow', options:[['none',t('sectionShadowNone')],['rgba(0, 0, 0, 0.12) 0px 1px 3px 0px',t('sectionShadowSoft')],['rgba(0, 0, 0, 0.16) 0px 4px 12px 0px',t('sectionShadowMedium')],['rgba(0, 0, 0, 0.22) 0px 12px 32px 0px',t('sectionShadowStrong')],
      // An inset overlay darkens or lightens a background picture behind the text.
      ['rgba(0, 0, 0, 0.45) 0px 0px 0px 100vmax inset',t('sectionOverlayDark')],['rgba(255, 255, 255, 0.6) 0px 0px 0px 100vmax inset',t('sectionOverlayLight')]]},
    {name:'text-align', label:'sectionAlignment', options:[['start',t('sectionStart')],['center',t('sectionCenter')],['end',t('sectionEnd')],['justify',t('sectionJustify')]]}
  ];
}
