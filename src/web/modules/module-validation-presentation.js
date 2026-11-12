import {t} from '../i18n/index.js';
import '../i18n/catalogues/bomImport.js';
import '../i18n/catalogues/figureDiagnostics.js';
import errors from '../locales/en/errors.json' with {type:'json'};
import {readinessText} from './resource-quality-presentation.js';
import {bomDiagnosticText} from './bom-import-diagnostics.js';

export const moduleErrorMessage=error=>Object.hasOwn(errors,error?.code)&&(!error.message||error.message===errors[error.code])?t('errors',error.code):error?.message;
export function moduleErrorDetail(detail){
 if(Array.isArray(detail?.issues)&&detail.workflow&&detail?.blocked)return detail.name+' · '+readinessText(detail,{holdReason:detail.reason});
 try{return bomDiagnosticText(detail?.diagnostic,t)??detail?.field??'';}catch{return detail?.field??'';}
}
// Generated fallback labels are presentation only. Original headings and table
// column indices remain unchanged, including values that look like translations.
export function bomImportColumns(table){
 const used=new Set();
 return table.columns.map(column=>{
  const base=column.heading.trim()||t('bomImport','column',{number:column.index+1});let label=base,suffix=2;
  while(used.has(label))label=base+' ('+(suffix++)+')';used.add(label);
  return {...column,label};
 });
}
