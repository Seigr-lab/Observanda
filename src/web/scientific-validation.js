import {figureIssues as modelIssues,parseFigureCSV as parseCSV} from './figure-model.js';
import {mapFigureTable as mapTable} from './figure-import-model.js';
import {readDelimitedTable as readTable} from './tabular-data.js';
import {t} from './i18n/index.js';
import './i18n/catalogues/figureDiagnostics.js';
import './i18n/catalogues/scientificEditors.js';

// Presentation adapters keep scientific validation and imported values shared
// with persistence, while formatting its diagnostics in the current language.
export const figureIssues=(figure,options={})=>modelIssues(figure,{...options,translate:t});
export const parseFigureCSV=(source,kind,options={})=>parseCSV(source,kind,{...options,translate:t});
export const readDelimitedTable=(source,options={})=>readTable(source,{...options,translate:t});
export const mapFigureTable=(table,mapping,figure,options={})=>mapTable(table,mapping,figure,{...options,translate:t});
