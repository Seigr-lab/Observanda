// Publication notation for plotted numbers: decimal, scientific (m×10ⁿ),
// engineering (exponents in multiples of three) and SI prefixes, in the reader's
// language. Digits come from the correctly rounded decimal spelling of the
// stored number, never from repeated floating-point arithmetic, so a label
// never claims digits the value does not have.
export const FIGURE_NOTATIONS=['decimal','scientific','engineering','si'];
const SUPERSCRIPT={'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
// SI brochure (9th edition, 2022 amendment): quecto to quetta.
const SI_PREFIXES=new Map([[-30,'q'],[-27,'r'],[-24,'y'],[-21,'z'],[-18,'a'],[-15,'f'],[-12,'p'],[-9,'n'],[-6,'μ'],[-3,'m'],[0,''],[3,'k'],[6,'M'],[9,'G'],[12,'T'],[15,'P'],[18,'E'],[21,'Z'],[24,'Y'],[27,'R'],[30,'Q']]);
const symbols=new Map();
// Decimal separator and minus sign of a language, read once from Intl.
export function numberSymbols(locale='en'){
 let tag;try{tag=Intl.NumberFormat.supportedLocalesOf([locale])[0]??'en';}catch{tag='en';}
 if(!symbols.has(tag)){
  const parts=new Intl.NumberFormat(tag,{minimumFractionDigits:1}).formatToParts(-1.5);
  symbols.set(tag,{locale:tag,decimal:parts.find(p=>p.type==='decimal')?.value??'.',minus:parts.find(p=>p.type==='minusSign')?.value??'-'});
 }
 return symbols.get(tag);
}
// Publication form of a JavaScript exponent spelling: 1.5e+10 → 1.5×10¹⁰,
// with the language's decimal mark and minus sign. Digits are kept exactly.
export function typographicExponent(spelling,locale='en'){
 const sign=numberSymbols(locale),[mantissa,exponent]=String(spelling).split('e');
 const negative=mantissa.startsWith('-'),text=localize(negative?mantissa.slice(1):mantissa,negative,sign);
 return exponent===undefined?text:text+'×10'+superscript(Number(exponent));
}
export const superscript=value=>String(value).replace(/[0-9-]/g,c=>SUPERSCRIPT[c]);
// Split |value| into its significant digits and decimal exponent, rounded to
// `digits` significant digits (1–17) with JavaScript's exact decimal rounding.
export function decimalDigits(value,digits){
 const [mantissa,exponent]=Math.abs(value).toExponential(digits-1).split('e');
 return {digits:mantissa.replace('.',''),exponent:Number(exponent)};
}
// Place a decimal point after `integer` digits, padding with zeros as needed.
function placeDigits(digits,integer,keepZeros){
 let text=integer>=digits.length?digits+'0'.repeat(integer-digits.length):integer<=0?'0.'+'0'.repeat(-integer)+digits:digits.slice(0,integer)+'.'+digits.slice(integer);
 if(!keepZeros&&text.includes('.'))text=text.replace(/\.?0+$/,'');
 return text;
}
const localize=(text,negative,{decimal,minus})=>(negative?minus:'')+text.replace('.',decimal);
function exponentForm(value,{notation,digits,decimals,locale,keepZeros}){
 const sign=numberSymbols(locale),negative=value<0;
 if(value===0)return localize(decimals?'0.'+'0'.repeat(decimals):'0',false,sign)+(notation==='si'?'':'×10⁰');
 // Fixed decimals apply to the mantissa; significant digits to the whole value.
 const step=notation==='scientific'?1:3;
 let parts=decimalDigits(value,Math.min(17,Math.max(1,decimals!==null?decimals+1:digits))),power=Math.floor(parts.exponent/step)*step;
 if(decimals!==null&&step===3){
  // Round at the last kept decimal of the shifted mantissa. A carry within the
  // same power keeps that position (99.996 → 100.00); a carry into the next
  // power moves to it (999.996 → 1.00×10³).
  const exponent=decimalDigits(value,17).exponent;power=Math.floor(exponent/step)*step;
  parts=decimalDigits(value,Math.min(17,exponent-power+1+decimals));
  if(parts.exponent-power>=step){power+=step;parts=decimalDigits(value,Math.min(17,parts.exponent-power+1+decimals));}
 }
 const integer=parts.exponent-power+1,kept=decimals===null?parts.digits:parts.digits.padEnd(integer+decimals,'0'),mantissa=localize(placeDigits(kept,integer,keepZeros||decimals!==null),negative,sign);
 if(notation==='si'&&SI_PREFIXES.has(power))return mantissa+'\u00a0'+SI_PREFIXES.get(power);
 return mantissa+'×10'+superscript(power);
}
// Format one plotted number. `digits` are significant digits; `decimals`
// (when not null) are fixed fraction digits and take precedence.
export function notationNumber(value,{notation='decimal',digits=5,decimals=null,locale='en',grouping=true,keepZeros=false}={}){
 if(!Number.isFinite(value))throw RangeError('Invalid figure number');
 value=Object.is(value,-0)?0:value;
 if(!Number.isInteger(digits)||digits<1||digits>17||decimals!==null&&(!Number.isInteger(decimals)||decimals<0||decimals>16))throw RangeError('Invalid figure number precision');
 if(notation!=='decimal')return exponentForm(value,{notation,digits,decimals,locale,keepZeros});
 const tag=numberSymbols(locale).locale;
 if(decimals!==null)return new Intl.NumberFormat(tag,{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:grouping}).format(value);
 return new Intl.NumberFormat(tag,{maximumSignificantDigits:digits,...(keepZeros?{minimumSignificantDigits:digits}:{}),useGrouping:grouping}).format(value);
}
