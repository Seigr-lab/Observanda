const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const text=value=>typeof value==='string'&&value.length<=240&&!/[\u0000-\u001f\u007f]/u.test(value);
export const PDF_PAGE_NUMBER_STYLES=Object.freeze(['decimal','lower-roman','upper-roman']);
export function pdfPageMasterDefaults(layout={}){
 return {version:1,facingPages:false,gutterMm:0,firstPageHeader:true,firstPageFooter:true,numberStyle:'decimal',numberStart:1,header:{left:'',center:layout.header??'',right:''},footer:{left:layout.footer??'',center:'',right:layout.pageNumbers===false?'':'{page}'}};
}
export function validPdfPageMaster(value){
 return exact(value,'version,facingPages,gutterMm,firstPageHeader,firstPageFooter,numberStyle,numberStart,header,footer')&&value.version===1&&['facingPages','firstPageHeader','firstPageFooter'].every(key=>typeof value[key]==='boolean')&&Number.isFinite(value.gutterMm)&&value.gutterMm>=0&&value.gutterMm<=100&&PDF_PAGE_NUMBER_STYLES.includes(value.numberStyle)&&Number.isInteger(value.numberStart)&&value.numberStart>=1&&value.numberStart<=9999&&['header','footer'].every(key=>exact(value[key],'left,center,right')&&Object.values(value[key]).every(text));
}
// Existing left/right values become inner/outer when facing pages are enabled.
// The binding allowance is additional; it reduces the usable width on both sides.
export function pdfPageMargins(layout,side='right'){
 if(!['left','right'].includes(side))throw new TypeError('Invalid PDF page side');
 const {top,right,bottom,left}=layout.margins,gutter=layout.pageMaster?.gutterMm??0;
 return layout.pageMaster?.facingPages&&side==='left'?{top,right:left+gutter,bottom,left:right}:{top,right,bottom,left:left+gutter};
}
export function pdfPageContentBox(layout){
 const widthMm=layout.widthMm-layout.margins.left-layout.margins.right-(layout.pageMaster?.gutterMm??0),heightMm=layout.heightMm-layout.margins.top-layout.margins.bottom;
 return {widthMm,heightMm,columnWidthMm:(widthMm-(layout.columns-1)*layout.columnGapMm)/layout.columns};
}
export function validPdfPageMasterGeometry(layout){
 if(!layout||!layout.margins||layout.pageMaster!==undefined&&!validPdfPageMaster(layout.pageMaster)||!Number.isInteger(layout.columns)||layout.columns<1||layout.columns>4||![layout.widthMm,layout.heightMm,layout.columnGapMm,...Object.values(layout.margins)].every(value=>Number.isFinite(value)&&value>=0))return false;
 const box=pdfPageContentBox(layout);return Number.isFinite(box.widthMm)&&Number.isFinite(box.heightMm)&&Number.isFinite(box.columnWidthMm)&&box.heightMm>=20&&box.columnWidthMm>=20;
}
export function pdfPageMasterHasSection(layout){return !!layout.pageMaster&&['header','footer'].some(key=>Object.values(layout.pageMaster[key]).some(value=>value.includes('{section}')));}
