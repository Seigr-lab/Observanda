import {materialSourcePicker} from './material-source-picker.js';
import {coordinateFrameText} from './coordinate-frame-ui.js';
import {coordinateFrameContextText} from './coordinate-frame-context.js';
import {validCoordinateFrame,validCoordinateFrameDescriptor} from './coordinate-frame-model.js';
import {knownDomain,domainCodec} from './measurement-domain-model.js';

const vector=column=>column?.representation==='domain'&&knownDomain(column.domain)&&domainCodec(column.domain)==='vector';
export function coordinateFrameColumnControls(column,{esc,text=coordinateFrameText,index=0}={}){
 const descriptor=column.coordinateFrame,locked=Boolean(descriptor?.transform);
 if(!descriptor&&!vector(column))return '';
 const summary=descriptor?coordinateFrameContextText({namespace:column.domain.namespace,dimension:column.domain.shape[0],unit:column.unit,...(locked?{method:'affine-frame-transform-v1'}:{})},{text}):text('frameUnassigned');
 return '<details data-coordinate-column-frame data-index="'+index+'"'+(locked?' data-fixed="true"':'')+'><summary>'+esc(text('columnFrame'))+'</summary><input type="hidden" data-coordinate-frame-value value="'+esc(descriptor?JSON.stringify(descriptor):'')+'"><p data-coordinate-frame-summary>'+esc(summary+(descriptor?' '+text('revision',{revision:descriptor.frame.revision}):''))+'</p>'+'<p>'+esc(text(locked?'frameResultFixed':'frameAssignmentHelp'))+'</p>'+(locked?'':'<div data-coordinate-frame-picker><input type="hidden" data-value value=""></div><div class="inline-actions"><button type="button" class="button" data-action="material-coordinate-frame-column-choose">'+esc(text('useFrame'))+'</button><button type="button" class="button" data-action="material-coordinate-frame-column-remove">'+esc(text('removeFrame'))+'</button></div>')+'<p data-coordinate-frame-status role="status"></p></details>';
}
export function readColumnCoordinateFrame(node,{validate=false}={}){
 const field=node.querySelector('[data-coordinate-frame-value]');if(!field?.value)return undefined;
 const value=JSON.parse(field.value);if(validate&&!validCoordinateFrameDescriptor(value))throw Error(coordinateFrameText('invalidFrame'));return value;
}
// One bounded saved-frame selector per visible schema column. No axis list is
// fetched merely to assign its pinned declaration to an authored vector.
export function wireCoordinateFrameColumns(root,{call,esc,field,guard,recordId,available=()=>true,text=coordinateFrameText}){
 const states=new Map();let disposed=false;
 for(const host of root.querySelectorAll('[data-coordinate-column-frame]')){
  if(host.dataset.fixed==='true'){const column=host.closest('[data-material-column]');if(column){for(const key of ['representation','radix','unit'])column.querySelector('[data-schema="'+key+'"]').disabled=true;for(const region of [column.querySelector('[data-domain-controls]'),column.querySelector('[data-provenance="origin"]')?.closest('details')])for(const control of region?.querySelectorAll('input,select,textarea,button')??[])control.disabled=true;}continue;}
  const state={host,busy:false,controller:null,picker:null};states.set(host,state);
  state.picker=materialSourcePicker({root:host.querySelector('[data-coordinate-frame-picker]'),call:(name,value,options)=>call(name,value,{...options,adopt:false,adoptOwner:false}),esc,field,guard,recordId,kind:'analysis',optional:true,id:'column-coordinate-frame-'+host.dataset.index,label:text('columnFrame')});
 }
 function check(state){guard();if(disposed||!root.isConnected||!state.host.isConnected)throw new DOMException('Coordinate frame binding changed','AbortError');}
 async function action(act,control){
  if(!['coordinate-frame-column-choose','coordinate-frame-column-remove'].includes(act))return false;
  const state=states.get(control.closest('[data-coordinate-column-frame]'));if(!state||state.busy||!available())return true;check(state);
  const value=state.host.querySelector('[data-coordinate-frame-value]'),summary=state.host.querySelector('[data-coordinate-frame-summary]'),status=state.host.querySelector('[data-coordinate-frame-status]');
  if(act==='coordinate-frame-column-remove'){value.value='';summary.textContent=text('frameUnassigned');status.textContent='';return true;}
  const selected=state.picker.values()[0];if(!selected)throw Error(text('chooseFrames'));state.busy=true;state.controller=new AbortController();state.host.setAttribute('aria-busy','true');status.textContent=text('busy');
  const buttons=[...state.host.querySelectorAll('[data-action]')].map(node=>({node,disabled:node.disabled}));for(const {node}of buttons)node.disabled=true;
  try{const result=await call('coordinate-frame-page',{ref:selected,offset:0,limit:1},{signal:state.controller.signal,adopt:false,adoptOwner:false});check(state);if(!validCoordinateFrame(result.frame))throw Error(text('invalidFrame'));value.value=JSON.stringify({version:1,frame:result.ref});summary.textContent=coordinateFrameContextText({namespace:result.frame.namespace,dimension:result.frame.dimension,unit:result.frame.unit},{text})+' '+text('revision',{revision:result.ref.revision});status.textContent='';}
  finally{state.busy=false;if(!disposed&&state.host.isConnected){state.host.setAttribute('aria-busy','false');for(const {node,disabled}of buttons)node.disabled=disabled;status.textContent='';}}
  return true;
 }
 const dispose=()=>{disposed=true;for(const state of states.values()){state.controller?.abort();state.picker.dispose();}states.clear();};
 dispose.action=action;dispose.ready=async()=>{guard();if([...states.values()].some(state=>state.busy))throw Error(text('waitFrame'));};return dispose;
}
