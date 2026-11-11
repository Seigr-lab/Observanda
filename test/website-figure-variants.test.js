import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFigure} from '../src/web/figure-model.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateDetachedRecords} from '../src/model.js';
import {publicProjection} from '../src/publication-projection.js';
import {renderPublication} from '../src/publication.js';
import {figureVariants,figureVariantLanguages,mapFigureVariants} from '../src/website-figure-variants.js';
import {displayPlacement,sourceFragmentAtPage} from '../src/website-entry-display.js';
import {feedContentAtPage} from '../src/website-feed-template.js';
import {localizedRecordPage} from '../src/website-record-language.js';
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
 for(const language of ['ca','es','nb','nn'])assert.ok(output.files.has('figures/'+stem+'.'+language+'.svg'),language);
 const html=output.files.get('entries/'+record.id+'.html');
 assert.match(html,new RegExp('<img src="../figures/'+stem+'.svg" data-observanda-figure-variants="en ../figures/'+stem+'.svg ca ../figures/'+stem+'.ca.svg es ../figures/'+stem+'.es.svg nb ../figures/'+stem+'.nb.svg nn ../figures/'+stem+'.nn.svg"'));
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
