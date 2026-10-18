import {validPdfPrintCondition} from './pdf-print-condition-model.js';
import {validPdfOutputProfile} from './pdf-output-validation-model.js';
import {validPdfPress} from './pdf-press-model.js';
import {validPdfPagination} from './pdf-pagination-model.js';
import {validPdfComposition} from './pdf-composition-model.js';
import {validPdfAudience,validPdfPublication} from './pdf-audience-model.js';
import {validPdfPageMasterGeometry} from './pdf-page-master-model.js';
import {validPdfNotes} from './pdf-notes-model.js';
import {validPdfImages} from './pdf-image-model.js';
import {validPdfFontPins} from './pdf-font-model.js';
import {validPdfStructure} from './pdf-structure-model.js';
import {validPdfResearch,validPdfFigures} from './pdf-research-model.js';
import {researchId} from './research-reference.js';
import {validProse,proseDocument} from './prose-model.js';
import {validFont} from './font-catalogue.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
export class PdfLayoutError extends Error{
 constructor(code,details=[]){super(code);this.name='PdfLayoutError';this.code=code;this.details=details;}
}
// Physical dimensions are millimetres; typography is in points. Presets are
// starting values, never a restriction on the author's saved layout.
export function pdfLayoutPreset(profile='digital'){
 if(!['digital','print'].includes(profile))throw new PdfLayoutError('PDF_LAYOUT');
 return {version:1,widthMm:210,heightMm:297,margins:{top:20,right:20,bottom:20,left:20},columns:1,columnGapMm:8,font:'atkinson',fontSizePt:11,lineHeight:1.5,header:'',footer:'',pageNumbers:true,links:profile==='print'?'disabled':'enabled',background:'#ffffff',color:'#172332'};
}
export function validPdfLayout(value){
 if(!exact(value,['version','widthMm','heightMm','margins','columns','columnGapMm','font','fontSizePt','lineHeight','header','footer','pageNumbers','links','background','color',...(Object.hasOwn(value??{},'pageMaster')?['pageMaster']:[])])||value.version!==1)return false;
 if(!number(value.widthMm,40,1000)||!number(value.heightMm,40,1000)||!exact(value.margins,['top','right','bottom','left'])||!Object.values(value.margins).every(v=>number(v,0,400)))return false;
 if(!Number.isInteger(value.columns)||!number(value.columns,1,4)||!number(value.columnGapMm,0,100)||!number(value.fontSizePt,6,96)||!number(value.lineHeight,1,3))return false;
 const innerWidth=value.widthMm-value.margins.left-value.margins.right,innerHeight=value.heightMm-value.margins.top-value.margins.bottom;
 return validPdfPageMasterGeometry(value)&&innerHeight>=20&&(innerWidth-value.columnGapMm*(value.columns-1))/value.columns>=20&&validFont(value.font)&&text(value.header,240)&&text(value.footer,240)&&typeof value.pageNumbers==='boolean'&&['enabled','disabled'].includes(value.links)&&[value.background,value.color].every(v=>typeof v==='string'&&/^#[a-f0-9]{6}$/.test(v));
}
export function validPdfDocumentHeader(value){
 return exact(value,['version','id','name','language','direction','layout',...['structure','fonts','audience','press','outputProfile','printCondition'].filter(key=>Object.hasOwn(value??{},key))])&&(!Object.hasOwn(value,'printCondition')||validPdfPrintCondition(value.printCondition)&&value.outputProfile!=='pdfa-2u')&&(!Object.hasOwn(value,'outputProfile')||validPdfOutputProfile(value.outputProfile))&&(!Object.hasOwn(value,'press')||validPdfPress(value.press))&&(!Object.hasOwn(value,'audience')||validPdfAudience(value.audience))&&(!Object.hasOwn(value,'structure')||validPdfStructure(value.structure))&&(!Object.hasOwn(value,'fonts')||validPdfFontPins(value.fonts))&&value.version===1&&researchId(value.id)&&text(value.name,240)&&!!value.name.trim()&&typeof value.language==='string'&&/^[a-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.language)&&['ltr','rtl','auto'].includes(value.direction)&&validPdfLayout(value.layout);
}
export function validPdfSection(value){
 return exact(value,['id','title','content','layout','start',...['research','figures','level','images','notes','publication','composition','pagination'].filter(key=>Object.hasOwn(value??{},key))])&&(!Object.hasOwn(value,'pagination')||validPdfPagination(value.pagination))&&(!Object.hasOwn(value,'composition')||validPdfComposition(value.composition))&&(!Object.hasOwn(value,'publication')||validPdfPublication(value.publication))&&(!Object.hasOwn(value,'research')||validPdfResearch(value.research))&&(!Object.hasOwn(value,'figures')||validPdfFigures(value.figures))&&(!Object.hasOwn(value,'images')||validPdfImages(value.images))&&(!Object.hasOwn(value,'notes')||validPdfNotes(value.notes))&&(!Object.hasOwn(value,'level')||Number.isInteger(value.level)&&value.level>=1&&value.level<=6)&&researchId(value.id)&&text(value.title,240)&&validProse(value.content)&&[null,'page','recto','verso'].includes(value.start)&&(value.layout===null||validPdfLayout(value.layout));
}
export function pdfSectionContent(section){return proseDocument(section.content);}
