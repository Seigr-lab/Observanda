import {pdfPageMargins} from './web/pdf-page-master-model.js';
// Only compiler-owned running matter is eligible for artifact classification.
// A renderer must also prove that it lies outside every matching content box.
export function pdfAccessibilityLayout(entries,{numberStart=1}={}){
 const layouts=new Map();
 for(const {value,sectionTitle=''} of entries){
  const master=value.pageMaster,runningText=master?[...Object.values(master.header),...Object.values(master.footer)].map(text=>text.replaceAll('{section}',sectionTitle)):[value.header,value.footer,...(value.pageNumbers?['{page}']:[])];
  for(const side of master?.facingPages?['left','right']:['right']){
   const item={widthMm:value.widthMm,heightMm:value.heightMm,margins:pdfPageMargins(value,side),runningText:runningText.filter(Boolean),numberStyle:master?.numberStyle??'decimal',numberStart};layouts.set(JSON.stringify(item),item);
  }
 }
 return {version:1,layouts:[...layouts.values()]};
}
