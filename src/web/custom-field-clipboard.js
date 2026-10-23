import {fieldNumberContext} from './custom-field-numbers.js';
import {validNumeralContext,numeralUsesRadix} from './numeral-context.js';
const refuse=code=>{throw Object.assign(Error(code),{code});};
// The saved field owns interpretation. Clipboard actions never edit its schema.
export function customFieldClipboardContext(field){
 const context=fieldNumberContext(field);
 if(field.type!=='number'||!validNumeralContext(context))refuse('NUMERAL_CLIPBOARD_INVALID');
 return {version:context.version,representation:context.representation,radix:numeralUsesRadix(context.representation)?context.radix:10};
}
export function validateCustomFieldClipboard(payload,context){
 if(!validNumeralContext(context))refuse('NUMERAL_CLIPBOARD_INVALID');
 if(payload.kind!=='typed')return;
 const incoming=payload.context;
 if(incoming.version!==context.version||incoming.representation!==context.representation||(numeralUsesRadix(context.representation)&&incoming.radix!==context.radix))refuse('NUMERAL_CLIPBOARD_CONTEXT');
}
