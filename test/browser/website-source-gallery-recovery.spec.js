import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('a transient access fence hides gallery edits and a later grant change preserves the permitted draft',async({page})=>{
 const id=randomUUID(),galleryId=randomUUID(),first='a'.repeat(64),second='b'.repeat(64);
 let revision='1'.repeat(64),locked=false,withdrawn=false,submitted;
 const picture=(sourceId,alt)=>({slotId:randomUUID(),sourceId,sourceRevision:first,key:'media:'+randomUUID(),kind:'photo',caption:'',alt,previewUrl:'/example.png'});
 const photos=[picture(first,'Weather station'),picture(second,'Private observation')];
 const site=()=>({id,name:'Survey',cssPath:'style.css',revision,pages:[{path:'index.html',title:'Home'}]});
 const saved=()=>({site:site(),path:'index.html',css:'',html:'<!doctype html><html><body><main><section data-website-source-gallery="'+galleryId+'"><h2>Survey gallery</h2></section></main></body></html>'});
 await page.exposeFunction('filesAPI',(route,data)=>{
  switch(route.slice('/api/website-files/'.length)){
   case 'session':return {workspaceId:id,defaultSiteId:id,sites:[site()]};
   case 'preparation':return {preparation:{state:'ready'}};
   case 'open':return saved();
   case 'version':return locked?{errorCode:'ACCESS_LOCKED',message:'Locked'}:{revision};
   case 'gallery/source-read':return {galleryId,heading:'Survey gallery',columns:2,items:[photos[0],withdrawn?{slotId:photos[1].slotId,unavailable:true}:photos[1]]};
   case 'library/validate':return {generation:revision,accepted:data.items.filter(row=>row.id===first||!withdrawn).map(row=>row.id)};
   case 'gallery/source-save':submitted=data;return saved();
   default:throw Error('Unexpected route '+route);
  }
 });
 await page.clock.install();await mountFilesEditor(page);
 await page.getByRole('button',{name:'Image gallery',exact:true}).click();
 await page.getByRole('button',{name:'Survey gallery',exact:true}).click();
 const heading=page.getByLabel('Gallery heading'),firstRow=page.locator('[data-figure-order="0"]');
 await heading.fill('Reviewed fieldwork');
 await firstRow.locator('details summary').first().click();await firstRow.getByLabel('Caption',{exact:true}).fill('Authored caption');
 locked=true;await page.clock.fastForward(5100);
 await expect(heading).toHaveCount(0);await expect(page.getByRole('img',{name:'Private observation'})).toHaveCount(0);
 locked=false;await page.clock.fastForward(5100);await expect(heading).toHaveValue('Reviewed fieldwork');
 withdrawn=true;revision='2'.repeat(64);await page.clock.fastForward(5100);
 await expect(page.locator('.website-gallery-withheld')).toHaveCount(1);
 await expect(page.getByRole('img',{name:'Private observation'})).toHaveCount(0);
 await expect(heading).toHaveValue('Reviewed fieldwork');
 await page.getByRole('button',{name:'Save gallery'}).click();
 await expect.poll(()=>submitted?.heading).toBe('Reviewed fieldwork');
 expect(submitted.expectedRevision).toBe(revision);expect(submitted.items[0].captionOverride).toBe('Authored caption');
 expect(submitted.items[1]).toEqual({slotId:photos[1].slotId,unavailable:true});
});
