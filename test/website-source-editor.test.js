import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWebsiteHTML,validateWebsiteCSS} from '../src/website-file-policy.js';
import {websiteSourceLocation} from '../src/website-source-location.js';
import {cssStructureIssue,formatWebsiteSource,sourcePoint,sourceLines,styleSelectorAt,fieldSourceText,rawSourceOffset,fieldSourceOffset,editedSourceText} from '../src/web/website-source-text.js';

test('source diagnostics point into the author’s original HTML and CSS and ordinary admission still refuses the same source',()=>{
 const cases=[
  [validateWebsiteHTML,'<main>\n<iframe title="Report appendix"></iframe></main>','element','<iframe title="Report appendix">'],
  [validateWebsiteHTML,'<html>\n<body><form action="feedback"></form></body></html>','attribute','action="feedback"'],
  [validateWebsiteHTML,'<head><link href="style.css" rel="arbitrary"></head>','linkRelation','rel="arbitrary"'],
  [validateWebsiteCSS,'/* title */\n.chart {background:U\\52 L("https://example.invalid/remote.png")}','localResource','U\\52 L("https://example.invalid/remote.png")'],
  [validateWebsiteCSS,'.plot {color: navy}\n@im/* annotation */port "layout.css";','cssFeature','@im/* annotation */port'],
  [validateWebsiteHTML,'<style>\n.chart{background:url("https://example.invalid/remote.png")}</style>','localResource','url("https://example.invalid/remote.png")']
 ];
 for(const [validator,source,reason,expected] of cases){
  assert.throws(()=>validator(source,{diagnose:true}),error=>{
   assert.equal(error.code,'INVALID');assert.equal(error.sourceDiagnostic.reason,reason);
   assert.equal(source.slice(error.sourceDiagnostic.start,error.sourceDiagnostic.end),expected);return true;
  });
  assert.throws(()=>validator(source),{code:'INVALID'});
 }
 assert.deepEqual(sourcePoint(sourceLines('aaa\nbb\nċ'),5),{line:2,column:2});
 const raw='\r\nfirst\r\nsecond\nthird\rlast\r\n',field=fieldSourceText(raw);
 for(let i=0;i<=field.length;i++)assert.equal(fieldSourceOffset(raw,rawSourceOffset(raw,i)),i);
 assert.equal(editedSourceText(raw,field.replace('second','line\ninserted')),'\r\nfirst\r\nline\r\ninserted\nthird\rlast\r\n');
 assert.equal(cssStructureIssue('a{--custom:"[literal]";b:fn(4)}'),null);
 assert.deepEqual(cssStructureIssue('a{\ncolor:red'),{start:1,end:2,reason:'cssDelimiter'});
 assert.equal(cssStructureIssue('a{color:/* x').reason,'cssComment');assert.equal(cssStructureIssue('a{content:"x\n"}').reason,'cssString');
 const css='@media (min-width:36em){.sample{--custom:"{;}";color:red;}}';
 assert.equal(styleSelectorAt(css,css.indexOf('red')+2),'.sample');
 assert.equal(styleSelectorAt(css,css.length),'.sample');assert.ok(formatWebsiteSource(css,'css').includes('--custom:"{;}"'));
});

test('source and canvas addresses agree through implied table sections and protected figure ancestors',()=>{
 const html='<HTML lang="en"><BODY><table data-observanda-source="sample"><tr><td>3 &lt; 4</td></tr></table><p>Ɛ</p></BODY></HTML>';
 const result=websiteSourceLocation(html,{offset:html.indexOf('3 &lt;')});
 assert.equal(result.path,'0/0/0/0');assert.equal(html.slice(result.start,result.tagEnd),'<td>');assert.equal(result.protectedRegion,true);
 assert.deepEqual(websiteSourceLocation(html,{path:result.path}),result);assert.equal(websiteSourceLocation(html,{path:'0/0'}),null);
 assert.equal(websiteSourceLocation(html,{path:'1'}).protectedRegion,false);assert.equal(websiteSourceLocation(html,{offset:0}),null);
 assert.throws(()=>websiteSourceLocation(html,{path:'1',offset:0}),{code:'INVALID'});
 const formatted=formatWebsiteSource('<P id="a" data-units="m / s">  x <i>y</i>  </P><!-- <p keep> --><pre>  a\n  b</pre>','html');
 assert.match(formatted,/<P\n  id="a"\n  data-units="m \/ s">  x <i>y<\/i>  <\/P>/);
 assert.ok(formatted.endsWith('<!-- <p keep> --><pre>  a\n  b</pre>'));
});
