import {tokenGroups,tokenStates,tokenValue,tokenID} from './website-token-model.js';
import {confirmAction} from './confirm-action.js';
import {styleField,styleOptions} from './website-style-controls.js';
import {inspectWebsiteStyle} from './website-style-inspection.js';

// This dialog edits the current site's saved style library. Every read and
// write carries the revision acknowledged by the ordinary website editor.
export async function editWebsiteStyles({t,opened,selection,target,instance,blockPath,signal,read,write,assignText,current,trigger}){
 const dialog=document.createElement('dialog');dialog.className='website-author-dialog website-token-dialog';dialog.dataset.styleLibrary='';
 const element=(parent,type,text)=>{const node=document.createElement(type);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
 const button=(parent,key,run)=>{const b=element(parent,'button',t(key));b.type='button';b.className='button';b.onclick=()=>void task(run);return b;};
 const field=(parent,key,tag)=>{const label=element(parent,'label');element(label,'span',t(key));const control=element(label,tag);control.setAttribute('aria-label',t(key));return control;};
 const heading=element(dialog,'header'),title=element(heading,'h2',t('styleLibrary'));title.id='style-library-title';dialog.setAttribute('aria-labelledby',title.id);
 const close=button(heading,'finderClose',()=>dismiss());
 const layout=element(dialog,'div');layout.className='website-token-columns';
 const browser=element(layout,'section'),query=field(browser,'tokenFind','input');query.type='search';query.maxLength=160;
 const results=element(browser,'div');results.className='website-token-results';results.setAttribute('role','group');results.setAttribute('aria-label',t('styleLibrary'));
 const pages=element(browser,'div');pages.className='website-token-actions';
 const previous=button(pages,'pageBack',()=>load(Math.max(offset-40,0))),next=button(pages,'pageForward',()=>load(catalog.next));
 const create=button(browser,'tokenNew',()=>choose(null));create.dataset.styleNew='';
 const editor=element(layout,'form');editor.noValidate=true;
 const name=field(editor,'tokenName','input');name.maxLength=160;name.required=true;name.dataset.styleName='';
 const settings=element(editor,'div');settings.className='website-token-actions';
 const group=field(settings,'tokenCategory','select'),state=field(settings,'tokenState','select');
 styleOptions(group,Object.keys(tokenGroups).map(k=>[k,t('tokenGroup_'+k)]));
 styleOptions(state,tokenStates.map(k=>[k,t('tokenState_'+k)]));
 const properties=element(editor,'div');properties.className='website-token-fields';
 const commands=element(editor,'div');commands.className='website-token-actions';
 const save=button(commands,'tokenSave',()=>saveDefinition());save.classList.add('button-primary');save.dataset.styleSave='';
 const remove=button(commands,'remove',async()=>{
  if(!selected||!await confirmAction(t('tokenRemoveConfirm',{name:selected.name,count:selected.pages}),{action:'remove'}))return;
  await write({action:'remove',tokenId:selected.id});await load(0);select(null);
 });
 const usage=element(editor,'p');usage.setAttribute('aria-live','polite');
 const assigner=element(editor,'fieldset');element(assigner,'legend',t('tokenPlacement'));
 const scope=field(assigner,'sectionScope','select'),currentUse=element(assigner,'p'),apply=button(assigner,'tokenApply',()=>applyAssignment(true)),clear=button(assigner,'tokenInherit',()=>applyAssignment(false));
 const inspector=element(editor,'details');element(inspector,'summary',t('tokenEffective'));
 const property=field(inspector,'tokenProperty','select'),winner=element(inspector,'output');winner.setAttribute('aria-live','polite');
 styleOptions(property,Object.values(tokenGroups).flat().map(k=>[k,t('tokenProp_'+k)]));property.value='font-family';
 const fontBox=element(dialog,'details');element(fontBox,'summary',t('tokenFonts'));
 const fontForm=element(fontBox,'fieldset'),existingFont=field(fontForm,'sectionFont','select');
 const input=field(fontForm,'tokenFontFile','input');input.type='file';input.accept='.woff2,.woff,.ttf,.otf';
 const rights=field(fontForm,'tokenRights','select');
 styleOptions(rights,['open-license','organization','permission'].map(k=>[k,t('tokenRights_'+k)]));
 const notice=field(fontForm,'tokenNotice','textarea');notice.maxLength=16384;
 const allow=field(fontForm,'tokenRedistribute','input');allow.type='checkbox';
 const fontSave=button(fontForm,'tokenSaveFont',saveFont);
 const status=element(dialog,'p');status.setAttribute('role','status');
 let catalog,selected,offset=0,edited=false,locked=false,epoch=0,timer=0,rules={},textOwner=selection,activeGroup='typography';
 let observed=null,names={},watchedDocument=null;
 const fresh=()=>dialog.open&&current()&&!signal.aborted;
 async function dismiss(){if(!locked&&(!edited||await confirmAction(t('discardConfirm'),{action:'discard'})))dialog.close();}
 async function task(callback){
  if(locked||!fresh())return;
  locked=true;close.disabled=true;dialog.setAttribute('aria-busy','true');editor.inert=browser.inert=fontForm.inert=true;
  try{await callback();}catch(error){if(fresh())status.textContent=error.message||t('failed');}
  finally{locked=false;close.disabled=false;dialog.removeAttribute('aria-busy');editor.inert=browser.inert=fontForm.inert=false;}
 }
 // Closing is still available when a read returns an error.
 close.onclick=dismiss;dialog.oncancel=e=>{e.preventDefault();dismiss();};
 const abort=()=>dialog.close();
 signal.addEventListener('abort',abort,{once:true});
 dialog.addEventListener('close',()=>{clearTimeout(timer);++epoch;watch(null);signal.removeEventListener('abort',abort);dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
 function update(){
  save.disabled=!edited||!name.value.trim();
  remove.disabled=!selected;
  const groupIds=ids=>(ids??[]).filter(id=>names[id]?.group===group.value);
  const assigned=groupIds(scope.value==='text'?textOwner?.ids:catalog?.scopes[scope.value]);
  const direct=groupIds(scope.value==='text'?textOwner?.ids:catalog?.direct[scope.value]);
  currentUse.textContent=t('tokenCurrent',{name:assigned.map(id=>names[id].name).join(', ')||t('sectionInherit')});
  apply.disabled=!selected||edited||direct.includes(selected.id)&&scope.value!=='text';
  clear.disabled=!selected||edited||!direct.length;
 }
 function renderFields(){
  const mode=state.value,category=group.value;
  properties.replaceChildren(...tokenGroups[category].map(key=>styleField(key,rules[mode]?.[key],catalog?.fonts??[],t,value=>{
   if(value)(rules[mode]??={})[key]=value;
   else if(rules[mode]){delete rules[mode][key];if(!Object.keys(rules[mode]).length)delete rules[mode];}
   edited=true;update();
  })));
 }
 function select(item){
  selected=item??null;edited=false;name.value=item?.name??'';group.value=item?.group??'typography';activeGroup=group.value;group.disabled=Boolean(item);
  rules=structuredClone(item?.rules??{});state.value='normal';usage.textContent=item?t('tokenUsage',{count:item.pages}):'';
  for(const b of results.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.styleId===item?.id));
  renderFields();renderScopes();update();
 }
 async function choose(item){if(edited&&!await confirmAction(t('discardConfirm'),{action:'discard'}))return;select(item);name.focus();}
 function renderScopes(){
  const prior=scope.value,opts=[['site',t('site')]];
  const folder=opened.path.split('/').slice(0,-1).join('/');
  if(folder)opts.push(['folder',t('themeFolder',{folder:folder+'/'})]);
  opts.push(['page',t('page')]);
  if(catalog?.component?.editable)opts.push(['component',t('tokenComponent',{name:catalog.component.name})]);
  if(catalog?.scopes.element)opts.push(['element',t('section')]);
  if(textOwner&&['color','typography'].includes(group.value))opts.push(['text',t('tokenText',{text:textOwner.label})]);
  styleOptions(scope,opts);scope.value=opts.some(([v])=>v===prior)?prior:opts.at(-1)[0];update();
 }
 async function load(at){
  const serial=++epoch,lookups=[...new Set([observed?.token,...(textOwner?.ids??[])].filter(tokenID))],requested=query.value;
  const response=await read({query:requested,offset:at,blockPath,instance,lookups:lookups.slice(0,32)});
  if(!fresh()||serial!==epoch)return;
  names={...response.names};
  for(let i=32;i<lookups.length;i+=32){
   const extra=await read({lookups:lookups.slice(i,i+32),query:requested,offset:at});if(!fresh()||serial!==epoch)return;Object.assign(names,extra.names);
  }
  offset=at;catalog=response;
  const rows=response.items.map(item=>{const b=document.createElement('button');b.type='button';b.dataset.styleId=item.id;b.setAttribute('aria-pressed',String(item.id===selected?.id));b.onclick=()=>choose(item);
   element(b,'strong',item.name);element(b,'small',t('tokenGroup_'+item.group));return b;});
  results.replaceChildren(...rows);if(!rows.length)element(results,'p',t('tokenEmpty'));
  previous.disabled=at===0;next.disabled=response.next===null;pages.hidden=previous.disabled&&next.disabled;
  const font=existingFont.value;styleOptions(existingFont,[['',t('tokenImportFont')],...response.fonts.map(f=>[f.id,f.label])]);
  existingFont.value=response.fonts.some(f=>f.id===font)?font:'';
  renderScopes();if(inspector.open)await inspect();else drawWinner();
 }
 function drawWinner(){
  if(!observed){winner.textContent=t('tokenSelectElement');return;}
  let source=t('tokenSource_'+observed.kind);
  if(observed.token)source=(names[observed.token]?.name??t('styleLibrary'))+' · '+t('tokenScope_'+observed.scope);
  else if(observed.selector)source+=' · '+observed.selector;
  winner.textContent=observed.value+' · '+source+(observed.pendingSheets?' · '+t('tokenIncompleteSheets'):'');
 }
 function sheetLoaded(event){
  if(!inspector.open||!fresh()||!event.target?.matches?.('link[rel~="stylesheet"]'))return;
  void inspect().catch(error=>{if(fresh())status.textContent=error.message||t('failed');});
 }
 function watch(doc){
  if(doc===watchedDocument)return;
  watchedDocument?.removeEventListener('load',sheetLoaded,true);watchedDocument?.removeEventListener('error',sheetLoaded,true);
  watchedDocument=doc;doc?.addEventListener('load',sheetLoaded,true);doc?.addEventListener('error',sheetLoaded,true);
 }
 async function inspect(){
  const node=target();watch(node?.ownerDocument);observed=inspectWebsiteStyle(node,property.value);
  if(observed)observed.pendingSheets=[...node.ownerDocument.querySelectorAll('link[rel~="stylesheet"][href]')].some(link=>!link.disabled&&!link.sheet);
  if(observed?.token&&!names[observed.token]){const r=await read({lookups:[observed.token]});if(!fresh())return;Object.assign(names,r.names);}
  drawWinner();
 }
 async function applyAssignment(assign){
  if(!selected||edited)return;
  const tokenId=assign?selected.id:null;
  if(scope.value==='text'){
   const ids=new Set(Object.keys(names).filter(id=>names[id].group===selected.group));
   if(!await assignText(textOwner,assign?selected.classId:null,selected.group,ids))throw Error(t('tokenSelectText'));
   dialog.close();return;
  }
  await write({action:'assign',scope:scope.value,tokenId,group:selected.group,blockPath,component:catalog.component?.id});
  await load(offset);select(catalog.items.find(t=>t.id===selected.id));status.textContent=t('tokenApplied');
 }
 async function saveDefinition(){
  const entered=name.value.trim(),valid=entered&&Object.keys(rules).length&&Object.values(rules).every(s=>Object.entries(s).every(([k,v])=>tokenValue(k,v)));
  if(!valid){status.textContent=t('tokenInvalid');return;}
  const result=await write({action:selected?'update':'create',...(selected?{tokenId:selected.id}:{}),name:entered,group:group.value,rules});
  if(!fresh())return;query.value=entered;await load(0);select(catalog.items.find(i=>i.id===result.modifiedStyleId));status.textContent=t('tokenSaved');
 }
 async function displayFont(){
  const font=catalog?.fonts.find(f=>f.id===existingFont.value);input.disabled=Boolean(font);input.value='';notice.value='';rights.value=font?.rights??'open-license';allow.checked=font?.embed??false;
  if(font){const result=await read({fontId:font.id});if(fresh()&&existingFont.value===font.id)notice.value=result.notice;}
 }
 async function saveFont(){
  const font=catalog.fonts.find(f=>f.id===existingFont.value);
  let change={action:'font-rights',fontId:font?.id,rights:rights.value,embed:allow.checked,notice:notice.value.trim()};
  if(!font){
   const file=input.files[0];if(!file||file.size>8*1024*1024)throw Error(t('tokenChooseFont'));
   const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(reader.result.slice(reader.result.indexOf(',')+1));reader.readAsDataURL(file);});
   change={...change,action:'import-font',encoded};
  }
  await write(change);await load(offset);await displayFont();renderFields();status.textContent=t('tokenSaved');
 }
 query.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>void task(()=>load(0)),180);};
 name.oninput=()=>{edited=true;update();};state.onchange=renderFields;
 group.onchange=async()=>{if(Object.keys(rules).length&&!await confirmAction(t('discardConfirm'),{action:'discard'})){group.value=activeGroup;return;}activeGroup=group.value;rules={};edited=true;renderFields();renderScopes();update();};
 property.onchange=()=>void task(inspect);inspector.ontoggle=()=>{if(inspector.open)void task(inspect);};
 scope.onchange=update;existingFont.onchange=()=>void task(displayFont);editor.onsubmit=event=>{event.preventDefault();void task(saveDefinition);};
 document.body.append(dialog);dialog.showModal();
 await task(async()=>{await load(0);if(fresh()){select(catalog.items[0]);await displayFont();query.focus();}});
}
