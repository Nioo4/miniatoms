import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const evidence = [];const browserVersion=browser.version();
for (const width of [1440,390]) {
 const page = await browser.newPage({viewport:{width,height:width===1440?960:844},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/',{waitUntil:'networkidle'});
 await page.locator('.global-error').waitFor();
 await page.screenshot({animations:'disabled',path:`artifacts/screenshots/home-${width}-configuration-required.png`,fullPage:true});
 const initial=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().height).map(b=>({text:b.textContent,disabled:b.disabled,rect:{x:b.getBoundingClientRect().x,y:b.getBoundingClientRect().y,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}}))}));
 await page.getByRole('button',{name:/个人记账本/}).click();
 const example=await page.locator('#home-prompt').inputValue();
 await page.screenshot({animations:'disabled',path:`artifacts/screenshots/home-${width}-example-filled.png`,fullPage:true});
 if(width===390){await page.getByRole('button',{name:'打开项目列表'}).click();await page.waitForFunction(()=>document.querySelector('.sidebar.open')?.getBoundingClientRect().x===0);await page.screenshot({animations:'disabled',path:'artifacts/screenshots/home-390-drawer.png'});await page.mouse.click(360,40);}
 await page.goto('http://127.0.0.1:3000/projects/00000000-0000-4000-8000-000000000001',{waitUntil:'networkidle'});
 await page.locator('.global-error').waitFor();
 await page.screenshot({animations:'disabled',path:`artifacts/screenshots/studio-${width}-configuration-required.png`,fullPage:true});
 if(width===390){await page.getByRole('button',{name:'应用成果',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.mobile-main-tabs .selected')?.textContent==='应用成果');await page.screenshot({animations:'disabled',path:'artifacts/screenshots/studio-390-result.png',fullPage:true});}
 const project=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,alert:document.querySelector('[role=alert]')?.textContent,inputFont:document.querySelector('textarea')?getComputedStyle(document.querySelector('textarea')).fontSize:null}));
 evidence.push({width,initial,example,project,errors});await page.close();
}
await browser.close();await writeFile('artifacts/screenshots/client-shell-check.json',JSON.stringify({environment:{baseUrl:'http://127.0.0.1:3000',browser:browserVersion,mode:'production build / configuration-required shell only',database:'not configured',modelCalls:0,recordedAt:new Date().toISOString()},checks:evidence},null,2));console.log(JSON.stringify(evidence,null,2));





