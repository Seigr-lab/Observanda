export function pdfLibraryOrganizationUI({esc,tr,button,post,draw,query,host,rows,archived}){
 const selection=new Map();
 let visible=false,kind='collection',search='',name='',labels=[],next=null,previous=[],cursor=null,target=null,filter=null;
 let batch='',review=null,request=null,editRequest=null,controller=null,locked=false,message='',notice='';
 const selected=id=>selection.has(id);
 const key=action=>'libraryAction'+action;
 const idAttrs=id=>'data-id="'+esc(id)+'"';
 function reset(){
  controller?.abort();controller=null;selection.clear();visible=false;kind='collection';search=name=batch=notice=message='';
  labels=[];next=cursor=target=filter=review=request=editRequest=null;previous=[];locked=false;
 }
 function changeSelection(){review=request=null;message=notice='';}
 function checkbox(item){
  if(typeof item.pinned!=='boolean')return '';
  return '<input type="checkbox" data-library-select="'+esc(item.id)+'" aria-label="'+esc(tr('librarySelectNamed',{name:item.name,id:item.id.slice(0,8)}))+'"'+(selected(item.id)?' checked':'')+(locked?' disabled':'')+'>';
 }
 function toolbar(){
  const list=rows().filter(item=>typeof item.pinned==='boolean');
  const pageSelected=list.length&&list.every(item=>selected(item.id));
  return '<div class="pdf-toolbar">'+button('libraryGroups','library-groups','aria-expanded="'+visible+'"')+
   (filter?'<span>'+esc(tr(filter.kind==='tag'?'libraryTag':'libraryCollection'))+' · '+esc(filter.name)+'</span>'+button('libraryAllDocuments','library-clear-filter'):'')+
   (list.length?button(pageSelected?'libraryUnselectPage':'librarySelectPage','library-select-page',locked?'disabled':''):'')+'</div>';
 }
 function manager(){
  if(!visible)return '';
  const tabs=['collection','tag'].map(value=>button(value==='tag'?'libraryTags':'libraryCollections','library-group-kind','data-kind="'+value+'" aria-pressed="'+(value===kind)+'"')).join('');
  const choices=labels.map(item=>'<li><button type="button" class="pdf-library-title" data-action="module-command" data-module-id="pdf-editor" data-command="library-group-choose" '+idAttrs(item.id)+' aria-pressed="'+(target?.id===item.id)+'">'+esc(item.name)+'</button> <span>'+esc(tr('libraryGroupCount',{n:item.count}))+'</span></li>').join('');
  const rename=target?button('libraryRenameGroup','library-rename-group')+button('libraryRemoveGroup','library-remove-group',target.count?'disabled':'')+button('libraryFilterGroup','library-filter-group'):'';
  return '<section class="pdf-library-groups"><div class="pdf-toolbar">'+tabs+'</div><div class="pdf-toolbar"><label>'+esc(tr('libraryFindGroup'))+'<input type="search" maxlength="100" data-library-group-search value="'+esc(search)+'"></label>'+button('search','library-find-groups')+'</div><ul>'+choices+'</ul><div class="pdf-toolbar">'+(previous.length?button('libraryPreviousPage','library-groups-previous'):'')+(next?button('more','library-groups-next'):'')+'</div><div class="pdf-toolbar"><label>'+esc(tr(kind==='tag'?'libraryTag':'libraryCollection'))+'<input type="text" maxlength="100" data-library-group-name value="'+esc(name)+'"></label>'+button('libraryCreateGroup','library-create-group')+rename+'</div></section>';
 }
 function actions(){
  if(!selection.size)return '';
  const allowed=archived()?['restore']:['pin','unpin','archive','export',...(target?['assign','unassign']:[])];
  if(!allowed.includes(batch))batch=allowed[0];
  const options=allowed.map(value=>'<option value="'+value+'"'+(value===batch?' selected':'')+'>'+esc(tr(key(value),{name:target?.name??''}))+'</option>').join('');
  let result='';
  if(review){
   const available=review.items.every(row=>['ready','unchanged'].includes(row.state)),ready=review.items.filter(row=>row.state==='ready').length;
   const details=review.items.map(item=>{
    const meta=item.audience?' · '+tr('edition',{number:item.edition})+' · '+(item.profile==='standard'?tr('libraryStandardPdf'):item.profile.toUpperCase())+' · '+tr(item.audience==='public'?'audiencePublic':'audiencePrivate')+' · '+tr(item.included===1?'libraryOneSection':'librarySections',{n:item.included}):'';
    return '<tr><th scope="row">'+esc(item.name??item.id)+'</th><td><code>'+esc(item.id.slice(0,8))+'</code> · <code>'+esc(item.revision.slice(0,12))+'</code></td><td>'+esc(tr('libraryState'+item.state)+meta)+'</td></tr>';
   }).join('');
   const stale=review.items.some(row=>['changed','unavailable','lifecycle'].includes(row.state));
   result='<div class="pdf-library-review"><table><caption>'+esc(tr(key(batch),{name:target?.name??''}))+'</caption><tbody>'+details+'</tbody></table>'+(stale?button('libraryRefreshSelection','library-refresh-selection'):'')+button(batch==='export'?'libraryQueueExports':'libraryApplyBatch','library-apply-batch',available&&ready&&!locked?'':'disabled')+'</div>';
  }
  return '<section class="pdf-library-batch"><div class="pdf-toolbar"><strong>'+esc(tr('librarySelectedCount',{n:selection.size}))+'</strong>'+button('libraryClearSelection','library-clear-selection')+'<label>'+esc(tr('libraryBatchAction'))+'<select data-library-batch-action>'+options+'</select></label>'+button('libraryReviewSelection','library-review-batch')+'</div>'+result+'</section>';
 }
 function view(){
  return '<div data-library-organization'+(locked?' aria-busy="true" inert':'')+'>'+toolbar()+manager()+actions()+
   (message?'<p role="alert">'+esc(message)+'</p>':'')+(notice?'<p role="status">'+esc(notice)+'</p>':'')+'</div>';
 }
 async function list(after=null,back=[]){
  const {signal}=controller,result=await post('library-labels',{kind,search,cursor:after,limit:12},{signal});
  if(signal.aborted)return;
  labels=result.items;next=result.next;previous=back;cursor=after;
  if(target){const item=labels.find(row=>row.id===target.id);if(item)target=item;}
 }
 function input(el){
  if(el.hasAttribute('data-library-select')){
   if(locked)return true;
   const item=rows().find(value=>value.id===el.dataset.librarySelect);if(!item)return true;
   if(el.checked&&!selected(item.id)&&selection.size>=100){el.checked=false;message=tr('librarySelectionLimit');draw();return true;}
   if(el.checked)selection.set(item.id,item.revision);else selection.delete(item.id);
   changeSelection();draw();host()?.querySelector('[data-library-select="'+item.id+'"]')?.focus();return true;
  }
  if(el.hasAttribute('data-library-group-search')){search=el.value;return true;}
  if(el.hasAttribute('data-library-group-name')){name=el.value;editRequest=null;return true;}
  if(el.hasAttribute('data-library-batch-action')){batch=el.value;changeSelection();draw();return true;}
  return false;
 }
 async function action(command,node){
  const names=['groups','group-kind','group-choose','find-groups','groups-previous','groups-next','create-group','rename-group','remove-group','filter-group','clear-filter','select-page','clear-selection','refresh-selection','review-batch','apply-batch'];
  const operation=command.slice('library-'.length);if(!names.includes(operation))return false;
  if(locked)return true;
  controller?.abort();const active=new AbortController();controller=active;locked=true;message=notice='';draw();
  try{
   if(operation==='groups'){visible=!visible;if(visible)await list();}
   else if(operation==='group-kind'){kind=node.dataset.kind;target=null;search=name='';editRequest=null;changeSelection();await list();}
   else if(operation==='group-choose'){target=labels.find(row=>row.id===node.dataset.id);name=target.name;editRequest=null;changeSelection();}
   else if(operation==='find-groups')await list();
   else if(operation==='groups-next'&&next)await list(next,[...previous,cursor]);
   else if(operation==='groups-previous'&&previous.length)await list(previous.at(-1),previous.slice(0,-1));
   else if(['create-group','rename-group','remove-group'].includes(operation)){
    const type=operation.split('-')[0],text=name.normalize('NFC').trim();
    if(type!=='remove'&&!text){message=tr('libraryNameRequired');return true;}
    const data=type==='create'?{type,kind,name:text}:{type,id:target.id,expected:target.revision,...(type==='rename'?{name:text}:{})};
    const signature=JSON.stringify(data);if(editRequest?.signature!==signature)editRequest={signature,command:{commandId:crypto.randomUUID(),operation:{...data,...(type==='create'?{id:crypto.randomUUID()}:{})}}};
    const saved=await post('library-label-edit',editRequest.command,{signal:active.signal});if(active.signal.aborted)return true;
    editRequest=null;if(filter?.id===saved.id)filter=type==='remove'?null:saved;
    target=type==='remove'?null:{...saved,count:type==='create'?0:target.count};name=target?.name??'';search='';changeSelection();await list();await query();
   }
   else if(operation==='filter-group'||operation==='clear-filter'){filter=operation==='filter-group'?target:null;visible=false;await query();}
   else if(operation==='select-page'){
    const page=rows().filter(item=>typeof item.pinned==='boolean'),remove=page.every(item=>selected(item.id));changeSelection();
    if(!remove&&new Set([...selection.keys(),...page.map(item=>item.id)]).size>100){message=tr('librarySelectionLimit');return true;}
    for(const item of page){if(remove)selection.delete(item.id);else selection.set(item.id,item.revision);}
   }else if(operation==='clear-selection'){selection.clear();changeSelection();}
   else if(operation==='refresh-selection'&&review){
    for(const item of review.items){if(item.currentRevision)selection.set(item.id,item.currentRevision);else if(['unavailable','lifecycle'].includes(item.state))selection.delete(item.id);}
    changeSelection();await query();
   }
   else if(operation==='review-batch'){
    review=request=null;
    const input={action:batch,groupId:['assign','unassign'].includes(batch)?target.id:null,selection:[...selection].map(([id,revision])=>({id,revision}))};
    const result=await post('library-review',input,{signal:active.signal});if(active.signal.aborted)return true;
    review=result;request={commandId:crypto.randomUUID(),review:input,token:result.token};
   }else if(operation==='apply-batch'&&request){
    const response=await post('library-batch',request,{signal:active.signal});if(active.signal.aborted)return true;
    selection.clear();changeSelection();notice=tr(response.jobs?'libraryExportsQueued':'libraryApplied',{n:response.count});
    if(visible)await list();await query();
   }
  }catch(error){if(!active.signal.aborted){message=error.message;if(error.code==='CONFLICT'){review=request=editRequest=null;}}}
  finally{if(controller===active){
   locked=false;draw();
   if(document.activeElement===document.body){
    const selector=operation==='review-batch'?'[data-command="library-apply-batch"]:enabled, [data-command="library-refresh-selection"]':
     operation==='groups'&&visible?'[data-library-group-search]':operation==='group-choose'?'[data-library-group-name]':'[data-command="'+command+'"]';
    (host()?.querySelector(selector)??host()?.querySelector('[data-command="library-groups"]'))?.focus();
   }
  }}
  return true;
 }
 return {view,checkbox,input,action,reset,groupId:()=>filter?.id??null};
}
