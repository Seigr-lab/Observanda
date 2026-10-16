import {registerInventoryDashboard} from './inventory-dashboard.js';
import {registerInventoryCards} from './inventory-data.js';
import {registerPlanningCards} from './planning-data.js';
import {registerCombinedCalendar} from './calendar-data.js';
export const registerResources=registry=>{registerInventoryDashboard(registry);registerInventoryCards(registry);};
export const registerPlanning=registry=>{registerPlanningCards(registry);registerCombinedCalendar(registry);};
