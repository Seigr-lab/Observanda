import messages from './locales/en/compositionControls.json' with {type:'json'};
const failure=key=>Object.assign(new Error(messages[key]),{compositionMessage:key});
// A normalized, ordered tree: stable element IDs survive moves, undo and reuse.
// Parent links describe layout; the array orders siblings. Research stays separate.
export const MAX_ELEMENTS=200, MAX_DEPTH=6;
export const acceptsChildren=element=>['container','disclosure','popup'].includes(element?.kind);
export const childrenOf=(elements,parentId=null)=>elements.filter(e=>(e.parentId??null)===parentId);
export function descendantsOf(elements,id){
  const ids=new Set([id]);let changed=true;
  while(changed){changed=false;for(const e of elements)if(ids.has(e.parentId)&&!ids.has(e.id)){ids.add(e.id);changed=true;}}
  return ids;
}
export function validTree(elements){
  if(!Array.isArray(elements)||elements.length>MAX_ELEMENTS)return false;
  const byId=new Map(elements.map(e=>[e?.id,e]));
  if(byId.size!==elements.length)return false;
  return elements.every(e=>{
    const seen=new Set([e?.id]);let parent=e?.parentId,depth=0;
    while(parent!==undefined&&parent!==null){
      const node=byId.get(parent);
      if(!acceptsChildren(node)||seen.has(parent)||++depth>MAX_DEPTH)return false;
      seen.add(parent);parent=node.parentId;
    }
    return true;
  });
}
export function moveElement(elements,id,parentId=null,beforeId=null){
  if(!elements.some(e=>e.id===id))throw failure('missing');
  if(parentId!==null&&!elements.some(e=>e.id===parentId&&acceptsChildren(e)))throw failure('container');
  const branch=descendantsOf(elements,id);
  if(branch.has(parentId))throw failure('insideSelf');
  if(beforeId===id)return elements;
  const sibling=elements.find(e=>e.id===beforeId);
  if(beforeId!==null&&(!sibling||(sibling.parentId??null)!==parentId))throw failure('destinationChanged');
  const moving=elements.filter(e=>branch.has(e.id)).map(e=>e.id===id?{...e,parentId}:e);
  const next=elements.filter(e=>!branch.has(e.id));
  let index=beforeId===null?next.length:next.findIndex(e=>e.id===beforeId);
  next.splice(index,0,...moving);
  if(!validTree(next))throw failure('nestingDepth');
  return next;
}
export function insertElement(elements,element,parentId=null,beforeId=null){
  if(elements.length>=MAX_ELEMENTS)throw failure('elementLimit');
  if(elements.some(e=>e.id===element.id))throw failure('uniqueIds');
  return moveElement([...elements,{...element,parentId:null}],element.id,parentId,beforeId);
}
export function cloneElements(elements,makeId){
  const copies=structuredClone(elements).map(e=>({...e,id:makeId()}));
  const ids=new Map(elements.flatMap((e,i)=>e.id?[[e.id,copies[i].id]]:[]));
  return copies.map(e=>({...e,...(e.parentId?{parentId:ids.get(e.parentId)??e.parentId}:{})}));
}
export function treeOrder(elements,parentId=null,depth=0){
  return childrenOf(elements,parentId).flatMap(e=>[{element:e,depth},...treeOrder(elements,e.id,depth+1)]);
}
export const ELEMENTS=[
  {kind:'container',name:messages['element_container'],symbol:'&#9638;',group:messages['group_Layout']},
  {kind:'popup',name:messages['element_popup'],symbol:'&#9633;',group:messages['group_Layout']},
  {kind:'copy-text',name:messages['element_copy-text'],symbol:'&#10697;',group:messages['group_Content']},
  {kind:'disclosure',name:messages['element_disclosure'],symbol:'&#9662;',group:messages['group_Layout']},
  {kind:'heading',name:messages['element_heading'],symbol:'H',group:messages['group_Content']},
  {kind:'text',name:messages['element_text'],symbol:'&#182;',group:messages['group_Content']},
  {kind:'asset',name:messages['element_asset'],symbol:'&#9639;',group:messages['group_Content']},
  {kind:'link',name:messages['element_link'],symbol:'&#8599;',group:messages['group_Content']},
  {kind:'download',name:messages['element_download'],symbol:'&#8595;',group:messages['group_Content']},
  {kind:'gallery',name:messages['element_gallery'],symbol:'&#9636;',group:messages['group_Content']},
  {kind:'hero',name:messages['element_hero'],symbol:'&#9637;',group:messages['group_Content']},
  {kind:'callout',name:messages['element_callout'],symbol:'&#8220;',group:messages['group_Content']},
  {kind:'contents',name:messages['element_contents'],symbol:'&#9776;',group:messages['group_Layout']},
  {kind:'divider',name:messages['element_divider'],symbol:'&mdash;',group:messages['group_Layout']},
  {kind:'projects',name:messages['element_projects'],symbol:'&#9635;',group:messages['group_Research']},
  {kind:'records',name:messages['element_records'],symbol:'&#9636;',group:messages['group_Research']},
  {kind:'pages',name:messages['element_pages'],symbol:'&#9649;',group:messages['group_Research']},
  {kind:'media',name:messages['element_media'],symbol:'&#9639;',group:messages['group_Research']}
];
export function newElement(kind,makeId=()=>crypto.randomUUID()){
  if(!ELEMENTS.some(e=>e.kind===kind))throw failure('unknown');
  const e={id:makeId(),kind,title:'',show:true};
  if(kind==='container')Object.assign(e,{layout:'row',columns:2,gap:24});
  else if(kind==='popup')Object.assign(e,{label:'',dialogWidth:640});
  else if(kind==='copy-text')Object.assign(e,{value:'',body:'',label:''});
  else if(kind==='disclosure')Object.assign(e,{open:false});
  else if(kind==='heading')Object.assign(e,{title:'Your heading',level:2});
  else if(kind==='hero')Object.assign(e,{body:'',assetId:null,href:'home',label:'',format:'markdown'});
  else if(kind==='gallery')Object.assign(e,{assetIds:[],columns:3});
  else if(['text','callout'].includes(kind))e.body='';
  else if(kind==='link')Object.assign(e,{href:'home',label:'Read more',body:'',action:{appearance:'link',arrow:false}});
  else if(kind==='download')Object.assign(e,{assetId:null,label:'',body:'',action:{appearance:'link',arrow:false}});
  else if(kind==='asset')e.assetId=null;
  else if(['projects','records','pages'].includes(kind))Object.assign(e,{title:kind[0].toUpperCase()+kind.slice(1),layout:'inherit'});
  return e;
}
