import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {measurementUI} from '../src/web/measurement-ui.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {domainComponentPageView} from '../src/web/measurement-domain-ui.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noop=()=>{};
const options={call:noop,frame:noop,esc,field:noop,guard:noop,owner:noop,inspect:noop,notify:noop,download:noop,origin:noop};
const descendants=node=>(node.childNodes??[]).flatMap(child=>[child,...descendants(child)]);
const attr=(node,key)=>node.attrs?.find(a=>a.name===key)?.value;
const text=node=>descendants(node).filter(n=>n.nodeName==='#text').map(n=>n.value).join('');
const value=representation=>({value:{presence:'value',spelling:'1',representation,radix:representation==='domain'?10:6,unit:''},references:{},sources:[],time:{kind:'none'},decoderVersion:'',integrity:'unknown',completion:'unknown',note:''});

test('domain facts omit the scalar envelope base while scalar facts retain their declared base',()=>{
 const ui=measurementUI(options),domain=parseFragment(ui.view(value('domain'))),scalar=parseFragment(ui.view(value('radix-fraction')));
 assert.ok(!descendants(domain).some(n=>n.nodeName==='dt'&&text(n)==='Base (for explicit base)'));
 const label=descendants(scalar).find(n=>n.nodeName==='dt'&&text(n)==='Base (for explicit base)');assert.ok(label);
 const siblings=label.parentNode.childNodes;assert.equal(text(siblings[siblings.indexOf(label)+1]),'6');
});

test('domain inspection keeps component context and independently wrapped surrounding source controls',async t=>{
 // Mocked inspection request and DOM wiring only; geometry is checked in the actual browser journey.
 const originalDocument=globalThis.document;let html='';const listeners=[],root={isConnected:true,addEventListener:(...args)=>listeners.push(args)};
 globalThis.document={getElementById:id=>id==='dialog'?{open:true}:null,querySelector:selector=>selector==='[data-measurement-inspection]'&&html.includes('data-measurement-inspection')?root:null};
 t.after(()=>{globalThis.document=originalDocument;});
 const source={ref:{kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},selector:{kind:'cell',page:0,row:0,column:2}},longValue='<tensor>'+('12345'.repeat(400)),definition={...defaultDomain('tensor'),shape:[2,3,7],component:{version:1,representation:'radix-fraction',radix:6}};
 const data={...value('domain'),kind:'cell',row:{id:'row-identity'},surrounding:[{order:1,page:0,row:0,presence:'value',value:longValue,excluded:''},{order:2,page:0,row:1,presence:'null',value:'unused',excluded:'Excluded by a recorded source observation'}],domain:{definition,supported:true,offset:32,total:42,next:null,items:[{index:32,position:[1,1,4],spelling:'0.3',exact:'1/2'}]}};
 const calls=[],ui=measurementUI({...options,call:async(name,payload)=>{calls.push({name,payload});return data;},frame:(title,body)=>{html=body;},readOnly:()=>true});t.after(()=>ui.clean());
 await ui.action('measurement-inspect',{dataset:{source:JSON.stringify(source)}});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'measurement-inspect');assert.deepEqual(calls[0].payload.source,source);
 const nodes=descendants(parseFragment(html));assert.ok(!nodes.some(n=>n.nodeName==='dt'&&text(n)==='Base (for explicit base)'));assert.ok(nodes.some(n=>n.nodeName==='h3'&&text(n).includes('radix-fraction base 6')));
 const region=nodes.find(n=>attr(n,'data-measurement-surrounding')!==undefined);assert.ok(region);assert.match(attr(region,'class'),/measurement-surrounding/);
 const table=descendants(region).find(n=>n.nodeName==='table'),head=descendants(table).find(n=>n.nodeName==='thead');const headers=descendants(head).filter(n=>n.nodeName==='th'&&attr(n,'scope')==='col');assert.equal(headers.length,3);assert.deepEqual(headers.map(text),['Row','Value','Exclusion']);assert.equal(attr(headers[0],'aria-label'),'Row on page (starting at 1)');
 const wrappers=descendants(table).filter(n=>attr(n,'class')==='measurement-surrounding-value');assert.equal(wrappers.length,2);
 for(const [index,wrapper] of wrappers.entries()){
  const button=wrapper.childNodes.find(n=>n.nodeName==='button'),spelling=wrapper.childNodes.find(n=>n.nodeName==='span');assert.ok(button);assert.ok(spelling);assert.equal(attr(button,'data-action'),'material-measurement-inspect');assert.deepEqual(JSON.parse(attr(button,'data-source')),{ref:source.ref,selector:{...source.selector,row:index}});assert.equal(text(button),'Inspect source');
 }
 assert.equal(text(wrappers[0].childNodes.find(n=>n.nodeName==='span')),longValue);assert.equal(text(wrappers[1].childNodes.find(n=>n.nodeName==='span')),'JSON null');assert.doesNotMatch(html,/<tensor>/);assert.match(html,/&lt;tensor&gt;/);assert.ok(listeners.some(([name])=>name==='click'));
});

