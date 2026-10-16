import {legacyRecords} from './legacy-records.js';
import {formattedText} from '../src/web/formatted-text.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {Workspace,digest} from '../src/storage.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {websiteSummary,navigationItems} from '../src/web/website-model.js';

test('every public page ends with the themed Observanda credit, after authored footer text',()=>{
 const book=sampleNotebook();book.website.footer='Our collective <&> its work';
 book.pages.push({id:randomUUID(),title:'About',body:'An introduction',share:true,sections:[]});
 const output=buildPublication(book);
 for(const [name,html] of output.files)if(name.endsWith('.html')){
  assert.equal((html.match(/Powered by Observanda/g)??[]).length,1,name);
  assert.match(html,/<footer class="site-footer"><p>Our collective &lt;&amp;&gt; its work<\/p><p class="powered-by"><a href="https:\/\/github.com\/Seigr-lab\/Observanda" target="_blank" rel="noopener noreferrer">Powered by Observanda<\/a><\/p><\/footer><\/body><\/html>/);
 }
 book.website.footer='';book.website.home.enabled=false;
 const withoutHome=buildPublication(book);assert.ok(!withoutHome.files.has('index.html'));
 for(const [name,html] of withoutHome.files)if(name.endsWith('.html'))assert.match(html,/<footer class="site-footer"><p class="powered-by">/);
});

test('mixed alignments survive validation and projection without changing earlier shared alignments',()=>{
 const book=sampleNotebook(),style={width:'full',surface:'none',align:'center',space:'normal',headingAlign:'end',bodyAlign:'justify',itemHeadingAlign:'start',detailsAlign:'center',captionAlign:'end',buttonAlign:'start'};
 book.website.home.sections[0].style=style;validateNotebook(book);
 assert.deepEqual(publicProjection(book).website.home.sections[0].style,style);
 assert.match(buildPublication(book).files.get('styles.css'),/--section-heading-align:end;--section-body-align:justify;--section-item-heading-align:start;--section-details-align:center;--section-caption-align:end;--section-button-align:start/);
 for(const key of ['headingAlign','bodyAlign','itemHeadingAlign','detailsAlign','captionAlign','buttonAlign']){
  const bad=structuredClone(book);bad.website.home.sections[0].style[key]='center;display:none';assert.throws(()=>buildPublication(bad),{code:'INVALID'});
 }
 book.website.home.sections[0].style={width:'full',surface:'none',align:'center',space:'normal'};
 assert.match(buildPublication(book).files.get('styles.css'),/--section-heading-align:center;--section-body-align:center;--section-item-heading-align:center/);
});

test('website composition upgrades format 5 without rewriting source bytes and separates site identity from workspace identity',async()=>{
 const legacy=legacyRecords(sampleNotebook());legacy.formatVersion=5;delete legacy.website.typography;delete legacy.website.presentation;delete legacy.website.palette;for(const key of ['title','description','home','design','assets','layouts','templates'])delete legacy.website[key];
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-site-upgrade-')),original=JSON.stringify(legacy),file=path.join(root,'observanda.json');await writeFile(file,original);
 const ws=new Workspace(root),current=await ws.read(),next=upgradeNotebook(current.book);
 assert.equal(await readFile(file,'utf8'),original);assert.equal(next.formatVersion,21);assert.equal(publicProjection(next).title,legacy.title);
 next.website.title='Kitchen field notes';next.website.description='Recipes and experiments.';next.website.home.title='In the kitchen';
 await ws.save(next,current.etag);const reopened=(await ws.read()).book;
 assert.equal(reopened.title,legacy.title);assert.equal(reopened.description,legacy.description);assert.equal(publicProjection(reopened).title,'Kitchen field notes');
 assert.equal(await readFile(path.join(root,'.observanda/revisions',digest(original)+'.json'),'utf8'),original);
});

