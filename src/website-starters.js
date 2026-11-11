import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {AppError} from './errors.js';
import {escapeWebsiteText as esc} from './website-file-html.js';
import {starterPage,starterStyles} from './web/website-file-starter.js';
import {saveSiteMenu} from './website-menu-storage.js';
import {defineComponent} from './website-component-storage.js';
import {regionOperation} from './website-region-storage.js';
import {saveWebsiteFeed} from './website-dynamic-feeds.js';

// A starter is a recipe for a new website: its pages, menu, site regions and
// record lists. Every word is site content in the site's language, read from
// the websiteStarters catalogue. Links are written from the site root.
const p=key=>({p:key}),h2=key=>({h2:key}),list=(...keys)=>({ul:keys}),links=(...rows)=>({links:rows});
const footer=[p('starterFooter')];
export const WEBSITE_STARTERS={
 blank:{pages:[{path:'index.html',body:[]}]},
 journal:{
  pages:[
   {path:'index.html',body:[p('journalIntro')],feed:{heading:'journalLatest',sort:'date-desc',template:'card',layout:'list',pageSize:6}},
   {path:'archive.html',title:'journalArchive',body:[p('journalArchiveIntro')],feed:{heading:'journalAllRecords',sort:'date-desc',template:'card',layout:'list',pageSize:50}},
   {path:'about.html',title:'journalAbout',body:[p('journalAboutText'),h2('journalMethods'),p('journalMethodsText')]}],
  menu:[['index.html','starterHome'],['archive.html','journalArchive'],['about.html','journalAbout']],
  regions:{footer:{body:footer}}},
 portfolio:{
  pages:[
   {path:'index.html',body:[p('portfolioIntro')],feed:{heading:'portfolioWork',sort:'date-desc',template:'card',layout:'grid',pageSize:12}},
   {path:'gallery.html',title:'portfolioGallery',body:[p('portfolioGalleryText')]},
   {path:'about.html',title:'portfolioAbout',body:[p('portfolioAboutText')]},
   {path:'contact.html',title:'portfolioContact',body:[p('portfolioContactText')]}],
  menu:[['index.html','starterHome'],['gallery.html','portfolioGallery'],['about.html','portfolioAbout'],['contact.html','portfolioContact']],
  regions:{footer:{body:footer}}},
 handbook:{
  pages:[
   {path:'index.html',body:[p('handbookIntro'),h2('handbookContents'),links(['guide/getting-started.html','handbookStart'],['guide/procedures.html','handbookProcedures'],['glossary.html','handbookGlossary'])]},
   {path:'guide/getting-started.html',title:'handbookStart',body:[p('handbookStartText'),h2('handbookRequirements'),list('handbookRequirement1','handbookRequirement2')]},
   {path:'guide/procedures.html',title:'handbookProcedures',body:[p('handbookProceduresText'),h2('handbookSafety'),p('handbookSafetyText')]},
   {path:'glossary.html',title:'handbookGlossary',body:[p('handbookGlossaryText')]}],
  menu:[['index.html','starterHome'],['guide/getting-started.html','handbookStart'],['guide/procedures.html','handbookProcedures'],['glossary.html','handbookGlossary']],
  regions:{
   sidebar:{body:[h2('handbookContents'),links(['index.html','starterHome'],['guide/getting-started.html','handbookStart'],['guide/procedures.html','handbookProcedures'],['glossary.html','handbookGlossary'])],settings:{mobile:'collapsed',mobileTitle:'handbookContents'}},
   footer:{body:footer}}},
 course:{
  pages:[
   {path:'index.html',body:[p('courseIntro'),h2('courseOutcomes'),list('courseOutcome1','courseOutcome2','courseOutcome3')]},
   {path:'lessons/lesson-1.html',title:'courseLesson1',body:[p('courseLessonText'),links(['index.html','courseOverview'],['lessons/lesson-2.html','courseNext'])]},
   {path:'lessons/lesson-2.html',title:'courseLesson2',body:[p('courseLessonText'),links(['lessons/lesson-1.html','coursePrevious'],['lessons/lesson-3.html','courseNext'])]},
   {path:'lessons/lesson-3.html',title:'courseLesson3',body:[p('courseLessonText'),links(['lessons/lesson-2.html','coursePrevious'],['resources.html','courseResources'])]},
   {path:'resources.html',title:'courseResources',body:[p('courseResourcesText')],feed:{heading:'courseReadings',sort:'title-asc',template:'card',layout:'list',pageSize:24}}],
  menu:[['index.html','courseOverview'],['lessons/lesson-1.html','courseLesson1'],['lessons/lesson-2.html','courseLesson2'],['lessons/lesson-3.html','courseLesson3'],['resources.html','courseResources']],
  regions:{
   sidebar:{body:[h2('courseLessons'),links(['index.html','courseOverview'],['lessons/lesson-1.html','courseLesson1'],['lessons/lesson-2.html','courseLesson2'],['lessons/lesson-3.html','courseLesson3'],['resources.html','courseResources'])],settings:{mobile:'collapsed',mobileTitle:'courseLessons'}},
   footer:{body:footer}}},
 laboratory:{
  pages:[
   {path:'index.html',body:[p('labIntro')],feed:{heading:'labRecent',sort:'date-desc',template:'card',layout:'grid',pageSize:9}},
   {path:'methods.html',title:'labMethods',body:[p('labMethodsText')]},
   {path:'results.html',title:'labResults',body:[p('labResultsText')],feed:{heading:'labAllResults',sort:'date-desc',template:'full',layout:'list',pageSize:10}},
   {path:'team.html',title:'labTeam',body:[p('labTeamText')]}],
  menu:[['index.html','starterHome'],['methods.html','labMethods'],['results.html','labResults'],['team.html','labTeam']],
  regions:{footer:{body:footer}}},
};
export const STARTER_IDS=Object.keys(WEBSITE_STARTERS);
const LANGUAGE_IDS=['ca','en','es','nb','nn'];

