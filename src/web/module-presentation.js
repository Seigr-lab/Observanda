import './i18n/catalogues/dashboardEditors.js';
import './i18n/catalogues/moduleEditors.js';
import './i18n/catalogues/labBookData.js';
import {t} from './i18n/index.js';
import labBookMessages from './locales/en/labBookTypes.json' with {type:'json'};

// Feature definitions also seed saved content. Only their browser presentation
// is localized; externally registered modules keep their own labels.
const labels={
 'scientific-calculator':['calculator','label'],stoichiometry:['moduleEditors','stoichiometry'],spreadsheet:['moduleEditors','spreadsheet'],
 'chemical-import':['moduleEditors','chemicalStructures'],timeline:['timeline','label'],'pdf-editor':['dashboardEditors','modulePdf'],
 organizations:['organizations','title'],collaboration:['reviews','title'],resources:['moduleEditors','inventory'],planning:['moduleEditors','planning'],
 projects:['navigation','projects'],research:['book','labBooks'],laboratory:['dashboardEditors','moduleSamples'],publishing:['publishingData','group']
};
const descriptions={'scientific-calculator':'moduleCalculatorDescription',stoichiometry:'moduleStoichiometryDescription',spreadsheet:'moduleSpreadsheetDescription','chemical-import':'moduleChemicalDescription','pdf-editor':'modulePdfDescription',collaboration:'moduleCollaborationDescription',resources:'moduleInventoryDescription',planning:'modulePlanningDescription',projects:'moduleProjectsDescription',research:'moduleResearchDescription',laboratory:'moduleSamplesDescription',publishing:'modulePublishingDescription'};
const labKey=(module,field)=>{
 const id=typeof module==='string'?module:module?.id;
 const key=(module?.labBookType?.id??(id?.startsWith('laboratory-')?id.slice(11):''))+'.'+field;
 return Object.hasOwn(labBookMessages,key)?key:null;
};
export function moduleLabel(module){
 const id=typeof module==='string'?module:module?.id,key=labKey(module,'label'),pair=labels[id];
 return key?t('labBookTypes',key):pair?t(...pair):typeof module==='string'?module:module?.label??id??'';
}
export function moduleDescription(module){
 const id=typeof module==='string'?module:module?.id,key=labKey(module,'description');
 return key?t('labBookTypes',key):descriptions[id]?t('dashboardEditors',descriptions[id]):['timeline','organizations'].includes(id)?t(id,'description'):module?.description??'';
}
export const moduleSettingsHeading=module=>module.id==='research'?t('labBookData','types'):module.settingsHeading??moduleLabel(module);
export const moduleLocationLabel=module=>module.id==='planning'?t('dashboardEditors','calendarPlanning'):labels[module.id]?moduleLabel(module):module.locationTool?.label??moduleLabel(module);
export const moduleSettingsLabel=module=>labKey(module,'label')?t('dashboardEditors','recordTypes'):module.settingsLabel;
export const moduleProjectSettings=module=>module.id==='resources'?{
 ...module.projectSettings,
 heading:t('dashboardEditors','inventoryLocations'),action:t('dashboardEditors','chooseInventoryLocations'),
 intro:t('dashboardEditors','inventoryLocationsHelp'),openLabel:t('dashboardEditors','openInventory')
}:module.projectSettings;
