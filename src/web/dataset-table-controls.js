import {t} from './i18n/index.js';
import {confirmAction} from './confirm-action.js';
import './i18n/catalogues/datasetTable.js';
import {emptyTableQuery,datasetPresenceTests,datasetValueTests} from './dataset-table-query.js';
const tr=(key,args)=>t('datasetTable',key,args);
const keyOf=ref=>[ref.workspaceId,ref.id,ref.revision].join('/');
export function datasetTableControls({call,esc,guard,refresh,readOnly,notify}){
 let view=null,searchController=null,serial=0;
 const host=()=>document.querySelector('[data-dataset-table-tools]');
 const fresh=()=>({query:emptyTableQuery(),pinned:[],hidden:[],columnOffset:0});
 function open(ref,doc,restore){
  const key=keyOf(ref);
  if(view?.key!==key){
   close();view={key,ref,width:doc.content.schemaIndex?.count??doc.content.columns.length,settings:fresh(),offset:0,selected:0,labels:new Map(),panels:new Set(),search:'',searchOffset:0,found:null,views:null,viewAfter:null,savedId:null,savedRevision:null,savedName:'',focus:null,anchor:null};
  }
  if(restore?.key===key){view.settings=structuredClone(restore.settings);view.offset=restore.offset;view.focus=restore.focus;view.anchor=restore.anchor;view.scroll=restore.scroll;}
 }
 function suspend(){searchController?.abort();view?.pending?.abort();searchController=null;}
 function close(){suspend();serial++;view=null;}
 function snapshot(){
  if(!view)return null;
  const region=document.querySelector('[data-table-grid]')?.closest('.material-table');
  const form=region?.closest('form');
  return {key:view.key,settings:structuredClone(view.displayed?.settings??view.settings),offset:view.displayed?.offset??view.offset,focus:view.focus,anchor:view.anchor,scroll:region?{left:region.scrollLeft,top:region.scrollTop,formLeft:form?.scrollLeft,formTop:form?.scrollTop}:null};
 }
 function columns(){
  const {width,settings}=view,hidden=new Set(settings.hidden),selected=[...settings.pinned];
  for(let i=settings.columnOffset;i<width&&i<settings.columnOffset+16;i++)if(!hidden.has(i)&&!selected.includes(i))selected.push(i);
  if(!selected.length){
   let column=settings.columnOffset;
   do{column=(column+1)%width;}while(hidden.has(column));
   selected.push(column);
  }
  return selected;
 }
 function setPageColumn(index){view.settings.columnOffset=Math.min(view.width-1,Math.max(0,index));}
 const label=index=>view.labels.get(index)??tr('column')+' '+(index+1);
 const command=(name,key,attrs='')=>'<button type="button" data-table-command="'+name+'" '+attrs+'>'+esc(tr(key))+'</button>';
 const select=(field,values,selected)=>'<select data-table-field="'+field+'">'+values.map(v=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+esc(tr(v))+'</option>').join('')+'</select>';
 const number=(value)=>value.toLocaleString(document.documentElement.lang);
 function remember(items){
  for(const {position,name} of items){if(view.labels.size>=256)view.labels.delete(view.labels.keys().next().value);view.labels.set(position,name);}
 }
 function renderColumns(){
  const v=view,items=v.found?.items??[];
  return '<label>'+esc(tr('find'))+' <input type="search" data-table-field="search" value="'+esc(v.search)+'"></label> '+command('search','search')+
   '<div data-column-results role="group" aria-label="'+esc(tr('columns'))+'">'+(v.found&&!items.length?'<p>'+esc(tr('none'))+'</p>':'')+items.map(c=>{
    const i=c.position,attr='data-column="'+i+'"',pinned=v.settings.pinned.includes(i),hidden=v.settings.hidden.includes(i);
    return '<div class="inline-actions"><span>'+esc(number(i+1)+'. '+c.name+(c.unit?' · '+c.unit:''))+'</span>'+command('show','show',attr)+command('use','use',attr)+command('pin',pinned?'unpin':'pin',attr)+(hidden?'':command('hide','hide',attr))+'</div>';
   }).join('')+(v.found?.next!=null?command('more','more'):'')+'</div>'+
   (v.settings.hidden.length?'<p>'+esc(tr('hidden'))+' ('+number(v.settings.hidden.length)+') '+command('all-columns','showAll')+'</p>':'')+
   (v.settings.pinned.length?'<p>'+esc(tr('pinned'))+' · '+v.settings.pinned.map(label).map(esc).join(', ')+'</p>':'');
 }
 function renderFilter(){
  const v=view,q=v.draft??structuredClone(v.settings.query);v.draft=q;
  return '<p>'+esc(tr('only'))+'</p><label>'+esc(tr('id'))+' <input data-table-field="id" maxlength="2048" value="'+esc(q.id)+'"></label> '+
   '<label>'+esc(tr('inclusion'))+' '+select('inclusion',['all','included','excluded'],q.inclusion)+'</label> '+
   '<label>'+esc(tr('where'))+' '+select('join',['all','any'],q.join)+'</label>'+
   '<p>'+esc(tr('selected',{column:label(v.selected)}))+'</p>'+
   '<label>'+esc(tr('condition'))+' '+select('test',[...datasetValueTests,...datasetPresenceTests],v.test??'equal')+'</label> '+
   '<label data-value-field'+(datasetPresenceTests.includes(v.test)?' hidden':'')+'>'+esc(tr('value'))+' <input data-table-field="value" maxlength="8192" value="'+esc(v.value??'')+'"></label> '+command('add','add',q.filters.length>=16?'disabled':'')+
   (q.filters.length?'<ol>'+q.filters.map((f,i)=>'<li>'+esc(label(f.column)+' · '+tr(f.test)+(f.value===undefined?'':' · '+f.value))+' '+command('remove','remove','data-index="'+i+'"')+'</li>').join('')+'</ol>':'')+
   '<label>'+esc(tr('sort'))+' '+select('sort',['original','ascending','descending'],q.sort?.direction??'original')+'</label> '+
   (q.sort?'<span>'+esc(label(q.sort.column))+'</span> '+(q.sort.column!==v.selected?command('sort-here','sortHere')+' ':''):'')+
   command('apply','apply')+' '+command('clear','clear');
 }
 function renderViews(){
  const v=view,items=v.views??[];
  return (v.views&&!items.length?'<p>'+esc(tr('noViews'))+'</p>':'')+
   '<ul>'+items.map((item,i)=>'<li><span>'+esc(item.name)+'</span> '+command('load','load','data-index="'+i+'"')+(readOnly()?'':' '+command('delete','delete','data-index="'+i+'" aria-label="'+esc(tr('delete')+' '+item.name)+'"'))+'</li>').join('')+'</ul>'+
   (v.viewAfter?command('views-more','moreViews'):'')+(readOnly()?'':'<label>'+esc(tr('name'))+' <input data-table-field="name" maxlength="120" value="'+esc(v.savedName)+'"></label> '+command('save','save')+(v.savedId?' '+command('save-as','saveAs'):''));
 }
 function render(){
  const v=view;
  const panel=(id,title,body)=>'<details data-table-panel="'+id+'"'+(v.panels.has(id)?' open':'')+'><summary>'+esc(tr(title))+'</summary>'+body+'</details>';
  return '<section data-dataset-table-tools aria-label="'+esc(tr('browse'))+'"><div class="inline-actions"><label>'+esc(tr('jump'))+' <input type="number" min="1" data-table-field="row" value="'+(v.offset+1)+'"></label> '+command('jump','go')+' '+command('copy','copy')+' '+command('cancel','cancel','hidden')+'</div><p data-table-status role="status"></p><div class="material-table-panels">'+panel('columns','columns',renderColumns())+panel('filter','filter',renderFilter())+panel('views','views',renderViews())+'</div></section>';
 }
 function capture(root){
  const field=n=>root.querySelector('[data-table-field="'+n+'"]');
  if(!view||!field('id'))return;
  const q=view.draft;q.id=field('id').value;q.inclusion=field('inclusion').value;q.join=field('join').value;
  view.test=field('test').value;view.value=field('value').value;
  const direction=field('sort').value;
  // Changing the filter target never silently changes an existing sort. The
  // sort select binds a new column only when the author chooses its direction.
  if(direction==='original')q.sort=null;
  else if(!q.sort||q.sort.direction!==direction)q.sort={column:view.selected,direction};
  view.search=field('search').value;
 }
 function replacePanels(){
  const root=host();if(!root)return;
  root.querySelector('[data-table-panel="columns"]').innerHTML='<summary>'+esc(tr('columns'))+'</summary>'+renderColumns();
  root.querySelector('[data-table-panel="filter"]').innerHTML='<summary>'+esc(tr('filter'))+'</summary>'+renderFilter();
  root.querySelector('[data-table-panel="views"]').innerHTML='<summary>'+esc(tr('views'))+'</summary>'+renderViews();
 }
 async function find(more=false){
  const v=view,root=host(),text=root.querySelector('[data-table-field="search"]').value;
  searchController?.abort();const controller=new AbortController();searchController=controller;
  try{
   const found=await call('table-schema-search',{ref:v.ref,text,offset:more?(v.found?.next??0):0,limit:8},{signal:controller.signal});
   if(v!==view||!root.isConnected||controller.signal.aborted)return;
   guard();remember(found.items);v.search=text;v.found=found;replacePanels();
  }catch(error){if(!controller.signal.aborted)throw error;}
 }
 async function list(more=false){
  const v=view,root=host(),page=await call('table-view-list',{ref:v.ref,after:more?v.viewAfter:null});
  if(!root.isConnected||view!==v)return;
  guard();v.views=page.items;v.viewAfter=page.next;replacePanels();
 }
 function address(control,field){const i=Number(control.dataset[field]);if(!Number.isSafeInteger(i)||i<0)throw new Error(tr('limit'));return i;}
 async function action(control){
  const v=view,root=host(),name=control.dataset.tableCommand;
  if(!root?.contains(control))return;
  guard();capture(root);
  if(name==='cancel'){v.pending?.abort();return;}
  if(name==='search'||name==='more')return find(name==='more');
  if(name==='views-more')return list(true);
  if(name==='copy')return copy();
  if(name==='jump'){
   const input=root.querySelector('[data-table-field="row"]');
   input.max=String(Math.max(1,v.total));if(!input.reportValidity())return;
   v.offset=Number(input.value)-1;v.focus=null;v.anchor=null;return refresh();
  }
  if(['show','use','pin','hide'].includes(name)){
   const column=address(control,'column');if(column>=v.width)return;
   if(name==='use'){v.selected=column;v.panels.add('filter');root.querySelector('[data-table-panel="filter"]').open=true;replacePanels();root.querySelector('[data-table-field="test"]').focus();return;}
   if(name==='show'){v.settings.hidden=v.settings.hidden.filter(i=>i!==column);setPageColumn(column);}
   if(name==='pin'){
    if(v.settings.pinned.includes(column))v.settings.pinned=v.settings.pinned.filter(i=>i!==column);
    else{if(v.settings.pinned.length>=16)throw new Error(tr('limit'));v.settings.hidden=v.settings.hidden.filter(i=>i!==column);v.settings.pinned.push(column);}
   }
   if(name==='hide'){
    if(v.settings.hidden.length>=v.width-1)throw new Error(tr('limit'));
    v.settings.pinned=v.settings.pinned.filter(i=>i!==column);
    if(!v.settings.hidden.includes(column))v.settings.hidden.push(column);
   }
   return refresh();
  }
  if(name==='all-columns'){v.settings.hidden=[];return refresh();}
  if(name==='add'||name==='remove'){
   if(name==='add'&&v.draft.filters.length<16)v.draft.filters.push({column:v.selected,test:v.test,...(datasetPresenceTests.includes(v.test)?{}:{value:v.value})});
   if(name==='remove')v.draft.filters.splice(address(control,'index'),1);
   replacePanels();root.querySelector('[data-table-field="test"]').focus();return;
  }
  if(name==='sort-here'){v.draft.sort={column:v.selected,direction:v.draft.sort.direction};replacePanels();root.querySelector('[data-table-field="sort"]').focus();return;}
  if(name==='clear'||name==='apply'){
   if(name==='clear')v.draft=emptyTableQuery();
   v.settings.query=structuredClone(v.draft);v.offset=0;v.focus=null;v.anchor=null;return refresh();
  }
  if(name==='load'||name==='delete'){
   const found=v.views[address(control,'index')];
   if(name==='delete'){
    if(!await confirmAction(tr('deleteConfirm',{name:found.name}),{action:'delete'}))return;
    await call('table-view-remove',{ref:v.ref,id:found.id,previous:found.revision});guard();
    if(v.savedId===found.id){v.savedId=null;v.savedName='';v.savedRevision=null;}return list();
   }
   v.savedId=found.id;v.savedRevision=found.revision;v.savedName=found.name;v.settings=structuredClone(found.settings);v.draft=structuredClone(v.settings.query);v.offset=0;return refresh();
  }
  if(name==='save'||name==='save-as'){
   const input=root.querySelector('[data-table-field="name"]'),title=input.value.trim();input.required=true;if(!input.reportValidity()||!title)return;
   const update=name==='save'&&v.savedId,id=update?v.savedId:crypto.randomUUID();
   const saved=await call('table-view-save',{ref:v.ref,id,previous:update?v.savedRevision:null,name:title,settings:v.settings});
   if(view!==v||!root.isConnected)return;
   guard();v.savedId=id;v.savedRevision=saved.revision;v.savedName=title;return list();
  }
 }
 async function load(ref){
  const v=view,token=++serial;v.pending?.abort();const controller=new AbortController();v.pending=controller;
  const root=host(),notice=root?.querySelector('[data-table-status]'),cancel=root?.querySelector('[data-table-command="cancel"]');
  if(notice)notice.textContent=tr('working');if(cancel)cancel.hidden=false;
  try{
   const result=await call('table-browse',{ref,query:v.settings.query,offset:v.offset,limit:32,columns:columns()},{signal:controller.signal});
   if(v!==view||token!==serial||controller.signal.aborted)return null;
   guard();v.total=result.total;v.displayed={settings:structuredClone(v.settings),offset:v.offset};remember(result.columns.map(({index,definition})=>({position:index,name:definition.name})));
   return result;
  }catch(error){
   if(v===view&&serial===token&&v.displayed){
    v.settings=structuredClone(v.displayed.settings);v.offset=v.displayed.offset;
    if(root?.isConnected){root.querySelector('[data-table-field="row"]').value=String(v.offset+1);replacePanels();}
   }
   if(!controller.signal.aborted)throw error;return null;
  }
  finally{if(v.pending===controller){v.pending=null;if(notice)notice.textContent='';if(cancel)cancel.hidden=true;}}
 }
 function step(direction){view.offset=Math.max(0,Math.min(Math.max(0,view.total-1),view.offset+direction*32));view.focus=null;view.anchor=null;}
 function pageColumns(direction){setPageColumn(view.settings.columnOffset+direction*16);}
 function cellPosition(el){return [Number(el.dataset.tableRow),Number(el.dataset.tableColumn)];}
 function cellAt(region,pos){return region.querySelector('[data-table-row="'+pos[0]+'"][data-table-column="'+pos[1]+'"]');}
 function selectCell(region,pos,extend=false,focus=true){
  const v=view,cell=cellAt(region,pos);if(!cell)return;
  if(!extend||!v.anchor)v.anchor=pos;
  v.focus=pos;
  for(const el of region.querySelectorAll('[data-table-row]')){
   const [r,c]=cellPosition(el),[y,x]=v.anchor;
   el.tabIndex=el===cell?0:-1;
   el.closest('td').setAttribute('aria-selected',String(r>=Math.min(pos[0],y)&&r<=Math.max(pos[0],y)&&c>=Math.min(pos[1],x)&&c<=Math.max(pos[1],x)));
  }
  if(focus){cell.focus({preventScroll:true});cell.scrollIntoView({block:'nearest',inline:'nearest'});}
 }
 async function copy(){
  const region=document.querySelector('[data-table-grid]');if(!region)return;
  const text=[...region.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td[aria-selected="true"] [data-table-row]')].map(el=>el.querySelector('span').textContent.replaceAll('"','""')).map(v=>/[\t\r\n"]/.test(v)?'"'+v+'"':v)).filter(row=>row.length).map(row=>row.join('\t')).join('\r\n');
  if(!text&& !region.querySelector('td[aria-selected="true"]'))return;
  await navigator.clipboard.writeText(text);const status=host()?.querySelector('[data-table-status]');if(status)status.textContent=tr('copied');
 }
 function bind(){
  const root=host(),grid=document.querySelector('[data-table-grid]');if(!root||!grid)return;
  root.addEventListener('click',event=>{const button=event.target.closest('[data-table-command]');if(button)void action(button).catch(e=>notify(e.message,true));});
  root.addEventListener('change',event=>{
   const field=event.target.dataset.tableField;
   if(field==='test')root.querySelector('[data-value-field]').hidden=datasetPresenceTests.includes(event.target.value);
   if(field==='sort'){capture(root);view.draft.sort=event.target.value==='original'?null:{column:view.selected,direction:event.target.value};replacePanels();root.querySelector('[data-table-field="sort"]').focus();}
  });
  root.addEventListener('keydown',event=>{
   const field=event.target.dataset.tableField;
   if(event.key==='Enter'&&['search','row','name','value'].includes(field)){event.preventDefault();root.querySelector('[data-table-command="'+({search:'search',row:'jump',name:'save',value:'add'})[field]+'"]')?.click();}
  });
  for(const details of root.querySelectorAll('[data-table-panel]'))details.addEventListener('toggle',()=>{
   if(!root.isConnected||!view)return;
   const key=details.dataset.tablePanel;
   if(details.open){view.panels.add(key);if(key==='columns'&&!view.found)void find().catch(e=>notify(e.message,true));if(key==='views'&&!view.views)void list().catch(e=>notify(e.message,true));}
   else view.panels.delete(key);
  });
  grid.addEventListener('focusin',event=>{const cell=event.target.closest('[data-table-row]');if(cell){const pos=cellPosition(cell);if(!view.focus||pos.some((v,i)=>v!==view.focus[i]))selectCell(grid,pos,false,false);}});
  grid.addEventListener('keydown',event=>{
   const cell=event.target.closest('[data-table-row]');if(!cell)return;
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){event.preventDefault();void copy().catch(e=>notify(e.message,true));return;}
   const [r,c]=cellPosition(cell),width=columns().length,height=grid.tBodies[0].rows.length;
   const position={ArrowLeft:[r,Math.max(0,c-1)],ArrowRight:[r,Math.min(width-1,c+1)],ArrowDown:[Math.min(height-1,r+1),c],ArrowUp:[Math.max(0,r-1),c],Home:[event.ctrlKey?0:r,0],End:[event.ctrlKey?height-1:r,width-1]}[event.key];
   if(position){event.preventDefault();selectCell(grid,position,event.shiftKey);}
  });
  const pos=view.focus&&cellAt(grid,view.focus)?view.focus:[0,0];
  selectCell(grid,pos,!!view.anchor,false);
  const scroller=grid.closest('.material-table');
  if(view.scroll&&scroller){
   const {left,top,formLeft,formTop}=view.scroll,form=scroller.closest('form');
   scroller.scrollLeft=left;scroller.scrollTop=top;
   if(form){form.scrollLeft=formLeft??0;form.scrollTop=formTop??0;}
   view.scroll=null;cellAt(grid,pos)?.focus({preventScroll:true});
  }
 }
 return {open,close,suspend,snapshot,columns,pageColumns,load,render,bind,step,get current(){return view;},range:result=>tr('range',{first:number(result.rows.length?result.offset+1:0),last:number(result.offset+result.rows.length),total:number(result.total),source:number(result.sourceRows)})};
}
