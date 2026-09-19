import { describe, expect, it } from "vitest";
import { appStateSchema, canTransition, canonicalJson, sourceHash, startRunSchema,createProjectSchema,cancelRunSchema,feedbackSchema,restoreSchema,putDataSchema,runStatusSchema,utf8Bytes } from "@/lib/contracts";

describe("public trust boundaries", () => {
  it("rejects inherited/dangerous keys, oversize UTF-8, depth and non-JSON values", () => {
    for (const value of [JSON.parse('{"__proto__":{}}'), { x: Infinity }, { x: new Date() }, { x: "中".repeat(23000) }])
      expect(appStateSchema.safeParse(value).success).toBe(false);
    let nested: unknown = {};
    for (let i = 0; i < 22; i++) nested = { x: nested };
    expect(appStateSchema.safeParse(nested).success).toBe(false);
    expect(appStateSchema.parse({ jobs: [], total: 0 })).toEqual({ jobs: [], total: 0 });
  });
  it("counts Unicode code points and rejects unknown command fields", () => {
    const valid = { requestId: crypto.randomUUID(), baseVersionId: null, prompt: "🚀".repeat(4000) };
    expect(startRunSchema.safeParse(valid).success).toBe(true);
    expect(startRunSchema.safeParse({ ...valid, prompt: valid.prompt + "中" }).success).toBe(false);
    expect(startRunSchema.safeParse({ ...valid, ownerId: "other" }).success).toBe(false);
  });
  it("keeps source bytes significant and normalizes state keys only", async () => {
    const source = { html: "<p>Hi</p>", css: "", js: "await appStore.getState();" };
    expect(await sourceHash(source)).not.toBe(await sourceHash({ ...source, js: source.js + " " }));
    expect(canonicalJson({ b: 2, a: { x: 1, y: 2 } })).toBe(canonicalJson({ a: { y: 2, x: 1 }, b: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("cannot leave terminal states or generate while restoring", () => {
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("cancelled", "generating")).toBe(false);
    expect(canTransition("validating", "repairing", "restore")).toBe(false);
    expect(canTransition("awaiting_preview", "succeeded", "restore")).toBe(true);
  });
});

describe('U-01 every command trust boundary',()=>{
  const id='a93899bd-0a5e-4c22-9da0-4f74c82c9258';
  const diagnostic={code:'PREVIEW_ERROR',message:'启动错误',file:'preview',line:null,column:null};
  const cases=[
    {name:'createProject',schema:createProjectSchema,value:{requestId:id,title:'项目'},ids:['requestId']},
    {name:'startRun',schema:startRunSchema,value:{requestId:id,prompt:'需求',baseVersionId:id,diagnostics:[]},ids:['requestId','baseVersionId']},
    {name:'cancel',schema:cancelRunSchema,value:{reason:'user'},ids:[]},
    {name:'feedback',schema:feedbackSchema,value:{requestId:id,candidateVersionId:id,sourceHash:'a'.repeat(64),dataRevision:0,outcome:'ready',diagnostics:[]},ids:['requestId','candidateVersionId']},
    {name:'restore',schema:restoreSchema,value:{requestId:id,targetVersionId:id,baseVersionId:id},ids:['requestId','targetVersionId','baseVersionId']},
    {name:'putData',schema:putDataSchema,value:{requestId:id,versionId:id,expectedRevision:0,state:{}},ids:['requestId','versionId']},
  ];
  it.each(cases)('$name rejects unknown fields and validates every UUID field',({schema,value,ids})=>{
    expect(schema.safeParse(value).success).toBe(true);
    for(const extra of [{ownerId:id},{userId:id},{userDailyLimit:999999},{unexpected:true}])expect(schema.safeParse({...value,...extra}).success).toBe(false);
    for(const field of ids){
      for(const invalid of ['', 'not-a-uuid',id+' ',id.slice(1),'00000000-0000-4000-0000-000000000000',42,undefined])expect(schema.safeParse({...value,[field]:invalid}).success,`${field}: ${String(invalid)}`).toBe(false);
      expect(schema.parse({...value,[field]:id.toUpperCase()})).toHaveProperty(field,id);
    }
  });
  it('enforces nested diagnostic strictness and outcome semantics on both diagnostic commands',()=>{
    const start={requestId:id,prompt:'需求',baseVersionId:null,diagnostics:[diagnostic]};
    const feedback={requestId:id,candidateVersionId:id,sourceHash:'a'.repeat(64),dataRevision:0,outcome:'errors',diagnostics:[diagnostic]};
    for(const [schema,value]of [[startRunSchema,start],[feedbackSchema,feedback]] as const){
      expect(schema.safeParse(value).success).toBe(true);
      expect(schema.safeParse({...value,diagnostics:[{...diagnostic,ownerId:id}]}).success).toBe(false);
      expect(schema.safeParse({...value,diagnostics:[{...diagnostic,message:'中'.repeat(2001)}]}).success).toBe(false);
      expect(schema.safeParse({...value,diagnostics:Array(6).fill(diagnostic)}).success).toBe(false);
    }
    expect(feedbackSchema.safeParse({...feedback,outcome:'ready'}).success).toBe(false);
    expect(feedbackSchema.safeParse({...feedback,diagnostics:[]}).success).toBe(false);
  });
  it('checks title Unicode limits and exact UTF-8 state capacity and depth boundaries',()=>{
    expect(createProjectSchema.safeParse({requestId:id,title:'🚀'.repeat(60)}).success).toBe(true);
    for(const title of [' ','🚀'.repeat(61)])expect(createProjectSchema.safeParse({requestId:id,title}).success).toBe(false);
    const exact={text:'x'.repeat(65536-utf8Bytes(JSON.stringify({text:''})))};
    const put={requestId:id,versionId:id,expectedRevision:0,state:exact};
    expect(utf8Bytes(JSON.stringify(exact))).toBe(65536);expect(putDataSchema.safeParse(put).success).toBe(true);
    expect(putDataSchema.safeParse({...put,state:{text:exact.text+'x'}}).success).toBe(false);
    let nested:unknown=null;for(let i=0;i<20;i++)nested={x:nested};
    expect(putDataSchema.safeParse({...put,state:nested}).success).toBe(true);
    expect(putDataSchema.safeParse({...put,state:{x:nested}}).success).toBe(false);
    for(const key of ['__proto__','constructor','prototype'])expect(putDataSchema.safeParse({...put,state:JSON.parse(`{"outer":{"${key}":{}}}`)}).success).toBe(false);
  });
});

it('U-05 checks the complete generation and restoration state edge matrices including all terminal rows',()=>{
  const active=['planning','generating','validating','awaiting_preview','repairing'];
  const terminal=['succeeded','failed','cancelled','timed_out'];
  const generateEdges=new Set(['planning:generating','generating:validating','repairing:validating','validating:awaiting_preview','validating:repairing','awaiting_preview:succeeded','awaiting_preview:repairing']);
  const restoreEdges=new Set(['validating:awaiting_preview','awaiting_preview:succeeded']);
  for(const kind of ['generate','restore'] as const)for(const from of runStatusSchema.options)for(const to of runStatusSchema.options){
    const expected=!terminal.includes(from)&&(from===to||(active.includes(from)&&['failed','cancelled','timed_out'].includes(to))||(kind==='generate'?generateEdges:restoreEdges).has(`${from}:${to}`));
    expect(canTransition(from,to,kind),`${kind}: ${from} -> ${to}`).toBe(expected);
  }
});
