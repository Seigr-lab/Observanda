// Each saved choice identifies this edition and carries its exact definition.
// Keep prior editions when a symbol, reference coordinate or factor changes.
// SI base units and prefixes: https://www.bipm.org/en/measurement-units/si-base-units
// Temperature: https://www.nist.gov/pml/owm/si-units-temperature
const units=[
 ['metre','m','length','1'],['centimetre','cm','length','1/100'],['millimetre','mm','length','1/1000'],
 ['micrometre','μm','length','1/1000000'],['nanometre','nm','length','1/1000000000'],
 ['kilogram','kg','mass','1'],['gram','g','mass','1/1000'],['milligram','mg','mass','1/1000000'],
 ['second','s','time','1'],['millisecond','ms','time','1/1000'],['microsecond','μs','time','1/1000000'],
 ['minute','min','time','60'],['hour','h','time','3600'],
 ['ampere','A','electric-current','1'],['mole','mol','amount-of-substance','1'],['candela','cd','luminous-intensity','1'],
 ['kelvin','K','temperature','1','0'],['celsius','°C','temperature','1','273.15'],['fahrenheit','°F','temperature','5/9','45967/180'],
 ['kelvin-interval','K','temperature','1'],['celsius-interval','°C','temperature','1'],['fahrenheit-interval','°F','temperature','5/9'],
 ['litre','L','length','1/1000',undefined,3],['millilitre','mL','length','1/1000000',undefined,3],
 ['hertz','Hz','time','1',undefined,-1],['percent','%','','1/100'],
];
const edition=new Map(units.map(item=>[item[0],item]));
const scalar=spelling=>({spelling,representation:spelling.includes('/')?'rational':spelling.includes('.')?'decimal':'integer',radix:10});

export function catalogueUnit(id,revision=1){
 const item=revision===1?edition.get(id):null;
 if(!item)return null;
 const [,symbol,axis,scale,offset,exponent=1]=item;
 const definition={version:1,kind:offset===undefined?'difference':'absolute',dimensions:axis?[{axis,exponent}]:[],scale:scalar(scale),offset:scalar(offset??'0'),source:{catalogue:'observanda-units',revision,id}};
 return {id,symbol,axis,definition};
}

export function catalogueUnits({kinds=['absolute','difference']}={}){
 return units.map(([id])=>catalogueUnit(id)).filter(item=>kinds.includes(item.definition.kind));
}

function sameScalar(a,b){
 return a?.spelling===b.spelling&&a.representation===b.representation&&a.radix===b.radix;
}

export function matchesUnitSource(value){
 const {source}=value;
 if(source===undefined)return true;
 if(!source||typeof source!=='object'||Array.isArray(source))return false;
 if(source.catalogue!=='observanda-units'||source.revision!==1||!Object.hasOwn(source,'id')||Object.keys(source).length!==3)return false;
 const unit=catalogueUnit(source.id,source.revision);
 if(!unit)return false;
 const expected=unit.definition;
 return value.version===expected.version&&value.kind===expected.kind&&Array.isArray(value.dimensions)&&value.dimensions.length===expected.dimensions.length&&
  value.dimensions.every((entry,index)=>entry?.axis===expected.dimensions[index].axis&&entry.exponent===expected.dimensions[index].exponent)&&
  sameScalar(value.scale,expected.scale)&&sameScalar(value.offset,expected.offset);
}
