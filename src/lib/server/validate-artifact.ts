import 'server-only';
import { parseFragment,Tokenizer,TokenizerMode } from 'parse5';
import { transform } from 'esbuild';
import { parse, type Node, type AnyNode, type Pattern, type CallExpression, type MemberExpression } from 'acorn';
import type { Artifact, Diagnostic } from '../contracts';
import { buildAppScript } from '../preview/artifact';

export async function validateArtifact(artifact:Artifact):Promise<Diagnostic[]> {
  const out:Diagnostic[]=[];
  const inlineStyles:string[]=[];
  const add=(file:Diagnostic['file'],message:string,line:number|null=null,column:number|null=null)=>{if(out.length<5)out.push({code:'STATIC_VALIDATION',message:[...message].slice(0,2000).join(''),file,line,column});};
  const blocked=new Set(['html','head','body','script','style','link','meta','base','iframe','object','embed']);
  const tokenizer=new Tokenizer({sourceCodeLocationInfo:true},{
    onStartTag(t){if(blocked.has(t.tagName))add('html',`不允许 ${t.tagName} 标签。`,t.location?.startLine??null,t.location?.startCol??null);if(['textarea','title'].includes(t.tagName))tokenizer.state=TokenizerMode.RCDATA;},
    onEndTag(){},onComment(){},onDoctype(){add('html','只允许 HTML 片段。');},onEof(){},onCharacter(){},onNullCharacter(){},onWhitespaceCharacter(){},
  });
  tokenizer.write(artifact.html,true);
  const fragment=parseFragment(artifact.html,{sourceCodeLocationInfo:true,onParseError:e=>add('html',e.code,e.startLine,e.startCol)});
  function walk(node:typeof fragment.childNodes[number]) {
    if('tagName'in node){
      if(blocked.has(node.tagName))add('html',`不允许 ${node.tagName} 标签。`);
      for(const attr of node.attrs){const name=attr.name.toLowerCase(),value=attr.value.trim();
        if(name.startsWith('on')||((name==='id'||name==='name')&&(value==='app'||value.startsWith('__ma_')))||(node.tagName==='form'&&name==='action'))add('html',`不允许属性 ${name}。`);
        if(['src','href','xlink:href','poster','srcset','action','formaction','background'].includes(name)&&value&&!value.startsWith('#')&&!(node.tagName==='img'&&name==='src'&&/^data:image\//i.test(value)))add('html','不允许外部或可执行资源 URL。');
        if(name==='style')inlineStyles.push(value);
      }
      for(const child of node.childNodes)walk(child);
      if('content'in node)for(const child of (node.content as typeof fragment).childNodes)walk(child);
    }
  }
  fragment.childNodes.forEach(walk);
  function checkCss(css:string,file:'html'|'css'){
    if(/@import\b/i.test(css))add(file,'样式不能引用外部资源。');
    for(const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)){
      const url=(match[1]??match[2]??match[3]).trim();
      if(!url.startsWith('#')&&!/^data:image\//i.test(url))add(file,'样式不能引用外部资源。');
    }
  }
  for(const style of inlineStyles){try{checkCss((await transform(`a{${style}}`,{loader:'css',logLevel:'silent'})).code,'html');}catch{add('html','内联样式语法无效。');}}
  try {
    const program=parse(artifact.js,{ecmaVersion:'latest',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true,locations:true});
    const reserved=(node:Node)=>add('js','main 是宿主保留入口；js 必须直接执行初始化，不得再次声明顶层 main。辅助函数请命名为 init 并 await init()。',node.loc!.start.line,node.loc!.start.column+1);
    function binding(pattern:Pattern) {
      if(pattern.type==='Identifier'&&pattern.name==='main')reserved(pattern);
      else if(pattern.type==='RestElement')binding(pattern.argument);
      else if(pattern.type==='AssignmentPattern')binding(pattern.left);
      else if(pattern.type==='ArrayPattern')for(const element of pattern.elements){if(element)binding(element);}
      else if(pattern.type==='ObjectPattern')for(const property of pattern.properties)binding(property.type==='RestElement'?property.argument:property.value as Pattern);
    }
    for(const statement of program.body){
      if((statement.type==='FunctionDeclaration'||statement.type==='ClassDeclaration')&&statement.id?.name==='main')reserved(statement.id);
      if(statement.type==='VariableDeclaration')for(const declaration of statement.declarations)binding(declaration.id);
    }
    // Compatibility check, not a complete JavaScript security analyser. Identify
    // intrinsic references before aliases hide them; respect lexical shadowing.
    type Scope={parent?:Scope;functionScope:boolean;names:Set<string>};
    const scopes=new WeakMap<Node,Scope>(),bindings=new WeakSet<Node>();
    const root:Scope={functionScope:true,names:new Set()};
    function declare(pattern:Pattern,scope:Scope){
      if(pattern.type==='Identifier'){scope.names.add(pattern.name);bindings.add(pattern);}
      else if(pattern.type==='RestElement')declare(pattern.argument,scope);
      else if(pattern.type==='AssignmentPattern')declare(pattern.left,scope);
      else if(pattern.type==='ArrayPattern')for(const item of pattern.elements){if(item)declare(item,scope);}
      else if(pattern.type==='ObjectPattern')for(const item of pattern.properties)declare(item.type==='RestElement'?item.argument:item.value as Pattern,scope);
    }
    function children(node:Node,visit:(child:AnyNode,key:string)=>void){
      for(const [key,value]of Object.entries(node)){
        for(const child of Array.isArray(value)?value:[value])if(child&&typeof child==='object'&&typeof child.type==='string')visit(child as AnyNode,key);
      }
    }
    function collect(node:AnyNode,inherited:Scope){
      if((node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')&&node.id)declare(node.id,inherited);
      const isFunction=['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type);
      const newScope=isFunction||['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','ClassDeclaration','ClassExpression'].includes(node.type);
      const scope:Scope=newScope?{parent:inherited,functionScope:isFunction,names:new Set()}:inherited;
      scopes.set(node,scope);
      if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||node.type==='ArrowFunctionExpression'){
        if(node.type!=='ArrowFunctionExpression'&&node.id)declare(node.id,scope);
        node.params.forEach(param=>declare(param,scope));
      }
      if((node.type==='ClassDeclaration'||node.type==='ClassExpression')&&node.id)declare(node.id,scope);
      if(node.type==='CatchClause'&&node.param)declare(node.param,scope);
      if(node.type==='VariableDeclaration'){
        let target=scope;if(node.kind==='var')while(!target.functionScope&&target.parent)target=target.parent;
        node.declarations.forEach(item=>declare(item.id,target));
      }
      children(node,child=>collect(child,scope));
    }
    collect(program,root);
    function unbound(node:Node,name:string){for(let scope=scopes.get(node);scope;scope=scope.parent)if(scope.names.has(name))return false;return true;}
    const dynamicNames=new Set(['eval','Function']),globalNames=new Set(['window','globalThis','self']);
    const isGlobal=(node:AnyNode)=>node.type==='Identifier'&&globalNames.has(node.name)&&unbound(node,node.name);
    const dynamicError=(node:Node)=>add('js','沙箱 CSP 禁止 eval 和 Function 动态编译（包括别名调用）。表达式请用纯 JavaScript 分词和算术解析，处理运算符优先级、括号及非法输入；不要使用动态代码执行。',node.loc!.start.line,node.loc!.start.column+1);
    function dynamicReferences(node:AnyNode,parent?:AnyNode,key?:string){
      if(node.type==='Identifier'&&dynamicNames.has(node.name)&&!bindings.has(node)&&unbound(node,node.name)){
        const property=parent&&((parent.type==='MemberExpression'&&key==='property'&&!parent.computed)||(['Property','MethodDefinition','PropertyDefinition'].includes(parent.type)&&key==='key'&&!('computed'in parent&&parent.computed)));
        const label=key==='label';
        if(!property&&!label)dynamicError(node);
      }
      if(node.type==='MemberExpression'&&isGlobal(node.object)){
        const name=!node.computed&&node.property.type==='Identifier'?node.property.name:node.computed&&node.property.type==='Literal'?node.property.value:null;
        if(typeof name==='string'&&dynamicNames.has(name))dynamicError(node);
      }
      if(node.type==='VariableDeclarator'&&node.init&&isGlobal(node.init)&&node.id.type==='ObjectPattern'){
        for(const property of node.id.properties)if(property.type==='Property'){
          const name=!property.computed&&property.key.type==='Identifier'?property.key.name:property.key.type==='Literal'?property.key.value:null;
          if(typeof name==='string'&&dynamicNames.has(name))dynamicError(property);
        }
      }
      children(node,(child,childKey)=>dynamicReferences(child,node,childKey));
    }
    dynamicReferences(program);
    const modals=new Set(['alert','confirm','prompt']);
    function walkJs(value:unknown) {
      if(!value||typeof value!=='object')return;
      if(Array.isArray(value)){value.forEach(walkJs);return;}
      const node=value as Node;
      if(node.type==='CallExpression'){
        const callee=(node as CallExpression).callee;
        let modal=callee.type==='Identifier'&&modals.has(callee.name);
        if(callee.type==='MemberExpression'){
          const member=callee as MemberExpression;
          const name=!member.computed&&member.property.type==='Identifier'?member.property.name:member.computed&&member.property.type==='Literal'?member.property.value:null;
          modal=member.object.type==='Identifier'&&['window','globalThis','self'].includes(member.object.name)&&typeof name==='string'&&modals.has(name);
        }
        if(modal)add('js','沙箱不支持 alert/confirm/prompt；请使用自建 DOM 对话框，删除操作必须等待用户明确确认。',node.loc!.start.line,node.loc!.start.column+1);
      }
      for(const child of Object.values(value))walkJs(child);
    }
    walkJs(program);
  }catch{ /* esbuild below remains the authority for syntax errors in the exact host wrapper. */ }
  for(const file of ['js','css'] as const){
    try {const result=await transform(file==='js'?buildAppScript(artifact.js):artifact.css,{loader:file,target:'es2022',logLevel:'silent'});
      if(file==='css')checkCss(result.code,'css');
      for(const warning of result.warnings)if(warning.id==='css-syntax-error')add(file,warning.text,warning.location?.line??null,warning.location?warning.location.column+1:null);
    }catch(error){const errors=(error as {errors?:{text:string;location?:{line:number;column:number}|null}[]}).errors??[];
      if(!errors.length)add(file,'无法解析源码。');
      for(const e of errors){let line=e.location?.line??null;if(file==='js'&&line!==null){line-=1;if(line<1||line>artifact.js.split('\n').length)line=null;}add(file,e.text,line,line!==null&&e.location?e.location.column+1:null);}
    }
  }
  return out;
}
