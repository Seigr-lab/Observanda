
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {researchReference} from '../src/web/research-reference.js';
import {proseReferences} from '../src/web/prose-model.js';
import {createFigure,parseFigureCSV,figureCSV,figureIssues,xValue} from '../src/web/figure-model.js';
import {renderFigure} from '../src/web/figure-renderer.js';
import {validateTask} from '../src/modules/planning.js';
import {reconcileRecords} from '../src/web/record-merge.js';
const link=(text,target)=>({type:'text',text,marks:[{type:'strong'},{type:'link',attrs:{href:researchReference(target),target:'_self',title:'',nofollow:false}}]});
test('rich research links in a website copy carry no labels or identifiers of other records',async()=>{
 const book=sampleNotebook(),record=book.entries[0],shared=book.entries[1],secret=book.entries[2];shared.share=true;secret.share=false;
 const target=id=>({workspaceId:book.id,kind:'record',id});
 record.body={type:'doc',content:[{type:'paragraph',content:[link('Shared experiment',target(shared.id)),link('Secret title',target(secret.id)),link('Other workspace title',{workspaceId:randomUUID(),kind:'record',id:randomUUID()})]}]};
 record.sections=[{id:randomUUID(),title:'Interpretation',body:plainRichText('Further context')}];validateNotebook(book);
 assert.equal(proseReferences(record.body).length,3);
 // The website copy holds this record only: links to other records never carry their identities or titles.
 const {html,css}=await convertPublicationRecord({},book,record),copy=html+css;
 for(const value of [secret.id,'Secret title','observanda://','Other workspace title',shared.id])assert.ok(!copy.includes(value),value);
 assert.ok(html.includes('Further context'));
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
 // An uncertainty reaching below zero is drawn clipped at the logarithmic axis; the value itself must be positive.
 f.y.scale='log';f.series[0].points[0].error=2;assert.deepEqual(figureIssues(f),[]);assert.match(renderFigure(f),/figure-interval-clipped/);
 f.series[0].points[0].y=0;assert.ok(figureIssues(f).some(s=>s.includes('positive')));f.series[0].points[0].y=1;
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
