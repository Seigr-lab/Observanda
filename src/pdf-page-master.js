import {fontStack} from './web/font-catalogue.js';
import {PdfLayoutError} from './web/pdf-layout-model.js';
import {validPdfPageMaster,validPdfPageMasterGeometry,pdfPageMargins} from './web/pdf-page-master-model.js';
export {pdfPageContentBox,pdfPageMasterHasSection} from './web/pdf-page-master-model.js';
// A CSS string is not a JSON string: line breaks use CSS hexadecimal escapes.
// Angle brackets are escaped too because the result lives in an HTML style tag.
const quoted=value=>'"'+value.replace(/["\\\u0000-\u001f<>\u007f\u2028\u2029]/gu,char=>char==='"'?'\\"':char==='\\'?'\\\\':'\\'+char.codePointAt(0).toString(16)+' ')+'"';
const placeholders=/\{(page|pages|section)\}/g;
function content(text,master,sectionTitle){
 if(!text)return 'none';let start=0;const parts=[];
 for(const match of text.matchAll(placeholders)){
  if(match.index>start)parts.push(quoted(text.slice(start,match.index)));
  parts.push(match[1]==='section'?quoted(sectionTitle):'counter('+match[1]+','+master.numberStyle+')');start=match.index+match[0].length;
 }
 if(start<text.length)parts.push(quoted(text.slice(start)));return parts.join(' ');
}
function selected(layout,sectionTitle){
 if(!validPdfPageMaster(layout.pageMaster)||!validPdfPageMasterGeometry(layout)||typeof sectionTitle!=='string'||sectionTitle.length>1024||!/^#[a-f0-9]{6}$/.test(layout.color))throw new PdfLayoutError('PDF_LAYOUT');return layout.pageMaster;
}
// Named page styles receive an exact section title from the compiler. No
// running-string feature, OS font lookup, or content-dependent script is used.
export function pdfPageMasterCSS(layout,name,{sectionTitle=''}={}){
 if(layout.pageMaster===undefined)return '';
 if(typeof name!=='string'||name!==''&&!/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(name))throw new PdfLayoutError('PDF_LAYOUT');
 const master=selected(layout,sectionTitle),selector='@page'+(name?' '+name:''),margins=side=>{const m=pdfPageMargins(layout,side);return 'margin:'+m.top+'mm '+m.right+'mm '+m.bottom+'mm '+m.left+'mm;';};
 const boxes=['header','footer'].map(group=>['left','center','right'].map(side=>'@'+(group==='header'?'top':'bottom')+'-'+side+'{content:'+content(master[group][side],master,sectionTitle)+';font:9pt '+fontStack(layout.font)+';color:'+layout.color+';text-align:'+side+'}').join('')).join('');
 let css=selector+'{'+margins('right')+boxes+'}';
 if(master.facingPages)css+='\n'+selector+':left{'+margins('left')+'}\n'+selector+':right{'+margins('right')+'}';
 // Increment the existing page counter on the first physical page. A reset
 // creates a page-local counter whose value is lost on subsequent pages.
 // Named section styles never restart the document's counter.
 const first=(name===''?'counter-increment:page '+master.numberStart+';':'')+['header','footer'].filter(group=>!master[group==='header'?'firstPageHeader':'firstPageFooter']).map(group=>['left','center','right'].map(side=>'@'+(group==='header'?'top':'bottom')+'-'+side+'{content:none}').join('')).join('');
 if(first)css+='\n'+selector+':first{'+first+'}';return css;
}
export function pdfPageMasterText(layout,sectionTitle=''){
 if(layout.pageMaster===undefined)return '';
 const master=selected(layout,sectionTitle),digits='0123456789'+(master.numberStyle==='lower-roman'?'ivxlcdm':master.numberStyle==='upper-roman'?'IVXLCDM':'');
 return ['header','footer'].flatMap(key=>Object.values(master[key])).map(value=>value.replace(placeholders,(_,key)=>key==='section'?sectionTitle:digits)).join(' ');
}
