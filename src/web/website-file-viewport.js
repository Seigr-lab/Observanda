export const websiteLayoutWidths=Object.freeze({desktop:null,tablet:900,phone:600});
const presets={desktop:1440,tablet:768,phone:375};
const breakpoint=width=>width<=websiteLayoutWidths.phone?'phone':width<=websiteLayoutWidths.tablet?'tablet':'desktop';

// Child pointer events are in document CSS pixels. Overlays drawn in the
// application window must use the displayed iframe rectangle, including zoom.
export function websiteFrameGeometry(frame){
 const bounds=frame.getBoundingClientRect(),scale=frame.offsetWidth?bounds.width/frame.offsetWidth:1;
 const left=bounds.left+frame.clientLeft*scale,top=bounds.top+frame.clientTop*scale;
 const host=frame.closest('[data-viewport-host]'),pane=host?.getBoundingClientRect()??bounds;
 const clipLeft=Math.max(pane.left,left),clipTop=Math.max(pane.top,top);
 const clipRight=Math.min(pane.left+(host?.clientWidth??pane.width),left+frame.clientWidth*scale);
 const clipBottom=Math.min(pane.top+(host?.clientHeight??pane.height),top+frame.clientHeight*scale);
 return {scale,left,top,clipLeft,clipRight,clipTop,clipBottom};
}

export function websiteFileViewport({esc,t,changed}){
 let preset='desktop',width=presets.desktop,zoom='fit',custom=1024,observer=null;
 function controls(){
  const option=(key,text,current)=>'<option value="'+key+'"'+(key===current?' selected':'')+'>'+esc(text)+'</option>';
  const choices=Object.entries(presets).map(([key,px])=>option(key,t(key)+' · '+px+' px',preset)).join('');
  return '<label>'+esc(t('viewport'))+' <select data-website-file-viewport>'+choices+option('custom',t('viewportCustom'),preset)+'</select></label>'+
   '<label data-viewport-custom'+(preset==='custom'?'':' hidden')+'><input type="number" required min="1" max="16384" step="1" value="'+custom+'" aria-label="'+esc(t('viewportPixels'))+'" data-viewport-width> px</label>'+
   '<label>'+esc(t('viewportZoom'))+' <select data-viewport-zoom>'+option('fit',t('viewportFit'),zoom)+option('actual','100%',zoom)+'</select></label>'+
   '<output data-viewport-readout></output>';
 }
 function frame(id,title){
  return '<div class="website-files-viewport" data-viewport-host><div data-viewport-surface><iframe id="'+id+'" class="website-files-canvas" title="'+esc(title)+'" sandbox="allow-same-origin"></iframe></div></div>';
 }
 function measure(){
  const host=document.querySelector('[data-viewport-host]'),frame=host?.querySelector('iframe');
  if(!frame||!host.clientWidth||!host.clientHeight)return;
  const scale=zoom==='fit'?Math.min(1,host.clientWidth/width):1;
  const height=Math.max(1,Math.floor(host.clientHeight/scale));
  frame.parentElement.style.width=width*scale+'px';
  Object.assign(frame.style,{width:width+'px',height:height+'px',transform:'scale('+scale+')'});
  const range=breakpoint(width);
  const label=range==='desktop'?'> '+websiteLayoutWidths.tablet+' px':range==='phone'?'≤ '+websiteLayoutWidths.phone+' px':(websiteLayoutWidths.phone+1)+'–'+websiteLayoutWidths.tablet+' px';
  const text=t('viewportMeasured',{width,height,percent:Math.round(scale*100),range:label});
  const readout=document.querySelector('[data-viewport-readout]');
  if(readout&&readout.textContent!==text)readout.textContent=text;
 }
 function change(input){
  if(input.matches('[data-website-file-viewport]')){
   preset=input.value;width=presets[preset]??custom;
   const label=document.querySelector('[data-viewport-custom]');label.hidden=preset!=='custom';
   if(!label.hidden){const field=label.querySelector('input');field.focus();field.select();}
  }else if(input.matches('[data-viewport-width]')){
   if(!input.reportValidity()||!Number.isInteger(input.valueAsNumber))return true;
   width=custom=input.valueAsNumber;
  }else if(input.matches('[data-viewport-zoom]'))zoom=input.value;
  else return false;
  measure();changed();return true;
 }
 function reset(){observer?.disconnect();observer=null;}
 function bind(){
  reset();const host=document.querySelector('[data-viewport-host]');if(!host)return;
  observer=new ResizeObserver(measure);observer.observe(host);measure();
 }
 return {controls,frame,bind,reset,change,breakpoint:()=>breakpoint(width)};
}
