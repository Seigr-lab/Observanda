import labels from './locales/en/pdfEditor.json' with {type:'json'};
import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';

const names={widthMm:'width',heightMm:'height',columnGapMm:'columnGap',fontSizePt:'fontSize',pageNumbers:'numbers',
 layout:'documentLayout',gutterMm:'gutter',structure:'documentStructure',caption:'captions',press:'pressGeometry',
 bleedMm:'pressBleedMm',cropMarks:'pressCropMarks',printCondition:'printConditionLabel',label:'printConditionLabel'};
const pdf=key=>t('pdfEditor',key);
function setting(key){
 if(/^\d+$/.test(key))return String(Number(key)+1);
 const name=names[key]??key;
 return typeof labels[name]==='string'&&!labels[name].includes('{')?pdf(name):key.replace(/([a-z])([A-Z])/g,'$1 $2');
}
function value(item){
 if(item===undefined||item===null)return t('recordDrafts','unset');
 if(typeof item==='boolean')return pdf(item?'enabled':'disabled');
 if(['ltr','rtl','auto','enabled','disabled'].includes(item))return pdf(item);
 return String(item);
}
export function pdfSettingsChanges(before,after){
 const rows=[];
 function compare(left,right,path){
  if(left===right)return;
  const a=left!==null&&typeof left==='object',b=right!==null&&typeof right==='object';
  if(a||b){
   for(const key of new Set([...Object.keys(a?left:{}),...Object.keys(b?right:{})])){
    if(key!=='version')compare(a?left[key]:undefined,b?right[key]:undefined,[...path,key]);
   }
   return;
  }
  rows.push({setting:path.map(setting).join(' › '),saved:value(left),pending:value(right)});
 }
 compare(before,after,[]);return rows;
}
