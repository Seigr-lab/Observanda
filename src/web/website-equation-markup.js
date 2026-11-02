export const mathNamespace='http://www.w3.org/1998/Math/MathML';
const tags=new Set('math semantics annotation mrow mi mn mo mtext mfrac msqrt mroot msub msup msubsup mtable mtr mtd mstyle mspace mover munder munderover mpadded menclose mmultiscripts mprescripts none mphantom'.split(' '));
const attributes=new Set('display encoding mathvariant mathcolor mathbackground displaystyle scriptlevel mathsize lspace rspace stretchy symmetric fence separator form accent accentunder movablelimits largeop linethickness height width depth voffset notation rowspacing columnspacing columnalign rowalign columnlines rowlines frame minsize maxsize'.split(' '));
export function safeEquationElement(tag,namespace,attrs){
 if(namespace!==mathNamespace||!tags.has(tag))return false;
 for(const {name,value,prefix} of attrs){
  if(prefix)return false;
  if(tag==='math'&&name==='xmlns'&&value===mathNamespace)continue;
  if(tag==='math'&&['id','class','lang','dir','aria-label','aria-description','aria-labelledby','aria-describedby'].includes(name))continue;
  if(!attributes.has(name)||name==='encoding'&&(tag!=='annotation'||value!=='application/x-tex'))return false;
 }
 return true;
}
