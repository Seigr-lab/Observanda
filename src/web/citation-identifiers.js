// Identifiers of a cited source. DOI, ISBN and ISSN are checked by their own
// rules (ISBN and ISSN check digits), so a mistyped identifier is caught when
// the citation is written, not when a reader tries to follow it.
export const CITATION_IDENTIFIER_KINDS=['doi','isbn','issn','arxiv','handle','other'];
const plain=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
export function validISBN(value){
 const digits=String(value).replace(/[\s-]/g,'').toUpperCase();
 if(/^\d{9}[\dX]$/.test(digits))return [...digits].reduce((sum,c,i)=>sum+(c==='X'?10:Number(c))*(10-i),0)%11===0;
 if(/^97[89]\d{10}$/.test(digits))return [...digits].reduce((sum,c,i)=>sum+Number(c)*(i%2?3:1),0)%10===0;
 return false;
}
export function validISSN(value){
 const match=/^(\d{4})-?(\d{3}[\dX])$/i.exec(String(value).trim());if(!match)return false;
 const digits=(match[1]+match[2]).toUpperCase();
 return [...digits].reduce((sum,c,i)=>sum+(c==='X'?10:Number(c))*(8-i),0)%11===0;
}
// The canonical spelling stored with the citation.
export function normalizeCitationIdentifier(kind,value){
 const text=String(value??'').trim();
 if(kind==='doi'){const doi=text.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i,'');return /^10\.\d{4,9}\/\S+$/.test(doi)&&doi.length<=300?doi:null;}
 if(kind==='isbn')return validISBN(text)?text.replace(/[\s-]/g,'').toUpperCase():null;
 if(kind==='issn')return validISSN(text)?text.replace(/^(\d{4})-?(\d{3}[\dX])$/i,'$1-$2').toUpperCase():null;
 if(kind==='arxiv'){const id=text.replace(/^arxiv:\s*/i,'');return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/.test(id)?id:null;}
 if(['handle','other'].includes(kind))return text&&plain(text,300)?text:null;
 return null;
}
export const validCitationIdentifier=item=>!!item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).sort().join()==='kind,value'&&CITATION_IDENTIFIER_KINDS.includes(item.kind)&&normalizeCitationIdentifier(item.kind,item.value)===item.value;
// Where a reader can follow an identifier; other kinds are shown as text.
export function citationIdentifierURL({kind,value}){
 if(kind==='doi')return 'https://doi.org/'+value.split('/').map((part,i)=>i?encodeURIComponent(part):part).join('/');
 if(kind==='arxiv')return 'https://arxiv.org/abs/'+value;
 if(kind==='handle'&&/^\d+(?:\.\d+)*\/\S+$/.test(value))return 'https://hdl.handle.net/'+value;
 return '';
}
// Parse the editor's "kind: value" lines; returns {identifiers, invalid}.
export function parseCitationIdentifiers(text){
 const identifiers=[],invalid=[];
 for(const line of String(text??'').split('\n').map(line=>line.trim()).filter(Boolean)){
  const match=/^([a-z]+)\s*:\s*(.+)$/i.exec(line),kind=match?.[1].toLowerCase(),value=match?normalizeCitationIdentifier(CITATION_IDENTIFIER_KINDS.includes(kind)?kind:'',match[2]):null;
  if(value)identifiers.push({kind,value});else invalid.push(line);
 }
 return {identifiers,invalid};
}
export const citationIdentifierText=identifiers=>(identifiers??[]).map(item=>item.kind+': '+item.value).join('\n');
