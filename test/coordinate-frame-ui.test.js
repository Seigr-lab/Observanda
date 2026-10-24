import {datasetCalculationGraphUI} from '../src/web/dataset-calculation-graph-ui.js';
import {CoordinateFrameError} from '../src/web/coordinate-frame-model.js';
import {safeError} from '../src/errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {coordinateFrameUI,coordinateFrameCellEligible} from '../src/web/coordinate-frame-ui.js';
import {coordinateTransformControls,readCoordinateTransform} from '../src/web/coordinate-frame-graph-ui.js';
import {coordinateFrameColumnControls,readColumnCoordinateFrame,wireCoordinateFrameColumns} from '../src/web/coordinate-frame-column-ui.js';
import messages from '../src/web/locales/en/coordinateFrames.json' with {type:'json'};
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label class="field">'+label+input+'</label>';
const ref=()=>({kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)});
const retainedScalar=(characters=9002)=>({format:'dataset-cell',version:1,characters,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',count:1,chunkSize:16,root:{count:1,height:1,key:'c'.repeat(64),hash:'d'.repeat(64)}}});
// Parsed DOM and mocked requests only; no browser, database, or native runtime.
function harness(t){
 const old=globalThis.document,cache=new WeakMap(),raw=new WeakMap();let tree=parseFragment('');
 const attrs=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
 const descendants=node=>(node.childNodes??[]).flatMap(child=>[child,...descendants(child)]);
 const matches=(node,selector)=>selector.split(',').some(raw=>{
  let s=raw.trim(),a=attrs(node);if(s.includes(' ')){const at=s.lastIndexOf(' '),last=s.slice(at+1);if(!matches(node,last))return false;let parent=node.parentNode;while(parent){if(matches(parent,s.slice(0,at)))return true;parent=parent.parentNode;}return false;}
  for(const state of ['checked','disabled'])if(s.endsWith(':'+state)){if(!(cache.get(node)?.[state]??Object.hasOwn(a,state)))return false;s=s.slice(0,-state.length-1);}
  if(s.startsWith('#'))return a.id===s.slice(1);if(s.startsWith('.'))return (a.class??'').split(' ').includes(s.slice(1));
  const m=/^([\w-]+)?(?:\[([^=\]]+)(?:="?([^"\]]*)"?)?\])?$/.exec(s);return !!m&&(!m[1]||node.nodeName===m[1])&&(!m[2]||Object.hasOwn(a,m[2])&&(m[3]===undefined||a[m[2]]===m[3]));
 });
 function wrap(node){
  if(cache.has(node))return cache.get(node);const listeners=new Map(),a=attrs(node);let value=a.value;
  const out={get isConnected(){return node===tree||descendants(tree).includes(node);},get dataset(){const name=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());return new Proxy({},{get:(_,key)=>attrs(node)[name(key)],deleteProperty:(_,key)=>{node.attrs=(node.attrs??[]).filter(a=>a.name!==name(key));return true;}});},
   get value(){if(value!==undefined)return value;if(node.nodeName==='select'){const options=descendants(node).filter(child=>child.nodeName==='option'),selected=options.find(child=>Object.hasOwn(attrs(child),'selected'))??options[0];return selected?attrs(selected).value??'':'';}return node.nodeName==='textarea'?out.textContent:'';},set value(v){value=String(v);},
   checked:Object.hasOwn(a,'checked'),disabled:Object.hasOwn(a,'disabled'),hidden:Object.hasOwn(a,'hidden'),inert:false,readOnly:Object.hasOwn(a,'readonly'),maxLength:Number(a.maxlength??-1),ownerDocument:{defaultView:{Event:class {constructor(type,options){this.type=type;Object.assign(this,options);}}}},
   get innerHTML(){return serialize(node);},set innerHTML(html){const fragment=parseFragment(String(html));node.childNodes=fragment.childNodes;for(const child of node.childNodes)child.parentNode=node;},
   get textContent(){return descendants(node).filter(child=>child.nodeName==='#text').map(child=>child.value).join('');},set textContent(v){node.childNodes=[{nodeName:'#text',value:String(v),parentNode:node}];},
   querySelector(selector){return out.querySelectorAll(selector)[0]??null;},querySelectorAll(selector){return descendants(node).filter(child=>matches(child,selector)).map(wrap);},
   append(child){const found=raw.get(child);if(!found)throw Error('Unknown append child');if(found.parentNode)found.parentNode.childNodes=found.parentNode.childNodes.filter(n=>n!==found);found.parentNode=node;node.childNodes.push(found);},
   remove(){if(node.parentNode)node.parentNode.childNodes=node.parentNode.childNodes.filter(child=>child!==node);},replaceChildren(){node.childNodes=[];},setAttribute(name,v){node.attrs??=[];const old=node.attrs.find(attr=>attr.name===name);if(old)old.value=String(v);else node.attrs.push({name,value:String(v)});},getAttribute(name){return attrs(node)[name]??null;},hasAttribute(name){return Object.hasOwn(attrs(node),name);},toggleAttribute(name,on){if(on)out.setAttribute(name,'');else node.attrs=(node.attrs??[]).filter(attr=>attr.name!==name);},
   addEventListener(type,callback){listeners.set(type,[...(listeners.get(type)??[]),callback]);},dispatchEvent(event){for(const callback of listeners.get(event.type)??[])callback(event);},
   matches(selector){return matches(node,selector);},contains(child){return descendants(node).some(n=>cache.get(n)===child);},closest(selector){let current=node;while(current){if(matches(current,selector))return wrap(current);current=current.parentNode;}return null;}
  };cache.set(node,out);raw.set(out,node);return out;
 }
 globalThis.document={getElementById:id=>id==='dialog'?{open:true}:null,querySelector:selector=>wrap(tree).querySelector(selector),querySelectorAll:selector=>wrap(tree).querySelectorAll(selector)};
 t.after(()=>{globalThis.document=old;});
 return {frame(title,body,actions){tree=parseFragment('<h2>'+esc(title)+'</h2>'+body+(actions??''));},query:selector=>document.querySelector(selector),all:selector=>document.querySelectorAll(selector),html:()=>serialize(tree)};
}
const control=(action,data={})=>({dataset:{action,...data}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));


