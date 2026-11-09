const ratios={original:'auto',square:'1',landscape:'4 / 3',portrait:'3 / 4',wide:'16 / 9'};
const positions=Array.from({length:21},(_,i)=>i*5);
export const defaultImageFrame=()=>({ratio:'original',fit:'contain',x:50,y:50});
export function validImageFrame(frame){
 return !!frame&&Object.keys(frame).length===4&&Object.hasOwn(ratios,frame.ratio)&&['contain','cover'].includes(frame.fit)&&positions.includes(frame.x)&&positions.includes(frame.y);
}
export const imageFrameClasses=frame=>['wi-ratio-'+frame.ratio,'wi-fit-'+frame.fit,'wi-x-'+frame.x,'wi-y-'+frame.y];
export function readImageFrame(classes=''){
 const frame=defaultImageFrame();
 for(const token of classes.split(/\s+/)){
  const match=/^wi-(ratio|fit|x|y)-([\w]+)$/.exec(token);
  if(match)frame[match[1]]=['x','y'].includes(match[1])?Number(match[2]):match[2];
 }
 return validImageFrame(frame)?frame:defaultImageFrame();
}
export function applyImageFrame(image,frame){
 for(const token of [...image.classList])if(/^wi-(ratio|fit|x|y)-/.test(token))image.classList.remove(token);
 image.classList.add(...imageFrameClasses(frame));
}
export const imageFrameCSS=Object.entries(ratios).filter(([key])=>key!=='original').map(([key,ratio])=>
 'img.wi-ratio-'+key+'{width:100%;height:auto;aspect-ratio:'+ratio+';object-position:var(--wi-x,50%) var(--wi-y,50%)}').join('')+
 'img.wi-fit-cover{object-fit:cover}img.wi-fit-contain{object-fit:contain}'+positions.map(n=>
 'img.wi-x-'+n+'{--wi-x:'+n+'%}img.wi-y-'+n+'{--wi-y:'+n+'%}').join('');
const keys={ratio:'frameRatio',fit:'frameFit',x:'frameFocusX',y:'frameFocusY'};
export function imageFrameControls(frame,t,esc){
 const select=(name,values)=>'<label>'+esc(t(keys[name]))+'<select aria-label="'+esc(t(keys[name]))+'" data-image-frame="'+name+'">'+values.map(key=>
  '<option value="'+key+'"'+(frame[name]===key?' selected':'')+'>'+esc(t('frame_'+key))+'</option>').join('')+'</select></label>';
 return '<details class="website-image-frame"><summary>'+esc(t('imageFraming'))+'</summary>'+select('ratio',Object.keys(ratios))+select('fit',['contain','cover'])+
 ['x','y'].map(axis=>'<label>'+esc(t(keys[axis]))+'<input data-image-frame="'+axis+'" type="range" min="0" max="100" step="5" value="'+frame[axis]+'"></label>').join('')+'</details>';
}
export function changeImageFrame(field,original){
 const key=field.dataset.imageFrame;if(!Object.hasOwn(keys,key))return null;
 const frame={...original,[key]:['x','y'].includes(key)?field.valueAsNumber:field.value};
 return validImageFrame(frame)?frame:null;
}
export function previewImageFrame(image,frame){
 image.style.aspectRatio=ratios[frame.ratio];image.style.objectFit=frame.fit;
 image.style.objectPosition=frame.x+'% '+frame.y+'%';
 image.style.width=frame.ratio==='original'?'':'100%';image.style.height=frame.ratio==='original'?'':'auto';
}
export function showOriginalImage(trigger,source,alt,t,ownership){
 const dialog=document.createElement('dialog'),heading=document.createElement('h2'),close=document.createElement('button'),image=document.createElement('img');
 dialog.className='website-original-image';dialog.setAttribute('aria-label',t('frameOpenOriginal'));
 heading.textContent=t('frameOpenOriginal');close.textContent=t('closePreview');close.type='button';
 image.alt=alt;const temporary=source instanceof Blob?URL.createObjectURL(source):null;
 const release=()=>{if(temporary)URL.revokeObjectURL(temporary);};
 const note=document.createElement('p');note.textContent=t(ownership);
 image.onload=image.onerror=release;image.src=temporary??source;dialog.append(heading,close,note,image);
 close.onclick=()=>dialog.close();dialog.onclose=()=>{release();dialog.remove();trigger.focus();};
 trigger.parentElement.append(dialog);dialog.showModal();close.focus();
}
