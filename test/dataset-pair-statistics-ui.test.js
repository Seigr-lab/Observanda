import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {datasetAggregationUI,aggregationInspection} from '../src/web/dataset-aggregation-ui.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {aggregationPairContextText} from '../src/web/dataset-aggregation-context.js';
import {measurementUI} from '../src/web/measurement-ui.js';
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

const get=(dom,key,index)=>index===undefined?dom.query('[data-aggregate="'+key+'"]'):dom.query('[data-aggregate-value="'+index+'"]').querySelector('[data-aggregate="'+key+'"]');
const change=(input,value)=>{input.value=value;input.onchange?.();};

const pair=(operation='covariance')=>({column:1,pairedColumn:18,operation,name:'Paired result',pairing:'complete-rows-v1',...(operation==='covariance'?{method:'centered-pairs-v1',normalization:'sample'}:{method:'ordinary-least-squares-intercept-v1',coefficient:'slope'})});
const recipe=(version=4)=>({version,source:ref(),keys:[0],keySemantics:['lexical'],values:[{column:1,operation:'mean',name:'Mean'}],missing:'skip',note:'Original method',...(version>=3?{resourcePolicy:defaultDatasetResourcePolicy()}:{})});
function author(t,{aggregation=recipe(),request=async()=>({columns:['Result'],rows:[{cells:['2/1'],valueKinds:['rational']}]})}={}){
 const dom=harness(t),selected=ref(),calls=[],watched=[],errors=[],columns=Array.from({length:20},(_,i)=>({name:i===0?'Group':i===1?'X':i===18?'Y':'Column '+(i+1),representation:i===1||i===18?'integer':'text',radix:10,unit:''}));
 const ui=datasetAggregationUI({state:{},api:{},call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='read')return {title:'Pinned aggregation',content:{aggregation}};if(name==='calculation-schema'){if(data.columns)return {columns:data.columns.map(i=>columns[i])};const offset=data.offset??0;return {columns:columns.slice(offset,offset+16),offset,total:columns.length,next:offset+16<columns.length?offset+16:null};}return request(name,data);},frame:dom.frame,esc,field,guard(){},owner:()=>selected.id,inspect:async()=>{},watchJob:async job=>watched.push(job),notify:message=>errors.push(message)});t.after(()=>ui.clean());
 const act=(name,data={})=>ui.action('aggregation-'+name,control(name,data));return {...dom,ui,act,calls,selected,watched,errors,open:(key='repeat')=>act(key,{ref:JSON.stringify(selected)})};
}

test('new aggregation uses recipe 5 while historical recipes require an explicit paired-statistics upgrade',async t=>{
 const original=recipe(3),saved=structuredClone(original),dom=author(t,{aggregation:original});await dom.open('open');assert.doesNotMatch(dom.html(),/material-aggregation-upgrade-/);dom.query('[data-group-key="0"]').checked=true;await dom.act('add');assert.match(dom.html(),/value="covariance"/);assert.match(dom.html(),/value="linear-fit"/);get(dom,'column',0).value='1';get(dom,'name',0).value='Mean';await dom.act('preview');assert.equal(dom.calls.at(-1).data.aggregation.version,5);assert.deepEqual(dom.calls.at(-1).data.aggregation.resourcePolicy,defaultDatasetResourcePolicy());
 await dom.open();assert.doesNotMatch(dom.html(),/value="covariance"/);get(dom,'title').value='Preserved title';get(dom,'note').value='Preserved rationale';dom.query('[data-dataset-resource="maxBits"]').value='';await dom.act('upgrade-paired');assert.equal(dom.query('[data-dataset-resource="maxBits"]').value,'');assert.equal(get(dom,'note').value,'Preserved rationale');assert.equal(get(dom,'title').value,'Preserved title');assert.match(dom.html(),/value="covariance"/);dom.query('[data-dataset-resource="maxBits"]').value='65536';await dom.act('preview');assert.equal(dom.calls.at(-1).data.aggregation.version,5);assert.deepEqual(original,saved);await dom.act('upgrade-quantile');await dom.act('preview');assert.equal(dom.calls.at(-1).data.aggregation.version,5);
});

