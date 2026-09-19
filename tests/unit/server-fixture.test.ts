import { describe,it,expect } from 'vitest';
import { fixtureCompletion,jobArtifact } from '../fixtures/model-server.mjs';
import { validateArtifact } from '../../src/lib/server/validate-artifact';

const request=(prompt:string,priorCalls=0)=>({thinking:{type:'disabled'},stream:false,tool_choice:{function:{name:'write_app'}},tools:[{function:{name:'write_app'}}],messages:[{role:'user',content:JSON.stringify({request:prompt})},...Array.from({length:priorCalls},(_,i)=>({role:'assistant',tool_calls:[{id:String(i),function:{name:'write_app',arguments:'{}'}}]}))]});
describe('local HTTP fixture output without starting any service',()=>{
  it.each([{dark:false,search:false,sort:false},{dark:true,search:true,sort:true}])('emits an artifact accepted by the actual static checker',async features=>{
    expect(await validateArtifact(jobArtifact(features))).toEqual([]);
  });
  it('injects only the requested attempt and preserves real repair call accounting',()=>{
    const first=fixtureCompletion(request('[fixture:static-once]')),second=fixtureCompletion(request('[fixture:static-once]',1));
    expect(JSON.parse(first.body.choices[0].message.tool_calls[0].function.arguments).js).toBe('const broken = ;');
    expect(JSON.parse(second.body.choices[0].message.tool_calls[0].function.arguments).js).toContain('appStore.setState');
    expect(fixtureCompletion(request('[fixture:delay]')).delayMs).toBe(20000);
  });
});
