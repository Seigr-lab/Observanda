import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {validateWebsiteLibraryRows,websiteLibraryFacets} from '../../src/website-file-library.js';
import {savedWebsiteSearches} from '../../src/website-saved-searches.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {sampleNotebook} from '../../src/sample.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('filter permitted saved entries by date, type, status and exact tags and retain an ordered selection',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'website-finder-filter-'));
 try{
  await mkdir(path.join(directory,'.observanda'));
  const workspace=new Workspace(directory,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
  const project={id:randomUUID(),title:'Metallurgy',share:true},book={id:randomUUID(),projectId:project.id,title:'Calibration',share:true};
  const metadata={id:workspace.vault.id,projects:[project],notebooks:[book]},example=sampleNotebook().entries.find(r=>r.type==='hypothesis');
  for(const [title,occurredOn,type,status,tags] of [
   ['Ångström baseline','2025-11-01','hypothesis','draft',['Co','series']],
   ['Gas analysis',{kind:'range',from:'2026-01-01',to:'2026-02-10',estimated:true},'analysis','completed',['CO','series']],
   ['Probe calibration','2026-02-06','protocol','completed',['Co','fixture']],
   ['Unscheduled sample',{kind:'unknown'},'note','planned',['series']]
  ]){
   const record={...example,id:randomUUID(),notebookId:book.id,title,occurredOn,type,status,tags,body:'Permitted instrument note',share:true,sections:[],figures:[],relations:[],attachments:[],contributors:[]};
   delete record.publication;delete record.attempt;delete record.results;delete record.template;
   const provenance={workspaceId:metadata.id,projectId:project.id,notebookId:book.id,recordId:record.id},sourceId=websiteSourceId(provenance);
   const converted=await convertPublicationRecord(workspace,metadata,record),token=await store.beginSourceUpdate({sourceId,ifAbsent:true,target:'website'});
   await store.putSource({sourceId,title,provenance,pickerContext:{projectTitle:project.title,notebookTitle:book.title},...converted},{token});
  }
  const {site}=await store.create({name:'Materials archive'});let tagReads=0;
  await page.exposeFunction('filesAPI',async(route,data={})=>{
   switch(route.replace('/api/website-files/','')){
    case 'session':return {workspaceId:metadata.id,title:'Materials',defaultSiteId:site.id,sites:[site]};
    case 'version':return {revision:await store.siteVersion(site.id)};
    case 'open':return store.open(site.id,data);
    case 'preparation':return {preparation:{}};
    case 'library/search':return store.searchLibrary(data);
    case 'library/facets':if(data.kind==='tag')tagReads++;return store.scope(scope=>websiteLibraryFacets(store,scope,data));
    case 'library/validate':return store.scope(()=>validateWebsiteLibraryRows(store,data));
    case 'library/saved-searches/list':return savedWebsiteSearches(store,'list',data);
    case 'library/saved-searches/save':return savedWebsiteSearches(store,'save',data);
    case 'library/saved-searches/remove':return savedWebsiteSearches(store,'remove',data);
    default:throw Error('Unexpected route '+route);
   }
  });
  await page.setViewportSize({width:1280,height:800});await mountFilesEditor(page);
  await page.getByRole('button',{name:'Browse available content'}).click();const d=page.getByRole('dialog'),rows=d.locator('[data-picker-row]');
  const field=key=>d.locator('[data-picker-field="'+key+'"]'),apply=()=>d.getByRole('button',{name:'Apply filters',exact:true}).click();
  await expect(rows).toHaveCount(4);expect(tagReads).toBe(0);await rows.filter({hasText:'Ångström baseline'}).getByRole('checkbox').check();
  await field('dateFrom').fill('2026-02-01');await field('dateTo').fill('2026-02-09');await field('recordType').selectOption('analysis');await field('status').selectOption('completed');await apply();
  await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Gas analysis');await expect(rows.first()).toContainText('CO');
  await expect(d.locator('.website-picker-queue')).toContainText('Ångström baseline');
  await field('dateTo').fill('2024-01-01');await apply();await expect(d.getByRole('status')).toContainText('end date');await expect(rows).toHaveCount(1);
  await d.locator('.website-picker-applied').getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(4);
  await field('sort').selectOption('date-desc');await expect(rows.first()).toContainText('Probe calibration');await expect(rows.last()).toContainText('Unscheduled sample');
  const tags=d.locator('[data-picker-facet="tag"]');await tags.locator('summary').click();const suggest=tags.getByLabel('Find a tag');await suggest.fill('co');await suggest.press('Enter');
  const options=tags.locator('[data-action="website-files-picker-choose-tag"]');await expect(options).toHaveCount(2);await options.filter({hasText:/^Co \(2\)$/}).click();
  await expect(rows).toHaveCount(2);await expect(rows.filter({hasText:'Gas analysis'})).toHaveCount(0);
  await field('tagMode').selectOption('any');await apply();await options.filter({hasText:/^CO \(1\)$/}).click();await expect(rows).toHaveCount(3);
  await d.locator('.website-picker-applied').getByRole('button',{name:'Remove Co',exact:true}).press('Enter');await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Gas analysis');
  await d.locator('[data-picker-search]').fill('absent');await d.locator('[data-picker-search]').press('Enter');await expect(rows).toHaveCount(0);await expect(d.locator('.website-picker-entry-list')).toContainText('No matching content');
  await d.locator('.website-picker-entry-list').getByRole('button',{name:'Clear filters',exact:true}).click();await expect(rows).toHaveCount(4);await expect(d.locator('.website-picker-queue')).toContainText('Ångström baseline');
  await rows.filter({hasText:'Gas analysis'}).getByRole('button',{name:'Filter by tag CO',exact:true}).click();
  await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Gas analysis');
  await d.getByRole('button',{name:'Saved searches',exact:true}).click();
  await d.getByLabel('Search name',{exact:true}).fill('Gas series');await d.getByRole('button',{name:'Save current search'}).click();
  await expect(d.getByRole('button',{name:'Gas series',exact:true})).toBeVisible();
  await d.getByRole('button',{name:'Close content picker'}).click();await page.reload();
  await page.getByRole('button',{name:'Browse available content'}).click();
  await d.getByRole('button',{name:'Saved searches',exact:true}).click();await d.getByRole('button',{name:'Gas series',exact:true}).click();
  await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('Gas analysis');
  await d.getByRole('button',{name:'Saved searches',exact:true}).click();
  await d.getByRole('button',{name:'Manage search',exact:true}).click();
  await d.locator('[data-picker-saved-rename]').fill('Confirmed gas series');await d.getByRole('button',{name:'Rename search',exact:true}).click();
  await expect(d.getByRole('button',{name:'Confirmed gas series',exact:true})).toBeVisible();
  await d.getByRole('button',{name:'Manage search',exact:true}).click();
  await d.getByRole('button',{name:'Remove saved search Confirmed gas series'}).click();await d.getByRole('button',{name:'Confirm removal'}).click();
  await expect(d.getByRole('button',{name:'Confirmed gas series',exact:true})).toHaveCount(0);
 }finally{await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:120});}
});
