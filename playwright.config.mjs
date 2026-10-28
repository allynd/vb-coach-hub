import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:8765',browserName:'chromium',trace:'retain-on-failure'},webServer:{command:'python3 -m http.server 8765 --bind 127.0.0.1',url:'http://127.0.0.1:8765',reuseExistingServer:!process.env.CI},reporter:[['list'],['html',{open:'never'}]]});
