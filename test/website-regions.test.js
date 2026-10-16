import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {createRegion,assignRegion,resolveRegion} from '../src/web/website-regions.js';
import {websiteSummary} from '../src/web/website-model.js';
import {footerTextAlignment} from '../src/web/website-footer.js';
import {mediaStyle,copySectionPresentation} from '../src/web/media-presentation.js';
import {newElement} from '../src/web/composition-tree.js';

test('custom headers retain reuse and independent copies without publishing unused automatic logos',()=>{
 const book=sampleNotebook(),logo=randomUUID(),page=randomUUID();book.website.logoId=logo;book.website.logoAlt='UNUSED_AUTOMATIC_LOGO';book.pages.push({id:page,title:'Sound',body:'Listening and exploration',share:true,sections:[]});
 const header=createRegion(book.website,'header','PRIVATE_HEADER_NAME',{makeId:randomUUID}),row=newElement('container',randomUUID);row.layout='row';
 header.sections=[row,{...newElement('heading',randomUUID),title:'Seigr',parentId:row.id},{...newElement('text',randomUUID),body:'A continuum of code, sound and nature',parentId:row.id}];assignRegion(book.website,'*','header',header.id);
 validateNotebook(book);let site=buildPublication(book);assert.ok(!site.files.has('media/'+logo+'.png'));assert.ok(!site.files.get('index.html').includes('UNUSED_AUTOMATIC_LOGO'));assert.ok(!site.files.get('index.html').includes('PRIVATE_HEADER_NAME'));assert.match(site.files.get('index.html'),/class="site-masthead"/);assert.ok(!site.files.get('index.html').includes('class="site-top"'));
 const copy=createRegion(book.website,'header','PRIVATE_PAGE_COPY',{copy:header,makeId:randomUUID});copy.sections.find(s=>s.kind==='heading').title='Seigr sound';assignRegion(book.website,'page:'+page,'header',copy.id);validateNotebook(book);site=buildPublication(book);assert.ok(site.files.get('pages/'+page+'.html').includes('Seigr sound'));assert.ok(!site.files.get('index.html').includes('Seigr sound'));assert.equal(copy.sections[1].parentId,copy.sections[0].id);
 book.website.logoId=null;assignRegion(book.website,'page:'+page,'header',null);site=buildPublication(book);assert.ok(site.files.get('pages/'+page+'.html').includes('class="site-top"'));assert.ok(!site.files.get('pages/'+page+'.html').includes('class="site-masthead"'));assert.match(site.files.get('index.html'),/class="site-masthead"/);
});
const fixture=()=>upgradeNotebook(sampleNotebook());
const create=(book,kind,name)=>createRegion(book.website,kind,name,{makeId:randomUUID});

test('attribution follows closing footer text and uses center only without authored footer content',()=>{
 assert.equal(footerTextAlignment(null,''),'center');assert.equal(footerTextAlignment(null,'Our footer'),'start');
 const book=fixture(),footer=create(book,'footer','Aligned footer'),text={...newElement('text',randomUUID),body:'Footer text'};footer.sections=[text];assignRegion(book.website,'*','footer',footer.id);
 for(const align of ['start','center','end','justify']){text.style={width:'full',surface:'none',align:'start',space:'normal',bodyAlign:align};assert.equal(footerTextAlignment(footer),align);assert.ok(buildPublication(book).files.get('styles.css').includes('--footer-text-align:'+align));}
 text.format='rich';text.richText={type:'doc',content:[{type:'paragraph',attrs:{align:'end'},content:[{type:'text',text:'Closing footer text'}]}]};assert.equal(footerTextAlignment(footer),'end');
 footer.sections.push({...newElement('heading',randomUUID),title:'Hidden',show:false,style:{...text.style,headingAlign:'center'}});assert.equal(footerTextAlignment(footer),'end');
 footer.sections=[{...newElement('text',randomUUID)}];assert.equal(footerTextAlignment(footer),'center');
});