const text=(key,args={})=>{assert.ok(messages[key],key);return messages[key].replace(/\{(\w+)\}/g,(_,name)=>String(args[name]));};
const get=(dom,key)=>dom.query('[data-coordinate-field="'+key+'"]');
const frameRef={...ref(),kind:'analysis'},sourceRef={...ref(),kind:'analysis'},targetRef={...ref(),kind:'analysis'},dataset=ref(),matrix={ref:dataset,selector:{kind:'cell',page:0,row:0,column:0}},translation={ref:dataset,selector:{kind:'cell',page:0,row:0,column:1}};
const unit=blankUnitDefinition(),frameValue=(namespace='source')=>({version:1,namespace,dimension:2,axesIndex:{count:2},unit:'m',unitDefinition:unit,rationale:'Explicit coordinate frame.',resourcePolicy:defaultDatasetResourcePolicy()}),axis=i=>({id:randomUUID(),name:'Axis '+(i+1)}),transform={version:1,method:'affine-frame-transform-v1',sourceFrame:sourceRef,targetFrame:targetRef,matrix,offset:translation,rationale:'Declared matrix row and column order.',resourcePolicy:defaultDatasetResourcePolicy()};
function author(t,{axes=[axis(0),axis(1)],frame=frameValue(),isCurrent=true,request=async()=>undefined}={}){
 const dom=harness(t),calls=[],inspected=[],stored=structuredClone(frame),values=structuredClone(axes),savedTransforms=[];let reference=frameRef,title='Declared frame',revision=1,currentTransform=structuredClone(transform);
 const column=kind=>({name:kind,representation:'domain',domain:{...defaultDomain(kind),namespace:kind==='vector'?'target':'coefficient-space',shape:kind==='matrix'?[2,2]:[2]},unit:'m',quantity:{unitDefinition:unit},missing:[]});
 const call=async(name,data,options)=>{calls.push({name,data:structuredClone(data),options});const custom=await request(name,data,options);if(custom!==undefined)return custom;
  if(name==='coordinate-frame-create'){Object.assign(stored,structuredClone(data.frame));title=data.title;values.length=0;return {ref:reference};}
  if(name==='coordinate-frame-page'){const other=data.ref.id===sourceRef.id||data.ref.id===targetRef.id,frame=other?frameValue(data.ref.id===sourceRef.id?'source':'target'):{...structuredClone(stored),axesIndex:{count:values.length}},items=other?[axis(0),axis(1)]:values,at=data.offset??0;return {ref:other?data.ref:reference,title,recordId:dataset.id,isCurrent,frame,items:structuredClone(items.slice(at,at+16)),offset:at,total:items.length,next:at+16<items.length?at+16:null};}
  if(name==='coordinate-frame-change'){if(data.collection==='settings'){Object.assign(stored,structuredClone(data.frame));title=data.title;}else if(data.remove)values.splice(data.offset,1);else if(data.move!==undefined){const [item]=values.splice(data.offset,1);values.splice(data.move,0,item);}else values[data.offset]=structuredClone(data.item);reference={...reference,revision:String(++revision).padStart(64,'0')};return {ref:reference};}
  if(name==='coordinate-frame-transform-read')return {ref:data.ref,title:'Declared transform',recordId:dataset.id,isCurrent,transform:structuredClone(currentTransform),sourceFrame:{ref:sourceRef,frame:frameValue()},targetFrame:{ref:targetRef,frame:frameValue('target')}};
  if(name==='coordinate-frame-transform-save'){savedTransforms.push(structuredClone(data));currentTransform=structuredClone(data.transform);return {ref:{kind:'analysis',id:data.id,revision:String(++revision).padStart(64,'0')}};}
  if(name==='list')return {items:data.kind==='dataset'?[{...dataset,title:'Components'}]:[{...sourceRef,title:'Source frame'},{...targetRef,title:'Target frame'}],next:null};
  if(name==='schema')return {items:[column('matrix'),column('vector')],offset:0,total:2,next:null};
  if(name==='rows')return {page:data.page,pages:1,rows:[{order:1,cells:[{}],valueKinds:['string']},{order:2,cells:[null],valueKinds:['null']},{order:3,cells:[{}],valueKinds:['string'],excluded:'Rejected'}]};
  if(name==='measurement-inspect')return {value:{presence:'value'},row:{},domain:{definition:column(data.source.selector.column?'vector':'matrix').domain,supported:true,items:[{index:0,position:data.source.selector.column?[0]:[0,0],spelling:'1',exact:'1/1'}],offset:data.componentOffset??0,total:data.source.selector.column?2:4,next:null}};
  throw Error('Unexpected '+name);
 };
 const ui=coordinateFrameUI({call,frame:dom.frame,esc,field,guard(){},owner:()=>dataset.id,inspect:async value=>inspected.push(value),text});t.after(()=>ui.clean());return {...dom,ui,calls,values,stored,savedTransforms,inspected,act:(key,data={})=>ui.action('coordinate-frames-'+key,control(key,data)),open:()=>ui.openFrame(reference,{existing:true}),create:()=>ui.openFrame(dataset),openTransform:()=>ui.openTransform({...frameRef,id:randomUUID()},{existing:true}),createTransform:()=>ui.openTransform(dataset)};
}

