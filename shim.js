/* Firebase-backed replacement for the claude.ai artifact runtime (db, user, downloads).
   Data lives in Firestore at users/{uid}/data/{name}; rules allow only the owner. */
(function(){
  const V="10.12.2",B="https://www.gstatic.com/firebasejs/"+V+"/";
  const CFG=window.FIREBASE_CONFIG;
  const LOCAL_KEYS=["planer-v1","ielts75-state"];
  /* The cloud copy is the source of truth: never start from a copy left in this browser, so nobody else using it sees it. */
  LOCAL_KEYS.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
  let fb=null;
  const ready=(async()=>{
    if(!CFG||!CFG.apiKey)return null;
    const [{initializeApp},A,F]=await Promise.all([import(B+"firebase-app.js"),import(B+"firebase-auth.js"),import(B+"firebase-firestore.js")]);
    const app=initializeApp(CFG),auth=A.getAuth(app),db=F.getFirestore(app);
    await new Promise(r=>{const off=A.onAuthStateChanged(auth,u=>{off();r(u)})});
    fb={A,F,auth,db};return fb;
  })().catch(e=>{console.warn("firebase",e);return null});
  const pathOf=p=>{const m=/^data\/users\/[^/]+\/(.+)$/.exec(p);return m?m[1].replace(/\//g,"_"):p.replace(/\//g,"_")};
  const api={
    async user(){const f=await ready;if(!f||!f.auth.currentUser)return null;return {id:async()=>f.auth.currentUser.uid,name:async()=>f.auth.currentUser.displayName}},
    async db(){const f=await ready;if(!f||!f.auth.currentUser)return null;const uid=f.auth.currentUser.uid;
      return {doc(p){const ref=f.F.doc(f.db,"users",uid,"data",pathOf(p));
        return {async get(){const s=await f.F.getDoc(ref);return {exists:s.exists(),data:()=>s.data()}},set:o=>f.F.setDoc(ref,o)}}}},
    async downloads(){return {async save({filename,data}){const b=data instanceof Blob?data:new Blob([data]);const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);return {status:"saved"}}}}
  };
  window.claude={use:n=>api[n]?api[n]():Promise.resolve(null)};

  /* ---------- account bar ---------- */
  const css=`.acct{position:fixed;z-index:9999;bottom:14px;left:14px;flex-wrap:wrap;max-width:250px;display:flex;gap:6px;align-items:center;font:13px/1.2 system-ui,sans-serif}
.acct a,.acct button{border:0;border-radius:999px;padding:7px 12px;background:rgba(36,36,36,.88);color:#fff;cursor:pointer;text-decoration:none;font:inherit}
.acct.strip{position:relative;top:auto;left:auto;right:auto;bottom:auto;max-width:none;justify-content:flex-end;padding:8px 12px calc(4px) 12px;padding-top:max(8px,env(safe-area-inset-top))}.acct.inside{position:static;margin:auto 0 8px;max-width:none}.acct a.on{background:#FF6898}.acct .who{background:#fff;color:#242424;box-shadow:0 0 0 1px #e3e3ee}
.acct .imp{display:none}.acct.in .imp{display:inline-block}
.acctbanner{position:fixed;z-index:9998;left:50%;transform:translateX(-50%);bottom:90px;background:#242424;color:#fff;border-radius:14px;padding:10px 14px;font:13px/1.35 system-ui,sans-serif;max-width:min(520px,calc(100vw - 32px));box-shadow:0 8px 24px rgba(0,0,0,.2)}
.acctbanner button{margin-left:8px;border:0;border-radius:999px;padding:5px 10px;background:#FF6898;color:#fff;cursor:pointer;font:inherit}
@media(max-width:900px){.acct .nm{display:none}}`;
  const here=/^\/angl(\/|$)/.test(location.pathname)?"en":"pl";
  addEventListener("DOMContentLoaded",async()=>{
    const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);
    const bar=document.createElement("div");bar.className="acct";
    bar.innerHTML=`<a href="/planer/" class="${here=="pl"?"on":""}">Планер</a><a href="/angl/" class="${here=="en"?"on":""}">Английский</a><button class="imp" title="Загрузить резервную копию (.json)">Импорт</button><button class="who">Вход…</button>`;
    const side=document.getElementById("side"),ex=document.getElementById("exportBtn");
    if(side&&matchMedia("(min-width:901px)").matches){bar.classList.add("inside");(ex&&ex.parentNode==side?side.insertBefore(bar,ex):side.appendChild(bar))}else{bar.classList.add("strip");document.body.prepend(bar)}
    const who=bar.querySelector(".who"),imp=bar.querySelector(".imp");
    const f=await ready;
    if(!f){who.textContent="Вход недоступен";who.disabled=true;return}
    const u=f.auth.currentUser;
    if(u){bar.classList.add("in");who.innerHTML=`<span class="nm">${(u.displayName||u.email||"").replace(/[<>&]/g,"")} · </span>Выйти`;
      who.onclick=async()=>{await f.A.signOut(f.auth);LOCAL_KEYS.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});location.reload()};
      imp.onclick=()=>{const i=document.createElement("input");i.type="file";i.accept=".json,application/json";i.onchange=async()=>{try{const t=await i.files[0].text(),o=JSON.parse(t);const name=here=="en"?"ielts":"planer";
        const doc=o.state?o:{v:1,state:JSON.stringify(o),at:Date.now()};const S=JSON.parse(doc.state);S.upd=Date.now();doc.state=JSON.stringify(S);doc.at=Date.now();
        await f.F.setDoc(f.F.doc(f.db,"users",u.uid,"data",name),doc);try{localStorage.setItem(here=="en"?"ielts75-state":"planer-v1",doc.state)}catch(e){}location.reload()}catch(e){alertBox("Не получилось прочитать файл")}};i.click()};
    }else{
      LOCAL_KEYS.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
      who.textContent="Войти через Google";
      who.onclick=async()=>{try{await f.A.signInWithPopup(f.auth,new f.A.GoogleAuthProvider());location.reload()}catch(e){if(e&&e.code!="auth/popup-closed-by-user")alertBox("Вход не удался: "+(e.code||e.message))}};
      const bn=document.createElement("div");bn.className="acctbanner";bn.innerHTML=`Это пустой планер. Войди через Google, чтобы видеть и сохранять свои данные.<button>Войти</button>`;bn.querySelector("button").onclick=()=>who.click();document.body.appendChild(bn);
    }
  });
  function alertBox(t){const d=document.createElement("div");d.className="acctbanner";d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),5000)}
})();