test('shared media presentation projects into every assigned page and independent copies retain their own settings',()=>{
 const book=fixture(),footer=create(book,'footer','Shared'),asset={id:randomUUID(),kind:'image',caption:'Mark',alt:'Mark',transcript:''};book.website.assets.push(asset);footer.sections=[{...newElement('asset',randomUUID),assetId:asset.id}];assignRegion(book.website,'*','footer',footer.id);
 const scope='region:'+footer.id+'#'+footer.sections[0].id;book.website.presentation.media.push({...mediaStyle(book.website,scope,asset.id),scope,id:asset.id,ratio:'portrait'});
 const copy=createRegion(book.website,'footer','Independent',{copy:footer,makeId:randomUUID});copySectionPresentation(book.website,'region:'+footer.id,footer.sections,'region:'+copy.id,copy.sections);assignRegion(book.website,'home','footer',copy.id);
 const copyScope='region:'+copy.id+'#'+copy.sections[0].id;book.website.presentation.media.find(m=>m.scope===copyScope).ratio='square';validateNotebook(book);
 const projected=publicProjection(book);assert.ok(projected.website.presentation.media.every(m=>!m.scope.startsWith('region:')));assert.equal(projected.website.presentation.media.find(m=>m.scope.startsWith('home#')).ratio,'square');assert.ok(projected.website.presentation.media.filter(m=>!m.scope.startsWith('home#')).every(m=>m.ratio==='portrait'));
});

test('shared designs, page overrides and independent copies survive validation without altering page content',()=>{
 const book=fixture(),before=structuredClone(book.website.home),side=create(book,'sidebar','Shared sidebar');
 side.sections=[{...newElement('contents',randomUUID),title:'Contents'}];
 assignRegion(book.website,'*','sidebar',side.id);
 const target='project:'+book.projects[0].id;
 assert.equal(resolveRegion(book.website,target,'sidebar'),side);
 assignRegion(book.website,target,'sidebar',null);assert.equal(resolveRegion(book.website,target,'sidebar'),null);
 assignRegion(book.website,target,'sidebar',undefined);assert.equal(resolveRegion(book.website,target,'sidebar'),side);
 const local=createRegion(book.website,'sidebar','Local',{copy:side,makeId:randomUUID});assignRegion(book.website,target,'sidebar',local.id);local.sections[0].title='Local index';
 assert.equal(side.sections[0].title,'Contents');assert.notEqual(local.sections[0].id,side.sections[0].id);
 assert.deepEqual(book.website.home,before);validateNotebook(book);
 const restored=upgradeNotebook(JSON.parse(JSON.stringify(book)));assert.equal(resolveRegion(restored.website,target,'sidebar').name,'Local');
 for(const change of [b=>b.website.design.regions.definitions[0].width=999,b=>b.website.design.regions.assignments.push({...b.website.design.regions.assignments[0]}),b=>b.website.design.regions.definitions[0].background='url(https://example.com)',b=>b.website.design.regions.assignments[0].regionId='missing']){const bad=structuredClone(book);change(bad);assert.throws(()=>validateNotebook(bad),{code:'INVALID'});}
});

test('reused contents link only the exported page sections with stable anchors and no private design metadata',()=>{
 const book=fixture(),side=create(book,'sidebar','PRIVATE_AUTHORING_NAME');side.sections=[{...newElement('contents',randomUUID),title:'On this page'}];assignRegion(book.website,'*','sidebar',side.id);
 const heading={...newElement('heading',randomUUID),title:'Public introduction'},hidden={...newElement('heading',randomUUID),title:'PRIVATE_HIDDEN_HEADING',show:false};book.website.home.sections=[heading,hidden];
 const unused=create(book,'sidebar','UNUSED_PRIVATE_DESIGN');unused.sections=[{...newElement('text',randomUUID),body:'PRIVATE_UNUSED_BODY'}];
 const privatePage={id:randomUUID(),title:'PRIVATE_PAGE',body:'',share:false,sections:[]};book.pages.push(privatePage);assignRegion(book.website,'page:'+privatePage.id,'sidebar',unused.id);
 const projection=publicProjection(book),serialized=JSON.stringify(projection);for(const privateText of ['PRIVATE_','UNUSED_PRIVATE_DESIGN',privatePage.id,side.id])assert.ok(!serialized.includes(privateText),privateText);
 const output=buildPublication(book),home=output.files.get('index.html');assert.ok(home.includes('href="#section-'+heading.id+'"'));assert.ok(home.includes('id="section-'+heading.id+'"'));assert.ok(!home.includes(hidden.id));
 const project=output.files.get('projects/'+book.projects[0].id+'.html');assert.match(project,/href="#page-notebooks"/);assert.match(project,/id="page-notebooks"/);assert.ok(!project.includes('href="#section-'+heading.id+'"'));
 for(const [name,html] of output.files)if(name.endsWith('.html')){const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,name);for(const match of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(match[1]),name+': '+match[1]);}
});