test('frame settings author an explicit unit and namespace without serializing backend sequence owners',async t=>{
 const dom=author(t);await dom.create();get(dom,'title').value='New declared frame';get(dom,'namespace').value='laboratory-frame';get(dom,'dimension').value='18';get(dom,'unit').value='m';get(dom,'rationale').value='Axes are defined in their authored order.';await dom.act('apply');const command=dom.calls.find(c=>c.name==='coordinate-frame-create').data;assert.equal(command.frame.namespace,'laboratory-frame');assert.equal(command.frame.dimension,18);assert.equal(command.frame.unitDefinition.kind,'difference');assert.equal(Object.hasOwn(command.frame,'axesIndex'),false);assert.deepEqual(command.frame.resourcePolicy,defaultDatasetResourcePolicy());assert.equal(dom.query('[data-coordinate-edit]'),null);
});

test('axis pages preserve stable identities across explicit moves, edits and middle removal',async t=>{
 const axes=Array.from({length:18},(_,i)=>axis(i)),dom=author(t,{axes,frame:{...frameValue(),dimension:18}});await dom.open();assert.equal(dom.all('[data-coordinate-axis]').length,16);await dom.act('axis-page',{offset:'16'});await dom.act('move-axis',{index:'1',to:'16'});assert.equal(dom.values[16].id,axes[17].id);await dom.act('edit-axis',{index:'0'});get(dom,'axisName').value='Explicit revised axis';await dom.act('apply');assert.equal(dom.values[16].id,axes[17].id);assert.equal(dom.values[16].name,'Explicit revised axis');await dom.act('remove-axis',{index:'0'});assert.equal(dom.values.length,17);assert.equal(dom.values[16].id,axes[16].id);assert.ok(dom.calls.filter(c=>c.name==='coordinate-frame-page').every(c=>c.data.limit===16));
});

