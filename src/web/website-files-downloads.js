import {pendingDownloadName,downloadSize,downloadKind} from './website-download-link.js';

const relative=(path,name)=>'../'.repeat(path.split('/').length-1)+name;
const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function field(parent,label,node){const wrap=make('label');wrap.append(label,node);parent.append(wrap);return node;}

// Inserts a link that offers a file to visitors. A new file is uploaded with
// the edited page in one save; an existing file is linked like any edit.
export function openDownloadDialog({doc,at,t,path,site,request,apply,upload,notify}){
 const modal=make('dialog');modal.className='website-author-dialog website-download-dialog';
 const heading=make('h2',t('downloadBlock'));heading.id='website-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',heading.id);
 const form=make('form'),status=make('p');status.setAttribute('role','status');
 const help=make('p',t('downloadPrivacy'));
 const fresh=make('fieldset'),freshLegend=make('legend',t('downloadNew'));fresh.append(freshLegend);
 const file=field(fresh,t('downloadFile'),make('input'));file.type='file';
 const label=field(form,t('downloadLabel'),make('input'));label.required=true;label.maxLength=200;
 const existing=make('fieldset'),existingLegend=make('legend',t('downloadExisting'));existing.append(existingLegend);existing.hidden=true;
 const list=make('ul');list.className='website-download-list';existing.append(list);
 const submit=make('button',t('downloadInsert'));submit.type='submit';submit.className='button primary';
 const cancel=make('button',t('cancel'));cancel.type='button';cancel.className='button';cancel.onclick=()=>modal.close();
 const actions=make('div');actions.className='inline-actions';actions.append(submit,cancel);
 form.prepend(help,fresh,existing);form.append(status,actions);modal.append(heading,form);
 let items=[],chosen=null,busy=false;
 const stem=name=>name.replace(/^.*\//,'').replace(/\.[^.]+$/,'');
 file.onchange=()=>{if(file.files?.[0]){chosen=null;for(const radio of list.querySelectorAll('input'))radio.checked=false;if(!label.value.trim())label.value=stem(file.files[0].name);}};
 function paint(){
  list.replaceChildren(...items.map(item=>{
   const row=make('li'),choice=make('label'),radio=make('input');radio.type='radio';radio.name='website-download';radio.value=item.name;radio.checked=chosen===item.name;
   radio.onchange=()=>{chosen=item.name;file.value='';if(!label.value.trim())label.value=stem(item.name);};
   const kind=downloadKind(item.name),meta=make('small',[kind,downloadSize(item.size),t(item.published?'downloadPublished':item.used?'downloadDraftOnly':'downloadUnused')].filter(Boolean).join(' · '));
   choice.append(radio,' ',item.name.replace(/^downloads\//,''),' ',meta);row.append(choice);
   if(!item.used){
    const remove=make('button',t('downloadRemove'));remove.type='button';remove.className='button';
    remove.onclick=async()=>{if(busy)return;busy=true;try{await request('downloads/remove',{siteId:site.id,expectedRevision:site.revision,name:item.name});modal.close();notify(t('downloadRemoved'));}catch(error){status.textContent=error.message;}finally{busy=false;}};
    row.append(remove);
   }
   return row;
  }));
  existing.hidden=!items.length;
 }
 request('downloads/list',{siteId:site.id,expectedRevision:site.revision}).then(result=>{items=result.items;paint();}).catch(error=>{status.textContent=error.message;});
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const text=label.value.trim(),selected=file.files?.[0]??null;
  if(!text){label.reportValidity();return;}
  if(!selected&&!chosen){status.textContent=t('downloadChoose');return;}
  const name=selected?'downloads/'+pendingDownloadName:chosen,size=selected?selected.size:items.find(item=>item.name===chosen)?.size;
  const paragraph=doc.createElement('p'),link=doc.createElement('a'),meta=doc.createElement('span');
  paragraph.className='website-download';link.setAttribute('href',relative(path,name));link.setAttribute('download','');link.textContent=text;
  meta.className='website-download-meta';meta.textContent=' ('+[downloadKind(selected?selected.name:chosen),downloadSize(size)].filter(Boolean).join(', ')+')';
  paragraph.append(link,meta);
  if(at&&at.parentElement&&!at.closest('header,nav,footer,[data-observanda-source],[data-observanda-link]'))at.after(paragraph);else (doc.querySelector('main:not([hidden])')??doc.body).append(paragraph);
  if(!selected){modal.close();apply(doc);return;}
  busy=true;submit.disabled=true;status.textContent=t('downloadUploading');
  try{await upload(doc,selected);modal.close();}
  catch(error){paragraph.remove();status.textContent=error.message;}
  finally{busy=false;submit.disabled=false;}
 };
 modal.addEventListener('close',()=>modal.remove(),{once:true});document.body.append(modal);modal.showModal();file.focus();
}
