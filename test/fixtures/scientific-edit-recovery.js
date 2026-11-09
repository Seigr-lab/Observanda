import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../../src/web/dataset-resource-policy.js';
import {defaultStatisticalUncertaintyDefinition} from '../../src/web/measurement-statistical-uncertainty-model.js';
import {blankUnitDefinition} from '../../src/web/measurement-unit-model.js';
import {materialReference} from '../../src/web/material-reference.js';

export const recoveryStates={S:'schema',M:'plot',G:'graph-node',I:'uncertainty-input',V:'uncertainty-covariance',U:'cusum',F:'spectrum',L:'local-intake',E:'evidence-intake'};
const names={dataset:'Recovery field readings',graph:'Recovery calculation graph',uncertainty:'Recovery uncertainty model'};
export async function createRecoverySources(call,recordId,upload){
 const labels=Array.from({length:22},(_,i)=>'Field '+i),csv=Buffer.from(labels.join(',')+'\n'+Array.from({length:4},(_,row)=>labels.map((_,i)=>String(i+row+1)).join(',')).join('\n'));
 const artifact=await upload(csv);
 const columns=labels.map(label=>({...defaultColumn({label}),representation:'integer',quantity:{origin:'measured',calibration:null,conversion:null,unitDefinition:blankUnitDefinition()}}));
 const source=await call('dataset',{recordId,title:names.dataset,artifact,columns});
 const graph=await call('calculation-graph-create',{recordId,title:names.graph,source,graphVersion:17,view:'observations',policy:defaultDatasetResourcePolicy()});
 let model=await call('uncertainty-create',{recordId,title:names.uncertainty,definition:defaultStatisticalUncertaintyDefinition()});
 const cell=column=>({ref:materialReference(source),selector:{kind:'cell',page:0,row:0,column}});
 model=await call('uncertainty-change',{ref:model,collection:'inputs',offset:0,item:{id:randomUUID(),name:'Original estimate',estimate:cell(0),sensitivity:{kind:'cell',source:cell(1)}}});
 return {source,graph,model};
}
export async function exerciseRecovery({page,id,mode,recordId,openRecord,interrupt,inspectScope,inspectDetails}){
 const state=recoveryStates[id],caseId='S06-'+id+'-'+mode;
 let dialog,action,openWorkbench,inspect;
 function attach(){
  dialog=page.locator('#dialog');
  action=key=>dialog.locator('[data-action="material-'+key+'"]');
  openWorkbench=async()=>{
   await openRecord(page);
   await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
   await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  };
  inspect=async title=>dialog.locator('.material-list li').filter({has:page.getByText(title,{exact:true})}).getByRole('button',{name:'Inspect',exact:true}).click();
 }
 attach();await openWorkbench();
 const text='0'.repeat(41)+'1.0000000000000000007';
 const field=(selector)=>dialog.locator(selector);
 const scalar=key=>field('[data-'+state+'-scalar="'+key+'"] [data-scalar-input]');
 const col=i=>field('[data-material-column="'+i+'"] [data-schema="unit"]');
 const unit='mm '+caseId;const label=caseId+' · sample';const source='unsubmitted/'+caseId;
 if(['S','M','U','F'].includes(id))await inspect(names.dataset);
 if(id==='G')await inspect(names.graph);
 if(id==='I'||id==='V')await inspect(names.uncertainty);
 if(id==='S'){
  await action('schema').click();await col(0).fill(unit);
  await action('exclusion-add').click();await field('[data-exclusion="row"]').fill('3');await field('[data-exclusion="reason"]').fill(label);
  await action('schema-next').click();await col(16).fill(label);
 }
 if(id==='M'){
  await action('plot-form').click();await field('#material-title').fill(label);
  await field('#material-x').selectOption('1');await field('#material-group').selectOption('4');
  await field('[data-material-value="2"]').check();
  const interval=field('[data-material-intervals="2"] details').first();await interval.locator('summary').click();
  await interval.locator('[data-interval-column="error"]').selectOption('3');
  await field('[data-column-window][data-offset="16"]').click();await field('[data-material-value="17"]').check();
  await field('#material-approximate').check();
 }
 if(id==='G'){await action('calculation-graph-open').click();await dialog.locator('[data-action="material-calculation-graph-add"][data-kind="constant"]').click();await field('[data-graph-field="constant"]').fill(text);}
 if(id==='I'||id==='V'){
  await action('uncertainty-open').click();if(id==='V')await dialog.locator('[data-action="material-uncertainty-tab"][data-collection="covariance"]').click();
  await action('uncertainty-add').click();if(id==='I')await field('[data-uncertainty-field="name"]').fill(label);
  await field('[data-uncertainty-field="operandKind"]').selectOption('declared');await field('[data-uncertainty-field="representation"]').selectOption('decimal');await field('[data-uncertainty-field="spelling"]').fill(text);
 }
 if(id==='U'||id==='F'){await action(state+'-open').click();await scalar(id==='U'?'target':'step').fill(text);await field('[data-'+state+'="title"]').fill(label);}
 if(id==='L'){await action('continuing-home').click();await field('#continuing-source').fill(source);}
 if(id==='E'){await action('intake-new').click();await field('#intake-title').fill(label);await field('#intake-provenance').fill('Archive '+caseId);await field('#intake-files').setInputFiles({name:'reading.csv',mimeType:'text/csv',buffer:Buffer.from('x,y\n1,2\n')});}
 await expect(dialog.locator('[data-scientific-recovery] [role="status"]')).toHaveText('Recovery copy saved.',{timeout:20000});
 const before=await inspectScope();const row=before.find(item=>item.kind===state);
 expect(row?.owner.recordId).toBe(recordId);expect(row.state).toBe('unchecked');
 const checkpoint=await inspectDetails(row);
 expect(checkpoint.summary.revision).toBe(row.revision);
 expect(checkpoint.summary.owner).toEqual(row.owner);
 expect(checkpoint.summary.capabilities.recover).toBe(true);
 if(!['L','E'].includes(id))expect(checkpoint.base.revision).toBe(row.baseRevision);
 if(mode==='C'){await action('recovery-keep').click();await expect(dialog).toBeHidden();}
 if(mode==='N'){
  await page.evaluate(()=>{location.hash='#/tools';});const guard=page.locator('#leave-dialog');
  await guard.getByRole('button',{name:'Keep recovery copy and continue'}).click();await expect(dialog).toBeHidden();
 }
 if(mode==='R')await page.reload();
 if(mode==='K'){page=await interrupt();attach();}
 await openWorkbench();
 expect(await inspectDetails(row)).toEqual(checkpoint);
 await dialog.locator('[data-action="material-recovery-open"][data-id="'+row.id+'"]').click();
 // The desktop may need to reopen the encrypted source after a process
 // restart. Wait for the workbench to mount before checking its values.
 await dialog.locator('[data-scientific-recovery]').waitFor({state:'visible',timeout:25000});
 if(id==='S'){
  await expect(col(16)).toHaveValue(label);await action('schema-prev').click();await expect(col(0)).toHaveValue(unit);
  await expect(field('[data-exclusion="row"]')).toHaveValue('3');await expect(field('[data-exclusion="reason"]')).toHaveValue(label);
 }
 if(id==='M'){
  await expect(field('#material-title')).toHaveValue(label);await expect(field('[data-material-value="2"]')).toBeChecked();
  await expect(field('[data-material-value="17"]')).toBeChecked();await expect(field('#material-approximate')).toBeChecked();
  await expect(field('#material-x')).toHaveValue('1');await expect(field('#material-group')).toHaveValue('4');
  await expect(field('[data-material-intervals="2"] [data-interval-column="error"]')).toHaveValue('3');
  expect(checkpoint.value.plot.mapping.values.map(series=>series.column)).toEqual([2,17]);
 }
 if(id==='G')await expect(field('[data-graph-field="constant"]')).toHaveValue(text);
 if(id==='I'||id==='V'){await expect(field('[data-uncertainty-field="spelling"]')).toHaveValue(text);await expect(field('[data-uncertainty-field="representation"]')).toHaveValue('decimal');if(id==='I')await expect(field('[data-uncertainty-field="name"]')).toHaveValue(label);}
 if(id==='U'||id==='F'){await expect(scalar(id==='U'?'target':'step')).toHaveValue(text);await expect(field('[data-'+state+'="title"]')).toHaveValue(label);}
 if(id==='L')await expect(field('#continuing-source')).toHaveValue(source);
 if(id==='E'){await expect(field('#intake-title')).toHaveValue(label);await expect(field('#intake-provenance')).toHaveValue('Archive '+caseId);await expect(field('#intake-files')).toHaveValue('');await expect(field('#intake-status')).toContainText('Select the original files again');}
 return {page,id:row.id};
}
