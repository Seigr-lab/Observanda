import {t} from './i18n/index.js';
import {sameUnitDimensions} from './measurement-unit-model.js';
import {catalogueUnit} from './measurement-unit-catalogue.js';
import {measurementUnitControls,readMeasurementUnit,wireMeasurementUnits} from './measurement-unit-ui.js';

const message=(key,args)=>t('measurements',key,args);

export function wireUnitLibrary({node,panel,esc,field,call,recordId,guard,signal,apply,read}){
 const root=node.ownerDocument.createElement('section');
 const button=(name,label)=>'<button type="button" class="button" data-library-'+name+'>'+esc(message(label))+'</button>';
 const input=(name,label,limit)=>field(esc(message(label)),'<input data-library-'+name+' maxlength="'+limit+'">');
 const unitNames=()=>input('title','unitLibraryName',300)+input('quantity','unitLibraryQuantity',120)+input('symbol','unitLibrarySymbol',100)+field(esc(message('unitLibraryAliases')),'<textarea data-library-aliases rows="2" maxlength="3232"></textarea>');
 root.innerHTML='<details data-library-favorites><summary>'+esc(message('favoriteQuantities'))+'</summary><div data-library-favorite-list></div></details>'+
  button('favorite-standard','favoriteStandard')+'<h4>'+esc(message('unitLibraryLab'))+'</h4>'+input('query','unitLibrarySearch',200)+button('search','unitLibraryFind')+
  '<div data-library-results></div><p data-library-status role="status"></p>'+
  '<details data-library-author><summary>'+esc(message('unitLibraryManage'))+'</summary>'+
  unitNames()+
  '<div data-library-review></div>'+button('review','unitLibraryReview')+'</details>';
 panel.append(root);
 const get=name=>root.querySelector('[data-library-'+name+']'),results=get('results'),status=get('status');
 let generation=0,items=[],after=null,next=null,selected=null,review=null,busy=false;
 const active=()=>!signal.aborted&&node.isConnected;
 const confirm=()=>{guard();if(!active())throw new DOMException('Aborted','AbortError');};
 async function list(cursor=null){
  const request=++generation,query=get('query').value.trim();
  const value=await call('unit-definition-list',{query,after:cursor},{signal});
  confirm();if(request!==generation)return;
  items=value.items;next=value.next;after=cursor;
  results.innerHTML=items.map((item,index)=>'<button type="button" class="button" data-library-result="'+index+'">'+esc(item.title+' · '+item.symbol+' · '+item.quantity)+'</button>').join('')+
   (next?button('next','moreUnitDefinitions'):'')+(after?button('first','firstUnitDefinitions'):'');
  status.textContent=items.length?'':message(next?'unitLibraryMorePossible':'unitLibraryNoMatches');
 }
 function payload(fields,current,updating=null){
  if(!current)throw RangeError(message('unitDeclare'));
  const {source,...definition}=current;
  const aliases=fields('aliases').value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);
  const value={recordId:updating?.recordId??recordId,id:updating?.ref.id??crypto.randomUUID(),expectedRevision:updating?.ref.revision??null,title:fields('title').value.trim(),
   unit:{quantity:fields('quantity').value.trim(),symbol:fields('symbol').value.trim(),aliases,definition}};
  if(!value.title||!value.unit.symbol||!value.unit.quantity)throw RangeError(message('unitLibraryFieldsRequired'));
  return value;
 }
 function reviewChanges(){
  review=payload(get,read());
  get('review').innerHTML='<p>'+esc(message('unitLibraryCreateReview'))+'</p><p>'+esc(review.title+' · '+review.unit.quantity+' · '+review.unit.symbol)+'</p>'+button('save','unitLibraryConfirm');
 }
 function forgetReview(){review=null;get('review').replaceChildren();}
 root.addEventListener('input',forgetReview,{signal});
 node.addEventListener('input',event=>{if(!root.contains(event.target))forgetReview();},{signal});
 let favorites=[],favoriteNext=null,favoriteRequest=0;
 async function showFavorites(cursor=null){
  const request=++favoriteRequest,page=await call('unit-favorites-list',{after:cursor},{signal});confirm();
  if(request!==favoriteRequest)return;
  favorites=page.items;favoriteNext=page.next;
  const list=get('favorite-list');
  list.innerHTML=(favorites.length?'<ul>'+favorites.map((row,index)=>{
   const label=row.unavailable?message('favoriteUnavailable'):row.standard?message('unitLabel-'+row.standard.id):row.quantity+' · '+row.title+' · '+row.symbol;
   return '<li>'+esc(label)+(row.unavailable?'':' <button type="button" class="button" data-library-use-favorite="'+index+'">'+esc(message('unitLibraryUse'))+'</button>')+' <button type="button" class="button" data-library-remove-favorite="'+index+'" aria-label="'+esc(message('removeFavoriteQuantity',{label}))+'">'+esc(message('remove'))+'</button></li>';
  }).join('')+'</ul>':'<p>'+esc(message('noFavoriteQuantities'))+'</p>')+(page.next?button('next-favorites','moreUnitDefinitions'):'')+(cursor?button('first-favorites','firstUnitDefinitions'):'');
 }
 get('favorites').addEventListener('toggle',()=>{if(get('favorites').open)void showFavorites().catch(error=>{if(active())status.textContent=error.message;});},{signal});
 const standard=panel.querySelector('[data-unit-standard]'),favoriteStandard=get('favorite-standard');
 function showStandardAction(){favoriteStandard.hidden=!standard.value;}
 standard.addEventListener('change',showStandardAction,{signal});showStandardAction();
 async function favorite(choice){
  await call('unit-favorite-set',{choice},{signal});confirm();status.textContent=message('favoriteQuantitySaved');
  if(get('favorites').open)await showFavorites();
 }
 function revise(chosen,trigger){
  const dialog=node.ownerDocument.createElement('dialog');
  dialog.setAttribute('aria-label',message('unitLibraryEdit'));dialog.className='material-dialog';
  dialog.innerHTML='<h3>'+esc(message('unitLibraryEdit'))+'</h3>'+unitNames()+measurementUnitControls(chosen.unit.definition,{esc,field,choices:false})+
   '<div data-library-edition-review aria-live="polite"></div>'+button('review','unitLibraryReview')+button('cancel','cancel');
  node.ownerDocument.body.append(dialog);
  const fields=name=>dialog.querySelector('[data-library-'+name+']'),feedback=fields('edition-review');
  const stop=wireMeasurementUnits(dialog,{esc,field});let proposal=null,saving=false;
  for(const [key,value] of Object.entries({title:chosen.title,quantity:chosen.unit.quantity,symbol:chosen.unit.symbol,aliases:chosen.unit.aliases.join('\n')}))fields(key).value=value;
  function close(){stop();dialog.remove();signal.removeEventListener('abort',close);if(active()&&trigger.isConnected)trigger.focus();}
  dialog.addEventListener('close',close,{once:true});signal.addEventListener('abort',close,{once:true});
  dialog.addEventListener('input',()=>{proposal=null;feedback.replaceChildren();});
  dialog.addEventListener('click',async event=>{
   const control=event.target.closest('button');if(!control||saving)return;
   if(control===fields('cancel')){dialog.close();return;}
   try{
    if(control===fields('review')){
     proposal=payload(fields,readMeasurementUnit(dialog,{validate:true}),chosen);
     feedback.innerHTML='<p>'+esc(message('unitLibraryRevisionReview',{title:chosen.title,revision:chosen.ref.revision.slice(0,12)}))+'</p><p>'+esc(proposal.title+' · '+proposal.unit.symbol)+'</p>'+button('save','unitLibraryConfirm');return;
    }
    if(control!==fields('save')||!proposal)return;
    saving=true;control.disabled=true;await call('unit-definition-save',proposal,{signal});confirm();
    dialog.close();await list();status.textContent=message('unitLibraryRevisionSaved');
   }catch(error){if(dialog.isConnected){proposal=null;feedback.textContent=error.message;}}
   finally{saving=false;if(control.isConnected)control.disabled=false;}
  });
  dialog.showModal();fields('title').focus();
 }
 root.addEventListener('click',async event=>{
  const control=event.target.closest('button');if(!control||busy||!root.contains(control))return;
  busy=true;const enabled=[...root.querySelectorAll('button:enabled')];
  for(const action of enabled)action.disabled=true;
  root.setAttribute('aria-busy','true');
  try{
   confirm();
   if(control.hasAttribute('data-library-favorite-standard'))await favorite(catalogueUnit(standard.value).definition.source);
   else if(control.hasAttribute('data-library-favorite-current'))await favorite(selected.ref);
   else if(control.hasAttribute('data-library-first-favorites'))await showFavorites();
   else if(control.hasAttribute('data-library-next-favorites'))await showFavorites(favoriteNext);
   else if(control.hasAttribute('data-library-remove-favorite')){
    const row=favorites[Number(control.dataset.libraryRemoveFavorite)];await call('unit-favorite-set',{remove:row.key},{signal});confirm();await showFavorites();
   }else if(control.hasAttribute('data-library-use-favorite')){
    const row=favorites[Number(control.dataset.libraryUseFavorite)];
    if(row.standard)apply(node,catalogueUnit(row.standard.id,row.standard.revision),null);
    else{const saved=await call('unit-definition-read',{ref:row.ref},{signal});confirm();apply(node,saved.unit,saved.ref);}
   }else if(control.hasAttribute('data-library-search')||control.hasAttribute('data-library-first'))await list();
   else if(control.hasAttribute('data-library-next'))await list(next);
   else if(control.hasAttribute('data-library-result')){
    const item=items[Number(control.dataset.libraryResult)];
    const saved=await call('unit-definition-read',{ref:item.ref},{signal});confirm();
    const current=read(),compatible=!current||current.kind===saved.unit.definition.kind&&sameUnitDimensions(current,saved.unit.definition);
    status.textContent=message(compatible?'unitLibraryCompatible':'unitLibraryDimensionChange');
    results.innerHTML='<p>'+esc(saved.title+' · '+saved.unit.symbol+' · '+saved.unit.quantity+' · '+saved.ref.revision.slice(0,12))+'</p>'+
     button('apply','unitLibraryUse')+button('favorite-current','favoriteUnit')+button('edit','unitLibraryEdit')+button('first','firstUnitDefinitions');
    selected={...item,...saved};
   }else if(control.hasAttribute('data-library-apply')){
    if(selected)apply(node,selected.unit,selected.ref);
   }else if(control.hasAttribute('data-library-edit')){
    if(selected)revise(selected,control);
   }else if(control.hasAttribute('data-library-review'))reviewChanges();
   else if(control.hasAttribute('data-library-save')&&review){
    const submitted=review,result=await call('unit-definition-save',submitted,{signal});confirm();
    const saved=await call('unit-definition-read',{ref:result.ref},{signal});confirm();
    apply(node,saved.unit,saved.ref);
   }
  }catch(error){if(active())status.textContent=error.message;}
  finally{busy=false;root.removeAttribute('aria-busy');for(const action of enabled)if(action.isConnected)action.disabled=false;}
 },{signal});
 get('query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();get('search').click();}},{signal});
}