test('refused axis save preserves the draft through busy state and retry',async t=>{
 let release,refuse=true;const dom=author(t,{request:async name=>{if(name==='coordinate-frame-change'&&refuse){await new Promise(resolve=>release=resolve);refuse=false;throw Error('Frame source denied');}}});await dom.open();await dom.act('edit-axis',{index:'0'});get(dom,'axisName').value='Keep exact authored name';const pending=dom.act('apply');await settle();assert.equal(dom.query('[data-coordinate-controls]').disabled,true);await dom.act('cancel');assert.equal(get(dom,'axisName').value,'Keep exact authored name');release();await assert.rejects(pending,/Frame source denied/);assert.equal(dom.query('[data-coordinate-controls]').disabled,false);await dom.act('apply');assert.equal(dom.values[0].name,'Keep exact authored name');
});

test('transform authoring uses pinned frame choices and selected native component cells without aggregate hydration',async t=>{
 const dom=author(t);await dom.createTransform();await settle();for(const [side,index]of [['sourceFrame',1],['targetFrame',2]]){const picker=dom.query('#coordinate-'+side);picker.value=picker.querySelectorAll('option')[index].value;picker.dispatchEvent({type:'change'});await dom.act('frame-choice',{side});}get(dom,'title').value='Pinned affine transform';get(dom,'rationale').value='Authored axis mapping and translation.';
 for(const [kind,column]of [['matrix','0'],['offset','1']]){await dom.act('choose-cell',{kind});dom.query('[data-coordinate-column]').value=column;await dom.act('cell-column');assert.deepEqual(dom.all('[data-action="material-coordinate-frames-use-cell"]').map(node=>node.disabled),[false,true,true]);await dom.act('use-cell',{row:'0'});}await dom.act('apply');assert.equal(dom.savedTransforms.length,1);assert.deepEqual(dom.savedTransforms[0].transform,{...transform,rationale:'Authored axis mapping and translation.'});assert.equal(dom.calls.some(c=>c.name==='measurement-component'),false);assert.match(dom.html(),/Matrix rows follow the target frame axes/);await dom.act('inspect-cell',{source:JSON.stringify(matrix)});assert.ok(dom.query('[data-domain-components]'));
});

