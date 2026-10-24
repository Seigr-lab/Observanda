import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {measurementUI} from '../src/web/measurement-ui.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';

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