test('paired controls require explicit choices and preserve both columns through paging, busy refusal and retry',async t=>{
 let release,refuse=true;const aggregation=recipe(5);aggregation.values=[pair()];const dom=author(t,{aggregation,request:async()=>{if(refuse){await new Promise(resolve=>release=resolve);throw Error('Unit declaration refused');}return {columns:['Paired result'],rows:[{cells:['2/1'],valueKinds:['rational']}]};}});await dom.open();assert.equal(get(dom,'pairedColumn',0).value,'18');assert.ok(dom.calls.some(c=>c.name==='calculation-schema'&&c.data.columns?.includes(18)));get(dom,'note').value='Keep exact paired rationale';change(get(dom,'normalization',0),'population');await dom.all('[data-column-window]').find(node=>node.dataset.offset==='16').onclick();
 assert.equal(get(dom,'column',0).value,'1');assert.equal(get(dom,'pairedColumn',0).value,'18');assert.equal(get(dom,'normalization',0).value,'population');assert.equal(get(dom,'note').value,'Keep exact paired rationale');
 const pending=dom.act('preview');await settle();assert.equal(dom.ui.isBusy(),true);assert.equal(dom.query('[data-aggregation-form]').getAttribute('aria-busy'),'true');assert.ok(dom.query('[data-aggregation-form]').querySelectorAll('button,input,select,textarea').every(node=>node.disabled));release();await assert.rejects(pending,/refused/);assert.equal(dom.ui.isBusy(),false);assert.equal(get(dom,'pairedColumn',0).value,'18');assert.equal(get(dom,'normalization',0).value,'population');assert.equal(get(dom,'note').value,'Keep exact paired rationale');refuse=false;await dom.act('preview');assert.deepEqual(dom.calls.at(-1).data.aggregation.values[0],{...pair(),normalization:'population'});
 change(get(dom,'operation',0),'linear-fit');assert.equal(dom.query('[data-aggregate-fit]').hidden,false);get(dom,'coefficient',0).value='';await assert.rejects(dom.act('preview'),/Choose/);change(get(dom,'coefficient',0),'intercept');await dom.act('preview');assert.deepEqual(dom.calls.at(-1).data.aggregation.values[0],{...pair('linear-fit'),coefficient:'intercept'});change(get(dom,'operation',0),'mean');await dom.act('preview');assert.deepEqual(dom.calls.at(-1).data.aggregation.values[0],{column:1,operation:'mean',name:'Paired result'});
});

test('late paired previews cannot replace a newly opened inspector',async t=>{
 let release;const aggregation=recipe(5);aggregation.values=[pair('linear-fit')];const dom=author(t,{aggregation,request:async()=>{await new Promise(resolve=>release=resolve);return {columns:['Slope'],rows:[]};}});await dom.open();const pending=dom.act('preview');await settle();dom.ui.clean();dom.frame('Other inspection','<p data-newer>Current source</p>');release();await pending;assert.ok(dom.query('[data-newer]'));assert.equal(dom.ui.isBusy(),false);
});

test('paired receipt exposes complete-pair counts, status, both source values and both pinned reading controls',()=>{
 const source=ref(),cell=column=>({ref:source,selector:{kind:'cell',page:2,row:4,column}}),a={...pair(),source,note:'Known pairing',counts:{total:3,included:1,excluded:1,missing:1},pairedStatistic:{version:1,method:'centered-pairs-v1',pairing:'complete-rows-v1',status:'insufficient-pairs'},members:[{presence:'value',value:'2',pairedPresence:'value',pairedValue:'5',status:'included',source:cell(1),pairedSource:cell(18)},{presence:'missing',value:'NA',pairedPresence:'value',pairedValue:'7',status:'missing',source:cell(1),pairedSource:cell(18)}],previous:null,next:2},sources=[];
 const html=aggregationInspection({aggregation:a},{esc,sourceButton:value=>{sources.push(value);return '<button>Inspect</button>';}});assert.match(html,/data-aggregation-paired/);assert.match(html,/Complete pairs/);assert.match(html,/at least two complete pairs/);assert.match(html,/data-pair-source="x"/);assert.match(html,/data-pair-source="y"/);assert.match(html,/data-pair-member/);assert.match(html,/Source X/);assert.match(html,/Source Y/);assert.match(html,/material-measurement-next/);assert.deepEqual(sources,[cell(1),cell(18),cell(1),cell(18)]);assert.doesNotMatch(html,/object Object/);
 for(const status of ['ready','no-pairs','zero-x-spread'])assert.match(aggregationInspection({aggregation:{...a,pairedStatistic:{...a.pairedStatistic,status}}},{esc,sourceButton:()=>''}),new RegExp('data-paired-statistic-status="'+status+'"'));
});

