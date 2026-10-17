import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainPublicationInput,readPublicationRecord} from '../src/publication-input.js';
import {retainPublicationSources} from '../src/publication-source-input.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {serialize} from '../src/storage-format.js';

test('file-backed capture retains legacy originals and federation finalization without native document nodes',async()=>{
 const book=upgradeNotebook(sampleNotebook()),record={...book.entries[0],body:'Exact legacy retained body',share:true,attachments:[],figures:[],relations:[],sections:[]};book.entries=[record];book.projects.forEach(project=>project.share=true);
 const files=new Map(),workspace={root:'in-memory-file-owner',async storageKind(){return 'file';},async readMetadata(file){return files.get(file)??null;},async writeMetadata(file,text){files.set(file,text);},async *metadataNames(){},catalogue(){assert.fail('Legacy capture opened native storage');}};
 const {entries,...metadata}=book,id=randomUUID(),local=await retainPublicationInput(workspace,id,metadata,entries,{deferFinalization:true});
 assert.equal(local.document,undefined);assert.equal(local.records.length,1);assert.equal(files.get('.observanda/release-inputs/'+id+'/'+record.id+'.json'),serialize(record));
 const finalized=await retainPublicationSources(workspace,id,local,[],null);assert.equal(finalized.document,undefined);assert.equal(finalized.summary.records,1);assert.deepEqual(await readPublicationRecord(workspace,{version:2,id},finalized.records[0]),record);
 assert.ok([...files.keys()].every(file=>!file.includes('/pd-v-')&&!file.includes('/pd-i-')));
});
