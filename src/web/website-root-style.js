import {fontStack,variationCSS} from './font-catalogue.js';
import {actionStyleRules} from './website-action-style.js';

export function websiteRootStyle(appearance,design){
 const a=appearance;
 return `:root{${actionStyleRules(design.buttons,'button')};${actionStyleRules(design.links,'link')};--reading-axes:${variationCSS(a.fontAxes)};--heading-axes:${variationCSS(a.headingFontAxes)};--reading-weight:${a.fontAxes?.wght??400};--heading-weight:${a.headingFontAxes?.wght??600};--heading-scale:${a.headingScale};--letter-spacing:${a.letterSpacing}px;--paragraph-spacing:${a.paragraphSpacing}em;--site-width:${design.width}px;--accent:${a.accent};--reading-width:${a.width}px;--reading-font:${fontStack(a.font)};--heading-font:${fontStack(a.headingFont)};--page-background:${a.background};--page-surface:${a.surface};--page-text:${a.text};--page-muted:${a.muted};--page-border:${a.border};--body-size:${a.fontSize}px;--line-height:${a.lineHeight};--corner-radius:${a.radius}px;--section-space:${a.density === 'compact' ? '28px' : '44px'};--card-padding:${a.density === 'compact' ? '20px' : '28px'};--card-gap:${a.density === 'compact' ? '16px' : '24px'};--entry-space:${a.density === 'compact' ? '2.5rem' : '4rem'}}`;
}
