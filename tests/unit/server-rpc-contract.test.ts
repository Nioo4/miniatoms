import { describe,it,expect } from 'vitest';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { runDto,runColumns } from '../../src/lib/server/db';
import { runSchema,runStatusSchema } from '../../src/lib/contracts';
import { ApiError,errorMessage } from '../../src/lib/server/errors';

describe('SQL/server source contract (not a database execution test)',()=>{
  it('explains business conflicts safely without using database text',()=>{
    expect(errorMessage('QUOTA_EXCEEDED')).toContain('额度');
    expect(errorMessage('RESOURCE_LIMIT')).toContain('容量上限');
    expect(errorMessage('RUN_IN_PROGRESS')).toContain('已有任务');
    expect(errorMessage('BASE_VERSION_CONFLICT')).toContain('新版本');
    expect(errorMessage('PREVIEW_DATA_CHANGED')).toContain('重新读取数据');
    expect(errorMessage('DATA_REVISION_CONFLICT')).toContain('其他窗口');
    expect(errorMessage('IDEMPOTENCY_CONFLICT')).toContain('不同内容');
    expect(errorMessage('select password from private')).toBe('服务暂时无法完成请求。');
    expect(new ApiError('QUOTA_EXCEEDED').status).toBe(429);
  });
  it('all 11 RPC call sites use exactly the migration parameter names',()=>{
    const migrations=resolve('supabase/migrations');
    const sql=readdirSync(migrations).filter(n=>n.endsWith('.sql')).map(n=>readFileSync(resolve(migrations,n),'utf8')).join('\n');
    const signatures=new Map([...sql.matchAll(/create function public\.(ma_\w+)\(([^)]*)\) returns jsonb/gi)].map(m=>[m[1],m[2].split(',').map(p=>p.trim().split(/\s+/)[0]).sort()]));
    const visited=new Set<string>();
    for(const file of ['http.ts','agent.ts','db.ts']){
      const source=ts.createSourceFile(file,readFileSync(resolve('src/lib/server',file),'utf8'),ts.ScriptTarget.Latest,true);
      function visit(node:ts.Node){
        if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='rpc'){
          const [name,args]=node.arguments;
          expect(ts.isStringLiteral(name)).toBe(true);expect(ts.isObjectLiteralExpression(args)).toBe(true);
          if(ts.isStringLiteral(name)&&ts.isObjectLiteralExpression(args)){
            const fields=args.properties.map(p=>p.name?.getText(source)).sort();
            expect(fields,`${file}: ${name.text}`).toEqual(signatures.get(name.text));visited.add(name.text);
          }
        }
        ts.forEachChild(node,visit);
      }
      visit(source);
    }
    expect([...visited].sort()).toEqual([...signatures.keys()].sort());expect(visited.size).toBe(11);
  });
  it.each(runStatusSchema.options)('maps SQL %s to strict public RunDto without private context',status=>{
    const id='a93899bd-0a5e-4c22-9da0-4f74c82c9258',date='2026-09-20T00:00:00.000Z';
    const row={id,project_id:id,kind:'generate',status,revision:3,base_version_id:null,candidate_version_id:null,result_version_id:null,model_calls:2,draft_attempt:1,plan:null,diagnostics:[],error_code:null,error_message:null,created_at:date,expires_at:date,finished_at:['succeeded','failed','cancelled','timed_out'].includes(status)?date:null,execution_token:'secret',agent_messages:[{content:'private'}],request_fingerprint:'private',call_records:[{}]};
    const dto=runDto(row);expect(runSchema.safeParse(dto).success).toBe(true);expect(dto.status).toBe(status);
    for(const key of ['execution_token','agent_messages','request_fingerprint','input_diagnostics','call_records']){
      expect(dto).not.toHaveProperty(key);expect(runColumns.split(',')).not.toContain(key);
    }
  });
});
