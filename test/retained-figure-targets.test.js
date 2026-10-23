import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {RecordDocument} from '../src/record-document.js';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {retainedFigureTargets,hasRetainedFigureTarget} from '../src/retained-figure-targets.js';
import {resultFigureRootTarget,resultFigureTargetPage,findResultFigure} from '../src/record-result-values.js';
import {validateResultSources} from '../src/result-statements.js';
const fixture=()=>{const files=new Map();let reads=0,writes=0;return {files,get reads(){return reads;},get writes(){return writes;},reset(){reads=0;},workspace:{async readMetadata(name){reads++;return files.get(name)??null;},async writeMetadata(name,text){writes++;files.set(name,text);}}};};
async function document(owner,figures){const tree=owner.blocks.tree(),root=await tree.retain({figures});await owner.blocks.flush();const value=new RecordDocument(owner.blocks,root),field=value.field.bind(value);value.field=(path,options)=>{assert.ok(path[0]!=='figures'||path.length>=3,'no entire figure hydration');return field(path,options);};return value;}
const statement=figureId=>({id:randomUUID(),kind:'figure',figureId,title:'Selected observation',text:'Exact target',limitations:'Synthetic',basis:'authored',source:null});

test('retained composition result choices page and resolve selected plot identity without expanding points or preceding panels',async()=>{
 const f=fixture(),owner=new RetainedFigureDocuments(f.workspace),plots=Array.from({length:257},(_,i)=>{const p=createFigure();p.title='Plot '+i;p.series[0].points=[{x:i,y:i,error:null}];return p;}),composition=createComposition(plots);composition.title='Composition';composition.panels.forEach((panel,i)=>{panel.label='Panel '+i;});composition.panels[256].figure.title='Tail '+('x'.repeat(2000));const saved=await owner.retain(composition),doc=await document(owner,[saved]),last=composition.panels[256].figure.id;
 assert.deepEqual(await resultFigureRootTarget(doc,0),{id:saved.id,title:saved.title,hasPanels:true});
 f.reset();const tail=await resultFigureTargetPage(doc,0,{offset:256,limit:4});assert.equal(tail.total,257);assert.equal(tail.items.length,1);assert.equal(tail.items[0].id,last);assert.equal(tail.items[0].hasPanels,false);assert.ok(tail.items[0].title.endsWith('...'));assert.equal(tail.next,null);assert.equal(tail.previous,252);assert.ok(f.reads<100,'tail choice follows bounded index paths');
 const clamped=await resultFigureTargetPage(doc,0,{offset:1000,limit:4});assert.equal(clamped.offset,256);assert.equal(clamped.items[0].id,last);assert.equal(clamped.next,null);
 f.reset();assert.equal((await findResultFigure(doc,last)).id,last);assert.ok(f.reads<100,'selected target does not enumerate all panels');assert.equal(await hasRetainedFigureTarget({store:{workspace:f.workspace}},saved,last),true);assert.equal(await findResultFigure(doc,randomUUID()),null);
 let count=0;for await(const target of retainedFigureTargets(f.workspace,saved)){assert.ok(target.id);count++;}assert.equal(count,258);
 await validateResultSources(f.workspace,{figures:[saved],results:{version:1,statements:[statement(last)]}});await assert.rejects(validateResultSources(f.workspace,{figures:[saved],results:{version:1,statements:[statement(randomUUID())]}}),{code:'ANALYSIS_INVALID'});
 const abort=new AbortController();abort.abort();await assert.rejects(resultFigureTargetPage(doc,0,{signal:abort.signal}),{name:'AbortError'});await assert.rejects(resultFigureTargetPage(doc,0,{limit:129}),{code:'INVALID'});
 const other=fixture();await assert.rejects(hasRetainedFigureTarget(other.workspace,saved,last),{code:'MATERIAL_MISSING'});
 // A content-addressed index still needs exact logical identity admission.
 const reader=await owner.open(saved),member=await reader.panelMember(composition.panels[0].figure.id),entry=await reader.index.find({root:reader.presentationIndex.collections.panels.keys},member.id),forgedId=randomUUID(),index=structuredClone(reader.presentationIndex);
 index.collections.panels.plots=await reader.index.change(index.collections.panels.plots,forgedId+':'+String(member.ordinal).padStart(16,'0'),entry.revision);await reader.index.flush(index.collections.panels.plots);const indexRoot=await reader.tree.retain(index);await owner.blocks.flush();const malformed=structuredClone(saved);malformed.document.presentation.index=indexRoot;
 await assert.rejects(hasRetainedFigureTarget(f.workspace,malformed,forgedId),{code:'MATERIAL_MISSING'});

});

test('single wrapper identities, inline header choices and explicit draft admission retain their separate boundaries',async()=>{
 const f=fixture(),owner=new RetainedFigureDocuments(f.workspace),plot=createFigure();plot.series[0].points=[{x:1,y:2,error:null}];const saved={...await owner.retain(plot),id:randomUUID()},inline=createComposition([plot,plot]),doc=await document(owner,[saved,inline]);
 assert.equal(await hasRetainedFigureTarget(f.workspace,saved,saved.id),true);assert.equal(await hasRetainedFigureTarget(f.workspace,saved,plot.id),false);assert.deepEqual((await resultFigureTargetPage(doc,0)).items,[]);assert.equal((await resultFigureRootTarget(doc,0)).hasPanels,false);assert.equal((await resultFigureTargetPage(doc,0,{offset:1000})).offset,0);
 const page=await resultFigureTargetPage(doc,1,{offset:1,limit:1});assert.equal(page.total,2);assert.equal(page.items[0].id,inline.panels[1].figure.id);assert.equal((await resultFigureTargetPage(doc,1,{offset:1000})).offset,1);assert.equal((await findResultFigure(doc,page.items[0].id)).id,page.items[0].id);
 const author=new RetainedFigureAuthoring(f.workspace);let draft=await author.start(null,{kind:'panels'});draft=await author.change(draft,{type:'append',collection:'panels',value:{label:'Unfinished observation',kind:'line',xKind:'number'}});const reader=await author.open(draft),panel=(await reader.window({collection:'panels',limit:1})).items[0],before=f.writes;
 await assert.rejects(hasRetainedFigureTarget(f.workspace,draft,panel.plotId),{code:'MATERIAL_INVALID'});assert.equal(await hasRetainedFigureTarget(f.workspace,draft,panel.plotId,{draft:true}),true);assert.equal(f.writes,before,'target admission only reads authenticated nodes');
});
