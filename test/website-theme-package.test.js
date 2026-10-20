import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,readdir,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startingAppearance} from '../src/web/themes.js';
import {validWebsiteTheme,themeReferences,WEBSITE_THEME_MAGIC} from '../src/web/website-theme-model.js';
import {websiteThemeRemapper,captureWebsiteTheme} from '../src/website-theme-package.js';
import {WebsiteThemeResources} from '../src/website-theme-resources.js';
import {websiteThemeUI} from '../src/web/website-theme-ui.js';
const base=()=>({format:'observanda-website-theme',version:1,name:'Field design',appearance:{...startingAppearance('research'),font:'modern',headingFont:'editorial'},palette:{accent:'#123456'},typography:{font:'modern'},design:{width:1100,navigation:'top',heading:'split',contents:true,regions:{definitions:[],assignments:[]}},templates:[],presentation:{media:[],covers:[]},assets:[],fonts:[],resources:[]});
const section=(id=randomUUID())=>({id,kind:'text',title:'Reading',show:true,body:'Authored reusable text'});
const bytes=Buffer.alloc(1024*1024+19,0x71),sha256=createHash('sha256').update(bytes).digest('hex');
function withAsset(){const p=base(),id=randomUUID(),s={id:randomUUID(),kind:'asset',title:'Design image',show:true,assetId:id};p.templates=[{id:randomUUID(),name:'Illustration',sections:[s]}];p.assets=[{id,kind:'image',caption:'Design caption',alt:'Texture',transcript:''}];p.resources=[{id,kind:'image',name:'asset.png',size:bytes.length,sha256}];return p;}
test('theme packages retain only selected definitions and inherited baselines while remapping every owner and anchor',async()=>{
 const parent=randomUUID(),child=randomUUID(),unselected=randomUUID(),anchor=randomUUID(),parentSection=section(),childSection=section();
 const rich={...section(),body:'',format:'rich',richText:{type:'doc',content:[]}};
 rich.richText.content.push({type:'heading',attrs:{level:2,id:anchor},content:[{type:'text',text:'Heading'}]});
 rich.richText.content.push({type:'paragraph',content:[{type:'text',text:'Follow heading',marks:[{type:'link',attrs:{href:'#record-section-'+anchor,title:'',target:'_self',nofollow:false}}]}]});
 const p=base(),header={document:{appearance:p.appearance,website:{palette:p.palette,typography:p.typography,design:p.design,presentation:p.presentation,templates:[{id:parent,name:'Parent',sections:[parentSection]},{id:child,name:'Child',sections:[childSection,rich],templateLink:{version:1,templateId:parent,root:'a'.repeat(64),sectionIds:[{templateId:parentSection.id,pageId:childSection.id}]}},{id:unselected,name:'Private unused',sections:[section()]}]}}};
 const {value}=await captureWebsiteTheme(header,{name:'Reusable',templateIds:[child],regionIds:[]},async()=>({sections:[parentSection],media:[]}));assert.equal(value.templates.length,2);assert.equal(validWebsiteTheme(value),true);
 const mapped=websiteThemeRemapper().remap(value);assert.equal(validWebsiteTheme(mapped),true);const text=JSON.stringify(mapped);for(const original of [parent,child,unselected,anchor,parentSection.id,childSection.id,'a'.repeat(64)])assert.equal(text.includes(original),false);
 const next=mapped.templates[1],heading=next.sections[1].richText.content[0].attrs.id,href=next.sections[1].richText.content[1].content[0].marks[0].attrs.href;assert.equal(href,'#record-section-'+heading);assert.equal(next.binding.templateId,mapped.templates[0].id);assert.equal(next.binding.sectionIds[0].templateId,mapped.templates[0].sections[0].id);assert.equal(next.binding.sectionIds[0].pageId,next.sections[0].id);assert.equal(next.binding.baseline.sections[0].id,mapped.templates[0].sections[0].id);
});
test('theme admission rejects research links, original downloads, private source filters, malformed dependencies and unowned resources',()=>{
 const link='observanda://'+randomUUID()+'/record/'+randomUUID();
 for(const mutate of [
 p=>{p.templates=[{id:randomUUID(),name:'References',sections:[{...section(),body:link}]}];},
 p=>{const rich={...section(),format:'rich',richText:{type:'doc',content:[]}};rich.richText.content.push({type:'paragraph',content:[{type:'text',text:'Reference',marks:[{type:'link',attrs:{href:link,title:'',target:'_self',nofollow:false}}]}]});p.templates=[{id:randomUUID(),name:'References',sections:[rich]}];},
 p=>{p.assets[0].caption=link;},
 p=>{p.templates[0].sections.push({id:randomUUID(),kind:'records',title:'Filtered',show:true,layout:'list',filter:{projectId:randomUUID(),tag:'',limit:1}});},
 p=>{p.resources.push({...p.resources[0],id:randomUUID()});},
 p=>{p.templates[0].binding={templateId:p.templates[0].id,sectionIds:[],baseline:{sections:[],media:[]}};},
 p=>{p.sourceSelections={private:true};}
 ]){const p=withAsset();mutate(p);assert.equal(validWebsiteTheme(p),false);}
 assert.ok(themeReferences({type:'book_figure',attrs:{figureId:randomUUID()}}).blocked.length);
 const external='https://example.org/articles/topic';assert.deepEqual([...themeReferences({href:external}).links],[external]);
});
async function fixture(t){const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-theme-frames-')),workspace={root,requireStorageKey:async()=>{},writeFile:writeFile,readFile:readFile};t.after(async()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-theme-frames-'));await rm(root,{recursive:true,force:true});});return new WebsiteThemeResources(workspace);}
async function* encoded(p,{body=bytes,extra=false,short=false}={}){const raw=Buffer.from(JSON.stringify(p));yield Buffer.from(WEBSITE_THEME_MAGIC+raw.length+'\n');for(let at=0;at<raw.length;at+=97)yield raw.subarray(at,at+97);for(let at=0;at<body.length-(short?1:0);at+=65536)yield body.subarray(at,Math.min(at+65536,body.length-(short?1:0)));if(extra)yield Buffer.from('unexpected');}
test('theme transport streams exact resources and refuses truncated, corrupt, extra and aborted bodies without retained partial stages',async t=>{
 const resources=await fixture(t),p=withAsset(),stage=await resources.receive(encoded(p),{test:true});assert.equal(stage.resources.length,1);const result=[];for await(const b of resources.stream(stage))result.push(b);const raw=Buffer.from(JSON.stringify(p));assert.deepEqual(Buffer.concat(result),Buffer.concat([Buffer.from(WEBSITE_THEME_MAGIC+raw.length+'\n'),raw,bytes]));await resources.remove(stage);
 for(const options of [{short:true},{extra:true},{body:Buffer.alloc(bytes.length,0)}])await assert.rejects(resources.receive(encoded(p,options),{}));
 const controller=new AbortController();async function* interrupted(){for await(const value of encoded(p)){if(value.length===65536)controller.abort();yield value;}}await assert.rejects(resources.receive(interrupted(),{},{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(await readdir(path.join(resources.workspace.root,'.observanda','theme-exchange')),[]);
});
test('theme review ignores a response for an edited draft and invalidates changed export choices',async()=>{
 let revision=0,resolve,requested;const state={storage:{contextId:'context'},book:{id:randomUUID(),website:{templates:[],design:{}}}},pin={researchSnapshotId:'a'.repeat(64),websiteId:randomUUID(),websiteRevision:'b'.repeat(64)},documents={enabled:()=>true,snapshot:()=>String(revision),flush:async()=>{},descriptor:()=>({websitePin:pin,draft:null})},responses=[];
 const api=async(route,data)=>{if(route.endsWith('/discard')){responses.push(data);return {};}requested=data;return new Promise(r=>{resolve=r;});};
 const ui=websiteThemeUI({state,documents,api,esc:String,field:(a,b)=>b,notify:()=>{},render:()=>{}});ui.input({id:'website-theme-name',value:'One',dataset:{}});
 const action=ui.action({dataset:{action:'website-theme-prepare'}});while(!resolve)await new Promise(r=>setImmediate(r));revision++;resolve({ready:true,id:randomUUID(),sha256:'c'.repeat(64)});await action;assert.equal(ui.view().includes('Download theme'),false);assert.equal(responses.length,1);
 const second=ui.action({dataset:{action:'website-theme-prepare'}});resolve=null;while(!resolve)await new Promise(r=>setImmediate(r));resolve({ready:true,id:randomUUID(),sha256:'d'.repeat(64),name:'One',templates:[],regions:[],assets:0,fonts:0,links:[],systemFonts:[]});await second;assert.match(ui.view(),/Download theme/);ui.input({id:'website-theme-name',value:'Two',dataset:{}});assert.equal(ui.view().includes('Download theme'),false);assert.equal(requested.name,'One');ui.reset();
});
