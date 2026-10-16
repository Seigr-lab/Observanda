// Shared design tokens: private preset names never become CSS or public metadata.
import {validFont,validAxes,axesFitFont} from './font-catalogue.js';
export {FONT_STACKS,FONT_OPTIONS,fontStack} from './font-catalogue.js';
export const APPEARANCE_KEYS = ['theme', 'accent', 'font', 'width', 'density', 'headingFont', 'background', 'surface', 'text', 'muted', 'border', 'fontSize', 'lineHeight', 'radius', 'layout', 'header'];
export const STARTING_THEMES = Object.freeze({
  research: Object.freeze({ appearance: Object.freeze({
    theme: 'research', accent: '#3758b2', background: '#f5f6f8', surface: '#ffffff', text: '#202a3a', muted: '#536072', border: '#d5dae3',
    font: 'atkinson', headingFont: 'atkinson', width: 1080, density: 'compact', fontSize: 18, lineHeight: 1.65, radius: 4, layout: 'list', header: 'plain'
  }) }),
  studio: Object.freeze({ appearance: Object.freeze({
    theme: 'studio', accent: '#216e69', background: '#f1f6f4', surface: '#ffffff', text: '#203532', muted: '#526962', border: '#cadbd5',
    font: 'atkinson', headingFont: 'space-grotesk', width: 960, density: 'comfortable', fontSize: 18, lineHeight: 1.75, radius: 16, layout: 'grid', header: 'band'
  }) })
});
export const startingAppearance = name => ({ ...STARTING_THEMES[name].appearance });
export const sameAppearance = (a, b) => Boolean(a && b && APPEARANCE_KEYS.every(key => a[key] === b[key])&&['fontAxes','headingFontAxes'].every(key=>JSON.stringify(a[key]??{})===JSON.stringify(b[key]??{})));
export function validAppearance(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !APPEARANCE_KEYS.every(k => Object.hasOwn(a, k)) || Object.keys(a).some(k=>!APPEARANCE_KEYS.includes(k)&&!['fontAxes','headingFontAxes'].includes(k)) || ['fontAxes','headingFontAxes'].some(k=>a[k]!==undefined&&!validAxes(a[k]))) return false;
  return ['research', 'studio'].includes(a.theme) && ['accent', 'background', 'surface', 'text', 'muted', 'border'].every(k => typeof a[k] === 'string' && /^#[0-9a-f]{6}$/i.test(a[k]))
    && ['font', 'headingFont'].every(k => validFont(a[k])&&axesFitFont(a[k],a[k+'Axes']))
    && Number.isInteger(a.width) && a.width >= 640 && a.width <= 1100 && ['comfortable', 'compact'].includes(a.density)
    && Number.isInteger(a.fontSize) && a.fontSize >= 14 && a.fontSize <= 22
    && Number.isFinite(a.lineHeight) && a.lineHeight >= 1.4 && a.lineHeight <= 2
    && Number.isInteger(a.radius) && a.radius >= 0 && a.radius <= 24
    && ['grid', 'list'].includes(a.layout) && ['plain', 'band'].includes(a.header);
}
export function contrastRatio(first, second) {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(pair => {
      const channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function contrastChecks(a) {
  return [
    ['Body text', Math.min(contrastRatio(a.text, a.background), contrastRatio(a.text, a.surface)), 4.5],
    ['Secondary text', Math.min(contrastRatio(a.muted, a.background), contrastRatio(a.muted, a.surface)), 4.5],
    ['Links', Math.min(contrastRatio(a.accent, a.background), contrastRatio(a.accent, a.surface)), 4.5],
    ['Figure marks on white', contrastRatio(a.accent, '#ffffff'), 3]
  ];
}