test('transform refusal preserves pinned operands and rationale while amendments keep model identity',async t=>{
 let refuse=true;const dom=author(t,{request:async name=>{if(name==='coordinate-frame-transform-save'&&refuse){refuse=false;throw Error('Singular matrix');}}});await dom.openTransform();const original=dom.calls[0].data.ref;await dom.act('edit-transform');get(dom,'rationale').value='Keep this rationale on exact rank refusal';await assert.rejects(dom.act('apply'),/Singular matrix/);assert.equal(get(dom,'rationale').value,'Keep this rationale on exact rank refusal');await dom.act('apply');assert.equal(dom.savedTransforms[0].id,original.id);assert.equal(dom.savedTransforms[0].expectedRevision,original.revision);assert.deepEqual(dom.savedTransforms[0].transform.matrix,matrix);assert.deepEqual(dom.savedTransforms[0].transform.offset,translation);
});

test('historical frame and transform views remain readable but cannot mutate or replace newer views after delayed reads',async t=>{
 let release;const dom=author(t,{isCurrent:false,request:async name=>{if(name==='measurement-inspect')await new Promise(resolve=>release=resolve);}});await dom.open();assert.ok(dom.query('[data-coordinate-historical]'));for(const key of ['settings','add-axis','edit-axis','remove-axis'])assert.equal(dom.query('[data-action="material-coordinate-frames-'+key+'"]'),null);const count=dom.calls.length;await dom.act('settings');assert.equal(dom.calls.length,count);await dom.openTransform();assert.equal(dom.query('[data-action="material-coordinate-frames-edit-transform"]'),null);const pending=dom.act('inspect-cell',{source:JSON.stringify(matrix)});await settle();dom.ui.clean();dom.frame('Later','<p data-later>Later</p>');release();await assert.rejects(pending,{name:'AbortError'});assert.ok(dom.query('[data-later]'));
});

const completeFrame={...frameValue(),axesIndex:{format:1,kind:'coordinate-frame-axes',count:2,chunkSize:1,root:{count:2,height:1,key:'a'.repeat(64),hash:'b'.repeat(64)}}};
function schemaBinding(t,{descriptor,request=async()=>undefined}={}){
 const dom=harness(t),calls=[],column={representation:'domain',domain:{...defaultDomain('vector'),namespace:'source',shape:[2]},unit:'m',quantity:{unitDefinition:unit},...(descriptor?{coordinateFrame:descriptor}:{})};
 dom.frame('Schema','<div data-schema-fixture>'+coordinateFrameColumnControls(column,{esc,text,index:18})+'</div>');const root=dom.query('[data-schema-fixture]');
 const binding=wireCoordinateFrameColumns(root,{call:async(name,data,options)=>{calls.push({name,data,options});const result=await request(name,data);if(result!==undefined)return result;if(name==='list')return {items:[{...sourceRef,title:'Pinned source frame'}],next:null};if(name==='coordinate-frame-page')return {ref:sourceRef,frame:completeFrame,items:[axis(0)],offset:0,total:2,next:1};throw Error(name);},esc,field,guard(){},recordId:dataset.id,text});t.after(binding);
 return {...dom,binding,calls,column,root,async choose(){const select=dom.query('#column-coordinate-frame-18');select.value=select.querySelectorAll('option')[1].value;select.dispatchEvent({type:'change'});return binding.action('coordinate-frame-column-choose',dom.query('[data-action="material-coordinate-frame-column-choose"]'));}};
}

test('raw vector schema frame assignment pins a selected complete declaration without changing retained coordinates',async t=>{
 const dom=schemaBinding(t);await settle();const original=structuredClone(dom.column);await dom.choose();assert.deepEqual(readColumnCoordinateFrame(dom.root,{validate:true}),{version:1,frame:sourceRef});assert.deepEqual(dom.column,original);const selected=dom.calls.find(c=>c.name==='coordinate-frame-page');assert.equal(selected.data.limit,1);assert.equal(selected.options.adoptOwner,false);assert.match(dom.query('[data-coordinate-frame-summary]').textContent,/Declared frame namespace source/);await dom.binding.action('coordinate-frame-column-remove',dom.query('[data-action="material-coordinate-frame-column-remove"]'));assert.equal(readColumnCoordinateFrame(dom.root),undefined);assert.match(dom.query('[data-coordinate-frame-summary]').textContent,/No coordinate frame assigned/);
});

