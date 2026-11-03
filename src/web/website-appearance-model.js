export const appearanceColors={background:'--page-background',text:'--page-text',accent:'--accent',surface:'--page-surface',border:'--page-border'};
export const appearanceFonts={sans:'system-ui, sans-serif',serif:'Georgia, serif',mono:'ui-monospace, monospace'};
export const appearancePresets={
 coast:{background:'#f6f8f6',text:'#193337',accent:'#08635a',surface:'#ffffff',border:'#c8d6cf',reading:'sans',heading:'serif'},
 field:{background:'#faf6ee',text:'#322d24',accent:'#765321',surface:'#fffcf6',border:'#d5c7ac',reading:'serif',heading:'sans'},
 night:{background:'#18232c',text:'#ebf2f5',accent:'#91d7ec',surface:'#23333e',border:'#526673',reading:'sans',heading:'sans'}
};
export function validAppearance(values){
 if(!values||typeof values!=='object'||Array.isArray(values))return false;
 return Object.entries(values).every(([key,value])=>typeof value==='string'&&(Object.hasOwn(appearanceColors,key)?/^#[0-9a-f]{6}$/i.test(value):['reading','heading'].includes(key)&&Object.hasOwn(appearanceFonts,value)));
}
export function appearanceCSS(values){
 const vars=[],body=[],rules=[];
 for(const [key,property] of Object.entries(appearanceColors))if(values[key])vars.push(property+': '+values[key]);
 if(values.reading){vars.push('--reading-font: '+appearanceFonts[values.reading]);body.push('font-family: var(--reading-font)');}
 if(values.heading){vars.push('--heading-font: '+appearanceFonts[values.heading]);rules.push(':where(h1, h2, h3, h4, h5, h6) { font-family: var(--heading-font); }');}
 if(values.background)body.push('background-color: var(--page-background)');if(values.text)body.push('color: var(--page-text)');
 if(values.accent)rules.push(':where(a) { color: var(--accent); }');
 return [':root {\n  '+vars.join(';\n  ')+';\n}',...(body.length?[':where(body) { '+body.join('; ')+'; }']:[]),...rules].join('\n')+'\n';
}