test('public paired context validates the method and describes normalization and original-coordinate fit meaning',()=>{
 assert.match(aggregationPairContextText(pair()),/complete row pairs.*n - 1.*sample/);assert.match(aggregationPairContextText({...pair(),normalization:'population'}),/divided by n \(population\)/);assert.match(aggregationPairContextText(pair('linear-fit')),/Unweighted.*slope.*Y.*X/);assert.match(aggregationPairContextText({...pair('linear-fit'),coefficient:'intercept'}),/intercept.*Y at source X = 0/);assert.equal(aggregationPairContextText(null),'');for(const invalid of [{...pair(),normalization:'automatic'},{...pair(),method:'other'},{...pair('linear-fit'),pairing:'nearest'},{...pair('linear-fit'),coefficient:'correlation'}])assert.throws(()=>aggregationPairContextText(invalid),/Unsupported paired/);
});


test('opening either paired source returns to the retained receipt and its selected member page',async t=>{
 const dom=harness(t),result={ref:ref(),selector:{kind:'cell',page:0,row:0,column:1}},input=ref(),calls=[],returned=[];let release;
 const source=(column,row=16)=>({ref:input,selector:{kind:'cell',page:0,row,column}}),cell=spelling=>({kind:'cell',value:{presence:'value',spelling,representation:'rational',radix:10,unit:''},row:{id:'row'},surrounding:[],exact:{numerator:spelling.split('/')[0],denominator:'1'}});
 const ui=measurementUI({call:async(name,payload)=>{calls.push({name,payload:structuredClone(payload)});if(payload.source.ref.id===input.id){if(payload.source.selector.column===1)await new Promise(resolve=>release=resolve);return cell(payload.source.selector.column===1?'0/1':'1/1');}const offset=payload.offset??0;return {...cell('2/1'),previous:offset?0:null,next:offset?null:16,aggregation:{...pair(),source:input,counts:{total:22,included:22,missing:0,excluded:0},pairedStatistic:{version:1,method:'centered-pairs-v1',pairing:'complete-rows-v1',status:'ready'},members:Array.from({length:offset?6:16},(_,index)=>({presence:'value',value:'0',pairedPresence:'value',pairedValue:'1',status:'included',source:source(1,offset+index),pairedSource:source(18,offset+index)})),previous:offset?0:null,next:offset?null:16}};},frame:dom.frame,esc,field,guard(){},owner:()=>result.ref.id,inspect:async(...args)=>returned.push(args),notify(){},download(){},origin:()=>({ref:result.ref,page:3}),readOnly:()=>true});t.after(()=>ui.clean());
 await ui.action('measurement-inspect',control('inspect',{source:JSON.stringify(result)}));await ui.action('measurement-next',control('next'));assert.equal(dom.all('[data-pair-member]').length,6);
 for(const axis of ['x','y']){const sourceControl=dom.query('[data-pair-source="'+axis+'"] button'),selected=JSON.parse(sourceControl.dataset.source);assert.deepEqual(selected,source(axis==='x'?1:18));const pending=ui.action('measurement-inspect',sourceControl);if(axis==='x'){await settle();assert.equal(dom.query('[data-measurement-inspection]'),null);release();}await pending;assert.equal(dom.query('[data-aggregation-sources]'),null);assert.match(dom.html(),axis==='x'?/0 \/ 1/:/1 \/ 1/);await ui.action('measurement-back-source',control('back-source'));assert.equal(dom.all('[data-pair-member]').length,6);assert.deepEqual(calls.at(-1).payload.source,result);assert.equal(calls.at(-1).payload.offset,16);}
 assert.deepEqual(returned,[]);await ui.action('measurement-back-source',control('back-source'));assert.deepEqual(returned,[[result.ref,{atPage:3,comparisonView:undefined}]]);
});
