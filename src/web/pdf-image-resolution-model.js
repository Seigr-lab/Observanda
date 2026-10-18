export const validPdfImageOutputDpi=value=>value===undefined||value===null||Number.isInteger(value)&&value>=72&&value<=1200;
// Self-contained so the exact planner can be passed into the trusted isolated
// renderer as well as used by the author's local quality preview.
export function planPdfImageResolution({naturalWidth,naturalHeight,widthPx,heightPx,fit='contain',outputDpi=null}={}){
 if(!Number.isSafeInteger(naturalWidth)||!Number.isSafeInteger(naturalHeight)||naturalWidth<1||naturalHeight<1||naturalWidth*naturalHeight>64*1024*1024||![widthPx,heightPx].every(value=>Number.isFinite(value)&&value>0)||!['contain','cover'].includes(fit)||outputDpi!==null&&(!Number.isInteger(outputDpi)||outputDpi<72||outputDpi>1200))throw new TypeError('Invalid PDF image resolution');
 const displayScale=(fit==='cover'?Math.max:Math.min)(widthPx/naturalWidth,heightPx/naturalHeight),sourceDpi=96/displayScale;
 if(!Number.isFinite(sourceDpi)||sourceDpi<=0)throw new TypeError('Invalid PDF image resolution');
 const ratio=outputDpi===null?1:Math.min(1,outputDpi/sourceDpi),width=Math.min(naturalWidth,Math.max(1,Math.ceil(naturalWidth*ratio-1e-9))),height=Math.min(naturalHeight,Math.max(1,Math.ceil(naturalHeight*ratio-1e-9)));
 return {width,height,pixels:width*height,originalPixels:naturalWidth*naturalHeight,sourceDpi,effectiveDpi:Math.min(width/naturalWidth,height/naturalHeight)*sourceDpi,downsample:width<naturalWidth||height<naturalHeight};
}