// The catalogue in the site's language, completed from English.
export async function starterText(language){
 const read=async lang=>JSON.parse(await readFile(new URL('./web/locales/'+lang+'/websiteStarters.json',import.meta.url),'utf8'));
 const english=await read('en'),base=String(language??'en').toLowerCase().split('-')[0];
 return LANGUAGE_IDS.includes(base)&&base!=='en'?{...english,...await read(base)}:english;
}
function words(text,site){
 return key=>{const value=text[key];if(typeof value!=='string')throw new AppError('INVALID');return value.replaceAll('{site}',site);};
}
const from=(page,target)=>path.posix.relative(path.posix.dirname(page),target)||path.posix.basename(target);
function markup(items,say,page){
 return items.map(item=>{
  if(item.p)return '<p>'+esc(say(item.p))+'</p>';
  if(item.h2)return '<h2>'+esc(say(item.h2))+'</h2>';
  if(item.ul)return '<ul>'+item.ul.map(key=>'<li>'+esc(say(key))+'</li>').join('')+'</ul>';
  if(item.links)return '<ul>'+item.links.map(([target,key])=>'<li><a href="'+esc(from(page,target))+'">'+esc(say(key))+'</a></li>').join('')+'</ul>';
  throw new AppError('INVALID');
 }).join('');
}

export function starterFiles(id,{name,language,text}){
 const starter=WEBSITE_STARTERS[id];if(!starter)throw new AppError('INVALID');
 const say=words(text,name),files=new Map([['style.css',starterStyles]]);
 for(const page of starter.pages){
  const document=starterPage({title:page.title?say(page.title):name,stylesheet:from(page.path,'style.css'),language},esc);
  files.set(page.path,document.replace('</h1></main>','</h1>'+markup(page.body,say,page.path)+'</main>'));
 }
 return files;
}

// Give a newly created site its menu, region components and record lists.
export async function applyStarter(store,state,id,{name,text,signal}){
 const starter=WEBSITE_STARTERS[id],siteId=state.site.id,say=words(text,name);
 let revision=state.site.revision;
 if(starter.menu){
  const items=starter.menu.map(([href,key])=>({key:null,label:say(key),href,children:[]}));
  revision=(await saveSiteMenu(store,siteId,{expectedRevision:revision,items,signal})).site.revision;
 }
 for(const [slot,region] of Object.entries(starter.regions??{})){
  const defined=await defineComponent(store,siteId,{expectedRevision:revision,name:say(slot==='footer'?'starterFooterName':'starterSidebarName'),html:'<section>'+markup(region.body,say,'index.html')+'</section>',signal});
  const settings=region.settings?{...region.settings,mobileTitle:say(region.settings.mobileTitle)}:undefined;
  revision=(await regionOperation(store,'assign',siteId,{expectedRevision:defined.site.revision,slot,component:defined.componentId,...(settings?{settings}:{}),signal})).site.revision;
 }
 for(const page of starter.pages)if(page.feed){
  const {heading,sort,template,layout,pageSize}=page.feed;
  revision=(await saveWebsiteFeed(store,siteId,{expectedRevision:revision,path:page.path,heading:say(heading),criteria:{sort},template,layout,pageSize,signal})).site.revision;
 }
 return store.open(siteId,{path:'index.html',signal});
}