test('denied frame selection preserves the original pinned assignment and can be retried',async t=>{
 let refuse=true;const original={version:1,frame:targetRef},dom=schemaBinding(t,{descriptor:original,request:async name=>{if(name==='coordinate-frame-page'&&refuse){refuse=false;throw Error('Frame authorization refused');}}});await settle();await assert.rejects(dom.choose(),/Frame authorization refused/);assert.deepEqual(readColumnCoordinateFrame(dom.root),original);assert.equal(dom.query('[data-action="material-coordinate-frame-column-choose"]').disabled,false);await dom.choose();assert.deepEqual(readColumnCoordinateFrame(dom.root),{version:1,frame:sourceRef});
});

test('transformed schema frame provenance stays read-only while late source authorization cannot update a disposed schema',async t=>{
 const fixed={version:1,frame:targetRef,sourceFrame:sourceRef,transform:frameRef},locked=schemaBinding(t,{descriptor:fixed});assert.equal(locked.query('[data-coordinate-frame-picker]'),null);assert.deepEqual(readColumnCoordinateFrame(locked.root,{validate:true}),fixed);assert.match(locked.html(),/Renaming the column preserves/);locked.binding();
 let release;const dom=schemaBinding(t,{descriptor:{version:1,frame:targetRef},request:async name=>{if(name==='coordinate-frame-page')await new Promise(resolve=>release=resolve);}});await settle();const pending=dom.choose();await settle();await assert.rejects(dom.binding.ready(),/Wait for the selected frame/);dom.binding();release();await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(readColumnCoordinateFrame(dom.root),{version:1,frame:targetRef});
});

test('graph coordinate transform uses an explicit earlier vector and pinned model with no inferred axes',t=>{
 const dom=harness(t),node={id:randomUUID(),kind:'coordinate-transform',left:null,model:null},left={id:randomUUID(),position:0};
 dom.frame('Transform',coordinateTransformControls(node,{esc,text,address:(key,label)=>field(label,'<input data-graph-field="'+key+'" value="">')}));assert.match(dom.html(),/exact source frame revision/);const root={querySelector:dom.query},input=dom.query('[data-graph-field="left"]');assert.throws(()=>readCoordinateTransform(root,node,1,frameRef,{text}),/earlier native vector/);input.value=JSON.stringify(left);assert.throws(()=>readCoordinateTransform(root,node,1,dataset,{text}),/saved affine coordinate transform/);assert.deepEqual(readCoordinateTransform(root,node,1,frameRef,{text}),{...node,left,model:frameRef});input.value=JSON.stringify({...left,position:1});assert.throws(()=>readCoordinateTransform(root,node,1,frameRef,{text}),/earlier native vector/);
});

test('selected long frame unit scalars finish authenticated paging before a settings amendment captures them',async t=>{
 const full='0'.repeat(9000)+'1',policy=defaultDatasetResourcePolicy();policy.resources.maxScalarCharacters=20000;const frame={...frameValue(),unitDefinition:{...unit,version:2,resourcePolicy:policy,scale:{...unit.scale,spelling:retainedScalar(full.length)}}};let release;
 const dom=author(t,{frame,request:async(name,data)=>{if(name==='coordinate-frame-scalar'){if(data.offset===0)await new Promise(resolve=>release=resolve);const end=Math.min(full.length,data.offset+data.limit);return {offset:data.offset,total:full.length,text:full.slice(data.offset,end),next:end<full.length?end:null};}}});await dom.open();await dom.act('settings');const input=dom.query('[data-unit-scalar="scale"] [data-unit-spelling]');assert.equal(input.readOnly,true);dom.query('[data-coordinate-frames]').dispatchEvent({type:'click',target:input.closest('[data-scalar-field]').querySelector('[data-scalar-edit]'),preventDefault(){},stopPropagation(){}});await settle();let saved=false;const pending=dom.act('apply').then(()=>saved=true);await settle();assert.equal(saved,false);release();await pending;const reads=dom.calls.filter(c=>c.name==='coordinate-frame-scalar');assert.equal(reads.length,3);assert.ok(reads.every(c=>c.data.limit===4096&&c.data.field==='unitDefinition.scale.spelling'&&c.data.ref.revision===frameRef.revision));assert.equal(dom.stored.unitDefinition.scale.spelling,full);
});

