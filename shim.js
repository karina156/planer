/* Stand-in for the claude.ai artifact runtime (db, user, downloads) on GitHub Pages.
   Sign-in is a password typed on the site. Data is encrypted in the browser (AES-GCM, key from
   PBKDF2-SHA256) and stored as data.enc on the `data` branch of each repo. Without the password
   the files are unreadable, so visitors only see the empty interface. Saving needs a GitHub
   token (Contents: read and write) that stays in this browser. */
(function(){
  const OWNER="karina156",ACCOUNT_REPO="planer";
  const here=/^\/angl(\/|$)/.test(location.pathname)?"en":"pl";
  const REPO=here=="en"?"angl":"planer",NAME=here=="en"?"ielts":"planer";
  const LOCAL_KEYS=["planer-v1","ielts75-state"],K_KEY="pw-key",K_TOKEN="gh-token",K_PEND="pw-pending-";
  const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
  /* The saved copy is the source of truth: never start from plain data left in this browser. */
  LOCAL_KEYS.forEach(ls.del);

  const te=new TextEncoder(),td=new TextDecoder();
  const b64=u=>{let s="";const a=new Uint8Array(u);for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode.apply(null,a.subarray(i,i+32768));return btoa(s)};
  const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  async function deriveKey(pw){
    const base=await crypto.subtle.importKey("raw",te.encode(pw),"PBKDF2",false,["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2",salt:te.encode("karina156-planer-v1"),iterations:600000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  }
  const importKey=raw=>crypto.subtle.importKey("raw",unb64(raw),{name:"AES-GCM"},true,["encrypt","decrypt"]);
  async function enc(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,te.encode(JSON.stringify(obj)));return JSON.stringify({v:1,iv:b64(iv),ct:b64(ct)})}
  async function dec(key,txt){const f=JSON.parse(txt);const pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(f.iv)},key,unb64(f.ct));return JSON.parse(td.decode(pt))}

  /* ---------- GitHub storage ---------- */
  const token=()=>ls.get(K_TOKEN);
  const api=(repo,path)=>`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`;
  const shas={};
  async function readFile(repo,path){
    const t=token();
    if(t){const r=await fetch(api(repo,path)+"?ref=data&t="+Date.now(),{headers:{Authorization:"Bearer "+t,Accept:"application/vnd.github+json"},cache:"no-store"});
      if(r.status==404){shas[repo+path]=null;return null}
      if(r.status==401){throw Object.assign(new Error("token"),{code:"token"})}
      if(!r.ok)throw new Error("read "+r.status);
      const j=await r.json();shas[repo+path]=j.sha;return td.decode(unb64(j.content.replace(/\s/g,"")))}
    const r=await fetch(`https://raw.githubusercontent.com/${OWNER}/${repo}/data/${path}?t=${Date.now()}`,{cache:"no-store"});
    if(r.status==404)return null;if(!r.ok)throw new Error("read "+r.status);return r.text();
  }
  async function writeFile(repo,path,text,keepalive){
    const t=token();if(!t)throw Object.assign(new Error("no token"),{code:"token"});
    const put=sha=>fetch(api(repo,path),{method:"PUT",keepalive:!!keepalive,headers:{Authorization:"Bearer "+t,Accept:"application/vnd.github+json","Content-Type":"application/json"},
      body:JSON.stringify({message:"update "+path,content:btoa(text),branch:"data",...(sha?{sha}:{})})});
    if(!((repo+path) in shas))await readFile(repo,path).catch(()=>{});
    let r=await put(shas[repo+path]);
    if(r.status==409||r.status==422){await readFile(repo,path);r=await put(shas[repo+path])}
    if(r.status==401)throw Object.assign(new Error("token"),{code:"token"});
    if(!r.ok)throw new Error("write "+r.status);
    shas[repo+path]=(await r.json()).content.sha;
  }

  /* ---------- session ---------- */
  let key=null;
  const ready=(async()=>{const raw=ls.get(K_KEY);if(!raw)return null;try{key=await importKey(raw)}catch(e){key=null}return key})();

  /* Saves are batched: the page writes on every change, GitHub gets at most one commit per pause. */
  let pendingDoc=null,flushTimer=null,flushing=null,lastErr=null;
  function schedule(){clearTimeout(flushTimer);flushTimer=setTimeout(flush,8000)}
  async function flush(keepalive){
    clearTimeout(flushTimer);if(!pendingDoc||!key)return;if(flushing){await flushing;if(!pendingDoc)return}
    const doc=pendingDoc;
    flushing=(async()=>{const text=await enc(key,doc);ls.set(K_PEND+NAME,text);
      try{await writeFile(REPO,"data.enc",text,keepalive);if(pendingDoc===doc){pendingDoc=null;ls.del(K_PEND+NAME)}lastErr=null;status()}
      catch(e){lastErr=e;status();throw e}})();
    try{await flushing}finally{flushing=null}
  }
  addEventListener("visibilitychange",()=>{if(document.visibilityState=="hidden")flush(true).catch(()=>{})});
  addEventListener("pagehide",()=>flush(true).catch(()=>{}));

  const runtime={
    async user(){await ready;if(!key)return null;return {id:async()=>"me",name:async()=>"Карина"}},
    async db(){await ready;if(!key)return null;
      return {doc(p){return {
        async get(){
          let remote=null,local=null;
          const txt=await readFile(REPO,"data.enc");if(txt)remote=await dec(key,txt);
          const pt=ls.get(K_PEND+NAME);if(pt){try{local=await dec(key,pt)}catch(e){ls.del(K_PEND+NAME)}}
          let d=remote;
          if(local&&(!remote||(local.at||0)>(remote.at||0))){d=local;pendingDoc=local;schedule()}
          if(!d)return {exists:false,data:()=>undefined};
          /* Make the saved copy win over the empty state the page started with. */
          try{const S=JSON.parse(d.state);S.upd=Date.now()+1000;d={...d,state:JSON.stringify(S)}}catch(e){}
          return {exists:true,data:()=>d};
        },
        async set(o){pendingDoc=o;schedule();if(!token())throw Object.assign(new Error("no token"),{code:"token"})}
      }}}},
    async downloads(){return {async save({filename,data}){const b=data instanceof Blob?data:new Blob([data]);const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return {status:"saved"}}}}
  };
  window.claude={use:n=>runtime[n]?runtime[n]():Promise.resolve(null)};

  /* ---------- interface ---------- */
  const css=`.acct{position:fixed;z-index:9999;bottom:14px;left:14px;flex-wrap:wrap;max-width:250px;display:flex;gap:6px;align-items:center;font:13px/1.2 system-ui,sans-serif}
.acct a,.acct button{border:0;border-radius:999px;padding:7px 12px;background:rgba(36,36,36,.88);color:#fff;cursor:pointer;text-decoration:none;font:inherit}
.acct.strip{position:relative;max-width:none;bottom:auto;left:auto;justify-content:flex-end;padding:8px 12px 4px;padding-top:max(8px,env(safe-area-inset-top))}.acct.inside{position:static;margin:auto 0 8px;max-width:none}.acct a.on{background:#FF6898}.acct .who{background:#fff;color:#242424;box-shadow:0 0 0 1px #e3e3ee}
.acct .in-only{display:none}.acct.in .in-only{display:inline-block}.acct .tok{background:#FFE7A8;color:#242424}
.acctbanner{position:fixed;z-index:9998;left:50%;transform:translateX(-50%);bottom:90px;background:#242424;color:#fff;border-radius:14px;padding:10px 14px;font:13px/1.35 system-ui,sans-serif;max-width:min(520px,calc(100vw - 32px));box-shadow:0 8px 24px rgba(0,0,0,.2)}
.acctbanner button{margin-left:8px;border:0;border-radius:999px;padding:5px 10px;background:#FF6898;color:#fff;cursor:pointer;font:inherit}
.pwbg{position:fixed;inset:0;z-index:10000;background:rgba(20,20,30,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.pw{background:#fff;color:#242424;border-radius:14px;padding:20px;width:min(400px,100%);font:14px/1.4 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.25)}
.pw h3{margin:0 0 6px;font-size:17px;font-weight:400}.pw p{margin:0 0 12px;color:#666;font-size:13px}.pw label{display:block;margin:10px 0 4px;font-size:13px;color:#555}
.pw input{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;padding:9px 10px;font:inherit;background:#fafafa;color:inherit}
.pw .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.pw .row button{border:0;border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer;background:#eee;color:#242424}.pw .row .ok{background:#FF6898;color:#fff}
.pw .err{color:#C2185B;font-size:13px;min-height:18px;margin-top:8px}.pw a{color:#6F7FD9}
@media(prefers-color-scheme:dark){.pw{background:#26262c;color:#eee}.pw p,.pw label{color:#aaa}.pw input{background:#1d1d22;border-color:#3a3a44}.pw .row button{background:#3a3a44;color:#eee}}
@media(max-width:900px){.acct .nm{display:none}}`;
  const TOKEN_URL="https://github.com/settings/personal-access-tokens/new";
  let bar;
  function status(){if(!bar)return;const t=bar.querySelector(".tok");if(t)t.hidden=!!token()&&!(lastErr&&lastErr.code=="token")}
  function note(t,ms){const d=document.createElement("div");d.className="acctbanner";d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),ms||5000)}

  function modal(html,onOk){
    const bg=document.createElement("div");bg.className="pwbg";bg.innerHTML=`<form class="pw">${html}<div class="err"></div><div class="row"><button type="button" class="no">Отмена</button><button class="ok">Готово</button></div></form>`;
    const f=bg.querySelector("form"),err=bg.querySelector(".err"),ok=bg.querySelector(".ok");
    const close=()=>bg.remove();bg.querySelector(".no").onclick=close;bg.addEventListener("click",e=>{if(e.target==bg)close()});
    f.onsubmit=async e=>{e.preventDefault();err.textContent="";ok.disabled=true;const t=ok.textContent;ok.textContent="Секунду…";
      try{await onOk(f,close)}catch(x){err.textContent=x.message||"Не получилось"}finally{ok.disabled=false;ok.textContent=t}};
    document.body.appendChild(bg);const first=f.querySelector("input");if(first)first.focus();
  }
  const tokenField=need=>`<label>Ключ GitHub ${need?"":"(чтобы сохранять изменения на этом устройстве)"}</label><input name="tok" autocomplete="off" placeholder="github_pat_…" ${need?"required":""}>
<p style="margin-top:6px">Ключ создаётся <a href="${TOKEN_URL}" target="_blank" rel="noopener">здесь</a>: репозитории planer и angl, право Contents: Read and write. Хранится только в этом браузере.</p>`;

  async function signIn(){
    let verify=null;
    try{verify=await readFile(ACCOUNT_REPO,"verify.enc")}catch(e){if(e.code=="token"){ls.del(K_TOKEN);verify=await readFile(ACCOUNT_REPO,"verify.enc").catch(()=>null)}}
    if(verify){
      modal(`<h3>Вход</h3><p>Введи свой пароль. Без него данные не открыть.</p><label>Пароль</label><input name="pw" type="password" autocomplete="current-password" required>${token()?"":tokenField(false)}`,async(f,close)=>{
        const k=await deriveKey(f.pw.value);
        try{const v=await dec(k,verify);if(v.ok!==1)throw 0}catch(e){throw new Error("Неверный пароль")}
        if(f.tok&&f.tok.value.trim())ls.set(K_TOKEN,f.tok.value.trim());
        ls.set(K_KEY,b64(await crypto.subtle.exportKey("raw",k)));close();location.reload();
      });
    }else{
      modal(`<h3>Придумай пароль</h3><p>Им шифруются твои данные. Если забыть пароль, данные не восстановить, поэтому запиши его.</p><label>Пароль (от 10 символов)</label><input name="pw" type="password" autocomplete="new-password" minlength="10" required><label>Ещё раз</label><input name="pw2" type="password" autocomplete="new-password" required>${tokenField(true)}`,async(f,close)=>{
        if(f.pw.value!==f.pw2.value)throw new Error("Пароли не совпадают");
        ls.set(K_TOKEN,f.tok.value.trim());
        const k=await deriveKey(f.pw.value);
        try{if(await readFile(ACCOUNT_REPO,"verify.enc"))throw new Error("Пароль уже задан, обнови страницу")}catch(e){if(e.code=="token"){ls.del(K_TOKEN);throw new Error("Ключ GitHub не подошёл")}throw e}
        try{await writeFile(ACCOUNT_REPO,"verify.enc",await enc(k,{ok:1}))}catch(e){if(e.code=="token")ls.del(K_TOKEN);throw new Error("Не получилось сохранить: проверь ключ GitHub (нужно Contents: Read and write)")}
        ls.set(K_KEY,b64(await crypto.subtle.exportKey("raw",k)));close();location.reload();
      });
    }
  }
  function askToken(){
    modal(`<h3>Ключ для сохранения</h3><p>Без ключа на этом устройстве изменения не сохраняются.</p>${tokenField(true)}`,async(f,close)=>{
      const old=token();ls.set(K_TOKEN,f.tok.value.trim());
      try{await readFile(ACCOUNT_REPO,"verify.enc")}catch(e){old?ls.set(K_TOKEN,old):ls.del(K_TOKEN);throw new Error("Ключ не подошёл")}
      lastErr=null;close();status();if(pendingDoc)flush().catch(()=>{});note("Ключ сохранён, изменения будут сохраняться");
    });
  }

  addEventListener("DOMContentLoaded",async()=>{
    const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);
    bar=document.createElement("div");bar.className="acct";
    bar.innerHTML=`<a href="/planer/" class="${here=="pl"?"on":""}">Планер</a><a href="/angl/" class="${here=="en"?"on":""}">Английский</a><button class="imp in-only" title="Загрузить резервную копию (.json)">Импорт</button><button class="tok in-only" hidden>Ключ GitHub</button><button class="who">Войти</button>`;
    const side=document.getElementById("side"),ex=document.getElementById("exportBtn");
    if(side&&matchMedia("(min-width:901px)").matches){bar.classList.add("inside");(ex&&ex.parentNode==side?side.insertBefore(bar,ex):side.appendChild(bar))}else{bar.classList.add("strip");document.body.prepend(bar)}
    const who=bar.querySelector(".who"),imp=bar.querySelector(".imp");
    bar.querySelector(".tok").onclick=askToken;
    await ready;
    if(key){
      bar.classList.add("in");who.innerHTML=`<span class="nm">Карина · </span>Выйти`;status();
      who.onclick=async()=>{try{await flush()}catch(e){}[K_KEY,K_PEND+"planer",K_PEND+"ielts",...LOCAL_KEYS].forEach(ls.del);location.reload()};
      imp.onclick=()=>{const i=document.createElement("input");i.type="file";i.accept=".json,application/json";i.onchange=async()=>{try{const o=JSON.parse(await i.files[0].text());
        const doc=o.state?o:{v:1,state:JSON.stringify(o),at:Date.now()};const S=JSON.parse(doc.state);S.upd=Date.now();doc.state=JSON.stringify(S);doc.at=Date.now();
        pendingDoc=doc;await flush();location.reload()}catch(e){note(e&&e.code=="token"?"Сначала добавь ключ GitHub":"Не получилось загрузить файл")}};i.click()};
      if(!token())note("Ты вошла, но на этом устройстве нет ключа GitHub: изменения не сохранятся. Нажми «Ключ GitHub».",9000);
    }else{
      who.onclick=()=>signIn().catch(()=>note("Нет связи с GitHub, попробуй позже"));
      const bn=document.createElement("div");bn.className="acctbanner";bn.innerHTML=`Это пустой планер. Войди, чтобы видеть и сохранять свои данные.<button>Войти</button>`;bn.querySelector("button").onclick=()=>{bn.remove();who.click()};document.body.appendChild(bn);
    }
  });
})();
