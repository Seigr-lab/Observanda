import {BUNDLED_FONTS} from './font-catalogue.js';
import {resolveLanguage} from './i18n/runtime.js';

export function publicationTemplatesUI({post,esc,tr,button,root,draw,selected,openDocument}){
 let panel=null,items=[],cursor=null,active=null,draft=null,name='',selectedSlots=new Set(),request=null,original=null,attempted=false,edited=false,conflicted=false,components=[];
 const language=()=>resolveLanguage(document.documentElement.lang);
 const field=(label,value)=>'<label class="field">'+esc(tr(label))+value+'</label>';
 const find=selector=>root()?.querySelector('[data-pdf-templates] '+selector);
 const controls=(label,command,attrs='')=>button(label,'template-'+command,attrs);
 const rowButton=(label,cmd,id)=>controls(label,cmd,'data-id="'+esc(id)+'"');
 const hasUnsaved=()=>edited||attempted;
 function close(){panel=active=draft=original=request=null;items=[];cursor=null;attempted=edited=conflicted=false;components=[];}
 async function list(){
  close();const page=await post('template-list',{language:language()});
  items=page.items;cursor=page.next;panel='list';
 }
 function show(value){
  active=value;name=value.value.name;selectedSlots=new Set(value.value.sections.filter(row=>!row.optional).map(row=>row.id));
  panel='preview';draft=request=null;attempted=edited=conflicted=false;
 }
 function layoutDetails(value){
  const layout=value.layout,font=BUNDLED_FONTS.find(f=>f.id===layout.font)?.family??layout.font;
  return '<p>'+esc(font)+' · '+esc(layout.fontSizePt)+' pt · '+esc(layout.widthMm)+' × '+esc(layout.heightMm)+' mm · '+esc(tr('starterProfile_'+value.profile))+'</p>';
 }
 function view(){
  if(!panel)return '';
  let html='<section class="panel" data-pdf-templates><h2>'+esc(tr('starterLibrary'))+'</h2>';
  if(attempted){
   const cmd=panel==='custom'?'publish':panel==='upgrade'?'update':'create';
   return html+'<p>'+esc(tr('starterRetryHelp'))+'</p>'+controls('retry',cmd)+controls('starterCancel','list')+'</section>';
  }
  if(panel==='list'){
   if(components.length)html+='<p role="alert">'+esc(tr('starterIncompatible',{components:components.join(', ')}))+'</p>';
   html+='<ul>'+items.map(row=>'<li>'+rowButton('starterPreview','preview',row.id)+' <strong>'+esc(row.name)+'</strong> · '+esc(tr('starterSectionsCount',{count:row.sections}))+'</li>').join('')+'</ul>';
   if(cursor)html+=controls('more','more');
   return html+field('starterImport','<input type="file" accept=".json,application/json" data-template-file>')+controls('starterReviewImport','import')+controls('starterCancel','close')+'</section>';
  }
  if(panel==='custom'){
   html+=field('name','<input type="text" data-template-name maxlength="240" value="'+esc(draft.name)+'">');
   html+=field('language','<input type="text" data-template-style="language" maxlength="63" value="'+esc(draft.language)+'">');
   html+=field('starterFont','<select data-template-style="font">'+BUNDLED_FONTS.map(font=>'<option value="'+esc(font.id)+'"'+(draft.layout.font===font.id?' selected':'')+'>'+esc(font.family)+'</option>').join('')+'</select>');
   html+=field('starterProfile','<select data-template-style="profile">'+['standard','pdfa-2u','pdfua-1'].map(profile=>'<option value="'+profile+'"'+(draft.profile===profile?' selected':'')+'>'+esc(tr('starterProfile_'+profile))+'</option>').join('')+'</select>');
   for(const [key,label,min,max] of [['widthMm','width',40,1000],['heightMm','height',40,1000],['fontSizePt','fontSize',6,96],['lineHeight','lineHeight',1,3]]){
    html+=field(label,'<input type="number" step="any" min="'+min+'" max="'+max+'" data-template-layout="'+key+'" value="'+esc(draft.layout[key])+'">');
   }
   for(const key of ['contents','numberSections'])html+=field(key,'<input type="checkbox" data-template-structure="'+key+'"'+(draft.structure[key]?' checked':'')+'>');
   html+='<ol>'+draft.sections.map((row,i)=>'<li>'+field('section','<input type="text" data-template-slot-title="'+i+'" maxlength="240" value="'+esc(row.title)+'">')+field('starterGuidance','<textarea data-template-slot-guide="'+i+'" maxlength="800">'+esc(row.guidance)+'</textarea>')+field('level','<select data-template-slot-level="'+i+'">'+[1,2,3,4,5,6].map(n=>'<option'+(row.level===n?' selected':'')+'>'+n+'</option>').join('')+'</select>')+'<label><input type="checkbox" data-template-slot-optional="'+i+'"'+(row.optional?' checked':'')+'> '+esc(tr('starterOptionalSlot'))+'</label><div class="pdf-toolbar">'+controls('up','slot-up','data-slot="'+i+'"'+(i===0?' disabled':''))+controls('down','slot-down','data-slot="'+i+'"'+(i===draft.sections.length-1?' disabled':''))+controls('removeSection','slot-remove','data-slot="'+i+'"'+(draft.sections.length===1?' disabled':''))+'</div></li>').join('')+'</ol>';
   if(conflicted)html+='<p role="alert">'+esc(tr('starterCopyConflict'))+'</p>';
   return html+controls('newSection','slot-add')+(conflicted?controls('starterSaveAs','fork-draft'):controls('starterPublish','publish'))+controls('starterCancel','list')+'</section>';
  }
  const data=active.value;
  html+='<h3>'+esc(data.name)+'</h3>'+layoutDetails(data);
  if(panel==='upgrade'){
   if(active.revision===original.revision)return html+'<p role="status">'+esc(tr('starterCurrent'))+'</p>'+controls('starterCancel','close')+'</section>';
   html+='<p>'+esc(tr('starterUpdateHelp'))+'</p>'+field('starterUpdateLayout','<input type="checkbox" data-template-settings>')+field('starterUpdateTitles','<input type="checkbox" data-template-titles>');
   html+='<details><summary>'+esc(tr('starterChanges'))+'</summary><ul>'+differences(original.value,data).map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul></details>';
  }else html+=field('name','<input type="text" data-template-name value="'+esc(name)+'" maxlength="240">');
  const placed=panel==='upgrade'?new Set(selected().starter.sections.map(s=>s.slot)):new Set();
  html+='<ol>'+data.sections.map(row=>{
   const existing=placed.has(row.id);
   return '<li><label><input data-template-slot="'+row.id+'" type="checkbox"'+(existing||selectedSlots.has(row.id)?' checked':'')+(existing||!row.optional&&panel!=='upgrade'?' disabled':'')+'> <strong>'+esc(row.title)+'</strong></label><p>'+esc(row.guidance)+'</p></li>';
  }).join('')+'</ol>';
  if(panel==='upgrade')return html+controls('starterApplyUpdate','update')+controls('starterCancel','close')+'</section>';
  if(panel==='import')return html+controls('starterCustomize','import-draft')+controls('starterCancel','list')+'</section>';
  return html+controls('starterFrom','create')+controls('starterSaveAs','copy')+(!active.builtIn?controls('starterEdit','edit'):'')+controls('starterExport','export')+controls('starterCancel','list')+'</section>';
 }
 function differences(a,b){
  const before=new Map(a.sections.map(s=>[s.id,s])),after=new Map(b.sections.map(s=>[s.id,s]));
  const positions=new Map(a.sections.map((section,i)=>[section.id,i+1]));
  const lines=[];
  function value(v,key){
   if(v===undefined||v===null||v==='')return '—';
   if(typeof v==='boolean')return tr(v?'enabled':'disabled');
   if(key==='font')return BUNDLED_FONTS.find(f=>f.id===v)?.family??v;
   if(key==='profile')return tr('starterProfile_'+v);
   if(key==='links')return tr(v);
   if(key==='numberStyle')return tr({'lower-roman':'lowerRoman','upper-roman':'upperRoman',decimal:'decimal'}[v]);
   return String(v);
  }
  const changed=(label,x,y,key)=>{if(x!==y)lines.push(label+' · '+value(x,key)+' → '+value(y,key));};
  for(const [position,section] of b.sections.entries()){
   const old=before.get(section.id);
   if(!old)lines.push(tr('starterAdded',{title:section.title}));
   else{
    if(old.title!==section.title)lines.push(old.title+' → '+section.title);
    changed(section.title+' · '+tr('starterGuidance'),old.guidance,section.guidance);
    changed(section.title+' · '+tr('level'),old.level,section.level);
    changed(section.title+' · '+tr('starterOptionalSlot'),old.optional,section.optional);
    changed(section.title+' · '+tr('start'),tr(old.start??'flow'),tr(section.start??'flow'));
    changed(section.title+' · '+tr('starterPosition'),positions.get(section.id),position+1);
   }
  }
  for(const row of a.sections)if(!after.has(row.id))lines.push(tr('starterRetired',{title:row.title}));
  const labels={widthMm:'width',heightMm:'height',fontSizePt:'fontSize',columnGapMm:'columnGap',pageNumbers:'numbers',caption:'captions',profile:'starterProfile',margins:'starterMargins'};
  function settings(x,y,prefix,parent){
   for(const key of new Set([...Object.keys(x??{}),...Object.keys(y??{})])){
    if(key==='version')continue;
    const from=x?.[key],to=y?.[key];if(from===to)continue;
    const labelKey=parent==='header'||parent==='footer'?parent+key[0].toUpperCase()+key.slice(1):labels[key]??key;
    const label=prefix+' · '+tr(labelKey);
    if((from&&typeof from==='object')||(to&&typeof to==='object'))settings(from,to,label,key);
    else changed(label,from,to,key);
   }
  }
  changed(tr('name'),a.name,b.name);changed(tr('language'),a.language,b.language);
  changed(tr('starterProfile'),a.profile,b.profile,'profile');settings(a.layout,b.layout,tr('documentLayout'));settings(a.structure,b.structure,tr('starterStructure'));
  return lines;
 }
 function input(el){
  if(!el.closest('[data-pdf-templates]'))return false;
  if(attempted)return true;
  if(draft)edited=true;
  if(el.hasAttribute('data-template-name')){if(draft)draft.name=el.value;else name=el.value;}
  else if(el.dataset.templateSlot){if(el.checked)selectedSlots.add(el.dataset.templateSlot);else selectedSlots.delete(el.dataset.templateSlot);}
  else if(draft){
   for(const [key,property] of [['templateSlotTitle','title'],['templateSlotGuide','guidance'],['templateSlotLevel','level'],['templateSlotOptional','optional']]){
    if(el.dataset[key]!==undefined){draft.sections[Number(el.dataset[key])][property]=property==='optional'?el.checked:property==='level'?Number(el.value):el.value;break;}
   }
   if(el.dataset.templateStyle==='font')draft.layout.font=el.value;
   if(el.dataset.templateStyle==='profile')draft.profile=el.value;
   if(el.dataset.templateStyle==='language')draft.language=el.value;
   if(['widthMm','heightMm','fontSizePt','lineHeight'].includes(el.dataset.templateLayout))draft.layout[el.dataset.templateLayout]=el.valueAsNumber;
   if(['contents','numberSections'].includes(el.dataset.templateStructure))draft.structure[el.dataset.templateStructure]=el.checked;
  }
  return true;
 }
 async function action(command,node){
  if(!command.startsWith('template-'))return false;
  const cmd=command.slice(9);
  if(attempted&&!['create','publish','update','close','list'].includes(cmd))return true;
  if(cmd==='list')await list();
  else if(cmd==='close')close();
  else if(cmd==='more'){const page=await post('template-list',{language:language(),after:cursor});items.push(...page.items);cursor=page.next;}
  else if(cmd==='preview')show(await post('template-read',{language:language(),id:node.dataset.id}));
  else if(cmd==='check'){
   const current=selected();
   const result=await post('template-review',{id:current.header.id,revision:current.revision});
   show(result.current);original=result.old;selectedSlots.clear();panel='upgrade';
  }else if(cmd==='copy'||cmd==='edit'||cmd==='import-draft'){
   draft=structuredClone(active.value);panel='custom';if(cmd!=='edit')draft.id=crypto.randomUUID();
  }else if(cmd==='fork-draft'&&conflicted&&draft){
   draft.id=crypto.randomUUID();conflicted=false;edited=true;
  }else if(cmd==='import'){
   const file=find('[data-template-file]')?.files?.[0];if(!file||file.size>512*1024)throw Error(tr('starterInvalidImport'));
   let value;try{value=JSON.parse(await file.text());}catch{throw Error(tr('starterInvalidImport'));}
   const reviewed=await post('template-inspect',{value});
   if(reviewed.compatible){show(reviewed);panel='import';components=[];}else components=reviewed.components;
  }else if(cmd==='export'){
   const url=URL.createObjectURL(new Blob([JSON.stringify(active.value,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download='publication-template.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }else if(cmd.startsWith('slot-')){
   edited=true;
   const index=Number(node.dataset.slot);
   if(cmd==='slot-add')draft.sections.push({id:crypto.randomUUID(),title:'',guidance:'',optional:false,level:1,start:null});
   if(cmd==='slot-remove')draft.sections.splice(index,1);
   if(cmd==='slot-up'||cmd==='slot-down'){const next=index+(cmd==='slot-up'?-1:1);if(next>=0&&next<draft.sections.length)[draft.sections[next],draft.sections[index]]=[draft.sections[index],draft.sections[next]];}
  }else if(cmd==='publish'){
   if(conflicted)return true;
   if(!request){
    // The native owner looks up the selected bundled font on this machine.
    const reviewed=await post('template-style',{value:draft});draft=reviewed.value;
    request={commandId:crypto.randomUUID(),expectedRevision:active.value.id===draft.id?active.revision:null,value:structuredClone(draft)};
   }
   attempted=true;
   try{await post('template-publish',request);show(await post('template-read',{language:draft.language,id:draft.id}));}
   catch(error){
    if(['INVALID','PDF_TEMPLATE_COMPONENT','CONFLICT','MODULE_REPLAY'].includes(error.code)){
     attempted=false;request=null;
     if(error.code==='CONFLICT')conflicted=true;
    }
    draw();throw error;
   }
  }else if(cmd==='create'||cmd==='update'){
   if(!request){
    const updating=cmd==='update',doc=selected(),id=updating?doc.header.id:crypto.randomUUID();
    if(!updating&&!name.trim())throw Error(tr('invalid'));
    const template={id:active.value.id,revision:active.revision,language:active.value.language},operation={type:updating?'template-update':'template-create',template,slots:[...selectedSlots]};
    if(updating){operation.titles=find('[data-template-titles]').checked;operation.settings=find('[data-template-settings]').checked;}else operation.name=name.trim();
    request={id,commandId:crypto.randomUUID(),expectedRevision:updating?doc.revision:null,operation};
   }
   attempted=true;
   try{await post('change',request);}
   catch(error){if(['INVALID','PDF_TEMPLATE_COMPONENT','CONFLICT','MODULE_REPLAY'].includes(error.code)){attempted=false;request=null;}draw();throw error;}
   const id=request.id;close();await openDocument(id);
  }
  draw();return true;
 }
 async function saveDraft(){
  if(!hasUnsaved())return;
  if(conflicted)throw Error(tr('starterCopyConflict'));
  await action('template-'+(panel==='custom'?'publish':panel==='upgrade'?'update':'create'));
 }
 return {view,input,action,close,hasUnsaved,saveDraft};
}
