import {t} from './i18n/index.js';

// "Edit {field}" places a field's label mid-sentence, so its first letter is
// written in lower case. Acronyms such as "PDF" keep their capitals, and a
// label the author wrote (a template field) is shown exactly as written.
export function recordValueHeading(label,{authored=false}={}){
 const value=String(label??''),second=value[1]??'';
 const inSentence=!authored&&second&&second===second.toLowerCase()&&second!==second.toUpperCase()?value[0].toLowerCase()+value.slice(1):value;
 return t('recordValues','heading',{field:inSentence});
}
