import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notationNumber,typographicExponent,decimalDigits,numberSymbols} from '../src/web/figure-number-notation.js';
import {formatFigureNumber,figureTickLabels} from '../src/web/figure-number-labels.js';
import {figureStyleDefaults,validFigureStyle,readerFigureStyle} from '../src/web/figure-style.js';
import {createFigure} from '../src/web/figure-model.js';
import {renderFigure} from '../src/web/figure-renderer.js';
import {retainedFigureProperties} from '../src/web/retained-figure-properties.js';

const style=extra=>({...figureStyleDefaults(),...extra});
const ticks=svg=>[...svg.matchAll(/<text class="figure-value-tick"[^>]*><title>([^<]*)<\/title>/g)].map(m=>m[1]);

test('digits come from the exact decimal spelling of the stored number',()=>{
 assert.deepEqual(decimalDigits(0.1+0.2,17),{digits:'30000000000000004',exponent:-1});
 assert.deepEqual(decimalDigits(-999.96,3),{digits:'100',exponent:3});
 assert.equal(notationNumber(0.1+0.2,{digits:17,locale:'en'}),'0.30000000000000004');
});

test('engineering notation uses powers of a thousand and settles rounding carries',()=>{
 assert.equal(notationNumber(4.7e-6,{notation:'engineering'}),'4.7×10⁻⁶');
 assert.equal(notationNumber(-12345.678,{notation:'engineering',digits:3}),'-12.3×10³');
 assert.equal(notationNumber(999.96,{notation:'engineering',digits:3}),'1×10³');
 assert.equal(notationNumber(999.996,{notation:'engineering',decimals:2}),'1.00×10³');
 assert.equal(notationNumber(99.996,{notation:'engineering',decimals:2}),'100.00×10⁰');
 assert.equal(notationNumber(123456,{notation:'engineering',digits:2}),'120×10³');
 assert.equal(notationNumber(0,{notation:'engineering',decimals:1}),'0.0×10⁰');
});

test('SI prefixes cover quecto to quetta and fall back to engineering beyond them',()=>{
 assert.equal(notationNumber(4.7e-6,{notation:'si'}),'4.7\u00a0μ');
 assert.equal(notationNumber(2.2e3,{notation:'si'}),'2.2\u00a0k');
 assert.equal(notationNumber(1.5e-30,{notation:'si'}),'1.5\u00a0q');
 assert.equal(notationNumber(3e30,{notation:'si'}),'3\u00a0Q');
 assert.equal(notationNumber(3e33,{notation:'si'}),'3×10³³');
 assert.equal(notationNumber(250e-3,{notation:'si',digits:4,keepZeros:true}),'250.0\u00a0m');
 assert.equal(notationNumber(0,{notation:'si'}),'0');
});

test('numbers use the decimal mark and minus sign of the reader language',()=>{
 for(const locale of ['ca','es','nb','nn'])assert.equal(numberSymbols(locale).decimal,',',locale);
 assert.equal(numberSymbols('en').decimal,'.');
 assert.equal(numberSymbols('xx-invalid-tag-!').locale,'en');
 assert.equal(notationNumber(-0.25,{notation:'si',locale:'nb'}),numberSymbols('nb').minus+'250\u00a0m');
 assert.equal(typographicExponent('1.5e+10','es'),'1,5×10¹⁰');
 assert.equal(typographicExponent('-2.50e-7','ca'),'-2,50×10⁻⁷');
 assert.equal(formatFigureNumber(0.25,style({locale:'ca'})),'0,25');
 assert.equal(formatFigureNumber(0.25,style()),'0.25');
});

test('figure labels offer scientific, engineering and SI notation with significant digits',()=>{
 assert.equal(formatFigureNumber(1.5e10,style()),'1.5×10¹⁰');
 assert.equal(formatFigureNumber(123456,style({numberFormat:'scientific'})),'1.23×10⁵');
 assert.equal(formatFigureNumber(123456,style({numberFormat:'scientific',significantDigits:5})),'1.2346×10⁵');
 assert.equal(formatFigureNumber(0.0033,style({numberFormat:'si',significantDigits:3})),'3.30\u00a0m');
 assert.equal(formatFigureNumber(1.2,style({numberFormat:'decimal',significantDigits:4})),'1.200');
 assert.equal(formatFigureNumber(1.2,style({numberFormat:'decimal',decimals:12})),'1.200000000000');
 // Fixed decimals take precedence over significant digits.
 assert.equal(formatFigureNumber(1.2,style({numberFormat:'decimal',decimals:1,significantDigits:6})),'1.2');
 assert.deepEqual(figureTickLabels([1e-6,1.5e-6,2e-6],style({numberFormat:'si'})),['1\u00a0μ','1.5\u00a0μ','2\u00a0μ']);
 const close=figureTickLabels([1.000001e-3,1.000002e-3],style({numberFormat:'engineering'}));assert.equal(new Set(close).size,2,close.join());
});

test('the style contract admits the new notations and rejects invalid precision',()=>{
 for(const numberFormat of ['engineering','si'])assert.ok(validFigureStyle({numberFormat}));
 assert.ok(validFigureStyle({significantDigits:17,decimals:15}));
 for(const bad of [{significantDigits:0},{significantDigits:18},{significantDigits:2.5},{decimals:16},{numberFormat:'binary'}])assert.equal(validFigureStyle(bad),false,JSON.stringify(bad));
 // The reader language is a rendering option, never part of a saved style.
 assert.equal(validFigureStyle({locale:'nb'}),false);
 const f=createFigure();assert.equal(readerFigureStyle(f,'nb').locale,'nb');assert.equal(readerFigureStyle(f).locale,undefined);
 const numberFormat=retainedFigureProperties('figure',f,f).find(p=>p.path==='style.numberFormat');
 assert.ok(numberFormat.options.includes('engineering')&&numberFormat.options.includes('si'));
 assert.ok(retainedFigureProperties('figure',f,f).some(p=>p.path==='style.significantDigits'&&p.type==='number'));
});

test('rendered tick labels follow the reader language without changing the figure',()=>{
 const f=createFigure();f.title='Current';f.x.kind='number';f.style={numberFormat:'si'};
 f.series[0].points=[{x:1,y:0.00121,error:null},{x:2,y:0.00124,error:null}];
 const before=structuredClone(f),english=ticks(renderFigure(f)),norwegian=ticks(renderFigure(f,{locale:'nb'}));
 assert.ok(english.some(label=>/\d\.\d+\u00a0m$/.test(label)),english.join());
 assert.ok(norwegian.some(label=>/\d,\d+\u00a0m$/.test(label)),norwegian.join());
 assert.equal(english.length,norwegian.length);assert.deepEqual(f,before);
});
