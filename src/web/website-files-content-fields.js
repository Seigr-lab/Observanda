// The selected section's texts as labelled fields in the inspector's Content tab. A plain
// text is typed straight into its field and the page follows; a text with formatting or
// links inside it is edited in the page, with the cursor placed visibly in it. The text a
// field belongs to is outlined in the page while the field is in use.
const formatting=new Set(['b','strong','i','em','u','s','sub','sup','code','mark','small','abbr','br','wbr']);
const kinds={h1:'heading',h2:'heading',h3:'heading',h4:'heading',h5:'heading',h6:'heading',p:'paragraph',li:'listItem',blockquote:'quotation',figcaption:'caption',td:'cell',th:'cell',dt:'term',dd:'definition',summary:'summary',a:'link',button:'button'};
const LIMIT=40;

export function websiteContentFields({document,host,t,make,listen,writable,beforeChange,change,point,placeCaret}){
 const list=make('div');list.className='website-content-fields';host.prepend(list);
 let section=null,fields=[],editing=null;
 // A text's owner is the nearest element that is not inline formatting.
 function owners(node){
  const found=[],walker=document.createTreeWalker(node,4);
  for(let text=walker.nextNode();text&&found.length<=LIMIT;text=walker.nextNode()){
   if(!text.data.trim()||!writable(text.parentElement))continue;
   let owner=text.parentElement;while(formatting.has(owner.localName)&&owner!==node&&owner.parentElement)owner=owner.parentElement;
   if(!found.includes(owner))found.push(owner);
  }
  return found;
 }
 const plain=owner=>![...owner.children].some(child=>child.localName!=='br');
 function label(owner){return t('contentField_'+(kinds[owner.localName]??'text'));}
 function render(){
  list.replaceChildren();fields=[];
  if(!section?.isConnected)return;
  const found=owners(section);
  if(!found.length){list.append(make('p',t('contentFieldsNone')));return;}
  list.append(make('p',t('contentFieldsHelp')));
  for(const owner of found.slice(0,LIMIT)){
   const row=make('div');row.className='website-content-field';
   const name=make('label',label(owner));
   if(plain(owner)){
    const input=make('textarea');input.rows=Math.min(6,Math.max(1,Math.ceil(owner.textContent.length/48)));input.value=owner.textContent;
    name.append(input);row.append(name);
    listen(input,'focus',()=>{editing=owner;point(owner);});
    listen(input,'blur',()=>{if(editing===owner){editing=null;point(null);}});
    let started=false;
    listen(input,'input',()=>{if(!owner.isConnected)return;if(!started){beforeChange();started=true;}owner.textContent=input.value;change();point(owner);});
    listen(input,'change',()=>{started=false;});
    fields.push({owner,input});
   }else{
    const preview=make('span',owner.textContent.trim().slice(0,120));preview.className='website-content-preview';
    const edit=make('button',t('contentFieldEditInPage'));edit.type='button';edit.className='button';
    listen(edit,'click',()=>placeCaret(owner));listen(edit,'focus',()=>point(owner));listen(edit,'blur',()=>point(null));
    row.append(name,preview,edit);
   }
   list.append(row);
  }
  if(found.length>LIMIT)list.append(make('p',t('contentFieldsMore')));
 }
 // Text typed in the page shows in its field, except in the field being typed into.
 function sync(){for(const {owner,input} of fields)if(owner.isConnected&&owner!==editing&&input.value!==owner.textContent)input.value=owner.textContent;}
 listen(document,'input',sync);
 return {
  select(node){if(node===section){sync();return;}section=node;render();},
  focusFirst(){const first=list.querySelector('textarea,button');first?.focus();return Boolean(first);},
 };
}
