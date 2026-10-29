import {t} from './i18n/index.js';
import {FONT_OPTIONS,BUNDLED_FONTS,fontStack,fontInfo,fontAxes,validFont,customFontId} from './font-catalogue.js';
const message=(key,parameters)=>t('fonts',key,parameters);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=key=>esc(message(key));
export const fontDisplayName=(id,label)=>id==='modern'&&label==='System sans serif'?message('systemSans'):id==='editorial'&&label==='System serif'?message('systemSerif'):label;
export const fontAxisName=(id,tag,axis)=>BUNDLED_FONTS.some(font=>font.id===id)&&['wght','opsz'].includes(tag)?message(tag==='wght'?'axisWeight':'axisOpticalSize'):axis.name;
let serial=0;
export function checkFontInputs(){const invalid=[...document.querySelectorAll('[data-font-axis]')].find(el=>!el.checkValidity());if(invalid){invalid.closest('details').open=true;invalid.reportValidity();throw new Error(message('rangeError'));}}
export function fontSelect(attributes,value,{first=[],fonts=FONT_OPTIONS}={}){
 const choices=[...first,...fonts];if(value&&validFont(value)&&!choices.some(([id])=>id===value))choices.push([value,fontInfo(value)?.label??message('savedCustom')]);
 return `<font-picker><select ${attributes}>${choices.map(([id,label])=>`<option value="${esc(id)}" ${id===value?'selected':''} ${id==='mixed'?'disabled':''}>${esc(fontDisplayName(id,label))}</option>`).join('')}</select></font-picker>`;
}
export function axisControls(id,values={},attributes=''){
 const axes=Object.entries(fontAxes(id));if(!axes.length)return '';
 return `<details class="font-axis-controls"><summary>${text('variableSettings')}</summary>${axes.map(([tag,a])=>`<label>${esc(fontAxisName(id,tag,a))} <small>${a.min}–${a.max}</small><input type="number" ${attributes} data-font-axis="${tag}" min="${a.min}" max="${a.max}" step="any" placeholder="${text('auto')}" value="${values[tag]??''}"></label>`).join('')}<p class="muted">${text('autoHelp')}</p></details>`;
}
export function installFontPickers(){
 if(customElements.get('font-picker'))return;
 customElements.define('font-picker',class extends HTMLElement{
  connectedCallback(){queueMicrotask(()=>{if(!this.isConnected||this.button)return;this.select=this.querySelector('select');if(!this.select)return;
   const s=this.select,id='font-menu-'+(++serial);this.button=document.createElement('button');this.button.type='button';this.button.className='font-picker-button';this.button.setAttribute('role','combobox');this.button.setAttribute('aria-haspopup','listbox');this.button.setAttribute('aria-controls',id);this.button.setAttribute('aria-expanded','false');
   const label=s.getAttribute('aria-label')??s.labels?.[0]?.textContent.trim()??message('font');this.button.setAttribute('aria-label',label);s.hidden=true;s.setAttribute('aria-hidden','true');s.tabIndex=-1;this.append(this.button);
   this.list=document.createElement('div');this.list.id=id;this.list.className='font-picker-list';this.list.setAttribute('role','listbox');this.list.setAttribute('aria-label',label);this.list.setAttribute('popover','manual');this.append(this.list);
   this.events=new AbortController();const opts={signal:this.events.signal};this.button.addEventListener('click',()=>this.open?this.close():this.show(),opts);this.button.addEventListener('keydown',e=>this.key(e),opts);
   this.list.addEventListener('pointerdown',e=>e.preventDefault(),opts);this.list.addEventListener('click',e=>{const option=e.target.closest('[role=option]');if(option)this.choose(Number(option.dataset.index));},opts);
   s.addEventListener('change',()=>this.update(),opts);s.addEventListener('fontselectionchange',()=>this.update(),opts);
   document.addEventListener('pointerdown',e=>{if(!this.contains(e.target))this.close();},opts);this.button.addEventListener('blur',()=>this.close(),opts);window.addEventListener('resize',()=>this.close(),opts);this.update();
  });}
  disconnectedCallback(){this.close();this.events?.abort();}
  update(){if(!this.button)return;const option=this.select.selectedOptions[0];this.button.textContent=(option?.textContent??message('choose'))+' ▾';this.button.style.fontFamily=fontStack(this.select.value)??'inherit';this.button.disabled=this.select.disabled;}
  show(){this.options=[...this.select.options].filter(o=>!o.disabled);this.list.replaceChildren();for(const [i,o] of this.options.entries()){const el=document.createElement('div');el.setAttribute('role','option');el.id=this.list.id+'-'+i;el.dataset.index=i;const sample=document.createElement('span');sample.textContent=o.textContent;sample.style.fontFamily=fontStack(o.value)??'inherit';el.append(sample);const info=fontInfo(o.value);if(info){const kind=document.createElement('small');kind.textContent=(customFontId(o.value)?message('custom'):'')+(Object.keys(info.faces[0].axes).length?message('variable'):message('static'));el.append(kind);}this.list.append(el);}
   this.list.showPopover();this.open=true;this.button.setAttribute('aria-expanded','true');const rect=this.button.getBoundingClientRect(),height=Math.min(360,Math.max(innerHeight-32,100)),below=innerHeight-rect.bottom-12,above=rect.top-12;this.list.style.width=Math.min(Math.max(rect.width,260),innerWidth-24)+'px';const down=below>=Math.min(height,180);this.list.style.maxHeight=Math.max(60,Math.min(height,down?below:above))+'px';this.list.style.left=Math.max(12,Math.min(rect.left,innerWidth-this.list.offsetWidth-12))+'px';this.list.style.top=(down?rect.bottom+4:Math.max(12,rect.top-this.list.offsetHeight-4))+'px';this.activate(Math.max(0,this.options.findIndex(o=>o.value===this.select.value)));
  }
  close(){if(!this.open)return;this.open=false;if(this.list.isConnected&&this.list.matches(':popover-open'))this.list.hidePopover();this.button.setAttribute('aria-expanded','false');this.button.removeAttribute('aria-activedescendant');}
  activate(i){this.active=(i+this.options.length)%this.options.length;for(const [index,el] of [...this.list.children].entries())el.setAttribute('aria-selected',String(index===this.active));const el=this.list.children[this.active];if(el){this.button.setAttribute('aria-activedescendant',el.id);if(el.offsetTop<this.list.scrollTop)this.list.scrollTop=el.offsetTop;else if(el.offsetTop+el.offsetHeight>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=el.offsetTop+el.offsetHeight-this.list.clientHeight;}}
  choose(i){const option=this.options[i];if(!option)return;this.select.value=option.value;this.close();this.update();this.select.dispatchEvent(new Event('input',{bubbles:true}));this.select.dispatchEvent(new Event('change',{bubbles:true}));}
  key(e){if(e.key==='Escape'){if(this.open){e.preventDefault();e.stopPropagation();this.close();}return;}if(e.key==='Tab'){this.close();return;}if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key)){e.preventDefault();if(!this.open){this.show();return;}if(e.key==='Enter'||e.key===' ')this.choose(this.active);else this.activate(e.key==='Home'?0:e.key==='End'?this.options.length-1:this.active+(e.key==='ArrowUp'?-1:1));return;}if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();if(!this.open)this.show();this.search=Date.now()-(this.searchedAt??0)>700?e.key:(this.search??'')+e.key;this.searchedAt=Date.now();const index=this.options.findIndex(o=>o.textContent.toLocaleLowerCase().startsWith(this.search.toLocaleLowerCase()));if(index>=0)this.activate(index);}}
 });
}
