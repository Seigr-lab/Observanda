import {modelMessages} from './model-messages.js';
import messages from './locales/en/figureDiagnostics.json' with {type:'json'};
import axes from './locales/en/figureAxes.json' with {type:'json'};
import composition from './locales/en/figureComposition.json' with {type:'json'};
import heatmap from './locales/en/figureHeatmap.json' with {type:'json'};
import intervals from './locales/en/figureIntervals.json' with {type:'json'};
import markers from './locales/en/figureMarkerArea.json' with {type:'json'};
import observations from './locales/en/figureObservations.json' with {type:'json'};
import provenance from './locales/en/figureProvenance.json' with {type:'json'};
import transforms from './locales/en/measurementTransform.json' with {type:'json'};
import measurements from './locales/en/measurements.json' with {type:'json'};

export const figureDiagnosticText=translate=>modelMessages('figureDiagnostics',messages,translate);
// Existing validators return fixed resource messages. Match only those known
// values; authored labels and unexpected diagnostics pass through unchanged.
const resources=new Map();
for(const [namespace,catalogue] of Object.entries({figureAxes:axes,figureComposition:composition,figureHeatmap:heatmap,figureIntervals:intervals,figureMarkerArea:markers,figureObservations:observations,figureProvenance:provenance,measurementTransform:transforms,measurements})){
 for(const [key,value] of Object.entries(catalogue))if(typeof value==='string'&&!value.includes('{'))resources.set(value,[namespace,key]);
}
export function figureResourceIssue(message,translate){
 const entry=translate&&resources.get(message);
 return entry?translate(...entry):message;
}
