import {fontStack,contrastRatio} from './themes.js';
import {variationCSS} from './font-catalogue.js';
import {applyApplicationBrand} from './app-brand.js';

// The app follows the author's chosen app theme: a starting theme or one they made.
export function applyAppTheme(textControls){
 const a=textControls.appearance();
 const values={accent:a.accent,background:a.background,surface:a.surface,text:a.text,muted:a.muted,border:a.border,
  radius:a.radius+'px',font:fontStack(a.font),heading:fontStack(a.headingFont),axes:variationCSS(a.fontAxes),'heading-axes':variationCSS(a.headingFontAxes),weight:a.fontAxes?.wght??400,'heading-weight':a.headingFontAxes?.wght??600,
  'on-accent':contrastRatio(a.accent,'#ffffff')>=contrastRatio(a.accent,'#17283f')?'#ffffff':'#17283f'};
 for(const [key,value] of Object.entries(values))document.documentElement.style.setProperty('--ui-'+key,value);
 document.documentElement.dataset.theme=a.base;
 applyApplicationBrand(a);
 document.documentElement.dataset.density=a.density;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',a.background);
 textControls.paintThemes?.();
}