test('connected graph upgrade retains policy and refuses stale or pending affine model edits without losing selections',async t=>{
 const dom=harness(t),saved=ref(),model={...ref(),kind:'analysis'},binding={id:randomUUID(),position:0},nodes=[{id:randomUUID(),kind:'column',binding,column:0}],policy=defaultDatasetResourcePolicy(),calls=[];let version=12,release,refuse=true;
 const ui=datasetCalculationGraphUI({call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='calculation-graph-page')return {title:'Pinned graph',graphVersion:version,policy,counts:{bindings:1,nodes:nodes.length,outputs:0},items:nodes.slice(data.offset??0,(data.offset??0)+(data.limit??16)),offset:data.offset??0,total:nodes.length,next:null};if(name==='calculation-graph-change'){if(data.collection==='version'){version=data.graphVersion;assert.deepEqual(data.policy,policy);}else nodes[data.offset]=data.item;return {ref:saved};}if(name==='list')return {items:[{...model,title:'Pinned transform'}],next:null};if(name==='coordinate-frame-transform-read'){if(refuse){await new Promise(resolve=>release=resolve);refuse=false;throw Error('Selected frame denied');}return {transform};}if(name==='dataset-preview')return {columns:['Target coordinates'],formats:[{frameContext:{namespace:'target-frame',dimension:2,unit:'m',method:'affine-frame-transform-v1'}}],rows:[{cells:[{format:'domain-preview',text:'[8/1, 6/1]',complete:true}],valueKinds:['string']}],columnOffset:0,columnCount:1};throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=>dataset.id,inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());const act=(key,data={})=>ui.action('calculation-graph-'+key,control(key,data));await ui.open(saved,{existing:true});await assert.rejects(act('add',{kind:'coordinate-transform'}),/Enable declared coordinate transforms/);await act('frame-upgrade');await act('apply-frame-upgrade');assert.equal(version,13);await act('add',{kind:'coordinate-transform'});await settle();await act('pick',{collection:'nodes',target:'left'});assert.equal(calls.at(-1).data.limit,1);await act('choose',{index:'0'});const select=dom.query('#graph-coordinate-transform-model');select.value=select.querySelectorAll('option')[1].value;select.dispatchEvent({type:'change'});const pending=act('apply');await settle();assert.equal(ui.isBusy(),true);await act('cancel-edit');assert.ok(dom.query('[data-graph-edit]'));release();await assert.rejects(pending,/Selected frame denied/);assert.equal(ui.isBusy(),false);assert.equal(JSON.parse(dom.query('[data-graph-field="left"]').value).id,nodes[0].id);await act('apply');assert.deepEqual(nodes[1],{id:nodes[1].id,kind:'coordinate-transform',left:{id:nodes[0].id,position:0},model});assert.equal(dom.query('[data-graph-edit]'),null);await act('preview');assert.match(dom.query('[data-coordinate-preview-context]').textContent,/target-frame/);assert.match(dom.query('[data-coordinate-preview-context]').textContent,/supplied unit label m/);assert.doesNotMatch(dom.query('[data-coordinate-preview-context]').textContent,new RegExp(model.id));
});

test('coordinate frame errors become localized application errors without leaking internal payloads',()=>{
 for(const code of ['INVALID','INCOMPATIBLE','UNITS','INPUT','SINGULAR']){const error=new CoordinateFrameError('COORDINATE_FRAME_'+code);error.message='private path';error.details=['private source'];const safe=safeError(error);assert.equal(safe.code,error.code);assert.deepEqual(safe.details,[]);assert.doesNotMatch(JSON.stringify(safe),/private/);assert.notEqual(safe.message,'IO');}
});
