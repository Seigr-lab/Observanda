import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {notebookDirectoryBook} from './publication-notebook-fixture.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {collectionPagePath} from '../src/web/public-collection-pages.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';

const feedId=html=>/class="project-book-directory"><div id="feed-([a-f0-9]+)"/.exec(html)?.[1];
const books=html=>[...html.matchAll(/class="notebook-link"><a href="..\/notebooks\/([^"]+)\.html"/g)].map(match=>match[1]);
const recordSection=html=>/<section id="page-records">([\s\S]*?)<\/section>/.exec(html)?.[1];

for(const count of [53,157])test('project directories continue through every admitted lab book: '+count,()=>{
 const book=notebookDirectoryBook(count),target='project:'+book.notebooks[0].projectId,output=buildPublication(book);verifyPublication(output);
 const first=output.files.get(collectionPagePath(target)),id=feedId(first),seen=[];assert.ok(id);assert.equal(books(first).length,24);
 for(let index=0;index<Math.ceil(count/24);index++){
  const html=output.files.get('projects/feed-'+id+'-'+index+'.html');assert.ok(html);assert.equal(books(html).length,Math.min(24,count-index*24));seen.push(...books(html));
  assert.equal(recordSection(html),recordSection(first));assert.ok(html.includes('Powered by Observanda'));assert.ok(!html.includes('PRIVATE_BOOK_SENTINEL'));assert.ok(!html.includes('PRIVATE_RECORD_SENTINEL'));
 }
 assert.deepEqual(seen,book.notebooks.slice(0,count).map(n=>n.id));
 const later=output.files.get(collectionPagePath(target,1)),laterId=feedId(later);assert.notEqual(laterId,id);
 assert.equal(recordSection(output.files.get('projects/feed-'+laterId+'-1.html')),recordSection(later));
 assert.equal(output.pages.filter(page=>page.path.startsWith('projects/')).length,book.projects.filter(p=>p.share).length);
});

test('default directories remain scoped to their project and respect replacement designs',()=>{
 const book=notebookDirectoryBook(),original=book.notebooks[0],project={...structuredClone(book.projects.find(p=>p.id===original.projectId)),id:randomUUID(),title:'Another project'};book.projects.push(project);
 const other={...structuredClone(original),id:randomUUID(),projectId:project.id,title:'Other project book'};book.notebooks.push(other);book.entries.push({...structuredClone(book.entries[0]),id:randomUUID(),notebookId:other.id});
 let output=buildPublication(book);verifyPublication(output);assert.ok(!output.files.get(collectionPagePath('project:'+original.projectId)).includes(other.title));
 const small=output.files.get(collectionPagePath('project:'+project.id));assert.ok(small.includes(other.title));assert.ok(!small.includes('project-book-directory'));assert.ok(!small.includes(original.title));
 book.website.layouts.push({...defaultPageLayout('project:'+original.projectId),placement:'replace',sections:[]});
 output=buildPublication(book);verifyPublication(output);assert.ok(!output.files.get(collectionPagePath('project:'+original.projectId)).includes('project-book-directory'));
});
