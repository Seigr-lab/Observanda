import {proseDocument,validProse} from '../src/web/prose-model.js';
import {pdfCrossReference} from '../src/web/pdf-cross-reference-model.js';
// Appends a linked paragraph to section content, as an author does in the
// editor, using the product's own reference address and content checks.
export function appendPdfCrossReference(content,target,label){
 if(typeof label!=='string'||!label.trim()||label.length>2000)throw new TypeError('Invalid PDF reference');
 const result=structuredClone(proseDocument(content));result.content.push({type:'paragraph',content:[{type:'text',text:label,marks:[{type:'link',attrs:{href:pdfCrossReference(target),title:'',target:'_self',nofollow:false}}]}]});
 if(!validProse(result))throw new RangeError('PDF reference exceeds the section limit');return result;
}
