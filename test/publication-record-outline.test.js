import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {parseFragment} from 'parse5';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {convertPublicationRecord,nestRecordHeadings} from '../src/publication-conversion-render.js';
import {sampleNotebook} from '../src/sample.js';
import {descendants,attr} from '../src/website-migration-views.js';

const headings=html=>[...descendants(parseFragment(html))].filter(n=>/^h[1-6]$/.test(n.tagName));

test('headings inside an entry move one level down and h6 stays h6',()=>{
 const article=parseFragment('<article><h1>a</h1><section><h2>b</h2><h5>c</h5><h6>d</h6></section></article>').childNodes[0];
 nestRecordHeadings(article);
 assert.deepEqual([...descendants(article)].filter(n=>/^h\d$/.test(n.tagName)).map(n=>n.tagName),['h2','h3','h6','h6']);
});

test('a website copy nests its sections under the entry title while the PDF copy is unchanged',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'publication-record-outline-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('publication-record-outline-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 const project={id:randomUUID(),title:'Apiary',share:true},book={id:randomUUID(),projectId:project.id,title:'Inspections',share:true};
 const metadata={id:workspace.vault.id,projects:[project],notebooks:[book]};
 const section={id:randomUUID(),title:'Mite count',body:'Three mites per hundred bees.',share:true};
 const record={...sampleNotebook().entries[1],id:randomUUID(),notebookId:book.id,title:'Hive 4',share:true,body:'Brood frames inspected.',sections:[section],attachments:[],figures:[],relations:[],contributors:[],tags:[]};
 delete record.results;delete record.publication;delete record.attempt;delete record.template;
 const website=await convertPublicationRecord(workspace,metadata,record,{target:'website'});
 const levels=headings(website.html).map(n=>[n.tagName,n.childNodes.map(c=>c.value??'').join('')]);
 assert.deepEqual(levels[0],['h2','Hive 4']);
 assert.ok(levels.slice(1).length&&levels.slice(1).every(([tag])=>tag!=='h2'&&tag!=='h1'),JSON.stringify(levels));
 const sectionHeading=headings(website.html).find(n=>attr(n.parentNode,'data-observanda-part')==='section:'+section.id);
 assert.equal(sectionHeading?.tagName,'h3');
 const pdf=await convertPublicationRecord(workspace,metadata,{...record,sharePdf:true,sections:[{...section,sharePdf:true}]},{target:'pdf'});
 if(pdf.visible)assert.ok(headings(pdf.html).some(n=>n.tagName==='h2'&&attr(n.parentNode,'data-observanda-part')==='section:'+section.id));
});

test('a website copy layers its renderer styles below the site and lets wide tables scroll',async t=>{
 const {retainedArticleCSS}=await import('../src/website-entry-styles.js');
 const {validateWebsiteCSS}=await import('../src/website-file-policy.js');
 const {websiteRecordRules}=await import('../src/publication-conversion-render.js');
 const root=await mkdtemp(path.join(os.tmpdir(),'publication-record-outline-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('publication-record-outline-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 const project={id:randomUUID(),title:'Apiary',share:true},book={id:randomUUID(),projectId:project.id,title:'Inspections',share:true,sharePdf:true};
 const record={...sampleNotebook().entries[1],id:randomUUID(),notebookId:book.id,title:'Hive 4',share:true,sharePdf:true,body:'Brood frames inspected.',sections:[],attachments:[],figures:[],relations:[],contributors:[],tags:[]};
 delete record.results;delete record.publication;delete record.attempt;delete record.template;
 const metadata={id:workspace.vault.id,projects:[project],notebooks:[book]};
 const website=await convertPublicationRecord(workspace,metadata,record,{target:'website'});
 validateWebsiteCSS(website.css);
 const layer=website.css.indexOf('@layer observanda-record {\n@scope ([data-observanda-source]) {');
 assert.ok(layer>=0);assert.ok(website.css.trimEnd().endsWith('}\n}'));
 assert.ok(website.css.includes(websiteRecordRules));
 // No renderer rule escapes the layer.
 assert.doesNotMatch(website.css.slice(0,layer),/\{[^}]*(?:color|font-size|margin)/);
 assert.equal(retainedArticleCSS(website.css,record.id,website.html),website.css.replace(/\n\[data-page="entry:[0-9a-f-]{36}"\] \.site-footer\{[^}]*\}(?=\n\}\n\}$)/u,''));
 const pdf=await convertPublicationRecord(workspace,metadata,record,{target:'pdf'});
 if(pdf.visible)assert.ok(!pdf.css.includes('@layer observanda-record'));
});
