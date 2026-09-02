import{_ as a,C as c,o,c as s,a3 as d,E as t,j as i,a as n}from"./chunks/framework.ByIHJIQ1.js";const m=JSON.parse('{"title":"2. Higher-Order Functions & Currying","description":"","frontmatter":{},"headers":[],"relativePath":"guide/02-higher-order.md","filePath":"guide/02-higher-order.md"}'),l={name:"guide/02-higher-order.md"};function p(u,e,h,g,f,x){const r=c("SaplPlayground");return o(),s("div",null,[e[0]||(e[0]=d("",7)),t(r,{title:"Higher Order Twice (03_twice.cfp)",lang:"Sapl",initialCode:`inc !x = x + 1
twice f x = f (f x)

main = twice inc 5`,expectedResult:"7"}),e[1]||(e[1]=i("hr",null,null,-1)),e[2]||(e[2]=i("h2",{id:"deep-curried-chains-twicex",tabindex:"-1"},[n("Deep Curried Chains ("),i("code",null,"twicex"),n(") "),i("a",{class:"header-anchor",href:"#deep-curried-chains-twicex","aria-label":'Permalink to "Deep Curried Chains (`twicex`)"'},"​")],-1)),e[3]||(e[3]=i("p",null,"When chaining higher-order applications, arity checks and partial applications are resolved efficiently on the JMVM evaluation stack:",-1)),e[4]||(e[4]=i("p",null,"$$\\text{twicex} = \\text{twice twice twice twice inc } 0 = 2^{(2^{(2^2)})} = 65536$$",-1)),t(r,{title:"Curried Chain (04_twicex.cfp)",lang:"Sapl",initialCode:`inc !x = x + 1
twice f x = f (f x)
twicex = twice twice twice twice inc 0

main = twicex`,expectedResult:"65536"})])}const _=a(l,[["render",p]]);export{m as __pageData,_ as default};
