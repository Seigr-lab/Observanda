import {customFontId} from './font-catalogue.js';
import {revisionId} from './revision-model.js';
export function validPdfFontPin(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='id,revision'&&customFontId(value.id)&&revisionId(value.revision);}
export function validPdfFontPins(value){return Array.isArray(value)&&value.length<=64&&value.every(validPdfFontPin)&&new Set(value.map(font=>font.id)).size===value.length;}
