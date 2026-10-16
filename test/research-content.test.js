
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {Workspace,digest} from '../src/storage.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {recordRevision} from '../src/research.js';
import {publicProjection,buildPublication} from '../src/publication.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {researchReference} from '../src/web/research-reference.js';
import {proseReferences} from '../src/web/prose-model.js';
import {createFigure,createSeries,parseFigureCSV,figureCSV,figureIssues,xValue} from '../src/web/figure-model.js';
import {renderFigure} from '../src/web/figure-renderer.js';
import {validateTask} from '../src/modules/planning.js';
import {reconcileRecords} from '../src/web/record-merge.js';
const link=(text,target)=>({type:'text',text,marks:[{type:'strong'},{type:'link',attrs:{href:researchReference(target),target:'_self',title:'',nofollow:false}}]});
test('format 13 figures upgrade on a clone, old checkpoints recover, original saved bytes remain in history',async()=>{
 const old=sampleNotebook();old.formatVersion=13;
 for(const e of old.entries){const f=e.figures[0];e.chart=f?{title:f.title,kind:f.kind,xLabel:f.x.label,yLabel:f.y.label,points:f.series[0].points.map(p=>({label:p.x,value:p.y}))}:null;delete e.figures;}
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-content-')),ws=new Workspace(root);
 await ws.create(old);const file=path.join(root,'observanda.json'),bytes=await readFile(file,'utf8'),snapshot=await ws.read(),next=upgradeNotebook(snapshot.book);
 assert.equal(next.formatVersion,21);assert.equal(await readFile(file,'utf8'),bytes);
 assert.deepEqual(next.entries[0].figures[0].series[0].points.map(p=>p.y),old.entries[0].chart.points.map(p=>p.value));
 const draftStore=new ResearchDrafts(ws),id=randomUUID(),record=structuredClone(old.entries[0]);record.chart.points[0].value=null;
 await draftStore.write({id,workspaceId:old.id,expectedRevision:null,changes:[{base:old.entries[0],record,expectedRevision:recordRevision(old.entries[0])}]});
 const recovered=(await draftStore.read(id)).draft.changes[0];assert.equal(recovered.record.figures[0].series[0].points[0].y,null);assert.equal(recovered.expectedRevision,recordRevision(recovered.base));
 const checkpoint=await draftStore.read(id);await draftStore.remove({id,workspaceId:old.id,expectedRevision:checkpoint.revision});assert.equal(await draftStore.read(id),null);
 await ws.save(next,snapshot.etag);assert.equal(await readFile(path.join(root,'.observanda','revisions',digest(bytes)+'.json'),'utf8'),bytes);
});
test('rich research links publish only selected destinations, with private labels and identifiers removed',()=>{
 const book=sampleNotebook(),record=book.entries[0],shared=book.entries[1],secret=book.entries[2];shared.share=true;secret.share=false;
 const target=id=>({workspaceId:book.id,kind:'record',id});
 record.body={type:'doc',content:[{type:'paragraph',content:[link('Shared experiment',target(shared.id)),link('Secret title',target(secret.id)),link('Other workspace title',{workspaceId:randomUUID(),kind:'record',id:randomUUID()})]}]};
 record.sections=[{id:randomUUID(),title:'Interpretation',body:plainRichText('Further context')}];validateNotebook(book);
 assert.equal(proseReferences(record.body).length,3);
 const projection=JSON.stringify(publicProjection(book));assert.ok(!projection.includes(secret.id));assert.ok(!projection.includes('Secret title'));assert.ok(!projection.includes('observanda://'));
 const publication=buildPublication(book),html=publication.files.get('entries/'+record.id+'.html');
 assert.match(html,/<strong>Shared experiment<\/strong>/);assert.ok(html.includes('../entries/'+shared.id+'.html'));assert.ok(!html.includes('Other workspace title'));
 assert.equal(record.body.content[0].content[1].text,'Secret title');
});
test('numeric spacing, gaps, uncertainty and CSV round trips use the same figure contract',()=>{
 const f=createFigure();f.title='Dose response';f.kind='scatter';f.x.label='Dose';f.y.label='Response';
 f.series=parseFigureCSV('Dose,Control,Treatment\n0,1,2\n1,,4\n10,3,8','number').series;f.series[0].points[0].error=.25;
 assert.deepEqual(figureIssues(f),[]);
 const imported=parseFigureCSV(figureCSV(f),'number');assert.deepEqual(imported.series.map(s=>s.points),f.series.map(s=>s.points));
 const svg=renderFigure(f);assert.ok(!/NaN|Infinity/.test(svg));
 const cx=[...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3.5"/g)].map(m=>Number(m[1]));
 assert.ok(Math.abs((cx[3]-cx[2])/(cx[4]-cx[2])-.1)<.001,'numeric X uses coordinate distance, not row spacing');
 f.kind='line';assert.equal((renderFigure(f).match(/stroke-linejoin="round"/g)||[]).length,3,'missing values split a line');
 assert.equal(xValue('2026-02-30','date'),null);assert.equal(xValue('2026-02-28','date'),Date.parse('2026-02-28'));
 f.y.scale='log';f.series[0].points[0].error=2;assert.ok(figureIssues(f).some(s=>s.includes('positive')));
 assert.throws(()=>parseFigureCSV('Time,Value\n0,not-a-number','number'));
});
test('rich prose shares module validation, and competing documents are explicit conflicts',()=>{
 const book=sampleNotebook(),base=book.entries[0],mine=structuredClone(base),stored=structuredClone(base);
 mine.body=plainRichText('My formatted edit');stored.body=plainRichText('Other author');
 const task={title:'Prepare run',description:mine.body,status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]};
 validateTask(task);assert.throws(()=>validateTask({...task,description:{type:'script',text:'invalid'}}));
 const merged=reconcileRecords([{base,record:mine}],[stored,...book.entries.slice(1)]);
 assert.ok(merged.conflicts.some(c=>c.label==='Summary / context'));
});
