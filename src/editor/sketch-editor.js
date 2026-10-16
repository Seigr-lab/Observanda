import {SKETCH_KINDS,SKETCH_LIMITS,validSketch,moveSketchItem} from '../web/sketch-model.js';
import {renderSketch} from '../web/sketch-renderer.js';
import {t as translate} from '../web/i18n/index.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function sketchEditor(host,a,{message=key=>translate('sketch',key)}={}){
 const controller=new AbortController(),events={signal:controller.signal};let selected=null,tool='stroke',colour='#202a3a',fill='none',weight=3,size=24,text='',gesture=null,undo=[],redo=[],zoom='fit';
 const t=key=>esc(message(key)),button=(action,label=action)=>`<button class="button" type="button" data-sketch-action="${action}">${t(label)}</button>`;
 const field=(key,value,type='number',extra='')=>`<label data-sketch-option="${key}">${t(key)}<input data-sketch-prop="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
 const copy=()=>structuredClone({items:a.items,width:a.width,height:a.height,background:a.background});
 const valid=()=>validSketch({...a,title:a.title||'Sketch',description:a.description||'Description'});
 const status=key=>{host.querySelector('[data-sketch-status]').textContent=message(key);};
 function remember(before){undo.push(before);if(undo.length>30)undo.shift();redo=[];}
 function change(fn,error='limit'){const before=copy();fn();if(!valid()){Object.assign(a,before);status(error);paint();return false;}remember(before);status('changed');paint();return true;}
 const item=()=>a.items.find(i=>i.id===selected);
 function fresh(kind,x=80,y=80){const base={id:crypto.randomUUID(),kind,colour};if(kind==='stroke')return {...base,weight,points:[[x,y]]};if(kind==='text')return {...base,x,y,text,size};return {...base,x,y,x2:Math.min(x+120,a.width),y2:Math.min(y+80,a.height),weight,fill};}
 host.className='sketch-editor';host.innerHTML=`<p>${t('hint')}</p><div class="sketch-tools"><label>${t('tool')}<select data-sketch-tool>${['select',...SKETCH_KINDS].map(k=>`<option value="${k}"${k===tool?' selected':''}>${t(k)}</option>`).join('')}</select></label>${field('colour',colour,'color')}${field('weight',weight,'number','min="0.5" max="24" step="0.5"')}${field('fill','#ffffff','color')}<label class="sketch-check"><input type="checkbox" data-sketch-no-fill checked>${t('transparent')}</label>${field('size',size,'number','min="8" max="96"')}<label>${t('textValue')}<textarea data-sketch-text maxlength="1000" rows="2"></textarea></label>${button('add')}</div><div class="sketch-actions">${['undo','redo','delete','down','up','svg','png'].map(k=>button(k)).join('')}</div><p data-sketch-status role="status" aria-live="polite"></p><div class="sketch-canvas-host">${renderSketch(a,{editing:true})}</div><div class="sketch-settings"><label>${t('elements')}<select data-sketch-selection></select></label><div data-sketch-selected></div><div class="sketch-dimensions">${field('width',a.width,'number','min="160" max="4096"')}${field('height',a.height,'number','min="160" max="4096"')}${field('background',a.background,'color')}</div></div>`;
 const svg=host.querySelector('[data-sketch-canvas]');svg.setAttribute('aria-label',message('canvas'));
 const zoomControl=host.ownerDocument.createElement('label');zoomControl.innerHTML=t('zoom')+`<select data-sketch-zoom><option value="fit">${t('fit')}</option><option value="1">100%</option><option value="2">200%</option></select>`;host.querySelector('.sketch-actions').after(zoomControl);
 function tools(){for(const label of host.querySelectorAll('[data-sketch-option]')){const key=label.dataset.sketchOption;if(['width','height','background'].includes(key))continue;label.hidden=tool==='select'||['fill','transparent'].includes(key)&&!['rectangle','ellipse'].includes(tool)||['size','text'].includes(key)&&tool!=='text'||key==='weight'&&tool==='text';}host.querySelector('[data-sketch-action=add]').disabled=tool==='select';}
 host.querySelector('[data-sketch-no-fill]').closest('label').dataset.sketchOption='transparent';host.querySelector('[data-sketch-text]').closest('label').dataset.sketchOption='text';
 function canvas(){const box=host.ownerDocument.createElement('div');box.innerHTML=renderSketch(a,{editing:true,selected});svg.innerHTML=box.firstElementChild.innerHTML;svg.setAttribute('viewBox',box.firstElementChild.getAttribute('viewBox'));svg.setAttribute('width',a.width*(Number(zoom)||1));svg.setAttribute('height',a.height*(Number(zoom)||1));host.querySelector('.sketch-canvas-host').classList.toggle('sketch-natural-size',zoom!=='fit');}
 function paint(){
  canvas();const i=item(),list=host.querySelector('[data-sketch-selection]');list.innerHTML=`<option value="">${t(a.items.length?'choose':'empty')}</option>`+a.items.map((v,n)=>`<option value="${v.id}"${selected===v.id?' selected':''}>${n+1}. ${t(v.kind)}${v.kind==='text'?' — '+esc(v.text.slice(0,70)):''}</option>`).join('');
  host.querySelector('[data-sketch-selected]').innerHTML=i?`<fieldset><legend>${t('selected')}: ${t(i.kind)}</legend><div class="sketch-properties">${i.kind==='stroke'?'':['x','y',...(i.kind==='text'?[]:['x2','y2'])].map(key=>`<label>${t(key)}<input data-sketch-item-prop="${key}" type="number" min="0" max="${key.startsWith('x')?a.width:a.height}" step="any" value="${i[key]}"></label>`).join('')}<label>${t('colour')}<input data-sketch-item-prop="colour" type="color" value="${i.colour}"></label>${i.kind==='text'?`<label>${t('textValue')}<textarea data-sketch-item-prop="text" maxlength="1000">${esc(i.text)}</textarea></label><label>${t('size')}<input data-sketch-item-prop="size" type="number" min="8" max="96" value="${i.size}"></label>`:`<label>${t('weight')}<input data-sketch-item-prop="weight" type="number" min=".5" max="24" step=".5" value="${i.weight}"></label>`}${['rectangle','ellipse'].includes(i.kind)?`<label>${t('fill')}<input data-sketch-item-prop="fill" type="color" value="${i.fill==='none'?'#ffffff':i.fill}"></label><label class="sketch-check"><input data-sketch-item-prop="transparent" type="checkbox"${i.fill==='none'?' checked':''}>${t('transparent')}</label>`:''}</div></fieldset>`:'';
  for(const k of ['width','height','background'])host.querySelector('[data-sketch-prop="'+k+'"]').value=a[k];
  for(const k of ['undo','redo','delete','down','up'])host.querySelector('[data-sketch-action="'+k+'"]').disabled=k==='undo'?!undo.length:k==='redo'?!redo.length:!i||k==='down'&&a.items[0]===i||k==='up'&&a.items.at(-1)===i;
 }
 function finish(cancel=false){if(!gesture)return;const g=gesture;gesture=null;if(svg.hasPointerCapture(g.pointerId))svg.releasePointerCapture(g.pointerId);if(cancel||g.invalid||!valid()){Object.assign(a,g.before);if(!cancel)status('limit');}else if(JSON.stringify(g.before)!==JSON.stringify(copy())){remember(g.before);status('changed');}paint();}
 const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const v=p.matrixTransform(svg.getScreenCTM().inverse());return [Math.round(Math.max(0,Math.min(a.width,v.x))*1000)/1000,Math.round(Math.max(0,Math.min(a.height,v.y))*1000)/1000];};
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0||gesture)return;e.preventDefault();svg.focus({preventScroll:true});const start=point(e),before=copy();
  if(tool==='select'){selected=e.target.closest('[data-sketch-item]')?.dataset.sketchItem??null;if(!selected){paint();return;}}
  else{if(a.items.length>=SKETCH_LIMITS.items){status('limit');return;}if(tool==='text'&&!text.trim()){status('invalid');return;}const i=fresh(tool,...start);if(!['text','stroke'].includes(tool)){i.x2=i.x;i.y2=i.y;}a.items.push(i);selected=i.id;}
  gesture={pointerId:e.pointerId,start,before,original:structuredClone(item()),invalid:false};svg.setPointerCapture(e.pointerId);canvas();
 },events);
 svg.addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointerId!==e.pointerId)return;const p=point(e),i=item();
  if(tool==='select')a.items[a.items.indexOf(i)]=moveSketchItem(gesture.original,p[0]-gesture.start[0],p[1]-gesture.start[1],a);
  else if(i.kind==='stroke'){if(i.points.length>=SKETCH_LIMITS.strokePoints){gesture.invalid=true;return;}const last=i.points.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])>=.5)i.points.push(p);}
  else if(i.kind!=='text'){i.x2=p[0];i.y2=p[1];}canvas();
 },events);
 svg.addEventListener('pointerup',e=>{if(gesture?.pointerId===e.pointerId)finish();},events);svg.addEventListener('pointercancel',()=>finish(true),events);svg.addEventListener('lostpointercapture',()=>finish(true),events);
 host.addEventListener('change',e=>{
  const el=e.target;if(el.hasAttribute('data-sketch-tool')){tool=el.value;tools();return;}
  if(el.hasAttribute('data-sketch-zoom')){zoom=el.value;canvas();return;}
  if(el.hasAttribute('data-sketch-selection')){selected=el.value||null;paint();return;}
  if(el.hasAttribute('data-sketch-no-fill')){fill=el.checked?'none':host.querySelector('[data-sketch-prop=fill]').value;return;}
  if(el.hasAttribute('data-sketch-text')){text=el.value;return;}
  const key=el.dataset.sketchProp,prop=el.dataset.sketchItemProp;
  if(key){if(!el.checkValidity())return;if(['width','height','background'].includes(key)){change(()=>{a[key]=key==='background'?el.value:Number(el.value);});return;}if(key==='colour')colour=el.value;if(key==='weight')weight=Number(el.value);if(key==='size')size=Number(el.value);if(key==='fill'){fill=el.value;host.querySelector('[data-sketch-no-fill]').checked=false;}return;}
  if(prop&&item()){if(!el.checkValidity())return;const id=selected;change(()=>{const i=item();if(prop==='transparent')i.fill=el.checked?'none':'#ffffff';else i[prop]=['colour','fill','text'].includes(prop)?el.value:Number(el.value);},'invalid');host.querySelector('[data-sketch-item-prop="'+prop+'"]')?.focus({preventScroll:true});selected=id;}
 },events);
 async function download(kind){
  const value=renderSketch(a);let blob=new Blob([value],{type:'image/svg+xml'}),url;
  try{if(kind==='png'){url=URL.createObjectURL(blob);const image=new Image();image.src=url;await image.decode();const canvas=host.ownerDocument.createElement('canvas');canvas.width=a.width;canvas.height=a.height;canvas.getContext('2d').drawImage(image,0,0);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error();URL.revokeObjectURL(url);url=null;}if(controller.signal.aborted)return;url=URL.createObjectURL(blob);const link=host.ownerDocument.createElement('a');link.href=url;link.download='observanda-sketch.'+kind;link.click();const released=url;url=null;setTimeout(()=>URL.revokeObjectURL(released),1000);}catch{if(!controller.signal.aborted)status('exportError');}finally{if(url)URL.revokeObjectURL(url);}
 }
 function action(key){
  finish(true);
  if(key==='svg'||key==='png'){void download(key);return;}
  if(key==='undo'||key==='redo'){const source=key==='undo'?undo:redo,target=key==='undo'?redo:undo;if(source.length){target.push(copy());Object.assign(a,source.pop());if(!item())selected=null;status('changed');paint();}return;}
  if(key==='add'){if(tool==='select'||tool==='text'&&!text.trim()){status('invalid');return;}change(()=>{const i=fresh(tool);a.items.push(i);selected=i.id;});return;}
  const i=item();if(!i)return;
  if(key==='delete'){change(()=>{a.items=a.items.filter(v=>v!==i);selected=null;});return;}
  if(key==='up'||key==='down'){const from=a.items.indexOf(i),to=from+(key==='up'?1:-1);if(to>=0&&to<a.items.length)change(()=>{[a.items[from],a.items[to]]=[a.items[to],a.items[from]];});}
 }
 host.addEventListener('click',e=>{const key=e.target.closest('[data-sketch-action]')?.dataset.sketchAction;if(key)action(key);},events);
 svg.addEventListener('keydown',e=>{
  if(e.key==='Escape'){finish(true);return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();action(e.shiftKey?'redo':'undo');return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();action('delete');return;}
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(delta&&item()){e.preventDefault();const amount=e.shiftKey?10:1;change(()=>{const i=item();a.items[a.items.indexOf(i)]=moveSketchItem(i,delta[0]*amount,delta[1]*amount,a);});}
 },events);
 tools();paint();return {ready(){finish();return [...host.querySelectorAll('input,select,textarea')].every(el=>el.reportValidity());},destroy(){finish(true);controller.abort();}};
}
