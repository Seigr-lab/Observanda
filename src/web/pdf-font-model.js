import {customFontId,BUNDLED_FONTS} from './font-catalogue.js';
import {revisionId} from './revision-model.js';
export function validPdfFontPin(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='id,revision'&&customFontId(value.id)&&revisionId(value.revision);}
export function validPdfFontPins(value){return Array.isArray(value)&&value.length<=64&&value.every(validPdfFontPin)&&new Set(value.map(font=>font.id)).size===value.length;}

// Only authored font marks are inspected; provenance and arbitrary source
// metadata must not make hidden fonts part of a selected PDF edition.
export function pdfInlineFontIds(value){
 const result=new Set();function visit(node){if(!node||typeof node!=='object')return;for(const mark of node.marks??[])if(mark.type==='font_family')result.add(mark.attrs.font);for(const child of node.content??[])visit(child);}visit(value);return [...result];
}
export function pdfSectionFontIds(section){return [...new Set([...(section?.layout?[section.layout.font]:[]),...pdfInlineFontIds(section?.content),...(section?.notes??[]).flatMap(note=>pdfInlineFontIds(note.content))])];}
export function pdfFontChoices(fonts=[]){return [...BUNDLED_FONTS.map(font=>[font.id,font.family]),...fonts.filter(font=>customFontId(font.id)&&font.embed&&!font.restricted).map(font=>[font.id,font.label])];}
