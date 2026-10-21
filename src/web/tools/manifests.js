import {timelineModule} from './timeline-manifest.js';
export const toolSpecs=[
 ['scientific-calculator','Scientific calculator','Exact arithmetic, scientific expressions, units, statistics and fractional base conversion.','calculation','calculation','Calculations'],
 ['stoichiometry','Stoichiometry','Molar masses, solutions, limiting reagents and reaction yields.','reaction','reaction','Reactions'],
 ['spreadsheet','Spreadsheet','Tables, formulas and delimited-file import with original values retained.','sheet','spreadsheet','Spreadsheets'],
 ['chemical-import','Chemical structures','Import CDXML drawings and SMILES structures, retaining original files.','chemical','chemical import','Chemical imports']
];
export const toolModules=[...toolSpecs.map(([id,label,description,type])=>({id,label,description,metadataOnly:true,pages:[],entityTypes:[type],navigation:[{action:'module-open',moduleId:id,label,icon:'records'}],load:async()=>()=>{},createUI:services=>id==='scientific-calculator'?import('./calculator-ui.js').then(m=>m.createCalculatorUI(services)):import('./ui.js').then(m=>m.createToolUI(services,id))})),timelineModule];
