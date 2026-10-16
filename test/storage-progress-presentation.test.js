import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageProgressPresentation,storageSize} from '../src/web/storage-progress-presentation.js';
test('storage progress separates whole-transfer totals from current-file work and verification reads',()=>{
 const base={stage:'copy-file',stages:['copy-workspace','copy-file'],completed:57475072,total:67108900,unit:'bytes',activity:{bytes:57409536,objects:0},transfer:{phase:'copying',files:137,totalFiles:19904,bytes:11000000000,totalBytes:27110680000}};
 const shown=storageProgressPresentation(base);assert.equal(shown.count,`Files copied and checked: 137 of ${(19904).toLocaleString('en')}`);assert.equal(shown.work,`Data copied: 11 GB of ${(27.11).toLocaleString('en')} GB`);assert.equal(shown.detail,`Current file: ${(57.48).toLocaleString('en')} MB of ${(67.11).toLocaleString('en')} MB`);
 assert.equal(shown.completed,11000000000);assert.equal(shown.total,27110680000);assert.doesNotMatch(JSON.stringify(shown),/Stored objects|Bytes processed/);
 const checking=storageProgressPresentation({...base,stage:'verify-file',completed:67108900,transfer:{...base.transfer,phase:'verifying'}});
 assert.equal(checking.work,shown.work);assert.equal(checking.count,shown.count);assert.match(checking.path,/Verifying/);
 assert.equal(storageSize(0),'0 bytes');assert.equal(storageSize(1000000),'1 MB');
});
test('review shows its actual stage and does not pretend to know undiscovered totals',()=>{
 const shown=storageProgressPresentation({stage:'database-inventory',stages:['review-workspace','database-inventory'],completed:811169,unit:'rows'});
 assert.equal(shown.path,'Reviewing workspace contents');assert.equal(shown.work,'');assert.equal(shown.count,`Current stage: ${(811169).toLocaleString('en')} rows completed; total not yet known`);assert.equal(shown.total,0);
});
test('database import identifies the transfer and separates processed archive bytes from imported rows',()=>{
 const shown=storageProgressPresentation({stage:'read-archive',stages:['preparing','copy-workspace','transfer-database','read-archive'],completed:26080000,total:8100000000,unit:'bytes',activity:{objects:321,bytes:26080000}});
 assert.match(shown.path,/Copying workspace.*Transferring records/);
 assert.equal(shown.count,`Database archive processed: ${(26.08).toLocaleString('en')} MB of ${(8.1).toLocaleString('en')} GB`);
 assert.equal(shown.detail,'Database rows imported: 321');assert.match(shown.work,/Loading saved records and history/);assert.equal(shown.barLabel,'Importing database records');
 const checking=storageProgressPresentation({stage:'verify-history',stages:['copy-workspace','transfer-database','verify-database','verify-history'],completed:4,total:10,unit:'items'});
 assert.match(checking.path,/Verifying the dedicated workspace database/);assert.match(checking.work,/evidence references/);assert.equal(checking.completed,4);assert.equal(checking.total,10);
 const compare=storageProgressPresentation({stage:'archive-table',stages:['copy-workspace','compare-database','archive','archive-table'],completed:4,total:10,unit:'rows'});
 assert.match(compare.path,/Comparing database contents/);assert.equal(compare.completed,4);assert.equal(compare.total,10);
 const unknown=storageProgressPresentation({stage:'activate',stages:['copy-workspace','activate'],completed:0,unit:'items'});
 assert.equal(unknown.count,'');assert.equal(unknown.total,0);assert.equal(unknown.barLabel,'Opening the verified workspace');
});
test('starting a transfer reports undiscovered totals honestly and continues automatically',()=>{
 const shown=storageProgressPresentation({stage:'inventory',completed:3,unit:'files',transfer:{phase:'checking',bytes:0,files:0}});
 assert.equal(shown.count,'0 files copied');assert.equal(shown.work,'0 bytes copied');assert.equal(shown.total,undefined);assert.doesNotMatch(shown.count,/0 of 0/);
});

test('a transfer without a pre-scan shows the completed file and byte totals',()=>{const shown=storageProgressPresentation({stage:'copy-file',completed:20,total:40,unit:'bytes',transfer:{phase:'copying',bytes:1800000,files:12}});assert.equal(shown.count,'12 files copied');assert.equal(shown.work,'1.8 MB copied');assert.equal(shown.total,undefined);});

test('project transfer labels retain their own owner rather than naming the workspace',()=>{const shown=storageProgressPresentation({stage:'copy-file',completed:20,total:40,unit:'bytes',transfer:{phase:'copying',files:2,bytes:50}},{project:true});assert.equal(shown.path,'Transferring project files');assert.doesNotMatch(JSON.stringify(shown),/workspace/i);});


test('workspace bundle progress identifies the project and returns to the complete project count',()=>{
 const running=storageProgressPresentation({stage:'copy-file',completed:10,total:20,unit:'bytes',transfer:{phase:'copying',owner:'Example experiments',bytes:10,files:0}});
 assert.equal(running.path,'Transferring project files: Example experiments');
 assert.doesNotMatch(running.barLabel,/workspace/i);
 const completed=storageProgressPresentation({stage:'copy-workspace-projects',completed:1,total:2,unit:'projects'});
 assert.equal(completed.count,'Projects copied: 1 of 2');assert.equal(completed.completed,1);assert.equal(completed.total,2);
});

test('nested rename progress labels folders and books without losing the completion stream',async()=>{
 const {readProgressStream}=await import('../src/web/progress-stream.js');
 const events=[{progress:{stage:'rename-check-owners',unit:'folders',completed:3}},{progress:{stage:'rename-book-databases',unit:'books',completed:1,total:2}},{progress:{stage:'future-stage',unit:'future-unit',completed:1,total:3}},{result:{complete:true}}];
 const response=new Response(events.map(value=>JSON.stringify(value)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}}),shown=[];
 assert.deepEqual(await readProgressStream(response,value=>shown.push(storageProgressPresentation(value))),{complete:true});
 assert.match(shown[0].count,/3 folders/);assert.match(shown[1].count,/1 of 2 lab books/);assert.match(shown[2].count,/1 of 3 items/);
});


test('a selected book labels its own transfer and database stages',()=>{
 const copied=storageProgressPresentation({stage:'copy-file',completed:10,total:20,unit:'bytes',transfer:{phase:'copying',files:3,bytes:1000}},{book:true});
 assert.equal(copied.path,'Copying lab-book files');assert.equal(copied.barLabel,'Lab-book files');assert.equal(copied.count,'3 files copied');
 const checking=storageProgressPresentation({stage:'verify-lab-book-database',stages:['copy-lab-book','verify-lab-book-database'],unit:'records',completed:2,total:3},{book:true});
 assert.equal(checking.path,'Copying lab book');assert.equal(checking.barLabel,'Verifying lab-book database');assert.doesNotMatch(JSON.stringify([copied,checking]),/workspace|project/i);
});

test('import explanations name the selected database owner',()=>{
 const progress={stage:'read-archive',stages:['import-book','lab-book-database-import','read-archive'],completed:1024,total:2048,unit:'bytes',activity:{objects:4}};
 assert.match(storageProgressPresentation(progress,{book:true}).work,/this lab book.s database/);
 assert.match(storageProgressPresentation(progress,{project:true}).work,/this project.s database/);
});
