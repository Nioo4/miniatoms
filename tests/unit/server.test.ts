import { describe,it,expect,vi,afterEach } from 'vitest';
import { validateArtifact } from '../../src/lib/server/validate-artifact';
import { parseModelResponse,readLimitedJson,callModel } from '../../src/lib/server/deepseek';
import { parseRuntimeConfig } from '../../src/lib/server/config';

const valid={html:'<label for="x">名称</label><input id="x"><button>保存</button>',css:'button { color: blue; }',js:'const state = await appStore.getState(); document.querySelector("button").textContent = "</script>";'};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('U-03 strict shared wrapper and fragment checks',()=>{
  it.each([
    'new Function("return 1+2")();','Function("return 1+2")();','eval("1+2");',
    '(0, eval)("1+2");','const calculate=Function; calculate("return 1+2")();',
    'const calculate=eval; calculate("1+2");','window.eval("1+2");',
    'new globalThis["Function"]("return 1+2")();','self["eval"]("1+2");',
    'const {Function: calculate}=window; calculate("return 1+2")();',
    'const {eval: calculate}=globalThis; calculate("1+2");',
    'document.querySelector("button").onclick=()=>new Function("return 1+2")();',
    'function local(Function) { return Function("ok"); } eval("1+2");',
    '{ const Function = x => x; Function("ok"); } new Function("return 1")();',
  ])('rejects CSP-incompatible dynamic evaluation without executing it: %s',async js=>{
    const errors=await validateArtifact({...valid,js:'\n  '+js});
    expect(errors.some(d=>d.code==='STATIC_VALIDATION'&&d.file==='js'&&d.line===2&&d.column!==null&&d.message.includes('CSP 禁止 eval 和 Function'))).toBe(true);
  });
  it('reports the exact raw-source location of a delayed Function constructor',async()=>{
    expect(await validateArtifact({...valid,js:'const calculate = () => {\n  return new Function("return 1+2")();\n};'})).toEqual([
      expect.objectContaining({code:'STATIC_VALIDATION',file:'js',line:2,column:14}),
    ]);
  });
  it.each([
    'const text="eval(1); new Function()"; /* window.eval() */ // Function()\nconst sum=1+2;',
    'const calculator={eval(value){return value;},Function(value){return value;}};calculator.eval(3);calculator.Function(4);',
    'const Function = value => value + 1; Function(2);',
    'function calculate(Function) { return Function(2); } calculate(value=>value+1);',
    'const window={eval(value){return value;}};window.eval(3);',
    'function calculate() { const {Function}= {Function:value=>value}; return Function(3); } calculate();',
    'const number = Number("2.5"); const result = (number + 3) * -2; document.querySelector("button").textContent=String(result);',
  ])('preserves literal text, local bindings and ordinary arithmetic: %s',async js=>expect(await validateArtifact({...valid,js})).toEqual([]));
  it.each(['async function main(appStore) { const state = await appStore.getState(); document.querySelector("button").onclick = () => state; }','const main = async () => {};','let main;','var main = function () {};','const { value: main } = {};','const [main] = [];'])('rejects a nested host entry binding: %s',async js=>{
    const diagnostics=await validateArtifact({...valid,js:'\n'+js});
    expect(diagnostics).toEqual([expect.objectContaining({code:'STATIC_VALIDATION',file:'js',line:2,column:js.indexOf('main')+1,message:expect.stringContaining('main 是宿主保留入口')})]);
  });
  it.each(['await appStore.getState(); return;','const text = "async function main() { confirm() }"; // function main() {}\n/* window.alert() */','async function init() { await appStore.getState(); } await init();','const obj = { main() {}, confirm() {} }; obj.main(); obj.confirm();','function helper() { const main = 1; return main; } helper();'])('accepts direct code and nonbinding main/modal text: %s',async js=>expect(await validateArtifact({...valid,js})).toEqual([]));
  it.each(['confirm("删除？")','alert("提示")','prompt("输入")','window.confirm("删除？")','globalThis["alert"]("提示")','self["prompt"]("输入")','window["confirm"]("删除？")'])('rejects unsupported native modal: %s',async js=>{
    expect(await validateArtifact({...valid,js:'\n  '+js})).toEqual([expect.objectContaining({code:'STATIC_VALIDATION',file:'js',line:2,column:3,message:expect.stringContaining('自建 DOM 对话框')})]);
  });
  it('accepts top-level await and literal script closing text without running the code',async()=>{
    expect(await validateArtifact({...valid,js:valid.js+'\nthrow new Error("not executed");'})).toEqual([]);
  });
  it.each(['import x from "x";','export const x=1;','with({}) {}','const a = ;'])('rejects %s',async js=>{
    const diagnostics=await validateArtifact({...valid,js});expect(diagnostics.some(d=>d.file==='js')).toBe(true);expect(diagnostics.find(d=>d.file==='js')?.line).toBe(1);
  });
  it.each(['<html><body>x</body></html>','<template><script>x</script></template>','<img src="https://evil.example/a">','<svg><a xlink:href="javascript:alert(1)">x</a></svg>','<div onclick="x()">x</div>','<div id="__ma_runtime">x</div>','<form action="/">x</form>','<div style="background:url(https://evil.example)">x</div>'])('rejects forbidden HTML %s',async html=>expect((await validateArtifact({...valid,html})).some(d=>d.file==='html')).toBe(true));
  it('does not mistake document tags in comments or textarea for HTML tags',async()=>expect(await validateArtifact({...valid,html:'<!-- <html> --><textarea>&lt;body&gt;</textarea>'})).toEqual([]));
  it('rejects external CSS and reports actual syntax errors',async()=>{
    expect((await validateArtifact({...valid,css:'@import "https://evil.example/style.css";'})).some(d=>d.file==='css')).toBe(true);
    expect((await validateArtifact({...valid,css:'a { color: red;'})).some(d=>d.file==='css')).toBe(true);
    expect((await validateArtifact({...valid,css:'a { background: \\75rl(https://evil.example/x); }'})).some(d=>d.file==='css')).toBe(true);
    expect(await validateArtifact({...valid,css:'a { background: url("data:image/png;base64,AAAA"); }'})).toEqual([]);
  });
});
function envelope(calls:unknown[],finish_reason='tool_calls'){return {id:'response',choices:[{finish_reason,message:{role:'assistant',content:null,tool_calls:calls}}]};}
const call={id:'call_actual',type:'function',function:{name:'write_app',arguments:'{invalid json'}};
describe('U-06 actual model protocol',()=>{
  it('preserves invalid tool arguments and ID for bounded static repair',()=>expect(parseModelResponse(envelope([call]),'write_app').call).toEqual(call));
  it.each([{calls:[]},{calls:[call,call]},{calls:[{...call,function:{name:'other',arguments:'{}'}}]}])('rejects missing/multiple/wrong tools',({calls})=>expect(()=>parseModelResponse(envelope(calls),'write_app')).toThrow(/协议/));
  it('does not parse truncated output or invent token usage',()=>{
    expect(()=>parseModelResponse(envelope([call],'length'),'write_app')).toThrow(/长度/);
    expect(parseModelResponse(envelope([call]),'write_app').usage.totalTokens).toBeNull();
  });
  it('counts actual response bytes and handles UTF-8 split at each byte',async()=>{
    const bytes=new TextEncoder().encode('{"text":"中文"}');
    const stream=new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}});
    expect(await readLimitedJson(new Response(stream),100)).toEqual({text:'中文'});
    await expect(readLimitedJson(new Response('中文字'),5)).rejects.toMatchObject({code:'PAYLOAD_TOO_LARGE'});
  });
  it('forces exactly one tool, disables thinking and never sends an unreserved alternate call',async()=>{
    for(const [key,value]of Object.entries({NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',DEEPSEEK_API_KEY:'fixture',AI_TEST_MODE:'off',APP_ORIGIN:'http://localhost:3000'}))vi.stubEnv(key,value);
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope([call]))));vi.stubGlobal('fetch',fetchMock);
    await callModel('write_app',[{role:'user',content:'hello'}],new AbortController().signal);
    const request=JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.thinking).toEqual({type:'disabled'});expect(request.max_tokens).toBe(16384);expect(request.tools).toHaveLength(1);expect(request.tools[0].function.parameters.additionalProperties).toBe(false);expect(request.tool_choice.function.name).toBe('write_app');expect(request.parallel_tool_calls).toBeUndefined();expect(request.response_format).toBeUndefined();
    expect(request.tools[0].function.parameters.properties.js.description).toContain('禁止再次声明顶层 main');
  });
});
describe('lazy configuration and fixture boundary',()=>{
  const env={NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test'};
  it('supports missing model key and zero quotas without converting zero to unlimited',()=>expect(parseRuntimeConfig({...env,LLM_USER_DAILY_LIMIT:'0'}).LLM_USER_DAILY_LIMIT).toBe(0));
  it('permits fixture only locally and outside Vercel',()=>{
    const fixture={...env,AI_TEST_MODE:'fixture',NODE_ENV:'test',DEEPSEEK_BASE_URL:'http://127.0.0.1:3999'};
    expect(parseRuntimeConfig(fixture).AI_TEST_MODE).toBe('fixture');
    for(const invalid of [{...fixture,NODE_ENV:'production'},{...fixture,VERCEL:'1'},{...fixture,APP_ORIGIN:'https://example.com'},{...env,DEEPSEEK_BASE_URL:'http://127.0.0.1:3999'}])expect(()=>parseRuntimeConfig(invalid)).toThrow();
  });
});
