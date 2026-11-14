import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {publishingUI} from '../src/web/publishing-ui.js';
import {publishingJobText} from '../src/web/publishing-presentation.js';
import {verificationStatus} from '../src/web/publication-verification-view.js';
const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const field=(label,control)=>'<label>'+label+control+'</label>';
const option=(value,label,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>';
// A website is selected: the destination form belongs to that website.
const login='5f0c3f9e-2b6a-4c1d-9e8f-0a1b2c3d4e5f';
function state(){return {storage:{contextId:'workspace'},page:'publishing',websitePin:{researchSnapshotId:'a',websiteId:'b',websiteRevision:null},websiteId:'b',publishing:{etag:'etag',configured:true,config:{kind:'github',github:{owner:'Authored <owner>',repository:'Authored & repo',branch:'main',directory:'',pages:false},ssh:{login,directory:'/site'},publicUrl:'https://example.org/',limits:{}}}};}
const logins=async route=>route==='/api/server-logins/list'?{logins:[{id:login,name:'Lab <server>',protocol:'ssh',host:'host.example',port:22,user:'user',identityFile:''}],etag:'e'}:{};
function ui(value,overrides={}){return publishingUI({state:value,api:logins,esc,field,option,render(){},notify(){},showDialog(){},onChange(){},...overrides});}
test('publishing controls translate across language switches without changing saved destination values',async context=>{
 context.after(()=>activateLanguage('en'));const value=state(),before=structuredClone(value.publishing.config),view=ui(value);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let html=view.view(true);
  for(const key of ['pubDestination','pubWith','pubOwner','pubBranch','pubMaxFile','pubMaxSite','pubVerify'])assert.ok(html.includes(esc(t('websiteAuthoring',key))),key+' '+locale);
  assert.ok(html.includes('value="github" selected'));assert.ok(html.includes('value="main"'));assert.ok(html.includes(esc(before.github.owner)));assert.ok(!html.includes('<owner>'));
  html=view.view();assert.ok(html.includes(esc(t('websiteAuthoring','pubTitle'))));assert.ok(html.includes(esc(t('websiteAuthoring','pubConfigure'))));
  assert.deepEqual(value.publishing.config,before);
  value.publishing.config.kind='ssh';html=view.view(true);assert.ok(html.includes(esc(t('websiteAuthoring','pubSshHelp',{current:'current',releases:'releases'}))));assert.ok(html.includes('value="/site"'));assert.ok(html.includes(esc(t('websiteAuthoring','serverLogin'))));value.publishing.config.kind='github';
  // Without a selected website the page is Integrations: sign-ins only, shared by every website.
  const workspace={...structuredClone(value),websitePin:null,websiteId:null},integrations=ui(workspace).view(true);
  assert.ok(integrations.includes(esc(t('websiteAuthoring','loginsTitle'))));assert.ok(!integrations.includes(esc(t('websiteAuthoring','pubWith'))));
 }
});
test('canonical publication status messages are localized lazily and unknown server text is escaped unchanged',async context=>{
 context.after(()=>activateLanguage('en'));const value=state(),view=ui(value);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  value.publishOutcome='Private repository verified. The selected branch will be created. Upload only; Pages settings will not be changed.';
  let html=view.view();for(const key of ['pubPrivateVerified','pubBranchCreate','pubPagesUnchanged'])assert.ok(html.includes(esc(t('websiteAuthoring',key))));
  value.publishOutcome='Comparing repository files (32)';html=view.view();assert.ok(html.includes(esc(t('websiteAuthoring','pubProgressCount',{stage:t('websiteAuthoring','pubComparingFiles'),count:32}))));
  value.publishOutcome='The live website is verified: all 12 files match the reviewed release; 3 removed URLs return not found.';html=view.view();assert.ok(html.includes(esc(t('publication','liveVerified',{count:12,removed:3}))));
  value.publishOutcome='Unknown <server> & authored';html=view.view();assert.ok(html.includes(esc(value.publishOutcome)));assert.ok(!html.includes('<server>'));
 }
});
test('publishing validation notices translate before any network mutation',async context=>{
 const previous=globalThis.document;context.after(()=>{globalThis.document=previous;activateLanguage('en');});globalThis.document={};
 for(const locale of locales){
  await load(locale);activateLanguage(locale);let notice;const value=state();value.publishing.dirty=true;
  const view=ui(value,{notify:message=>{notice=message;},api:async()=>{assert.fail('No request for unsaved settings');}});
  await view.action({dataset:{action:'publish-check'}});assert.equal(notice,t('websiteAuthoring','pubSaveFirst'));
  value.publishing.dirty=false;value.publishing.connected=false;await view.action({dataset:{action:'publish-create-repository'}});assert.equal(notice,t('websiteAuthoring','pubConnectFirst'));
 }
});
test('shared publishing job presentation maps worker stages, states and errors without changing protocol data',async context=>{
 context.after(()=>activateLanguage('en'));
 const jobs=[{state:'running',progress:{stage:'Uploading selected files'}},{state:'queued',progress:{stage:'queued'}},{state:'running',progress:{stage:'Checking repository'}},{state:'failed',error:'PUBLISH_REMOTE',message:'Server fallback'}],before=structuredClone(jobs);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.equal(publishingJobText(jobs[0]),t('githubTransfer','uploading'));
  assert.equal(publishingJobText(jobs[1]),t('supportEditors','state_queued'));
  assert.equal(publishingJobText(jobs[2]),t('repositorySetup','checking'));
  assert.equal(publishingJobText(jobs[3]),t('errors','PUBLISH_REMOTE'));
  assert.equal(verificationStatus(jobs[3]),t('errors','PUBLISH_REMOTE'));
  assert.equal(publishingJobText({state:'running',progress:{stage:'Unknown worker stage'}}),'Unknown worker stage');
  assert.deepEqual(jobs,before);
 }
});
