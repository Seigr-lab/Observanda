export function websitePickerSaved({request,site,msg,esc,criteria,recall,paint}){
 let open=false,rows=[],pages=[''],page=0,next=null,name='',query='',search='',pending=null,editing=null,createId=null,message='',controller;
 const button=(op,key,attrs='')=>'<button type="button" class="button" data-action="website-files-picker-saved-'+op+'" '+attrs+'>'+esc(msg(key))+'</button>';
 function reset(){
  controller?.abort();controller=null;open=false;rows=[];pages=[''];page=0;next=null;name=query=search=message='';pending=editing=createId=null;
 }
 function view(){
  return '<aside id="website-picker-refinements" class="website-picker-refinements website-picker-saved" aria-label="'+esc(msg('pickerSavedSearches'))+'"><h3>'+esc(msg('pickerSavedSearches'))+'</h3><p>'+esc(msg('pickerSavedHelp'))+'</p>'+
   '<label>'+esc(msg('pickerNameSearch'))+'<input data-picker-saved-name maxlength="120" value="'+esc(name)+'"></label>'+button('save','pickerSaveSearch')+
   '<hr><label>'+esc(msg('pickerFindSaved'))+'<input type="search" data-picker-saved-query maxlength="160" value="'+esc(query)+'"></label>'+button('find','pickerFind')+
   '<ul>'+rows.map((row,i)=>'<li><button type="button" class="website-picker-link" data-action="website-files-picker-saved-run" data-index="'+i+'">'+esc(row.name)+'</button>'+
    (editing?.id===row.id?'<div class="website-picker-manage"><label>'+esc(msg('pickerNameSearch'))+'<input data-picker-saved-rename maxlength="120" value="'+esc(editing.name)+'"></label>'+
     button('rename','pickerRenameSearch','data-index="'+i+'"')+button('replace','pickerReplaceFilters','data-index="'+i+'"')+button('ask','remove','data-index="'+i+'" aria-label="'+esc(msg('pickerRemoveSaved',{name:row.name}))+'"')+button('cancel','cancel')+'</div>':
     pending===row.id?'<div>'+button('delete','pickerConfirmDelete','data-index="'+i+'"')+button('cancel','cancel')+'</div>':
     button('edit','pickerManageSearch','data-index="'+i+'"'))+'</li>').join('')+'</ul>'+
   ((!rows.length&&controller===null)?'<p>'+esc(msg('pickerNoSaved'))+'</p>':'')+
   (page?button('prev','pickerPrevious'):'')+(next?button('next','pickerNext'):'')+'<p role="status">'+esc(message)+'</p></aside>';
 }
 async function load(target=0,focus){
  controller?.abort();const job=new AbortController();controller=job;
  try{
   const data=await request('library/saved-searches/list',{siteId:site().site.id,after:pages[target]??'',query:search},{signal:job.signal});
   if(job!==controller)return;rows=data.items;page=target;next=data.next;pending=editing=null;
  }finally{if(controller===job){controller=null;paint(focus);}}
 }
 function input(el){
  if(el.matches('[data-picker-saved-name]')){if(name!==el.value)createId=null;name=el.value;}
  else if(el.matches('[data-picker-saved-rename]')&&editing)editing.name=el.value;
  else if(el.matches('[data-picker-saved-query]'))query=el.value;
  else return false;
  return true;
 }
 async function action(op,el){
  if(op==='toggle'){if(open){reset();paint('[data-action="website-files-picker-saved-toggle"]');return;}
   open=true;await load(0,'[data-picker-saved-name]');return;}
  if(!open)return;
  const row=rows[Number(el.dataset.index)],siteId=site().site.id;message='';
  if(op==='find'){search=query.trim();pages=[''];return load(0,'[data-picker-saved-query]');}
  if(op==='prev'&&page)return load(page-1);
  if(op==='next'&&next){pages[page+1]=next;return load(page+1);}
  if(op==='run'&&row){reset();return recall(row.criteria);}
  if(op==='edit'&&row){pending=null;editing={id:row.id,name:row.name};paint('[data-picker-saved-rename]');return;}
  if(op==='ask'&&row){editing=null;pending=row.id;paint('[data-action="website-files-picker-saved-delete"]');return;}
  if(op==='cancel'){pending=editing=null;paint();return;}
  if(op==='save'&&!name.trim()){message=msg('pickerNameSearch');paint('[data-picker-saved-name]');return;}
  controller?.abort();const job=new AbortController();controller=job;
  try{
   if(op==='save'){
    createId??=crypto.randomUUID();
    await request('library/saved-searches/save',{siteId,id:createId,name:name.trim(),criteria:criteria()},{signal:job.signal});
    if(controller!==job)return;message=msg('pickerSearchStored');name=search=query='';createId=null;
   }else if(row&&editing&&row.id===editing.id&&['rename','replace'].includes(op)){
    if(!editing.name.trim()){message=msg('pickerNameSearch');paint('[data-picker-saved-rename]');return;}
    await request('library/saved-searches/save',{siteId,id:row.id,revision:row.revision,name:op==='rename'?editing.name.trim():row.name,criteria:op==='replace'?criteria():row.criteria},{signal:job.signal});
    if(controller!==job)return;message=msg('pickerSearchStored');
   }else if(op==='delete'&&row?.id===pending){
    await request('library/saved-searches/remove',{siteId,id:row.id,revision:row.revision},{signal:job.signal});
    if(controller!==job)return;
   }else return;
  }catch(error){
   if(error.name==='AbortError')return;
   if(error.code!=='CONFLICT')throw error;
   message=msg(op==='save'?'pickerSearchNameTaken':'changed');
  }finally{if(controller===job)controller=null;}
  if(!open)return;pages=[''];await load(0,'[data-picker-saved-name]');
 }
 return {view,reset,input,action,isOpen:()=>open};
}
