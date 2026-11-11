import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFigure} from '../src/web/figure-model.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {publicProjection} from '../src/publication-projection.js';
import {renderPublication} from '../src/publication.js';
import {figureVariants,figureVariantLanguages,mapFigureVariants,figureDrawingLanguages} from '../src/website-figure-variants.js';
import {createComposition} from '../src/web/figure-composition.js';
import {displayPlacement,sourceFragmentAtPage} from '../src/website-entry-display.js';
import {feedContentAtPage} from '../src/website-feed-template.js';
import {localizedRecordPage} from '../src/website-record-language.js';
import {figureReadingView} from '../src/web/figure-reading-view.js';
import {parseFragment} from 'parse5';

const hash=n=>String(n).repeat(64).slice(0,64);

test('variant lists keep one file per language and map every file',()=>{
 const value='en a.svg ca b.svg es c.svg';
 assert.deepEqual([...figureVariants(value)],[['en','a.svg'],['ca','b.svg'],['es','c.svg']]);
 assert.equal(figureVariants('en a.svg ca').size,0);
 assert.equal(mapFigureVariants(value,url=>'../'+url),'en ../a.svg ca ../b.svg es ../c.svg');
 assert.deepEqual(figureVariantLanguages,['en','ca','es','nb','nn']);
});

test('a website copy draws a plot once per language and the page shows the drawing for its language',()=>{
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share),plot=createFigure();
 plot.title='Mite load';plot.series[0].points=[1200.5,3400.25].map((y,x)=>({x,y,error:.25}));
 record.figures=[plot];record.sections=[];
 record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Counts.'}]}]};
 validateDetachedRecords([record]);
 const output=renderPublication(publicProjection(book),{figureLanguages:figureVariantLanguages});
 const stem=record.id+'-'+plot.id;
 for(const language of ['ca','es','nb'])assert.ok(output.files.has('figures/'+stem+'.'+language+'.svg'),language);
 // Bokmål and Nynorsk write numbers alike and share one drawing.
 assert.ok(!output.files.has('figures/'+stem+'.nn.svg'));
 const html=output.files.get('entries/'+record.id+'.html');
 assert.match(html,new RegExp('<img src="../figures/'+stem+'.svg" data-observanda-figure-variants="en ../figures/'+stem+'.svg ca ../figures/'+stem+'.ca.svg es ../figures/'+stem+'.es.svg nb ../figures/'+stem+'.nb.svg nn ../figures/'+stem+'.nb.svg"'));
 // Without languages (the generated site and PDF) nothing changes.
 assert.doesNotMatch(renderPublication(publicProjection(book)).files.get('entries/'+record.id+'.html'),/data-observanda-figure-variants/);
});

test('placed copies, displays and feeds carry every drawing and the localizer picks one',()=>{
 const files=['en','ca','es','nb','nn'].map((language,i)=>[language,'assets/'+hash(i+1)+'.svg']);
 const variants=files.map(([l,u])=>l+' '+u).join(' ');
 const fragment='<figure data-observanda-part="figure:x"><img src="'+files[0][1]+'" data-observanda-figure-variants="'+variants+'" alt="Mite load"></figure>';
 const placed=sourceFragmentAtPage(fragment,'notes/index.html');
 assert.ok(placed.includes('data-observanda-figure-variants="'+files.map(([l,u])=>l+' ../'+u).join(' ')+'"'));
 const section=parseFragment('<section data-observanda-source="'+hash('a')+'" data-observanda-source-revision="'+hash('b')+'" data-observanda-display-id="'+randomUUID()+'" data-observanda-display="section">'+placed+'</section>').childNodes[0];
 assert.deepEqual(displayPlacement(section).assets.sort(),files.map(([,u])=>u).sort());
 assert.ok(feedContentAtPage(fragment,'notes/index.html','f1').includes(' ca ../'+files[1][1]+' '));
 const page=lang=>'<!doctype html><html lang="'+lang+'"><body><main><section data-observanda-source="'+hash('a')+'" data-observanda-source-revision="'+hash('b')+'">'+placed+'</section></main></body></html>';
 const catalan=localizedRecordPage(page('ca'));
 assert.match(catalan,new RegExp('<img src="../'+files[1][1]+'"'));
 assert.match(localizedRecordPage(catalan.replace('lang="ca"','lang="nn"')),new RegExp('<img src="../'+files[4][1]+'"'));
 assert.match(localizedRecordPage(page('de')),new RegExp('<img src="../'+files[0][1]+'"'));
});

