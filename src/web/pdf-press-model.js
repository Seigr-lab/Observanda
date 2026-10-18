const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const mm=value=>value*72/25.4;
export function pdfPressDefaults(){return {version:1,bleedMm:3,cropMarks:true};}
export function validPdfPress(value){return !!exact(value,'version,bleedMm,cropMarks')&&value.version===1&&Number.isFinite(value.bleedMm)&&value.bleedMm>=0&&value.bleedMm<=20&&typeof value.cropMarks==='boolean';}
// All boxes and mark coordinates are PDF points. The original physical page is
// the finished trim: expansion reserves blank space without moving artwork.
export function pdfPressGeometry(trim,press){
 if(!validPdfPress(press)||!exact(trim,'x,y,width,height')||!Object.values(trim).every(Number.isFinite)||trim.width<=0||trim.height<=0)throw Object.assign(new Error('PDF_PRESS'),{code:'PDF_PRESS'});
 const bleedPt=mm(press.bleedMm),gap=mm(2),length=mm(3),allowancePt=bleedPt+(press.cropMarks?gap+length:0),expand=amount=>({x:trim.x-amount,y:trim.y-amount,width:trim.width+2*amount,height:trim.height+2*amount}),marks=[],right=trim.x+trim.width,top=trim.y+trim.height;
 if(press.cropMarks){for(const y of [trim.y,top])marks.push([trim.x-bleedPt-gap-length,y,trim.x-bleedPt-gap,y],[right+bleedPt+gap,y,right+bleedPt+gap+length,y]);for(const x of [trim.x,right])marks.push([x,trim.y-bleedPt-gap-length,x,trim.y-bleedPt-gap],[x,top+bleedPt+gap,x,top+bleedPt+gap+length]);}
 return {trim:{...trim},bleed:expand(bleedPt),media:expand(allowancePt),crop:expand(allowancePt),allowancePt,strokePt:0.25,marks};
}
