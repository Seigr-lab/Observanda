import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {validPdfOutputProfile} from './pdf-output-validation-model.js';
export function pdfOutputProfileFields(header,{esc,archival=false}){
 const text=key=>t('pdfEditor',key),options=[['ordinary','outputOrdinary'],['pdfa-2u','outputArchival'],['pdfua-1','outputAccessible']];
 return (header.printCondition?'<p>'+esc(text('printArchivalConflict'))+'</p>':'')+'<label class="field">'+esc(text('outputProfile'))+'<select data-pdf-output-profile>'+options.map(([value,label])=>'<option value="'+value+'"'+((header.outputProfile??'ordinary')===value?' selected':'')+((value!=='ordinary'&&!archival||value==='pdfa-2u'&&header.printCondition)?' disabled':'')+'>'+esc(text(label))+'</option>').join('')+'</select></label><p data-pdf-output-hint>'+esc(text(!header.outputProfile?'outputOrdinaryHint':!archival?'outputArchivalUnavailable':header.outputProfile==='pdfua-1'?'outputAccessibleHint':'outputArchivalHint'))+'</p>';
}
export function changePdfOutputProfile(header,value){if(value==='pdfa-2u'&&header.printCondition)return false;if(value==='ordinary')delete header.outputProfile;else if(validPdfOutputProfile(value))header.outputProfile=value;else return false;return true;}
