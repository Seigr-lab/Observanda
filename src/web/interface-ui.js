import {t} from './i18n/index.js';
import {orderNavigationNodes} from './navigation-dom.js';
import {ux} from './experience-ui.js';
const message=(key,parameters)=>t('interface',key,parameters);
const NAVIGATION_GROUPS = ['research','projects','website','workspace'];
export const DEFAULT_INTERFACE = Object.freeze({appTheme:'research',pinnedTools:[],fontSize:17,lineHeight:1.6,navigationPosition:'left',navigationWidth:272,navigationCollapsed:false,headerAlignment:'center',headerOrder:'logo-first',navigationOrder:['research','projects','website','workspace']});
export const normalizeInterface = value => ({...structuredClone(DEFAULT_INTERFACE),...structuredClone(value)});
export function validInterface(value) {
  if(!value || typeof value !== 'object' || Array.isArray(value))return false;
  const keys=Object.keys(value),legacy=keys.length===2&&keys.every(key=>['fontSize','lineHeight'].includes(key));
  const required=Object.keys(DEFAULT_INTERFACE).filter(key=>!['appTheme','pinnedTools','headerAlignment','headerOrder'].includes(key));
  const shape=legacy||(required.every(key=>keys.includes(key))&&keys.every(key=>Object.hasOwn(DEFAULT_INTERFACE,key)));
  const v=normalizeInterface(value);
  return shape && Array.isArray(v.pinnedTools)&&v.pinnedTools.length<=80&&new Set(v.pinnedTools).size===v.pinnedTools.length&&v.pinnedTools.every(id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))&&['research','studio'].includes(v.appTheme)&&['left','center','right'].includes(v.headerAlignment)&&['logo-first','title-first'].includes(v.headerOrder)&&Number.isInteger(v.fontSize) && v.fontSize>=16 && v.fontSize<=24 &&
    Number.isFinite(v.lineHeight)&&v.lineHeight>=1.4&&v.lineHeight<=2&&
    ['left','right','top'].includes(v.navigationPosition)&&Number.isInteger(v.navigationWidth)&&v.navigationWidth>=220&&v.navigationWidth<=640&&
    typeof v.navigationCollapsed==='boolean'&&Array.isArray(v.navigationOrder)&&v.navigationOrder.length>0&&new Set(v.navigationOrder).size===v.navigationOrder.length&&v.navigationOrder.every(id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id));
}
export function interfaceUI({api,field,showDialog,notify,onChange}) {
  let settings=normalizeInterface(DEFAULT_INTERFACE),saved=normalizeInterface(DEFAULT_INTERFACE),version=0,pending=null,widthQueue=Promise.resolve();
  const isDirty=()=>JSON.stringify(settings)!==JSON.stringify(saved);
  function apply() {
    document.documentElement.style.setProperty('--app-font-size', settings.fontSize + 'px');
    document.documentElement.style.setProperty('--app-line-height', settings.lineHeight);
    document.documentElement.dataset.largeText = String(settings.fontSize >= 21);
    applyLayout();
    for (const control of document.querySelectorAll('[data-interface]')) {
      if(control.type==='checkbox')control.checked=settings[control.dataset.interface];else control.value=settings[control.dataset.interface];
      const output=control.closest('.field')?.querySelector('output');if(output)output.textContent=control.value+(['fontSize','navigationWidth'].includes(control.dataset.interface)?' px':'');
    }
  }
  function navigationOrder(){
    const order=[...settings.navigationOrder];
    for(const node of document.querySelectorAll('#workspace-navigation [data-nav-section]')){
      const id=node.dataset.navSection;if(!order.includes(id)){const index=order.indexOf('workspace');order.splice(index<0?order.length:index,0,id);}
    }
    return order;
  }
  const escapeLabel=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function applyLayout(){
    const root=document.documentElement;root.dataset.headerAlignment=settings.headerAlignment;root.dataset.headerOrder=settings.headerOrder;root.dataset.navigation=settings.navigationPosition;root.dataset.navigationCollapsed=String(settings.navigationCollapsed);
    root.style.setProperty('--app-navigation-width',settings.navigationWidth+'px');
    const identity=document.querySelector('.workspace-identity'),title=identity?.querySelector('.workspace-name');
    if(title){const logos=[...identity.children].filter(node=>node!==title);orderNavigationNodes(identity,settings.headerOrder==='title-first'?[title,...logos]:[...logos,title]);}
    document.dispatchEvent(new Event('observanda:interface-layout'));
    bindResizer();
    const nav=document.querySelector('#workspace-navigation');
    if(nav){
      const children=[...nav.children],order=navigationOrder();
      orderNavigationNodes(nav,children.filter(node=>!node.dataset.navSection).concat(order.flatMap(id=>children.filter(node=>node.dataset.navSection===id))));
    }
    for(const button of document.querySelectorAll('[data-action="interface-toggle-menu"]')){button.textContent=settings.navigationCollapsed?message('showMenu'):message('hideMenu');button.setAttribute('aria-expanded',String(!settings.navigationCollapsed));}
  }
  function bindResizer(){
    const handle=document.querySelector('.navigation-resizer');if(!handle)return;
    handle.setAttribute('aria-valuemin','220');handle.setAttribute('aria-valuemax','640');handle.setAttribute('aria-valuenow',settings.navigationWidth);handle.setAttribute('aria-valuetext',message('pixels',{width:settings.navigationWidth}));
    if(handle.dataset.bound)return;handle.dataset.bound='true';
    const resize=value=>{settings.navigationWidth=Math.round(Math.max(220,Math.min(640,value,window.innerWidth-380)));version++;apply();onChange();};
    const persist=()=>{
      // A direct resize saves only width, never other pending appearance settings.
      const width=settings.navigationWidth;
      widthQueue=widthQueue.then(async()=>{try{if(pending)await pending;const value={...structuredClone(saved),navigationWidth:width};pending=api('/api/interface',value);await pending;saved.navigationWidth=width;displayStatus(status());onChange();}
      catch(error){notify(error.message??message('widthFailed'),true);}
      finally{pending=null;}});return widthQueue;
    };
    let start=null;
    handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;start={x:event.clientX,width:settings.navigationWidth,id:event.pointerId};handle.setPointerCapture(event.pointerId);document.documentElement.classList.add('resizing-navigation');event.preventDefault();});
    handle.addEventListener('pointermove',event=>{if(start)resize(start.width+(event.clientX-start.x)*(settings.navigationPosition==='right'?-1:1));});
    handle.addEventListener('pointerup',()=>{if(!start)return;start=null;document.documentElement.classList.remove('resizing-navigation');persist();});
    handle.addEventListener('pointercancel',()=>{if(start)resize(start.width);start=null;document.documentElement.classList.remove('resizing-navigation');});
    handle.addEventListener('keydown',event=>{const direction=settings.navigationPosition==='right'?-1:1;const value=event.key==='Home'?220:event.key==='End'?640:event.key==='ArrowRight'?settings.navigationWidth+16*direction:event.key==='ArrowLeft'?settings.navigationWidth-16*direction:null;if(value!==null){event.preventDefault();resize(value);persist();}});
  }
  const status=()=>isDirty()?message('unsaved'):message('saved');
  function changed(){version++;apply();displayStatus(status());onChange();}
  const text=(key,parameters)=>escapeLabel(message(key,parameters));
  function controls() {
    return `<p class="muted">${text('textHelp')}</p>` + field(escapeLabel(ux('appTheme')),`<select data-interface="appTheme">${['research','studio'].map(id=>`<option value="${id}" ${settings.appTheme===id?'selected':''}>${escapeLabel(t('appearance',id+'Name'))}</option>`).join('')}</select>`)+
      field(text('fontSize')+' <output>' + settings.fontSize + ' px</output>', `<input data-interface="fontSize" type="range" min="16" max="24" step="1" value="${settings.fontSize}">`) +
      field(text('lineHeight')+' <output>' + settings.lineHeight + '</output>', `<input data-interface="lineHeight" type="range" min="1.4" max="2" step="0.1" value="${settings.lineHeight}">`) +
      `<div class="interface-sample"><strong>${text('sampleTitle')}</strong><p>${text('sampleBody')}</p><label>${text('sampleField')}<input value="${text('sampleValue')}" readonly tabindex="-1"></label></div><p class="muted" data-interface-status role="status">${status()}</p><div class="inline-actions"><button class="button" type="button" data-action="interface-reset">${text('resetText')}</button><button class="button primary" type="button" data-action="interface-save">${text('save')}</button></div>`;
  }
  function headerControls(){
    const select=(key,label,choices)=>field(label,`<select data-interface="${key}">${choices.map(([id,text])=>`<option value="${id}" ${settings[key]===id?'selected':''}>${text}</option>`).join('')}</select>`);
    return `<p class="muted">${text('headerHelp')}</p><div class="form-grid">${select('headerAlignment',message('headerAlignment'),[['left',message('left')],['center',message('center')],['right',message('right')]])}${select('headerOrder',message('headerOrder'),[['logo-first',message('logoFirst')],['title-first',message('titleFirst')]])}</div>`;
  }
  function displayStatus(text) { for (const el of document.querySelectorAll('[data-interface-status]')) el.textContent=text; }
  async function save(){
    if(pending){await pending;return save();}if(!isDirty())return;
    const edit=version,value=structuredClone(settings);displayStatus(message('saving'));
    pending=api('/api/interface',value);
    try{await pending;saved=value;if(edit===version)settings=structuredClone(value);displayStatus(status());onChange();}finally{pending=null;}
  }
  async function discard(){if(pending)await pending;settings=structuredClone(saved);version++;apply();displayStatus(status());onChange();}
  function layoutControls(){return `<p>${text('layoutHelp')}</p>${field(message('navigationPosition'),`<select data-interface="navigationPosition">${[['left',message('left')],['right',message('right')],['top',message('top')]].map(([id,label])=>`<option value="${id}" ${settings.navigationPosition===id?'selected':''}>${label}</option>`).join('')}</select>`)}${field(text('navigationWidth')+' <output>'+settings.navigationWidth+' px</output>',`<input type="range" data-interface="navigationWidth" min="220" max="640" step="1" value="${settings.navigationWidth}">`)}<label class="checkbox"><input type="checkbox" data-interface="navigationCollapsed" ${settings.navigationCollapsed?'checked':''}><span>${text('collapsed')}</span></label><h3>${text('order')}</h3><div data-navigation-order>${orderControls()}</div><p class="muted" data-interface-status role="status">${status()}</p><div class="dialog-actions"><button class="button" data-action="interface-layout-reset">${text('resetLayout')}</button><button class="button" data-action="close-dialog">${text('done')}</button><button class="button primary" data-action="interface-save">${text('save')}</button></div>`;}
  const groupLabel=id=>NAVIGATION_GROUPS.includes(id)?message(id):document.querySelector('[data-nav-section="'+id+'"]')?.getAttribute('aria-label')??id;
  function orderControls(){const order=navigationOrder();return order.map((id,index)=>`<div class="menu-order-row"><span>${escapeLabel(groupLabel(id))}</span><button class="button" data-action="interface-order" data-id="${id}" data-direction="-1" aria-label="${text('earlier',{name:groupLabel(id)})}" ${index===0?'disabled':''}>${text('up')}</button><button class="button" data-action="interface-order" data-id="${id}" data-direction="1" aria-label="${text('later',{name:groupLabel(id)})}" ${index===order.length-1?'disabled':''}>${text('down')}</button></div>`).join('');}
  function input(el) { if(!el.dataset.interface)return false;settings[el.dataset.interface]=el.type==='checkbox'?el.checked:el.tagName==='SELECT'?el.value:Number(el.value);changed();return true; }
  async function action(button) {
    if(button.dataset.action==='interface-reset'){settings.fontSize=DEFAULT_INTERFACE.fontSize;settings.lineHeight=DEFAULT_INTERFACE.lineHeight;changed();return true;}
    if(button.dataset.action==='interface-layout'){showDialog(`<h2 id="dialog-title">${text('layout')}</h2>${layoutControls()}`);return true;}
    if(button.dataset.action==='interface-toggle-menu'){settings.navigationCollapsed=!settings.navigationCollapsed;changed();return true;}
    if(button.dataset.action==='interface-layout-reset'){for(const key of ['navigationPosition','navigationWidth','navigationCollapsed','navigationOrder'])settings[key]=structuredClone(DEFAULT_INTERFACE[key]);changed();document.querySelector('[data-navigation-order]').innerHTML=orderControls();return true;}
    if(button.dataset.action==='interface-order'){settings.navigationOrder=navigationOrder();const from=settings.navigationOrder.indexOf(button.dataset.id),to=from+Number(button.dataset.direction);if(from>=0&&to>=0&&to<settings.navigationOrder.length){[settings.navigationOrder[from],settings.navigationOrder[to]]=[settings.navigationOrder[to],settings.navigationOrder[from]];changed();document.querySelector('[data-navigation-order]').innerHTML=orderControls();document.querySelector(`[data-action="interface-order"][data-id="${button.dataset.id}"][data-direction="${button.dataset.direction}"]:not(:disabled)`)?.focus();}return true;}
    if(button.dataset.action==='interface-save'){await save();notify(message('savedNotice'));return true;}
    return false;
  }
  async function load() { const value=await api('/api/interface');if(validInterface(value))settings=normalizeInterface(value);saved=structuredClone(settings);apply(); }
  apply();
  async function togglePinnedTool(id){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))return;
    const operation=widthQueue.then(async()=>{if(pending)await pending;const pins=saved.pinnedTools.includes(id)?saved.pinnedTools.filter(value=>value!==id):[...saved.pinnedTools,id];const value={...structuredClone(saved),pinnedTools:pins};pending=api('/api/interface',value);try{await pending;saved.pinnedTools=pins;settings.pinnedTools=[...pins];onChange();}finally{pending=null;}});widthQueue=operation.catch(()=>{});return operation;
  }
  return {controls,headerControls,input,action,load,save,discard,isDirty,applyLayout,theme:()=>settings.appTheme,pinnedTools:()=>[...settings.pinnedTools],togglePinnedTool};
}