test('footer composition exports its media once and integrates attribution into the same styled footer',()=>{
 const book=fixture(),footer=create(book,'footer','Studio footer'),asset={id:randomUUID(),kind:'image',caption:'Studio mark',alt:'Mark',transcript:''};book.website.assets.push(asset);
 footer.background='#142536';footer.color='#fefefe';footer.sections=[{...newElement('text',randomUUID),body:'Made together'},{...newElement('asset',randomUUID),assetId:asset.id}];assignRegion(book.website,'*','footer',footer.id);book.website.footer='OLD_FOOTER_TEXT';
 assert.ok(websiteSummary(book).media.some(m=>m.id===asset.id));
 const output=buildPublication(book,{mediaFiles:new Map([[asset.id,{kind:'image',extension:'png',bytes:readFileSync(new URL('../src/preview-assets/image.png',import.meta.url))} ]])});
 assert.ok(output.files.has('media/'+asset.id+'.png'));assert.match(output.files.get('styles.css'),/\.site-footer\{padding:20px;background:#142536;color:#fefefe/);
 for(const [name,html] of output.files)if(name.endsWith('.html')){assert.equal((html.match(/Powered by Observanda/g)??[]).length,1);assert.ok(!html.includes('OLD_FOOTER_TEXT'));assert.match(html,/<footer class="site-footer"><div class="page-composition" data-composition="footer">/);assert.match(html,/<p class="powered-by">.*<\/p><\/footer><\/body><\/html>/);}
 assignRegion(book.website,'*','footer',undefined);assert.ok(!publicProjection(book).website.assets.some(a=>a.id===asset.id));
});

test('sidebar slots share designs without sharing assignments or exported element identities',()=>{
 const book=fixture(),side=create(book,'sidebar','PRIVATE_DESIGN_NAME');side.sections=[{...newElement('text',randomUUID),body:'Chapter navigation'}];side.mobile='collapsed';side.mobileTitle='Chapters';
 assignRegion(book.website,'*','sidebar',side.id);assignRegion(book.website,'home','secondary-sidebar',side.id);
 validateNotebook(book);assert.equal(resolveRegion(book.website,'home','secondary-sidebar'),side);
 const output=buildPublication(book),html=output.files.get('index.html');
 assert.match(html,/data-composition="secondary-sidebar"/);assert.match(html,/sidebar-disclosure/);assert.ok(!html.includes(side.name));
 const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 assignRegion(book.website,'home','secondary-sidebar',null);assert.equal(resolveRegion(book.website,'home','sidebar'),side);assert.equal(resolveRegion(book.website,'home','secondary-sidebar'),null);
 const second=createRegion(book.website,'secondary-sidebar','PRIVATE_SECOND_NAME',{makeId:randomUUID});assert.equal(second.kind,'sidebar');assert.equal(second.side,'right');
 second.sections=[{...newElement('contents',randomUUID),title:'Contents'}];assignRegion(book.website,'*','secondary-sidebar',second.id);assignRegion(book.website,'home','secondary-sidebar',undefined);validateNotebook(book);
 const published=publicProjection(book);assert.ok(published.website.regions.some(r=>r.kind==='secondary-sidebar'&&r.side==='right'));assert.ok(!JSON.stringify(published).includes('PRIVATE_'));
 for(const mutate of [r=>r.mobile='script',r=>r.mobileTitle='\u0000',r=>r.mobileTitle=false]){const bad=structuredClone(book);mutate(bad.website.design.regions.definitions[0]);assert.throws(()=>validateNotebook(bad),{code:'INVALID'});}
});
