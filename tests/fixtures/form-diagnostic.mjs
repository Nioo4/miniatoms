// Standalone browser diagnosis. Does not start services or change the application.
import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
  for(const scenario of [{sandbox:'allow-scripts',prevent:true,method:'get'},{sandbox:'allow-scripts allow-forms',prevent:true,method:'get'},{sandbox:'allow-scripts allow-forms',prevent:false,method:'get'},{sandbox:'allow-scripts allow-forms',prevent:false,method:'post'}]){
    const {sandbox,prevent,method}=scenario;
    const page=await browser.newPage();const consoleMessages=[],outbound=[];
    page.on('console',message=>consoleMessages.push(message.text()));
    page.on('request',request=>{if(request.url().startsWith('https://example.com'))outbound.push(request.url());});
    await page.setContent('<iframe title="diagnostic"></iframe>');
    await page.evaluate(({sandbox,prevent,method})=>{
      window.events=[];
      window.addEventListener('message',event=>window.events.push(event.data));
      const frame=document.querySelector('iframe');frame.setAttribute('sandbox',sandbox);
      frame.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-test\'; form-action \'none\'"><form method="'+method+'" action="https://example.com/forbidden"><label for="x">Value</label><input id="x" name="fixtureValue" required><button type="submit">Save</button></form><script nonce="test">document.querySelector("button").addEventListener("click",()=>parent.postMessage("click","*"));document.querySelector("form").addEventListener("submit",event=>{'+(prevent?'event.preventDefault();':'')+'parent.postMessage("submit","*");});</script>';
    },scenario);
    await page.frameLocator('iframe').getByLabel('Value').fill('fixture');
    const frameUrlBefore=page.frames()[1].url();await page.frameLocator('iframe').getByRole('button',{name:'Save'}).click();
    await page.waitForTimeout(100);
    console.log(JSON.stringify({browser:browser.version(),sandbox,method,preventDefault:prevent,events:await page.evaluate(()=>window.events),console:consoleMessages,outbound,frameUrlBefore,frameUrlAfter:page.frames()[1].url()}));
    await page.close();
  }
}finally{await browser.close();}
