import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {taskStarters} from '../../src/web/task-starters.js';
import {navigate,preferences} from './preferences-helper.js';
import {openEvidence} from './record-editor-helper.js';

export function chooseStarterAction(page){
  const dialog=page.locator('#dialog');
  return async name=>{
    const button=dialog.getByRole('button',{name,exact:true});
    await expect(button).toBeEnabled({timeout:30000});await button.focus();
    await expect(button).toBeFocused();await page.keyboard.press('Enter');
  };
}

export async function previewStarterLanguages(page,{helpURL,templatesURL}){
  const dialog=page.locator('#dialog'),choose=chooseStarterAction(page);
  for(const language of ['ca','es','nb','nn','en']){
    const labels=JSON.parse(await readFile(new URL('../../src/web/locales/'+language+'/recordStarters.json',import.meta.url),'utf8'));
    await page.goto(helpURL);await page.locator('[data-language-choice]').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await page.goto(templatesURL);await page.getByRole('button',{name:labels.taskLibrary,exact:true}).press('Enter');
    for(const starter of taskStarters){
      const name=labels['task_'+starter.id];await choose(name);await expect(dialog.getByRole('heading',{name,exact:true})).toBeVisible();
      await expect(dialog.getByText(labels['task_'+starter.id+'_help'],{exact:true})).toBeVisible();
      if(starter.sections.length){const option=dialog.getByRole('checkbox').first();await option.press('Space');await expect(option).not.toBeChecked();}
      await choose(labels.back);
    }
    await choose(labels.close);
  }
}

export async function authorStarter(page,{name,title,body,fieldVisit=false}){
  const dialog=page.locator('#dialog'),choose=chooseStarterAction(page);
  await page.getByRole('button',{name:'New record',exact:true}).click();await choose('Record templates');await dialog.getByRole('combobox',{name:'Create',exact:true}).selectOption('record');await choose(name);
  await dialog.getByLabel('Title for new records').fill(title);
  if(name==='Lesson')await dialog.getByLabel('Reflection',{exact:true}).uncheck();
  await choose('Start writing');
  await expect(page.getByLabel('Record title',{exact:true})).toHaveValue(title);
  await page.locator('.document-field').first().locator('[contenteditable=true]').fill(body);
  if(fieldVisit){
    const first=page.locator('[data-writing-section]').first();
    await first.locator('[data-writing-heading]').fill('Field conditions');await first.locator('[contenteditable=true]').fill('Rain gauge reading 12.4 mm.');
    await first.locator('[data-writing-share-pdf]').check();
    const visibility=page.locator('[data-record-publication]');
    await visibility.getByRole('checkbox',{name:'Available for PDF',exact:true}).check();
    await visibility.locator('summary').click();await visibility.getByRole('checkbox',{name:'PDF · Summary / context',exact:true}).uncheck();
  }
  await page.getByRole('button',{name:'Save record',exact:true}).click();
  const retained=page.getByRole('heading',{name:title,level:1,exact:true});
  await expect(retained).toBeVisible({timeout:60000});await page.reload();await expect(retained).toBeVisible({timeout:30000});
}

async function browserDownload(page,trigger){
  const pending=page.waitForEvent('download',{timeout:60000});
  await trigger();
  return readFile(await (await pending).path());
}

export async function verifyFieldVisitEvidence(page,{title,otherTitle,downloadBytes=trigger=>browserDownload(page,trigger)}){
  const dialog=page.locator('#dialog'),choose=chooseStarterAction(page);
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await openEvidence(page);await choose('Import original file');
  const buffer=Buffer.from('Observations recorded at the selected visit.');
  await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'field-notes.txt',mimeType:'text/plain',buffer});
  await choose('Import original');
  await dialog.locator('.material-list > li').filter({hasText:'field-notes.txt'}).getByRole('button',{name:'Inspect',exact:true}).click();
  expect(await downloadBytes(()=>choose('Download original'))).toEqual(buffer);
  await choose('Back to evidence');await choose('Close');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await page.getByRole('searchbox',{name:'Search records',exact:true}).fill(title);
  await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-1 of 1',{timeout:45000});
  await expect(page.locator('#entry-results').getByRole('button',{name:title,exact:true})).toBeVisible();
  if(otherTitle)await expect(page.getByRole('button',{name:otherTitle,exact:true})).toHaveCount(0);
}

export async function exportFieldVisitPdf(page,{title,privateText,downloadBytes=trigger=>browserDownload(page,trigger)}){
  await navigate(page,'PDF editor');
  const pdf=page.locator('[data-pdf-editor]');await pdf.getByRole('button',{name:'New document',exact:true}).click();
  await pdf.getByRole('button',{name:'Add research',exact:true}).click();
  await pdf.getByLabel('Search record titles').fill(title);await pdf.getByRole('button',{name:'Search',exact:true}).click();
  await pdf.locator('.pdf-source-list').getByRole('button',{name:title,exact:true}).click();
  await pdf.getByRole('button',{name:'Field conditions',exact:true}).click();await pdf.getByRole('button',{name:'Insert selected content',exact:true}).click();
  await expect(pdf.getByRole('textbox',{name:'Content',exact:true})).toContainText('Rain gauge reading 12.4 mm.');
  const bytes=await downloadBytes(()=>pdf.getByRole('button',{name:'Download PDF',exact:true}).click());
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true,isEvalSupported:false});
  try{
    const document=await task.promise,pages=[];
    for(let number=1;number<=document.numPages;number++){const sheet=await document.getPage(number);pages.push(...(await sheet.getTextContent()).items.map(item=>item.str??''));sheet.cleanup();}
    const text=pages.join(' ');expect(text).toContain('Field conditions');expect(text).toContain('Rain gauge reading 12.4 mm.');if(privateText)expect(text).not.toContain(privateText);
  }finally{await task.destroy();}
}

export async function customizeMethodProfile(page,{bookURL,onCustomized}){
  const dialog=page.locator('#dialog'),choose=chooseStarterAction(page);
  await navigate(page,'Preferences');await preferences(page,'Templates');const enabled=page.locator('[data-desk-module="laboratory-educational"]');await enabled.check();
  const openProfile=async()=>{await page.goto(bookURL);await page.getByRole('button',{name:'Lab book settings',exact:true}).click();};
  await openProfile();const editor=dialog.locator('[data-configuration-editor]');
  await editor.locator('[data-configuration-add-profile]').selectOption('educational');await editor.locator('[data-command="profile-add"]').click();
  await editor.getByRole('button',{name:'Learning activities',exact:true}).click();
  const types=editor.locator('[data-command="section-select"]'),originalPosition=(await types.allTextContents()).indexOf('Learning activities');
  expect(originalPosition).toBeGreaterThanOrEqual(0);
  await editor.getByLabel('Record type name',{exact:true}).fill('Teaching activities');await editor.locator('[data-configuration-field-prop="label"]').fill('Field briefing');
  await editor.locator('[data-command="section-move"][data-direction="1"]').click();
  await expect(types.nth(originalPosition+1)).toHaveText('Teaching activities',{timeout:60000});
  await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  await onCustomized?.();
  for(const value of [false,true]){
    await openProfile();await editor.locator('[data-configuration-profile="educational"]').setChecked(value);await choose('Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  }
}