test('figure reading controls on a placed copy are labelled in the page language',async()=>{
 const {readFile}=await import('node:fs/promises');
 const es=JSON.parse(await readFile(new URL('../src/web/locales/es/book.json',import.meta.url),'utf8'));
 const view=figureReadingView('<img src="x.svg" alt="">','Mite load');
 const page='<!doctype html><html lang="es"><body><main><section data-observanda-source="'+hash('a')+'" data-observanda-source-revision="'+hash('b')+'">'+view+'</section></main></body></html>';
 const html=localizedRecordPage(page);
 assert.ok(html.includes('data-observanda-label="book:enlargeFigure">'+es.enlargeFigure+'<'));
});

test('converting an entry for websites maps every drawing to a public asset, and PDF gets none',async t=>{
 const path=await import('node:path'),os=await import('node:os'),{mkdir,mkdtemp,rm}=await import('node:fs/promises'),{randomBytes}=await import('node:crypto');
 const {Workspace}=await import('../src/storage.js'),{closeIdleMutationFiles}=await import('../src/mutation-files.js'),{convertPublicationRecord}=await import('../src/publication-conversion-render.js');
 const root=await mkdtemp(path.join(os.tmpdir(),'website-figure-variants-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-figure-variants-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 const project={id:randomUUID(),title:'Apiary',share:true},notebook={id:randomUUID(),projectId:project.id,title:'Inspections',share:true,sharePdf:true};
 const plot=createFigure();plot.title='Mite load';plot.series[0].points=[1200.5,3400.25].map((y,x)=>({x,y,error:.25}));
 const record={...sampleNotebook().entries[1],id:randomUUID(),notebookId:notebook.id,title:'Hive 4',share:true,sharePdf:true,body:'Counts.',sections:[],attachments:[],figures:[plot],relations:[],contributors:[],tags:[]};
 delete record.results;delete record.publication;delete record.attempt;delete record.template;
 const metadata={id:workspace.vault.id,projects:[project],notebooks:[notebook]};
 const website=await convertPublicationRecord(workspace,metadata,record,{target:'website'});
 const value=/data-observanda-figure-variants="([^"]+)"/.exec(website.html)?.[1];assert.ok(value,'variants missing');
 const variants=figureVariants(value),paths=new Set(website.assets.map(asset=>asset.path));
 assert.deepEqual([...variants.keys()],figureVariantLanguages);
 for(const url of variants.values()){assert.match(url,/^assets\/[a-f0-9]{64}\.svg$/);assert.ok(paths.has(url),url);}
 const pdf=await convertPublicationRecord(workspace,metadata,record,{target:'pdf'});
 if(pdf.visible)assert.doesNotMatch(pdf.html,/data-observanda-figure-variants/);
});

test('languages that write numbers alike share a drawing, and panels carry one inline drawing per number style',()=>{
 assert.deepEqual(Object.fromEntries(figureDrawingLanguages(figureVariantLanguages)),{en:'en',ca:'ca',es:'es',nb:'nb',nn:'nb'});
 const book=upgradeNotebook(sampleNotebook()),record=book.entries.find(e=>e.share);
 const panel=title=>{const f=createFigure();f.title=title;f.series[0].points=[1200.5,3400.25].map((y,x)=>({x,y,error:.25}));return f;};
 const figure=createComposition([panel('Hive A'),panel('Hive B')]);figure.title='Mite loads';
 record.figures=[figure];record.sections=[];record.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Counts.'}]}]};
 validateDetachedRecords([record]);
 const html=renderPublication(publicProjection(book),{figureLanguages:figureVariantLanguages}).files.get('entries/'+record.id+'.html');
 const groups=[...html.matchAll(/<div data-observanda-figure-language="([^"]+)"( hidden)?>/g)].map(m=>[m[1],Boolean(m[2])]);
 assert.deepEqual(groups,[['en',false],['ca',true],['es',true],['nb nn',true]]);
 const article=html.slice(html.indexOf('<article'),html.indexOf('</article>')+10);
 const page=lang=>'<!doctype html><html lang="'+lang+'"><body><main><section data-observanda-source="'+hash('a')+'" data-observanda-source-revision="'+hash('b')+'">'+article+'</section></main></body></html>';
 const shown=value=>[...localizedRecordPage(value).matchAll(/<div data-observanda-figure-language="([^"]+)"( hidden)?>/g)].filter(m=>!m[2]).map(m=>m[1]);
 assert.deepEqual(shown(page('nn')),['nb nn']);assert.deepEqual(shown(page('ca')),['ca']);assert.deepEqual(shown(page('de')),['en']);
 const nynorsk=localizedRecordPage(page('nn'));assert.equal(localizedRecordPage(nynorsk),nynorsk);
 assert.deepEqual(shown(nynorsk.replace('lang="nn"','lang="en"')),['en']);
 assert.doesNotMatch(renderPublication(publicProjection(book)).files.get('entries/'+record.id+'.html'),/data-observanda-figure-language/);
});
