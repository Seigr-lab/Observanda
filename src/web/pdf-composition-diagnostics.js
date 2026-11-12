export const pdfCompositionReportName='layout-diagnostics.json';
const codes=new Set(['PDF_COMPOSITION_OVERLAP','PDF_COMPOSITION_OVERFLOW','PDF_CONTENT_CLIPPED','PDF_CONTENT_OVERFLOW','PDF_BLOCK_TOO_TALL','PDF_GLYPH','PDF_FONT_FAILED','PDF_FONT_SUBSTITUTED','PDF_IMAGE_MISSING','PDF_IMAGE_RESOLUTION']);
export function compositionDiagnostics(findings,sectionId){
 return findings.filter(row=>codes.has(row.code)&&(row.sectionId===sectionId||row.code==='PDF_FONT_FAILED')).map(({code,blockId,blockIndex})=>({code,blockId,blockIndex}));
}