test('phone component labels preserve the semantic table, complete values and selected scalar paging',()=>{
 const spelling='1234567890'.repeat(50)+'/7',exact=spelling,retained={format:'dataset-cell',version:1,characters:10000,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',count:1,chunkSize:16,root:{count:1,height:1,key:'c'.repeat(64),hash:'d'.repeat(64)}}},definition={...defaultDomain('vector'),shape:[66]},page={definition,supported:true,offset:32,total:66,next:34,items:[{index:32,position:[32],spelling,exact},{index:33,position:[33],spelling:retained,exact:null}]};
 const html=domainComponentPageView(page,{esc}),nodes=descendants(parseFragment(html)),table=nodes.find(n=>n.nodeName==='table'),head=descendants(table).find(n=>n.nodeName==='thead'),body=descendants(table).find(n=>n.nodeName==='tbody'),rows=body.childNodes.filter(n=>n.nodeName==='tr');
 const headers=descendants(head).filter(n=>n.nodeName==='th');assert.deepEqual(headers.map(text),['Component coordinates','Original spelling','Exact value']);assert.ok(headers.every(n=>attr(n,'scope')==='col'));assert.equal(rows.length,2);
 for(const row of rows){assert.equal(attr(row.childNodes[0],'scope'),'row');const labels=descendants(row).filter(n=>attr(n,'class')==='domain-component-label');assert.deepEqual(labels.map(text),headers.map(text));assert.ok(labels.every(n=>attr(n,'aria-hidden')==='true'));}
 assert.equal(text(descendants(rows[0]).find(n=>attr(n,'data-domain-component-spelling')!==undefined)),spelling);assert.equal(text(descendants(rows[0]).find(n=>attr(n,'data-domain-component-exact')!==undefined)),exact);
 const field=nodes.find(n=>attr(n,'data-scalar-component')==='33');assert.deepEqual(JSON.parse(attr(field,'data-scalar-reference')),retained);assert.ok(descendants(field).some(n=>attr(n,'data-scalar-view')!==undefined));
 assert.deepEqual(nodes.filter(n=>attr(n,'data-action')==='material-measurement-components').map(n=>attr(n,'data-offset')),['0','34']);assert.doesNotMatch(html,/object Object/);
});


test('topology collection paging and nested source navigation retain the selected page and reject obsolete reads',async t=>{
 const originalDocument=globalThis.document;let html='',dialogOpen=true,hold=false,release;const root={isConnected:true,addEventListener(){}};
 globalThis.document={getElementById:id=>id==='dialog'?{open:dialogOpen}:null,querySelector:selector=>selector==='[data-measurement-inspection]'&&html.includes('data-measurement-inspection')?root:null};t.after(()=>{globalThis.document=originalDocument;});
 const source={ref:{kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},selector:{kind:'cell',page:0,row:0,column:0}},other={...source,selector:{...source.selector,column:1}},definition={...defaultDomain('topology'),namespace:'literal keys'},calls=[];
 const ui=measurementUI({...options,call:async(name,payload)=>{calls.push({name,payload:structuredClone(payload)});if(hold)await new Promise(resolve=>release=resolve);const collection=payload.topologyCollection??'vertices',offset=payload.componentOffset??0;return {...value('domain'),kind:'cell',row:{id:'row'},surrounding:[],domain:{definition,supported:true,collection,offset,total:34,next:offset+1,items:[{index:offset,key:' key ',...(collection==='edges'?{from:'a',to:'b'}:{})}]}};},frame:(title,body)=>{html=body;},origin:()=>({ref:source.ref,page:0}),readOnly:()=>true});t.after(()=>ui.clean());
 const act=(key,dataset={})=>ui.action('measurement-'+key,{dataset});await act('inspect',{source:JSON.stringify(source)});assert.equal(calls.at(-1).payload.topologyCollection,undefined);await act('topology',{collection:'edges'});assert.equal(calls.at(-1).payload.componentOffset,0);assert.equal(calls.at(-1).payload.topologyCollection,'edges');await act('components',{offset:'16'});assert.equal(calls.at(-1).payload.topologyCollection,'edges');assert.equal(calls.at(-1).payload.componentOffset,16);await act('inspect',{source:JSON.stringify(other)});assert.equal(calls.at(-1).payload.topologyCollection,undefined);await act('back-source');assert.deepEqual(calls.at(-1).payload.source,source);assert.equal(calls.at(-1).payload.topologyCollection,'edges');assert.equal(calls.at(-1).payload.componentOffset,16);assert.match(html,/Edges 17-17 of 34/);await act('topology',{collection:'vertices'});assert.equal(calls.at(-1).payload.componentOffset,0);
 hold=true;const pending=act('components',{offset:'16',collection:'edges'});await new Promise(resolve=>setImmediate(resolve));ui.clean();html='<p>Replacement</p>';release();await pending;assert.equal(html,'<p>Replacement</p>');
});
