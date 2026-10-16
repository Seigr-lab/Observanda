import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import {BUNDLED_FONTS,faceCSS,customFontId} from './web/font-catalogue.js';
import {AppError} from './errors.js';
export {FONT_STACKS,fontStack} from './web/font-catalogue.js';
export const bundledFonts = new Map();
for (const font of BUNDLED_FONTS) {
  for(const face of font.faces)bundledFonts.set('fonts/'+face.file,await readFile(new URL('./fonts/'+face.file,import.meta.url)));
  bundledFonts.set('fonts/'+font.license,await readFile(new URL('./fonts/'+font.license,import.meta.url),'utf8'));
}
export function fontCSS(names, files, customFiles=new Map()) {
  return [...new Set(names)].map(id => {
    const bundled=BUNDLED_FONTS.find(f=>f.id===id);
    if(bundled){files.set('fonts/'+bundled.license,bundledFonts.get('fonts/'+bundled.license));return bundled.faces.map(face=>{files.set('fonts/'+face.file,bundledFonts.get('fonts/'+face.file));return faceCSS(id,face,'fonts/'+face.file);}).join('\n');}
    if(!customFontId(id))return '';
    const font=customFiles.get(id);if(!font)throw new AppError('FONT_MISSING');if(!font.embed)throw new AppError('FONT_EMBED');
    const face=font.faces[0];files.set('fonts/'+face.file,font.bytes);return faceCSS(id,face,'fonts/'+face.file);
  }).join('\n');
}
export const bundledFontCSS=fontCSS(BUNDLED_FONTS.map(f=>f.id),new Map());
export function isBundledFont(name, bytes) {
  const original = bundledFonts.get(name);
  return original !== undefined && createHash('sha256').update(original).digest('hex') === createHash('sha256').update(bytes).digest('hex');
}
