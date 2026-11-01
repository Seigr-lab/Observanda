import {modelMessages} from '../model-messages.js';
import messages from '../locales/en/bomImport.json' with {type:'json'};
import tableMessages from '../locales/en/figureDiagnostics.json' with {type:'json'};

const fields={value:'fieldValue',footprint:'fieldFootprint',partNumber:'fieldPartNumber',unit:'fieldUnit',notes:'fieldNotes',references:'fieldReferences'};
const catalogues={bomImport:messages,figureDiagnostics:tableMessages};
export const bomImportText=translate=>modelMessages('bomImport',messages,translate);
// Stable diagnostic identifiers accompany the existing English error field.
// Only these known catalogues are accepted for client-side presentation.
export function bomDiagnosticText(diagnostic,translate){
 const {namespace,key,parameters={}}=diagnostic??{},catalogue=Object.hasOwn(catalogues,namespace)?catalogues[namespace]:null;
 if(!catalogue||!Object.hasOwn(catalogue,key))return null;
 const text=modelMessages(namespace,catalogue,translate),values={...parameters};
 if(namespace==='bomImport'&&key==='field'&&Object.hasOwn(fields,values.field))values.field=text(fields[values.field]);
 return text(key,values);
}
export function bomImportError(key,parameters={},translate){
 const diagnostic={namespace:'bomImport',key,parameters};
 return Object.assign(new Error(bomDiagnosticText(diagnostic,translate)),{diagnostic});
}
// readDelimitedTable already accepts a presentation callback. Capturing its
// known message arguments preserves parser semantics without parsing English.
export function bomTableDiagnostics(translate){
 let diagnostic=null;
 return {
  text(namespace,key,parameters={}){diagnostic={namespace,key,parameters};return bomDiagnosticText(diagnostic,translate);},
  attach(error){if(diagnostic&&typeof error==='object'&&error)error.diagnostic=diagnostic;return error;}
 };
}
