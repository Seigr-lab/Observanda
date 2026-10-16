import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordValues} from '../src/record-values.js';
import {RecordWriting} from '../src/record-writing.js';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {ResearchMaterials} from '../src/research-materials.js';
export async function figureValueFixture({large=false,tags=null}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-values-')),source=sampleNotebook(),record=source.entries[2];source.entries=[record];record.status='draft';
 if(tags)record.tags=tags;
 record.sections=Array.from({length:73},(_,i)=>({id:randomUUID(),title:'Section '+i,body:large?'exact'.repeat(5600):'Retained observation '+i}));
 record.figures=Array.from({length:9},(_,i)=>{const f=createFigure();f.title='Observation '+i;f.kind='scatter';f.series[0].points=[{x:1,y:i+2,error:null,xLower:.5,xUpper:1.5,yLower:i+1,yUpper:i+3,count:4},{x:2,y:i+3,error:null,count:9}];f.markerArea={unitArea:24,label:'Repeated observations'};return f;});
 const compound=createComposition(record.figures.slice(0,3));compound.title='Panel comparison';record.figures[8]=compound;
 record.results={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:compound.panels[0].figure.id,title:'First acquisition result',text:'Two observations.',limitations:'Synthetic fixture only.',basis:'authored',source:null}]};
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before comparison'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:compound.id,alternative:'Compare acquisitions'}},{type:'paragraph',content:[{type:'text',text:'After comparison'}]}]};
 const f=await encryptedFixture(directory,source),ready=await f.workspace.read(),saved=ready.book.entries[0],materials=new ResearchMaterials(f.workspace),figure=saved.figures[0];
 const analysis=await f.workspace.withLock(()=>materials.commit({kind:'analysis',recordId:saved.id,title:'Retained plot calculation',content:{inputs:[],outputs:[],tool:'Synthetic calculator',version:'1',parameters:'Two observations',figure:structuredClone(figure)}}));
 figure.source=analysis;await f.workspace.save(ready.book,ready.etag);
 if(large){const writing=new RecordWriting(f.workspace),target={workspaceId:source.id,recordId:saved.id,sectionId:null},base=await writing.read(target);saved.body.content.push({type:'paragraph',content:[{type:'text',text:'Extended observations '.repeat(2500)}]});await writing.save({...target,expectedRevision:base.revision,value:{body:saved.body}});}
 const values=new RecordValues(f.workspace),target=id=>({workspaceId:source.id,recordId:saved.id,field:'figure:'+id});
 return {...f,directory,book:ready.book,record:saved,materials,analysis,values,target,save:(base,value)=>values.save({...target(base.field.slice(7)),expectedRevision:base.revision,value:{value}}),async close(){clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
}
