import { chromium, type Browser } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// B-10 needs native visibility. Normal Playwright launch enables focus emulation
// in its own CDP session; disabling it in another session does not undo that.
// Use the documented noDefaults option and a fresh, test-owned browser profile.
export async function launchNativeBrowser() {
  const root=resolve(tmpdir()),profile=await mkdtemp(join(root,'miniatoms-native-'));
  const child=spawn(chromium.executablePath(),['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--no-sandbox','--disable-dev-shm-usage','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  const exited=new Promise<void>(resolveExit=>child.once('exit',()=>resolveExit()));
  let browser:Browser|undefined;
  async function close(){
    if(browser){
      try{await (await browser.newBrowserCDPSession()).send('Browser.close');}catch{}
      await browser.close().catch(()=>undefined);
    }
    if(child.exitCode===null){child.kill();await Promise.race([exited,new Promise<void>(done=>setTimeout(done,2000))]);}
    // Validate the exact task-owned directory before recursive cleanup on Windows.
    if(dirname(resolve(profile))!==root||!basename(profile).startsWith('miniatoms-native-'))throw new Error('Refusing invalid test profile cleanup path');
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
  try{
    const endpoint=await new Promise<string>((resolveEndpoint,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Native Chromium did not expose a test endpoint')),15000);
      let output='';
      child.stderr.on('data',chunk=>{
        output=(output+String(chunk)).slice(-8192);
        const found=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/.exec(output);
        if(found){clearTimeout(timer);resolveEndpoint(found[1]);}
      });
      child.once('error',()=>{clearTimeout(timer);reject(new Error('Native Chromium launch failed'));});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('Native Chromium exited before connection'));});
    });
    browser=await chromium.connectOverCDP(endpoint,{noDefaults:true,timeout:15000});
    return {browser,context:browser.contexts()[0],close};
  }catch(error){await close();throw error;}
}
