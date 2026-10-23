import {t} from './i18n/index.js';
import {datasetResourcePolicyControls,readDatasetResourcePolicy,datasetResourcePolicyDescription} from './dataset-resource-policy-ui.js';
import {scalarTextReference} from './measurement-scalar-policy.js';
const text=(key,values)=>t('measurements',key,values);
const ownPolicy=(root,kind)=>[...root.querySelectorAll('[data-scalar-policy-for]')].find(node=>node.dataset.scalarPolicyFor===kind&&node.closest('[data-scalar-policy-owner]')===root);
const abort=()=>new DOMException('Scalar selection changed','AbortError');
export function scalarPolicyControls(policy,{esc,field,kind,allowed=true}){
 if(!allowed&&!policy)return '';return '<details data-scalar-policy-for="'+kind+'"><summary>'+esc(text('scalarPolicy'))+'</summary><label><input type="checkbox" data-scalar-policy-enabled'+(policy?' checked':'')+'> '+esc(text('scalarPolicyEnable'))+'</label><fieldset data-scalar-policy-values'+(policy?'':' hidden disabled')+'>'+datasetResourcePolicyControls(policy,{esc,field,help:text('scalarPolicyHelp'),legacy:'',footer:''})+'</fieldset></details>';
}
export function readScalarPolicy(root,kind,{validate=false}={}){const node=ownPolicy(root,kind);return node?.querySelector('[data-scalar-policy-enabled]').checked?readDatasetResourcePolicy(node,{validate}):undefined;}
export function selectedScalarPolicy(control,{validate=true}={}){const root=control.closest('[data-scalar-policy-owner]');return root?readScalarPolicy(root,root.dataset.scalarPolicyOwner,{validate}):undefined;}
export function scalarPolicyDescription(policy,{esc}){return datasetResourcePolicyDescription(policy,{esc,title:text('scalarPolicy')});}
export function wireScalarPolicies(root,kind){
 const controller=new AbortController(),refresh=node=>{const enabled=node.querySelector('[data-scalar-policy-enabled]').checked,values=node.querySelector('[data-scalar-policy-values]');values.hidden=!enabled;values.disabled=!enabled;const owner=node.closest('[data-scalar-policy-owner]');for(const input of owner.querySelectorAll('[data-scalar-input]'))if(input.closest('[data-scalar-policy-owner]')===owner)input.maxLength=enabled?65536:8192;};
 root.addEventListener('change',event=>{const node=event.target.closest('[data-scalar-policy-for]');if(node?.dataset.scalarPolicyFor===kind&&event.target.matches('[data-scalar-policy-enabled]'))refresh(node);},{signal:controller.signal});
 for(const node of root.querySelectorAll('[data-scalar-policy-for]'))if(node.dataset.scalarPolicyFor===kind)refresh(node);return ()=>controller.abort();
}
export function scalarSpellingInput(value,{esc,field,attributes='',resourcePolicy}){
 const retained=scalarTextReference(value);if(typeof value!=='string'&&!retained)throw TypeError('Invalid retained scalar text');
 return '<span data-scalar-field data-scalar-path="'+esc(field)+'"'+(retained?' data-scalar-reference="'+esc(JSON.stringify(value))+'"':'')+'><input '+attributes+' data-scalar-input maxlength="'+(resourcePolicy?65536:8192)+'" spellcheck="false" value="'+esc(retained?'':value)+'"'+(retained?' readonly':'')+'>'+(retained?'<span data-scalar-summary>'+esc(text('scalarRetained',{count:value.characters}))+'</span><button type="button" class="button" data-scalar-edit>'+esc(text('scalarEdit'))+'</button><button type="button" class="button" data-scalar-cancel hidden>'+esc(text('scalarCancel'))+'</button>':'')+'<span data-scalar-status role="status"></span></span>';
}
export function readScalarSpelling(input,{validate=false}={}){const node=input.closest('[data-scalar-field]'),value=node?.dataset.scalarReference?JSON.parse(node.dataset.scalarReference):input.value;if(validate){const policy=selectedScalarPolicy(input),length=typeof value==='string'?value.length:value.characters;if(length>(policy?.resources.maxScalarCharacters??8192))throw Error(text('scalarLimit'));}return value;}
export function scalarSpellingView(value,{esc,field,component}){
 if(typeof value==='string')return esc(value);if(!scalarTextReference(value))throw TypeError('Invalid retained scalar text');
 return '<span data-scalar-field '+(component===undefined?'data-scalar-path="'+esc(field)+'"':'data-scalar-component="'+component+'"')+' data-scalar-reference="'+esc(JSON.stringify(value))+'"><span>'+esc(text('scalarRetained',{count:value.characters}))+'</span> <button type="button" class="button" data-scalar-view>'+esc(text('scalarView'))+'</button><span data-scalar-status role="status"></span><span data-scalar-page></span></span>';
}
// Reads resolve a whitelisted field under an authenticated pinned material, never
// a client-supplied block root. Only an explicitly selected edit is hydrated.
export function wireScalarFields(root,{call,reference,guard=()=>{},available=()=>true,esc}={}){
 let active=true;const controller=new AbortController(),requests=new Map();
 const current=node=>active&&root.isConnected&&node.isConnected&&root.contains(node)&&available(node)&&!node.closest('[inert],fieldset:disabled')&&!node.querySelector('[data-scalar-input]:disabled')&&(!root.closest('dialog')||root.closest('dialog').open);
 const identity=node=>JSON.stringify([reference?.(node),node.dataset.scalarPath,node.dataset.scalarComponent,node.dataset.scalarReference,selectedScalarPolicy(node,{validate:false})]);
 function status(node,message,error=false){if(!current(node))return;const output=node.querySelector('[data-scalar-status]');if(output){output.textContent=message;output.setAttribute('role',error?'alert':'status');}}
 async function read(node,{edit=false,offset=0}={}){
  if(!current(node)||typeof call!=='function'||typeof reference!=='function')return;guard();requests.get(node)?.controller.abort();
  const descriptor=JSON.parse(node.dataset.scalarReference),context=structuredClone(reference(node)),stamp=identity(node),request={controller:new AbortController(),promise:null},input=node.querySelector('[data-scalar-input]'),wasReadonly=input?.readOnly;
  if(!scalarTextReference(descriptor)||!context?.ref)throw Error(text('scalarUnavailable'));
  if(edit){const policy=selectedScalarPolicy(node);if(descriptor.characters>(policy?.resources.maxScalarCharacters??8192))throw Error(text('scalarLimit'));}
  requests.set(node,request);const check=()=>{guard();request.controller.signal.throwIfAborted();if(!current(node)||requests.get(node)!==request||identity(node)!==stamp)throw abort();};
  const buttons=[...node.querySelectorAll('[data-scalar-edit],[data-scalar-view],[data-scalar-offset]')];for(const button of buttons)button.disabled=true;if(input)input.readOnly=true;const cancel=node.querySelector('[data-scalar-cancel]');if(cancel)cancel.hidden=false;
  status(node,text('scalarLoading'));
  request.promise=(async()=>{try{
   let at=offset,joined='';do{check();const result=await call(node.dataset.scalarComponent===undefined?'measurement-scalar':'measurement-component',{...context,...(node.dataset.scalarComponent===undefined?{field:node.dataset.scalarPath}:{component:Number(node.dataset.scalarComponent)}),offset:at,limit:edit?16384:4096},{signal:request.controller.signal});check();
    const end=at+result.text?.length;if(typeof result.text!=='string'||result.offset!==at||result.total!==descriptor.characters||end>result.total||result.next!==(end<result.total?end:null)||end===at&&end<result.total)throw Error(text('scalarUnavailable'));
    if(edit)joined+=result.text;else{node.querySelector('[data-scalar-page]').innerHTML='<pre>'+esc(result.text)+'</pre><span>'+esc(text('scalarRange',{first:at+1,last:end,total:result.total}))+'</span>'+[at?Math.max(0,at-4096):null,result.next].map((value,index)=>value===null?'':'<button type="button" class="button" data-scalar-offset="'+value+'">'+esc(text(index?'nextValue':'previousValue'))+'</button>').join('');break;}at=result.next;
   }while(at!==null);
   check();if(edit){input.value=joined;input.readOnly=false;delete node.dataset.scalarReference;node.querySelector('[data-scalar-edit]')?.remove();node.querySelector('[data-scalar-summary]')?.remove();for(const name of ['input','change'])input.dispatchEvent(new root.ownerDocument.defaultView.Event(name,{bubbles:true}));}status(node,edit?text('scalarLoaded'):'');
  }catch(error){if(error.name!=='AbortError')status(node,error.message,true);else if(!request.controller.signal.aborted)status(node,text('scalarChanged'),true);throw error;}
  finally{if(requests.get(node)===request){requests.delete(node);if(input&&node.dataset.scalarReference)input.readOnly=wasReadonly;for(const button of buttons)if(button.isConnected)button.disabled=false;if(cancel)cancel.hidden=true;}}})();
  return request.promise;
 }
 root.addEventListener('click',event=>{const control=event.target.closest('[data-scalar-edit],[data-scalar-view],[data-scalar-offset],[data-scalar-cancel]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();const node=control.closest('[data-scalar-field]');if(!node||!current(node))return;if(control.hasAttribute('data-scalar-cancel')){requests.get(node)?.controller.abort();status(node,text('scalarCancelled'));return;}void read(node,{edit:control.hasAttribute('data-scalar-edit'),offset:Number(control.dataset.scalarOffset??0)}).catch(error=>{if(error.name!=='AbortError')status(node,error.message,true);});},{signal:controller.signal});
 const dispose=()=>{active=false;controller.abort();for(const request of requests.values())request.controller.abort();requests.clear();};dispose.ready=()=>Promise.all([...requests.values()].map(value=>value.promise));return dispose;
}
