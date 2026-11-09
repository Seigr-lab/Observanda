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

export function visualStyleFields(document, t) {
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
    {name:'text-align', label:'sectionAlignment', options:[['start',t('sectionStart')],['center',t('sectionCenter')],['end',t('sectionEnd')],['justify',t('sectionJustify')]]}
  ];
}
