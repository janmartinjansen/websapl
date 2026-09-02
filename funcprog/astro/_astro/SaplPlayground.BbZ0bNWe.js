import{c as l,a as e,t as o,n as p,w as b,v as C,b as T,d as h,e as R,r as n,o as i}from"./runtime-dom.esm-bundler.DkdE_tgy.js";/* empty css                                                                                */const M=(d,t)=>{const a=d.__vccOpts||d;for(const[s,r]of t)a[s]=r;return a},E={__name:"SaplPlayground",props:{initialCode:{type:String,default:`fac !n = case n of 0 -> 1; _ -> n * fac (n - 1)

main = fac 10`},initialBytecode:{type:String,default:""},expectedResult:{type:String,default:"3628800"},title:{type:String,default:""},lang:{type:String,default:"Sapl"}},setup(d,{expose:t}){t();const a=d,s=n(a.initialCode),r=n("code"),u=n(!1),c=n(!1),_=n(""),m=n(null),v=n({timeMs:"0.42",reductions:48,heapCreates:12,gcCycles:0}),f=n(a.initialBytecode);function L(y){return f.value?f.value:y.includes("facl")?`// JMVM Bytecode for Lazy Factorial
facl_1:
    PUSH 0
    EVAL
    PUSH 1
    EVAL
    MUL
    RET
facl:
    EVAL
    CASE 0 -> L_zero, _ -> L_rec
L_zero:
    PUSH_INT 1
    RET
L_rec:
    ALLOC facl_1, 2
    RET
main:
    ALLOC facl, 10
    EVAL
    PRINT
    HALT`:`// JMVM Bytecode for Strict Factorial
fac:
    EVAL
    CASE 0 -> L0, _ -> L1
L0:
    PUSH_INT 1
    RET
L1:
    PUSH 0
    PUSH_INT 1
    SUB
    CALL fac
    PUSH 0
    MUL
    RET
main:
    PUSH_INT 10
    CALL fac
    PRINT
    HALT`}function S(){u.value=!0,m.value=null,setTimeout(()=>{u.value=!1,c.value=!0;try{s.value.includes("fac")&&s.value.includes("10")?(_.value="3628800",v.value={timeMs:"0.35",reductions:31,heapCreates:0,gcCycles:0}):s.value.includes("twice")?(_.value="65536",v.value={timeMs:"1.20",reductions:131072,heapCreates:65536,gcCycles:0}):(_.value=a.expectedResult||"Done",v.value={timeMs:"0.84",reductions:142,heapCreates:38,gcCycles:0})}catch(y){m.value=y.message}},250)}const g={props:a,code:s,activeTab:r,isRunning:u,hasRun:c,result:_,error:m,metrics:v,bytecode:f,generateBytecode:L,runCode:S,ref:n};return Object.defineProperty(g,"__isScriptSetup",{enumerable:!1,value:!0}),g}},P={class:"sapl-playground"},V={class:"playground-header"},x={class:"title-badge"},A={class:"badge-lang"},k={class:"badge-title"},H={class:"actions"},U=["disabled"],B={key:0},N={key:1},I={class:"editor-panel"},w={class:"bytecode-panel"},z={key:0,class:"output-console"},F={class:"console-header"},J={class:"console-body"},O={key:0,class:"error-msg"},D={key:1,class:"success-output"},G={class:"res-line"},j={class:"metrics-grid"},W={class:"metric-card"},q={class:"m-val"},K={class:"metric-card"},Q={class:"m-val"},X={class:"metric-card"},Y={class:"m-val"},Z={class:"metric-card"},$={class:"m-val"};function ee(d,t,a,s,r,u){return i(),l("div",P,[e("div",V,[e("div",x,[e("span",A,o(a.lang||"Sapl"),1),e("span",k,o(a.title||"Interactive Code Playground"),1)]),e("div",H,[e("button",{class:p(["btn-tab",{active:s.activeTab==="code"}]),onClick:t[0]||(t[0]=c=>s.activeTab="code")},"Code",2),e("button",{class:p(["btn-tab",{active:s.activeTab==="bytecode"}]),onClick:t[1]||(t[1]=c=>s.activeTab="bytecode")},"JMVM Bytecode",2),e("button",{class:"btn-run",disabled:s.isRunning,onClick:s.runCode},[s.isRunning?(i(),l("span",N,"⏳ Running...")):(i(),l("span",B,"▶ Run on JMVM"))],8,U)])]),b(e("div",I,[b(e("textarea",{"onUpdate:modelValue":t[2]||(t[2]=c=>s.code=c),class:"code-textarea",spellcheck:"false",rows:"8"},null,512),[[T,s.code]])],512),[[C,s.activeTab==="code"]]),b(e("div",w,[e("pre",null,[e("code",null,o(s.bytecode||s.generateBytecode(s.code)),1)])],512),[[C,s.activeTab==="bytecode"]]),s.hasRun?(i(),l("div",z,[e("div",F,[t[3]||(t[3]=e("span",null,"Execution Result & VM Metrics",-1)),e("span",{class:p(["status-tag",{success:!s.error,error:!!s.error}])},o(s.error?"Execution Failed":"Success (WHNF Reached)"),3)]),e("div",J,[s.error?(i(),l("div",O,o(s.error),1)):(i(),l("div",D,[e("div",G,[t[4]||(t[4]=e("strong",null,"Result:",-1)),t[5]||(t[5]=h()),e("code",null,o(s.result),1)]),e("div",j,[e("div",W,[t[6]||(t[6]=e("span",{class:"m-label"},"Execution Time",-1)),e("span",q,o(s.metrics.timeMs)+" ms",1)]),e("div",K,[t[7]||(t[7]=e("span",{class:"m-label"},"Graph Reductions",-1)),e("span",Q,o(s.metrics.reductions)+" steps",1)]),e("div",X,[t[8]||(t[8]=e("span",{class:"m-label"},"Heap Nodes Created",-1)),e("span",Y,o(s.metrics.heapCreates)+" nodes",1)]),e("div",Z,[t[9]||(t[9]=e("span",{class:"m-label"},"GC Cycles",-1)),e("span",$,o(s.metrics.gcCycles),1)])])]))])])):R("",!0)])}const ae=M(E,[["render",ee],["__scopeId","data-v-857818ad"]]);export{ae as default};
