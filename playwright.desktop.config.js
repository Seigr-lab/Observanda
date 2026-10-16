import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./test/desktop',workers:1,fullyParallel:false,timeout:120000,reporter:'list'});
