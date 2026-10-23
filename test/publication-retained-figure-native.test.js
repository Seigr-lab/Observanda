import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {createFigure} from '../src/web/figure-model.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {publicationDraftCommand} from './publication-fixture.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {recordRevision} from '../src/research.js';
import {contentBuffer} from '../src/file-content.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {verifyPublicationFigures} from '../src/publication-retained-figures.js';

test('native publication freezes complete retained figures with separate data consent and no private source roots',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-edition-')),book=sampleNotebook();book.entries=book.entries.slice(0,1);const record=book.entries[0];record.share=true;record.sections=[];record.attachments=[];record.figures=[];
 const fixture=await encryptedFixture(directory,book),materials=new ResearchMaterials(fixture.workspace);
 t.after(async()=>{clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-figure-edition-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const figures=[];
 for(const title of ['Complete observations','Chart only']){
  const figure=createFigure();figure.title=title;figure.series[0].points=Array.from({length:137},(_,i)=>({x:i,y:i%17,error:i===136?1:null}));
  const retained=await fixture.workspace.withLock(()=>new RetainedFigureDocuments(fixture.workspace).retain(figure)),source=await fixture.workspace.withLock(()=>materials.commit({kind:'analysis',recordId:record.id,title,content:{inputs:[],outputs:[],tool:'Synthetic retained observations',version:'1',parameters:'Exact retained values',figure:retained}}));
  figures.push({...retained,source});
 }
 record.figures=figures;
 const command=await publicationDraftCommand(fixture.workspace,book),selected=book.entries[0],choice=defaultEditionRecord(selected,recordRevision(selected));choice.figures[0].data=true;
 const storage=websiteWorkspace(fixture.workspace,null),releases=new PublicationJobs(storage),source=await withPublicationCapture(storage,async(workspace,id,finish)=>{const pinned=await releases.pin({...command,edition:{version:1,records:[choice]}},{workspace,id,signal:t.signal});return finish(()=>pinned);},{signal:t.signal});
 const input=await openPublicationInput(storage,source);await verifyPublicationFigures(input,selected,{signal:t.signal});
 // Once captured, preparation uses the frozen closure, not current originals.
 const originalRead=ResearchMaterials.prototype.read;ResearchMaterials.prototype.read=()=>{throw Error('Live source read during preparation');};
 const job={id:source.id,lease:{token:randomUUID()}};let candidate;try{candidate=await releases.prepare(job,{signal:t.signal,progress:async()=>{}});}finally{ResearchMaterials.prototype.read=originalRead;}
 await storage.withLock(()=>releases.commit(job,candidate));const edition=await new PublicationJobs(storage).read(candidate.reviewId),text=async name=>(await contentBuffer(await edition.files.get(name))).toString('utf8');
 const prefix='figures/'+record.id+'-',html=await text('entries/'+record.id+'.html'),svg=await text(prefix+figures[0].id+'.svg'),csv=await text(prefix+figures[0].id+'.csv');
 assert.equal((svg.match(/class="figure-observation"/g)??[]).length,137);assert.equal((csv.match(/^"measurement",/gm)??[]).length,137);assert.equal((html.match(/<tr data-point-id=/g)??[]).length,137);
 assert.equal(await edition.files.has(prefix+figures[1].id+'.svg'),true);assert.equal(await edition.files.has(prefix+figures[1].id+'.csv'),false);
 for await(const [name,content] of edition.files)if(/\.(html|svg|csv|json)$/.test(name)){
  const value=(await contentBuffer(content)).toString('utf8');for(const figure of figures)for(const secret of [figure.source.id,figure.source.revision,figure.document.data.root,figure.document.presentation.root])if(secret)assert.equal(value.includes(secret),false,'Private figure source escaped into '+name);
 }
 assert.deepEqual((await fixture.workspace.read()).book.entries[0].figures,figures);
});
