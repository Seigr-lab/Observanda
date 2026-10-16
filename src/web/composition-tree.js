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
  if(!elements.some(e=>e.id===id))throw new Error('This element no longer exists.');
  if(parentId!==null&&!elements.some(e=>e.id===parentId&&acceptsChildren(e)))throw new Error('Choose a container or the page.');
  const branch=descendantsOf(elements,id);
  if(branch.has(parentId))throw new Error('An element cannot be placed inside itself.');
  if(beforeId===id)return elements;
  const sibling=elements.find(e=>e.id===beforeId);
  if(beforeId!==null&&(!sibling||(sibling.parentId??null)!==parentId))throw new Error('The destination has changed.');
  const moving=elements.filter(e=>branch.has(e.id)).map(e=>e.id===id?{...e,parentId}:e);
  const next=elements.filter(e=>!branch.has(e.id));
  let index=beforeId===null?next.length:next.findIndex(e=>e.id===beforeId);
  next.splice(index,0,...moving);
  if(!validTree(next))throw new Error('This move would exceed the supported nesting depth.');
  return next;
}
export function insertElement(elements,element,parentId=null,beforeId=null){
  if(elements.length>=MAX_ELEMENTS)throw new Error('This page has reached its element limit.');
  if(elements.some(e=>e.id===element.id))throw new Error('Element IDs must be unique.');
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
  {kind:'container',name:'Container',symbol:'&#9638;',group:'Layout'},
  {kind:'popup',name:'Popup',symbol:'&#9633;',group:'Layout'},
  {kind:'copy-text',name:'Copyable text',symbol:'&#10697;',group:'Content'},
  {kind:'disclosure',name:'Expandable section',symbol:'&#9662;',group:'Layout'},
  {kind:'heading',name:'Heading',symbol:'H',group:'Content'},
  {kind:'text',name:'Text',symbol:'&#182;',group:'Content'},
  {kind:'asset',name:'Image / media',symbol:'&#9639;',group:'Content'},
  {kind:'link',name:'Button / link',symbol:'&#8599;',group:'Content'},
  {kind:'download',name:'File download',symbol:'&#8595;',group:'Content'},
  {kind:'gallery',name:'Gallery',symbol:'&#9636;',group:'Content'},
  {kind:'hero',name:'Introduction',symbol:'&#9637;',group:'Content'},
  {kind:'callout',name:'Callout',symbol:'&#8220;',group:'Content'},
  {kind:'contents',name:'Page contents',symbol:'&#9776;',group:'Layout'},
  {kind:'divider',name:'Divider',symbol:'&mdash;',group:'Layout'},
  {kind:'projects',name:'Projects',symbol:'&#9635;',group:'Research'},
  {kind:'records',name:'Records',symbol:'&#9636;',group:'Research'},
  {kind:'pages',name:'Pages',symbol:'&#9649;',group:'Research'},
  {kind:'media',name:'Research media',symbol:'&#9639;',group:'Research'}
];
export function newElement(kind,makeId=()=>crypto.randomUUID()){
  if(!ELEMENTS.some(e=>e.kind===kind))throw new Error('Unknown element.');
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