test('ordered homepage sections render real text, pages and collections, escape markup, and omit disabled drafts',()=>{
 const b=sampleNotebook();b.website.title='Field studies';b.website.home.showTitle=false;
 b.pages.push({id:randomUUID(),title:'About our work',body:'A page independent of research records.',share:true});
 b.website.home.sections=[{id:'intro',kind:'text',title:'A closer observation',body:'One paragraph.\n\n<script>attack()</script>',show:true},{id:'pages',kind:'pages',title:'Read more',layout:'list',show:true},{id:'projects',kind:'projects',title:'Research lines',layout:'grid',show:true},{id:'hidden',kind:'text',title:'Private draft',body:'/home/private/secret',show:false}];
 const c=buildPublication(b),html=c.files.get('index.html');
 assert.ok(html.indexOf('A closer observation')<html.indexOf('Read more'));assert.ok(html.indexOf('Read more')<html.indexOf('Research lines'));
 assert.ok(html.includes('&lt;script&gt;attack()&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(![...c.files.values()].join('').includes('Private draft'));
 assert.ok(html.includes('section-layout-list'));assert.ok(html.includes('class="visually-hidden"'));assert.ok(!html.includes('<title>Field studies | Field studies</title>'));
 assert.equal(websiteSummary(b).pages.length,1);
});

test('homepage media reuses selected presentation copies and never exposes excluded records, media, or stale references',async()=>{
 const b=sampleNotebook(),e=b.entries[0],id=randomUUID();e.attachments=[{id,kind:'image',caption:'Evidence image',alt:'A test grid',transcript:'',share:true}];
 b.website.home.sections=[{id:'image',kind:'media',title:'Selected evidence',entryId:e.id,attachmentId:id,show:true}];
 const assets=new Map([[id,{kind:'image',extension:'png',bytes:await readFile(new URL('../src/preview-assets/image.png',import.meta.url))}]]);
 let c=buildPublication(b,{mediaFiles:assets});assert.ok(c.files.get('index.html').includes(`src="media/${id}.png"`));assert.ok(c.files.get(`entries/${e.id}.html`).includes(`src="../media/${id}.png"`));
 for(const exclude of [()=>{e.attachments[0].share=false;},()=>{e.share=false;},()=>{b.projects[0].share=false;},()=>{b.website.home.sections[0].attachmentId=randomUUID();}]){
  b.projects[0].share=e.share=e.attachments[0].share=true;b.website.home.sections[0].attachmentId=id;exclude();c=buildPublication(b,{mediaFiles:assets});
  assert.ok(!c.files.get('index.html').includes('Selected evidence'));assert.ok(!c.files.get('index.html').includes(id));
 }
});

test('selection summary explains blocked records and permits a standalone homepage without making private work public',()=>{
 const b=sampleNotebook();b.description='';b.projects[0].share=false;
 let s=websiteSummary(b);assert.equal(s.canPublish,false);assert.equal(s.blockedEntries.length,2);assert.equal(s.entries.length,0);
 assert.equal(navigationItems(b).find(i=>i.target==='project:'+b.projects[0].id).available,false);
 b.website.description='Independent studio';s=websiteSummary(b);assert.equal(s.canPublish,true);assert.equal(s.entries.length,0);
 b.website.description='';b.website.home.sections.push({id:'text',kind:'text',title:'Our methods',body:'Observing carefully.',show:true});assert.equal(websiteSummary(b).canPublish,true);
});

test('composition validation rejects invalid IDs, unknown section kinds, duplicate IDs, unsafe structures and malformed media references',()=>{
 for(const edit of [b=>b.website.home.sections.push({...b.website.home.sections[0]}),b=>b.website.home.sections[0].id='" onclick="attack()',b=>b.website.home.sections[0].kind='script',b=>b.website.home.sections[0].layout='javascript',b=>b.website.title=false,b=>b.website.home.extra=true,b=>b.website.home.sections=[{id:'media',kind:'media',title:'',show:true,entryId:'missing',attachmentId:randomUUID()}]]){
  const b=sampleNotebook();edit(b);assert.throws(()=>validateNotebook(b),{code:'INVALID'});
 }
});


test('format 6 composition upgrades with layout defaults without changing saved source, sections or identities',async()=>{
 const source=legacyRecords(sampleNotebook());source.formatVersion=6;delete source.website.typography;delete source.website.presentation;delete source.website.palette;delete source.website.design;delete source.website.assets;delete source.website.layouts;delete source.website.templates;
 const original=JSON.stringify(source),next=upgradeNotebook(source);assert.equal(JSON.stringify(source),original);assert.equal(next.formatVersion,21);assert.deepEqual(next.website.home,source.website.home);assert.equal(next.website.design.width,1200);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-layout-migration-')),file=path.join(root,'observanda.json');await writeFile(file,original);const ws=new Workspace(root),current=await ws.read();next.website.design.navigation='side';await ws.save(next,current.etag);assert.equal(await readFile(path.join(root,'.observanda/revisions',digest(original)+'.json'),'utf8'),original);
});

test('authored pages compose columns, callouts, portable links and filtered collections without leaking excluded content',()=>{
 const b=sampleNotebook(),id=randomUUID();b.entries[0].tags=['featured'];
 b.pages.push({id,title:'Our methods',body:'Introduction',share:true,sections:[
  {id:'method',kind:'callout',title:'Repeat and compare',body:'Preserve the original observations.',show:true,style:{width:'half',surface:'tint',align:'start',space:'roomy'}},
  {id:'records',kind:'records',title:'Selected work',show:true,layout:'editorial',filter:{projectId:b.projects[0].id,tag:'featured',limit:1}},
  {id:'back',kind:'link',title:'Continue reading',label:'Project',body:'Find all published records.',href:'project:'+b.projects[0].id,show:true},
  {id:'hidden-link',kind:'link',title:'Private destination',label:'Private record',body:'Do not publish this text.',href:'entry:'+b.entries.find(e=>!e.share).id,show:true},
  {id:'hidden',kind:'text',title:'Secret text',body:'Unpublished material',show:false}
 ]});
 const out=buildPublication(b),html=out.files.get('pages/'+id+'.html');assert.match(html,/block-width-half block-surface-tint block-align-start block-space-roomy/);assert.match(html,/section-layout-editorial/);assert.match(html,new RegExp('href="../projects/'+b.projects[0].id+'.html"'));assert.match(html,/Watching a seed unfold/);assert.doesNotMatch(html,/Does paper change|Private destination|Do not publish|Unpublished material/);assert.match(html,/section-method/);
 b.projects[0].share=false;const hidden=buildPublication(b).files.get('pages/'+id+'.html');assert.doesNotMatch(hidden,/Selected work|Continue reading/);assert.match(hidden,/Repeat and compare/);
});

test('page composition rejects executable links, malformed styles and invalid collection filters before rendering',()=>{
 for(const href of ['javascript:alert(1)','file:///tmp/private','https://user:secret@example.com','data:text/html,hello','//example.com']){
  const b=sampleNotebook();b.website.home.sections=[{id:'link',kind:'link',title:'',label:'Open',body:'',href,show:true}];assert.throws(()=>validateNotebook(b),{code:'INVALID'});
 }
 for(const mutate of [s=>s.style={width:'full; color:red',surface:'card',align:'start',space:'normal'},s=>s.filter={projectId:null,tag:'',limit:-1},s=>s.filter={projectId:'missing',tag:'',limit:1}]){
  const b=sampleNotebook();mutate(b.website.home.sections[0]);assert.throws(()=>validateNotebook(b),{code:'INVALID'});
 }
 const b=sampleNotebook();b.website.design.width=5000;assert.throws(()=>validateNotebook(b),{code:'INVALID'});
});


test('nested navigation validates cycles and keeps children usable when a parent is excluded',()=>{
 const b=sampleNotebook(),parent=b.projects[0],id=randomUUID();b.pages.push({id,title:'Methods',body:'Published methods',share:true});
 b.website.navigation=[{target:'home',label:'Start',show:true,parent:null},{target:'project:'+parent.id,label:'Research',show:true,parent:null},{target:'page:'+id,label:'Methods',show:true,parent:'project:'+parent.id}];
 const html=buildPublication(b).files.get('index.html');assert.match(html,/Pages under Research/);assert.match(html,/class="site-submenu"/);assert.match(html,new RegExp('href="pages/'+id+'.html"'));
 const cycle=structuredClone(b);cycle.website.navigation[1].parent='page:'+id;assert.throws(()=>validateNotebook(cycle),{code:'INVALID'});
 const missing=structuredClone(b);missing.website.navigation[1].parent='missing';assert.throws(()=>validateNotebook(missing),{code:'INVALID'});
 b.projects[0].share=false;const projection=publicProjection(b);assert.equal(projection.website.navigation.find(item=>item.target==='page:'+id).parent,null);assert.doesNotMatch(buildPublication(b).files.get('index.html'),/Pages under Research/);
});


test('format 7 migration preserves source and scoped composition does not change research or publish saved templates',()=>{
 const source=legacyRecords(sampleNotebook());source.formatVersion=7;delete source.website.typography;delete source.website.presentation;delete source.website.palette;delete source.website.layouts;delete source.website.templates;const original=JSON.stringify(source),book=upgradeNotebook(source);assert.equal(JSON.stringify(source),original);assert.equal(book.formatVersion,21);const research=JSON.stringify(book.entries),project=book.projects[0];
 book.website.layouts.push({...defaultPageLayout('project:'+project.id),heading:'Fieldwork archive',showHeading:false,placement:'replace',sections:[{id:'intro',kind:'hero',title:'Follow the evidence',body:'A **careful** record.',format:'markdown',assetId:null,href:'home',label:'Back home',show:true}]});
 book.website.templates.push({id:randomUUID(),name:'Secret template name',sections:[{id:'private',kind:'text',title:'Hidden private instructions',body:'Never published without applying',show:true}]});
 const result=buildPublication(book),html=result.files.get('projects/'+project.id+'.html');assert.match(html,/Follow the evidence/);assert.match(html,/<strong>careful<\/strong>/);assert.doesNotMatch(html,/<header class="site-header">/);assert.doesNotMatch([...result.files.values()].join(''),/Secret template|Hidden private/);assert.equal(JSON.stringify(book.entries),research);
});

test('formatted blocks escape HTML, reject executable links, and preserve lists and code',()=>{
 const html=formattedText('## Method\n\n**Bold** and *emphasis*\n\n- One\n- Two\n\n<script>alert(1)</script>\n\n[Safe](https://example.org) [Unsafe](javascript:alert(1))\n\n```\n<tag>\n```','markdown');assert.match(html,/<h3>Method<\/h3>/);assert.match(html,/<ul><li>One<\/li><li>Two<\/li><\/ul>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|href="javascript/);assert.match(html,/<pre><code>&lt;tag&gt;/);
});

test('hero and ordered gallery assets are emitted only for included composed pages',async()=>{
 const book=sampleNotebook(),a=randomUUID(),b=randomUUID(),p=randomUUID();book.website.assets=[a,b].map(id=>({id,kind:'image',caption:'Image '+id,alt:'Synthetic specimen',transcript:''}));book.pages.push({id:p,title:'Gallery',body:'',share:false,sections:[{id:'hero',kind:'hero',title:'Observe',body:'',assetId:a,href:'home',label:'',show:true},{id:'gallery',kind:'gallery',title:'Specimens',assetIds:[b,a],columns:2,show:true}]});const bytes=await readFile(new URL('../src/preview-assets/image.png',import.meta.url)),mediaFiles=new Map([a,b].map(id=>[id,{kind:'image',extension:'png',bytes}]));
 assert.ok(!buildPublication(book,{mediaFiles}).files.has('media/'+a+'.png'));const preview=buildPublication(book,{mediaFiles,designPageId:p}),html=preview.files.get('pages/'+p+'.html');assert.match(html,/gallery-columns-2/);assert.ok(html.lastIndexOf(b)<html.lastIndexOf(a));assert.equal(book.pages[0].share,false);book.pages[0].share=true;assert.ok(buildPublication(book,{mediaFiles}).files.has('media/'+b+'.png'));
});
