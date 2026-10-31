'use strict';
/*
 * Mi Bodega sync client. No third party scripts, API credentials are publishable.
 * Inventory data remains in IndexedDB. Cloud copies use per-user RLS + revision CAS.
 * Conflicts are never silently resolved by overwriting either version.
 */
(() => {
  const CONFIG_KEY='mi-bodega-cloud-config-v3';
  const SESSION_KEY='mi-bodega-cloud-session-v3';
  const el=id=>document.getElementById(id);
  const defaults=window.MI_BODEGA_CLOUD||{};
  const stored=()=>{try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}');}catch{return {};}};
  const config=()=>{
    const custom=stored();
    return {url:(custom.url||defaults.url||'').replace(/\/$/,''),key:custom.key||defaults.publishableKey||''};
  };
  let session=null, busy=false, conflictRow=null, conflictMeta=null, booted=false;
  const parseSession=()=>{try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null');}catch{return null;}};
  const saveSession=s=>{session=s;if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY);renderAuth();};
  function setStatus(message,bad=false){const node=el('cloud-status');if(!node)return;node.textContent=message;node.style.color=bad?'#a34837':'';}
  function renderAuth(){
    el('cloud-login-box').hidden=!!session;
    el('cloud-logged-actions').hidden=!session;
    if(session)setStatus('Cuenta: '+session.email+' · Preparado para sincronizar.');
    else setStatus(config().url?'Conexión preparada. Inicia sesión para sincronizar.':'Sin conexión configurada. Los datos permanecen solo en este navegador.');
  }
  function errorText(err){
    const m=String(err?.message||err||'Error desconocido');
    return m.length>220?m.slice(0,220)+'…':m;
  }
  function validateConfig(c){
    const u=new URL(c.url);if(u.protocol!=='https:')throw new Error('La dirección de Supabase debe utilizar HTTPS.');
    if(!/^[-\w.]+$/.test(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Escribe solo la URL raíz de tu proyecto Supabase.');
    if(!c.key||c.key.length<20||/^sb_secret_|^service_role/i.test(c.key))throw new Error('Introduce la clave publicable de Supabase, NUNCA la clave secreta.');
  }
  async function request(path,options={},auth=true){
    const cfg=config();validateConfig(cfg);
    if(!navigator.onLine)throw new Error('No hay conexión a internet; los cambios seguirán guardados aquí.');
    if(auth)await ensureToken();
    const url=cfg.url+path;
    const headers={'apikey':cfg.key,'Content-Type':'application/json',...options.headers};
    if(auth&&session)headers.Authorization='Bearer '+session.access_token;
    const response=await fetch(url,{...options,headers,cache:'no-store'});
    const text=await response.text();let data;
    try{data=text?JSON.parse(text):null;}catch{data={message:text};}
    if(!response.ok){const e=new Error(data?.msg||data?.message||data?.error_description||data?.error||`Error HTTP ${response.status}`);e.status=response.status;throw e;}
    return data;
  }
  async function ensureToken(){
    if(!session)throw new Error('Inicia sesión para sincronizar.');
    if((session.expires_at||0)>Date.now()/1000+90)return;
    const cfg=config();validateConfig(cfg);
    if(!session.refresh_token)throw new Error('La sesión expiró. Inicia sesión nuevamente.');
    const res=await fetch(cfg.url+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),cache:'no-store'
    });
    const info=await res.json();
    if(!res.ok){saveSession(null);throw new Error('La sesión expiró. Vuelve a iniciar sesión.');}
    saveSession({email:session.email,userId:info.user?.id||session.userId,access_token:info.access_token,refresh_token:info.refresh_token,expires_at:Math.floor(Date.now()/1000)+(info.expires_in||3600)});
  }
  function emptyLocal(){return state.boxes.length===0&&state.items.length===0;}
  function snapshot(){return {app:'mi-bodega',version:2,createdAt:new Date().toISOString(),settings:state.settings,boxes:state.boxes,items:state.items};}
  async function remoteRead(){
    const r=await request('/rest/v1/bodega_inventories?user_id=eq.'+encodeURIComponent(session.userId)+'&select=user_id,revision,payload,updated_at');
    return r?.[0]||null;
  }
  async function push(payload,revision){
    const user=session.userId;
    if(revision===0){
      const result=await request('/rest/v1/bodega_inventories',{
        method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:user,revision:1,payload})
      });
      if(!result?.length)throw new Error('No se pudo crear la copia en la nube.');
      return result[0].revision;
    }
    const result=await request('/rest/v1/bodega_inventories?user_id=eq.'+encodeURIComponent(user)+'&revision=eq.'+revision+'&select=revision',{
      method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({revision:revision+1,payload})
    });
    if(!result?.length){const error=new Error('Alguien modificó el inventario desde otro dispositivo.');error.conflict=true;throw error;}
    return result[0].revision;
  }
  async function markUploaded(seq,revision){
    const d=await db();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction('syncmeta','readwrite');const m=tx.objectStore('syncmeta');const req=m.get('main');
      req.onsuccess=()=>{const current=req.result||{id:'main',seq:0};m.put({...current,ownerId:session.userId,revision,dirty:current.seq!==seq});};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function pull(row,meta){
    validateRestore(row.payload);
    await replaceAll(row.payload,{userId:session.userId,revision:row.revision,expectedSeq:meta.seq});
    await reload();
  }
  function announceConflict(row,meta){
    conflictRow=row;conflictMeta=meta;el('cloud-conflict').hidden=false;
    setStatus('Atención: el inventario de este dispositivo y el de la nube son diferentes. No se sobrescribieron.',true);
  }
  function clearConflict(){conflictRow=null;conflictMeta=null;el('cloud-conflict').hidden=true;}
  async function sync(){
    if(busy||!session||!config().url)return;
    // Never replace data while the user is editing an unsaved form.
    if(document.querySelector('dialog[open], #locations-form input:focus, #locations-form textarea:focus'))return;
    busy=true;
    try{
      await ensureToken();
      // Do not sync behind an unresolved conflict. Local data remains usable.
      if(conflictMeta){setStatus('Hay un conflicto pendiente. Descarga respaldo y elige una copia.',true);return;}
      const meta=await readSyncMeta();
      if(meta.ownerId&&meta.ownerId!==session.userId){announceConflict(await remoteRead(),meta);return;}
      const row=await remoteRead();
      const hasData=!emptyLocal();
      if(!row){
        if(meta.revision>0){announceConflict(null,meta);return;}
        const seq=meta.seq;
        const revision=await push(snapshot(),0);
        await markUploaded(seq,revision);
        setStatus('✓ Datos respaldados en la nube · Cuenta: '+session.email);
        return;
      }
      // First connection with pre-existing local inventory needs explicit owner choice.
      if(!meta.ownerId&&hasData){announceConflict(row,meta);return;}
      if(!meta.ownerId&&!hasData){await pull(row,meta);setStatus('✓ Inventario descargado de la nube · Cuenta: '+session.email);return;}
      if(row.revision!==meta.revision){
        if(meta.dirty){announceConflict(row,meta);return;}
        await pull(row,meta);
        setStatus('✓ Inventario actualizado desde la nube · Cuenta: '+session.email);
        return;
      }
      if(meta.dirty){
        const seq=meta.seq;const revision=await push(snapshot(),meta.revision);
        await markUploaded(seq,revision);
        setStatus('✓ Cambios guardados en la nube · Cuenta: '+session.email);
      }else setStatus('✓ Sincronizado · Cuenta: '+session.email);
    }catch(e){
      console.warn('Sincronización:',e);
      if(e.conflict){try{announceConflict(await remoteRead(),await readSyncMeta());}catch{setStatus('Conflicto de sincronización. Vuelve a intentarlo.',true);}}
      else setStatus('Datos locales conservados. Sin sincronizar: '+errorText(e),true);
    }finally{busy=false;}
  }
  async function logIn(create){
    const email=el('cloud-email').value.trim().toLowerCase(),password=el('cloud-password').value;
    if(!email||!password||password.length<8)return setStatus('Ingresa correo y contraseña de al menos 8 caracteres.',true);
    try{
      const cfg=config();validateConfig(cfg);
      if(create){
        const result=await request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})},false);
        if(!result?.access_token){setStatus('Revisa tu correo y confirma la cuenta. Después pulsa Iniciar sesión.');el('cloud-password').value='';return;}
        saveSession({email,userId:result.user.id,access_token:result.access_token,refresh_token:result.refresh_token,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)});
      }else{
        const result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);
        saveSession({email,userId:result.user.id,access_token:result.access_token,refresh_token:result.refresh_token,expires_at:Math.floor(Date.now()/1000)+(result.expires_in||3600)});
      }
      el('cloud-password').value='';clearConflict();await sync();
    }catch(e){setStatus('No fue posible iniciar sesión: '+errorText(e),true);}
  }
  async function chooseRemote(){
    if(!session)return;
    // Do NOT destroy a local copy before giving the user the backup file.
    exportJSON();
    if(!confirm('Se descargó un respaldo LOCAL. ¿Confirmas que ya lo guardaste y quieres reemplazar TODO el inventario de este dispositivo por la versión de la nube?'))return;
    busy=true;
    try{
      const row=await remoteRead(),meta=await readSyncMeta();
      if(!row)throw new Error('No existe inventario en la nube. No se borraron datos locales.');
      await pull(row,meta);clearConflict();setStatus('✓ Copia de la nube recuperada y copia local guardada como JSON.');
    }catch(e){setStatus('No se reemplazó el inventario: '+errorText(e),true);}finally{busy=false;}
  }
  async function chooseLocal(){
    if(!session)return;
    busy=true;
    try{
      const row=await remoteRead();
      if(row){
        download(`mi-bodega-copia-nube-${fileDate()}.json`,JSON.stringify(row.payload,null,2),'application/json');
      }
      exportJSON();
      if(!confirm('Se descargaron las copias de la nube (si había) y de este equipo. Confirma que están guardadas. ¿REEMPLAZAR la nube por el inventario de este dispositivo?'))return;
      const meta=await readSyncMeta(),seq=meta.seq;
      const revision=await push(snapshot(),row?.revision||0);
      await markUploaded(seq,revision);clearConflict();setStatus('✓ Se subió la copia local. Conserva los respaldos descargados.');
    }catch(e){setStatus('No se reemplazó la nube: '+errorText(e),true);}
    finally{busy=false;}
  }
  function boot(){
    if(booted)return;booted=true;
    const cfg=config();el('cloud-url').value=cfg.url;el('cloud-key').value=cfg.key;
    session=parseSession();renderAuth();
    el('cloud-config-save').onclick=()=>{
      try{
        const url=el('cloud-url').value.trim(),key=el('cloud-key').value.trim();validateConfig({url,key});
        if(session&&!confirm('Cambiar de proyecto cerrará tu sesión actual en esta aplicación. ¿Continuar?'))return;
        localStorage.setItem(CONFIG_KEY,JSON.stringify({url,key}));saveSession(null);clearConflict();setStatus('Conexión guardada. Crea una cuenta o inicia sesión.');
      }catch(e){setStatus(errorText(e),true);}
    };
    el('cloud-login').onclick=()=>logIn(false);
    el('cloud-signup').onclick=()=>logIn(true);
    el('cloud-logout').onclick=()=>{saveSession(null);clearConflict();setStatus('Sesión cerrada. El inventario sigue guardado localmente.');};
    el('cloud-sync').onclick=()=>sync();
    el('cloud-keep-remote').onclick=chooseRemote;
    el('cloud-keep-local').onclick=chooseLocal;
    window.addEventListener('mi-bodega-reloaded',()=>{if(session&&!conflictMeta)sync();});
    window.addEventListener('online',sync);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
    window.setInterval(()=>{if(navigator.onLine)sync();},30000);
    if(session)sync();
  }
  window.addEventListener('mi-bodega-ready',boot);
})();
