'use strict';

const DB_NAME = 'mi-bodega-local-v1';
const DB_VERSION = 3;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const nice = (s) => String(s ?? '').trim();
const DEFAULT_ZONES = [
  {code:'A',name:'Uso frecuente'}, {code:'B',name:'Herramientas y materiales'},
  {code:'C',name:'Temporada'}, {code:'D',name:'Objetos grandes'},
  {code:'P',name:'Por clasificar'}
];
const defaultSettings = () => ({id:'main',bodega:'Bodega principal',zones:DEFAULT_ZONES.map(z=>({...z}))});
const state = { boxes: [], items: [], settings:defaultSettings(), view: 'inicio', editingPhoto: '', detailsId: '', cameraStream: null, scanning: false };
let dbPromise;

function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('boxes')) d.createObjectStore('boxes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('syncmeta')) d.createObjectStore('syncmeta', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}
// All local writes persist a dirty flag and edit sequence in the SAME IndexedDB transaction.
// Cache updates and browser refreshes never clear these stores.
async function fromStore(store, action, value) {
  const d=await db();const writing=action!=='getAll' && store!=='syncmeta';
  const result=await new Promise((resolve,reject)=>{
    const tx=d.transaction(writing?[store,'syncmeta']:[store],writing?'readwrite':'readonly');
    const req=tx.objectStore(store)[action](...(value===undefined?[]:[value]));
    let result;
    req.onsuccess=()=>{result=req.result;};
    if(writing){
      const m=tx.objectStore('syncmeta');
      const q=m.get('main');
      q.onsuccess=()=>{const previous=q.result||{id:'main',revision:0,seq:0,dirty:false,ownerId:''};
        m.put({...previous,seq:(previous.seq||0)+1,dirty:true});};
    }
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  return result;
}
const all = (store) => fromStore(store, 'getAll');
const save = (store, data) => fromStore(store, 'put', data);
const remove = (store, id) => fromStore(store, 'delete', id);
async function readSyncMeta(){return (await fromStore('syncmeta','get','main'))||{id:'main',revision:0,seq:0,dirty:false,ownerId:''};}
async function writeSyncMeta(change){
  const d=await db();return new Promise((resolve,reject)=>{
    const tx=d.transaction('syncmeta','readwrite'),store=tx.objectStore('syncmeta');
    const req=store.get('main');req.onsuccess=()=>store.put({...{id:'main',revision:0,seq:0,dirty:false,ownerId:''},...req.result,...change});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function reload() {
  const [boxes,items,settings]=await Promise.all([all('boxes'), all('items'), all('settings')]);
  state.boxes=boxes;state.items=items;state.settings=settings.find(x=>x.id==='main')||defaultSettings();
  state.boxes.sort((a,b) => String(a.id).localeCompare(String(b.id),'es',{numeric:true}));
  state.items.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  render();
  window.dispatchEvent(new Event('mi-bodega-reloaded'));
}
const getBox = id => state.boxes.find(x => x.id === id);
const zoneLabel = code => state.settings.zones.find(z=>z.code===code)?.name || (code ? `Zona ${code}` : 'Sin zona asignada');
const where = (area,zone,shelf,level,order) => `${area||state.settings.bodega} · ${zone ? `Zona ${zone} (${zoneLabel(zone)})` : 'Sin zona asignada'} · ${shelf==='SUELO'?'Suelo':`Estante ${shelf}`} · Nivel ${level} · Orden ${order}`;
const loc = b => b ? where(b.area,b.zone,b.shelf,b.level,b.order) : 'Ubicación no disponible';
const itemLoc = item => {
  const b = getBox(item.boxId);
  if(b)return `${b.id} · ${loc(b)} · Posición ${item.position}`;
  if(item.boxId==='')return `Sin caja · ${where(item.loose?.area,item.loose?.zone,item.loose?.shelf,item.loose?.level,item.position)}`;
  return `Caja ${item.boxId} (sin ubicación)`;
};
const byPosition = (a,b) => Number(a.position) - Number(b.position) || a.name.localeCompare(b.name,'es');
const searchText = s => nice(s).toLocaleLowerCase('es');

function toast(msg, error = false) {
  const el = $('#notice');
  el.textContent = msg; el.classList.toggle('error',error); el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 6500);
}
function view(id) {
  state.view = id;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${id}`));
  $$('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === id));
  $('#page-title').textContent = ({inicio:'Tu bodega, bajo control',ubicaciones:'Mapa de tu bodega',cajas:'Organización por cajas',objetos:'Todos tus objetos',respaldo:'Cuida tu inventario'})[id] || 'Mi Bodega';
  window.scrollTo(0,0);
}
function empty(title, subtitle) {return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(subtitle)}</p></div>`;}
function itemRow(x, minimal=false) {
  const image = x.photo && /^data:image\/(jpeg|png|webp);base64,/i.test(x.photo) ? `<img src="${x.photo}" class="thumb" alt="Foto de ${esc(x.name)}">` : '<div class="thumb">▤</div>';
  return `<div class="item-card">${image}<div class="item-info"><strong>${esc(x.name)}</strong><small>${esc(itemLoc(x))}</small><small>${esc(x.category||'Sin categoría')}${x.notes ? ` · ${esc(x.notes)}` : ''}</small></div><div class="item-actions"><span class="qty-badge">× ${esc(x.qty)}</span>${!minimal ? `<button class="mini-button" data-action="edit-item" data-id="${esc(x.id)}">Editar</button><button class="mini-button danger" data-action="delete-item" data-id="${esc(x.id)}">Eliminar</button>` : ''}</div></div>`;
}
function render() {
  $('#stat-boxes').textContent = state.boxes.length;
  $('#stat-items').textContent = state.items.length;
  $('#stat-units').textContent = state.items.reduce((n,it) => n + Number(it.qty||0),0);
  $('#recent-items').innerHTML = state.items.length ? state.items.slice(0,5).map(x => `<div class="compact-row"><div><strong>${esc(x.name)}</strong><small>${esc(itemLoc(x))}</small></div><span class="tag">${esc(x.boxId||'SIN CAJA')}</span></div>`).join('') : empty('Tu bodega está lista para comenzar','Crea una caja y registra tu primer objeto.');
  renderBoxes(); renderItems(); renderHomeResults(); updateBoxSelects(); renderLocations();
}
function renderBoxes() {
  const q = searchText($('#box-filter').value);
  const boxes = state.boxes.filter(b => searchText(`${b.id} ${b.name} ${loc(b)} ${b.notes}`).includes(q));
  $('#boxes-list').innerHTML = boxes.length ? boxes.map(b => {
    const count = state.items.filter(x => x.boxId === b.id).length;
    return `<article class="box-card"><div class="box-card-head"><span class="box-icon">▤</span><span class="box-id">${esc(b.id)}</span></div><h3>${esc(b.name)}</h3><div class="box-location">${esc(loc(b))}</div><div class="box-bottom"><small>${count} tipo${count !== 1 ? 's' : ''} de objeto${count !== 1 ? 's' : ''}</small><div class="box-buttons"><button class="text-button" data-action="details" data-id="${esc(b.id)}">Ver contenido</button><button class="text-button" data-action="edit-box" data-id="${esc(b.id)}">Editar</button><button class="text-button" data-action="print" data-id="${esc(b.id)}">QR</button></div></div></article>`;
  }).join('') : empty(q?'Sin resultados':'Todavía no tienes cajas', q?'Prueba otra búsqueda.':'Pulsa «Nueva caja» para registrar la primera.');
}
function renderItems() {
  const q = searchText($('#items-filter').value);
  const filterBox = $('#item-box-filter').value;
  const list = state.items.filter(x => (!filterBox || x.boxId === filterBox) && searchText(`${x.name} ${x.category} ${x.boxId} ${x.notes} ${itemLoc(x)} ${getBox(x.boxId)?.name ?? ''}`).includes(q));
  $('#items-list').innerHTML = list.length ? list.map(x => itemRow(x)).join('') : empty(q || filterBox?'No se encontraron objetos':'No hay objetos registrados', q || filterBox?'Cambia los filtros para ver más.':'Agrega tu primer objeto, con o sin caja.');
}
function renderHomeResults() {
  const q = searchText($('#home-search').value);
  if(!q) {$('#home-results').innerHTML = '';return;}
  const list = state.items.filter(x => searchText(`${x.name} ${x.category} ${x.notes} ${itemLoc(x)} ${getBox(x.boxId)?.name ?? ''}`).includes(q));
  $('#home-results').innerHTML = list.length ? list.slice(0,30).map(x => `<div class="result-row"><div><strong>${esc(x.name)}</strong><small>${esc(itemLoc(x))}</small></div><span class="tag">${esc(x.qty)} unid.</span></div>`).join('') : empty('No encontramos ese objeto','Revisa la escritura o agrega el objeto al inventario.');
}
function updateBoxSelects() {
  const opt = state.boxes.map(b=>`<option value="${esc(b.id)}">${esc(b.id)} — ${esc(b.name)}</option>`).join('');
  const itemSelect=$('#item-box');const oldItem=itemSelect.value;
  itemSelect.innerHTML = '<option value="">Selecciona una ubicación...</option><option value="__loose__">Sin caja (objeto suelto)</option>' + opt;
  if (oldItem==='__loose__'||state.boxes.some(b=>b.id===oldItem)) itemSelect.value=oldItem;
  const filter=$('#item-box-filter');const oldFilter=filter.value;
  filter.innerHTML='<option value="">Todas las cajas</option>'+opt;
  if(state.boxes.some(b=>b.id===oldFilter)) filter.value=oldFilter;
}
function zoneOptions() {
  return state.settings.zones.map(z=>`<option value="${esc(z.code)}">Zona ${esc(z.code)} — ${esc(z.name)}</option>`).join('');
}
function zoneEditorRow(z) {
  return `<label class="field zone-field"><span class="zone-pill">${esc(z.code)}</span><input data-zone-code="${esc(z.code)}" maxlength="60" required value="${esc(z.name)}" aria-label="Nombre de zona ${esc(z.code)}"></label>`;
}
function renderLocations() {
  $('#setting-bodega').value=state.settings.bodega;
  const container=$('#zones-form-grid');
  // Only rerender editor if a save, import or first load modified zone data; avoid losing editing while typing.
  if(document.activeElement && container.contains(document.activeElement)) return;
  container.innerHTML=state.settings.zones.map(zoneEditorRow).join('');
  const zones=[...state.settings.zones];
  if(state.boxes.some(b=>!b.zone)||state.items.some(i=>i.boxId===''&&!i.loose?.zone))zones.push({code:'?',name:'Sin zona asignada'});
  $('#zone-map').innerHTML=zones.map(z=>{
    const boxes=state.boxes.filter(b=>(b.zone||'?')===z.code);
    const loose=state.items.filter(i=>i.boxId===''&&(i.loose?.zone||'?')===z.code);
    const details=boxes.map(b=>`<li><button class="text-button" data-action="details" data-id="${esc(b.id)}">${esc(b.id)}</button> — ${esc(b.name)}<small>${esc(b.shelf)} / ${esc(b.level)} / Orden ${esc(b.order)}</small></li>`).join('')+loose.map(i=>`<li><strong>${esc(i.name)}</strong> <span class="tag">Sin caja</span><small>${esc(i.loose?.shelf||'SUELO')} / ${esc(i.loose?.level||'N00')} / Orden ${esc(i.position)}</small></li>`).join('');
    return `<article class="zone-card"><div class="zone-card-header"><span class="zone-code">${esc(z.code)}</span><div><h3>${esc(z.name)}</h3><p>${boxes.length} cajas · ${loose.length} objetos sueltos</p></div></div><ul class="zone-contents">${details||'<li class="muted">Sin objetos registrados todavía</li>'}</ul></article>`;
  }).join('');
}
async function saveLocations(e) {
  e.preventDefault();const area=nice($('#setting-bodega').value);
  const zones=$$('#zones-form-grid [data-zone-code]').map(el=>({code:el.dataset.zoneCode,name:nice(el.value)}));
  if(!area||!zones.length||zones.some(z=>!z.name))return toast('Completa el nombre de tu bodega y todas las zonas.',true);
  const oldName=state.settings.bodega;
  const settings={id:'main',bodega:area,zones};
  const changedBoxes=state.boxes.filter(b=>b.area===oldName).map(b=>({...b,area}));
  const changedItems=state.items.filter(i=>i.boxId===''&&i.loose?.area===oldName).map(i=>({...i,loose:{...i.loose,area}}));
  // Al cambiar el nombre principal, conservar coherentes las ubicaciones existentes.
  const d=await db();
  await new Promise((resolve,reject)=>{
    const tx=d.transaction(['boxes','items','settings','syncmeta'],'readwrite');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    changedBoxes.forEach(b=>tx.objectStore('boxes').put(b));
    changedItems.forEach(i=>tx.objectStore('items').put(i));
    tx.objectStore('settings').put(settings);
    const m=tx.objectStore('syncmeta'),q=m.get('main');q.onsuccess=()=>{const old=q.result||{id:'main',revision:0,seq:0,ownerId:''};m.put({...old,seq:(old.seq||0)+1,dirty:true});};
  });
  await reload();toast('Organización guardada. Ahora puedes registrar tus cajas.');
}
function addZone() {
  const used=new Set(state.settings.zones.map(z=>z.code));
  const code='EFGHIJKLMNOQRSTUVWXYZ'.split('').find(c=>!used.has(c));
  if(!code)return toast('Has alcanzado la cantidad máxima de zonas.',true);
  // Commit typed edits only locally until «Guardar organización» is pressed.
  const container=$('#zones-form-grid');container.insertAdjacentHTML('beforeend',zoneEditorRow({code,name:`Nueva zona ${code}`}));
  container.querySelector(`[data-zone-code="${code}"]`).focus();
}
function toggleLooseFields() {
  const loose=$('#item-box').value==='__loose__';$('#item-loose-fields').hidden=!loose;
}
function openDialog(id) { const el = document.getElementById(id); if (!el.open) el.showModal(); }
function closeDialog(id) { const el = document.getElementById(id); if (el.open) el.close(); }
function nextBoxCode() {
  const max=state.boxes.reduce((n,b)=>Math.max(n, Number((b.id.match(/^C(\d+)$/i)||[])[1]||0)),0);
  return 'C'+String(max+1).padStart(3,'0');
}
function getNextOrder(zone,shelf,level,id='') {
  const occupied=state.boxes.filter(b=>b.id!==id && b.zone===zone && searchText(b.shelf)===searchText(shelf)&&searchText(b.level)===searchText(level));
  let pos=1;while(occupied.some(b=>Number(b.order)===pos))pos++;
  return pos;
}
function newBox(id = '') {
  const b=getBox(id);
  $('#box-form').reset();$('#box-id').value = b?.id || '';
  $('#box-dialog-title').textContent = b ? `Editar caja ${b.id}` : 'Nueva caja';
  $('#box-name').value=b?.name||'';
  $('#box-area').value=b?.area||state.settings.bodega;
  $('#box-zone').innerHTML=zoneOptions();$('#box-zone').value=b?.zone||'P';
  $('#box-shelf').value=b?.shelf||'SUELO';
  $('#box-level').value=b?.level||'N00';
  $('#box-order').value=b?.order||getNextOrder($('#box-zone').value,$('#box-shelf').value,$('#box-level').value);
  $('#box-notes').value=b?.notes||'';
  $('#box-zone').onchange=()=>{if(!b)$('#box-order').value=getNextOrder($('#box-zone').value,$('#box-shelf').value,$('#box-level').value);};
  openDialog('box-dialog');
}
async function saveBox(e) {
  e.preventDefault();const id=$('#box-id').value || nextBoxCode();
  const x={id,name:nice($('#box-name').value),area:nice($('#box-area').value),zone:$('#box-zone').value,shelf:nice($('#box-shelf').value).toUpperCase(),level:nice($('#box-level').value).toUpperCase(),order:Number($('#box-order').value),notes:nice($('#box-notes').value)};
  if (!x.name||!x.area||!state.settings.zones.some(z=>z.code===x.zone)||!x.shelf||!x.level||!Number.isInteger(x.order)||x.order<1) return toast('Completa todos los campos obligatorios de la caja.',true);
  const conflict=state.boxes.find(b=>b.id!==id && searchText(b.area)===searchText(x.area) && b.zone===x.zone && searchText(b.shelf)===searchText(x.shelf) && searchText(b.level)===searchText(x.level) && Number(b.order)===x.order);
  if(conflict) return toast(`La ubicación ya la ocupa ${conflict.id}. Cambia el orden o nivel.`,true);
  await save('boxes',x);closeDialog('box-dialog');await reload();toast(`Caja ${id} guardada.`);
}
function newItem(id = '', defaultBox = '') {
  const x=state.items.find(x=>x.id===id);
  $('#item-form').reset();$('#item-id').value=x?.id||'';
  $('#item-dialog-title').textContent=x?'Editar objeto':'Nuevo objeto';
  $('#item-name').value=x?.name||'';$('#item-category').value=x?.category||'';
  $('#item-qty').value=x?.qty||1;$('#item-position').value=x?.position||1;
  $('#item-notes').value=x?.notes||'';
  state.editingPhoto=x?.photo||'';updatePhotoPreview();
  $('#item-box').value=x?(x.boxId||'__loose__'):(defaultBox||'');
  $('#item-loose-area').value=x?.loose?.area||state.settings.bodega;
  $('#item-loose-zone').innerHTML=zoneOptions();$('#item-loose-zone').value=x?.loose?.zone||'P';
  $('#item-loose-shelf').value=x?.loose?.shelf||'SUELO';
  $('#item-loose-level').value=x?.loose?.level||'N00';
  toggleLooseFields();openDialog('item-dialog');
}
function updatePhotoPreview() {
  const el=$('#photo-preview'); const ok=/^data:image\/(jpeg|png|webp);base64,/i.test(state.editingPhoto);
  el.hidden=!ok;if(ok) el.querySelector('img').src=state.editingPhoto;
}
async function resizePhoto(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>10*1024*1024) throw new Error('Usa una imagen JPG, PNG o WebP de hasta 10 MB.');
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,720/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  return canvas.toDataURL('image/jpeg',0.75);
}
async function saveItem(e) {
  e.preventDefault();
  const existing=state.items.find(x=>x.id===$('#item-id').value);
  const boxSelection=$('#item-box').value;
  const noBox=boxSelection==='__loose__';
  const loose=noBox?{area:nice($('#item-loose-area').value),zone:$('#item-loose-zone').value,shelf:nice($('#item-loose-shelf').value).toUpperCase(),level:nice($('#item-loose-level').value).toUpperCase()}:null;
  const x={id:existing?.id||crypto.randomUUID(),name:nice($('#item-name').value),category:nice($('#item-category').value),qty:Number($('#item-qty').value),boxId:noBox?'':boxSelection,loose,position:Number($('#item-position').value),notes:nice($('#item-notes').value),photo:state.editingPhoto||'',updatedAt:new Date().toISOString()};
  if(!x.name||!Number.isInteger(x.qty)||x.qty<1||!Number.isInteger(x.position)||x.position<1) return toast('Comprueba nombre, cantidad y posición.',true);
  if(noBox){
    if(!loose.area||!state.settings.zones.some(z=>z.code===loose.zone)||!loose.shelf||!loose.level)return toast('Completa la ubicación del objeto sin caja.',true);
  }else if(!getBox(x.boxId))return toast('Selecciona una caja o «Sin caja».',true);
  const occupied=state.items.find(i=>i.id!==x.id&&Number(i.position)===x.position && (noBox ? i.boxId==='' && searchText(i.loose?.area)===searchText(loose.area)&&i.loose?.zone===loose.zone&&searchText(i.loose?.shelf)===searchText(loose.shelf)&&searchText(i.loose?.level)===searchText(loose.level) : i.boxId===x.boxId));
  if(occupied)return toast(`La posición ${x.position} ya la ocupa «${occupied.name}».`,true);
  try {const photo=$('#item-photo').files[0];if(photo)x.photo=await resizePhoto(photo);
    await save('items',x);closeDialog('item-dialog');await reload();toast(`Objeto «${x.name}» guardado.`);
  }catch(err){console.error(err);toast(err.message||'No se pudo guardar el objeto.',true);}
}

function details(id) {
  const b=getBox(id);if(!b)return toast(`La caja ${id} no existe en este inventario.`,true);
  state.detailsId=id;$('#details-title').textContent=`${b.id} — ${b.name}`;
  const items=state.items.filter(x=>x.boxId===id).sort(byPosition);
  $('#details-body').innerHTML=`<div class="detail-code">Código de caja: ${esc(b.id)}</div><p class="detail-row"><strong>Ubicación:</strong> ${esc(loc(b))}</p>${b.notes?`<p class="detail-row"><strong>Notas:</strong> ${esc(b.notes)}</p>`:''}<strong>Contenido (${items.length} tipos):</strong><ul class="detail-items">${items.length?items.map(x=>`<li><strong>${esc(x.name)}</strong> · ${esc(x.qty)} unid. <small>Posición ${esc(x.position)}${x.category?` · ${esc(x.category)}`:''}</small></li>`).join(''):'<li>Esta caja está vacía.</li>'}</ul><button type="button" class="button secondary" data-action="add-to-box" data-id="${esc(id)}">+ Agregar objeto a esta caja</button><button type="button" class="mini-button danger" data-action="delete-box" data-id="${esc(id)}" style="margin-left:9px">Eliminar caja vacía</button>`;
  openDialog('details-dialog');
}
async function deleteItem(id) {
  const x=state.items.find(x=>x.id===id);if(!x)return;
  if(!confirm(`¿Eliminar «${x.name}» del inventario?`))return;
  await remove('items',id);await reload();toast('Objeto eliminado.');
}
async function deleteBox(id) {
  const b=getBox(id);if(!b)return;
  if(state.items.some(x=>x.boxId===id))return toast('No puedes eliminar esta caja mientras contenga objetos.',true);
  if(!confirm(`¿Eliminar la caja ${id}?`))return;
  await remove('boxes',id);closeDialog('details-dialog');await reload();toast('Caja eliminada.');
}
function printBox(id) {
  const b=getBox(id);if(!b)return;
  const payload=`MI-BODEGA|${b.id}`;
  let svg;
  try{svg=window.MiBodegaQR.svg(payload,4);}catch(err){return toast('No se pudo generar el QR: '+err.message,true);}
  const w=window.open('','_blank');if(!w)return toast('Permite abrir ventanas emergentes para imprimir la etiqueta.',true);
  const label=`${b.id} — ${b.name}`;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiqueta ${esc(b.id)}</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#153746}.tag{border:2px solid #163747;border-radius:14px;width:350px;padding:25px;text-align:center}.code{font-size:30px;font-weight:900}.name{font-size:18px;font-weight:700;margin:10px 0}.place{font-size:13px;line-height:1.5}.qr{margin:17px auto;width:200px}.qr svg{width:200px;height:200px}.hint{font-size:10px;color:#777}.print{margin-top:20px;padding:12px 22px;border:0;border-radius:8px;background:#147d69;color:white;font-weight:bold;cursor:pointer}@media print{.print{display:none}.tag{break-inside:avoid}}</style></head><body><div class="tag"><div class="code">${esc(b.id)}</div><div class="name">${esc(b.name)}</div><div class="place">${esc(loc(b))}</div><div class="qr">${svg}</div><div class="hint">Mi Bodega · Escanea con la aplicación o busca este código</div></div><button class="print" onclick="window.print()">Imprimir etiqueta</button></body></html>`);
  w.document.close();w.focus();
}
function download(name,content,mime) {const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
const fileDate=()=>new Date().toISOString().slice(0,10);
function exportJSON() {download(`mi-bodega-respaldo-${fileDate()}.json`,JSON.stringify({app:'mi-bodega',version:2,createdAt:new Date().toISOString(),settings:state.settings,boxes:state.boxes,items:state.items},null,2),'application/json;charset=utf-8');toast('Respaldo descargado. Guarda una copia fuera de este equipo.');}
function exportCSV() {
  const header=['Nombre','Categoria','Cantidad','Bodega','Zona','Estante/soporte','Nivel','Orden caja','Codigo caja','Nombre caja','Posicion objeto','Notas'];
  const q=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  const rows=state.items.map(x=>{const b=getBox(x.boxId)||{};const d=x.boxId?b:(x.loose||{});return [x.name,x.category,x.qty,d.area,d.zone,d.shelf,d.level,b.order,x.boxId||'SIN CAJA',b.name,x.position,x.notes].map(q).join(';')});
  download(`mi-bodega-inventario-${fileDate()}.csv`,'\uFEFF'+[header.map(q).join(';'),...rows].join('\r\n'),'text/csv;charset=utf-8');toast('CSV descargado.');
}
function validateRestore(input) {
  if(!input||input.app!=='mi-bodega'||![1,2].includes(input.version)||!Array.isArray(input.boxes)||!Array.isArray(input.items))throw new Error('El archivo no es un respaldo válido de Mi Bodega (v1 o v2).');
  if(input.boxes.length>10000||input.items.length>50000)throw new Error('El respaldo excede el máximo permitido.');
  if(input.version===2){
    const s=input.settings;
    if(!s||s.id!=='main'||typeof s.bodega!=='string'||!s.bodega||s.bodega.length>60||!Array.isArray(s.zones)||s.zones.length>26)throw new Error('Configuración de bodega inválida.');
    const zoneIds=new Set();
    for(const z of s.zones){if(!z||typeof z.code!=='string'||!/^[A-Z]$/.test(z.code)||zoneIds.has(z.code)||typeof z.name!=='string'||!z.name||z.name.length>60)throw new Error('Zonas no válidas en el respaldo.');zoneIds.add(z.code);}
  }
  const ids=new Set();
  for(const b of input.boxes){if(!b||typeof b.id!=='string'||!/^C\d{3,12}$/.test(b.id)||ids.has(b.id))throw new Error('Hay códigos de caja inválidos o duplicados.');ids.add(b.id);for(const k of ['name','area','shelf','level','notes']){if(typeof b[k]!=='string'||b[k].length>500)throw new Error('Datos de caja inválidos.');}if(b.zone!==undefined && (typeof b.zone!=='string'||b.zone.length>1))throw new Error('Zona de caja inválida.');if(!Number.isInteger(Number(b.order))||Number(b.order)<1)throw new Error('Orden de caja inválido.');}
  const itemIds=new Set();
  for(const x of input.items){
    if(!x||typeof x.id!=='string'||x.id.length>100||itemIds.has(x.id))throw new Error('Hay objetos inválidos o repetidos.');itemIds.add(x.id);
    if(x.boxId===''){
      if(input.version!==2||!x.loose||typeof x.loose!=='object')throw new Error('Ubicación de objeto suelto inválida.');
      for(const k of ['area','zone','shelf','level'])if(typeof x.loose[k]!=='string'||!x.loose[k]||x.loose[k].length>60)throw new Error('Ubicación de objeto suelto inválida.');
    }else if(!ids.has(x.boxId))throw new Error('Hay objetos asociados a una caja inexistente.');
    for(const k of ['name','category','notes'])if(typeof x[k]!=='string'||x[k].length>500)throw new Error('Datos de objeto inválidos.');
    if(!Number.isInteger(Number(x.qty))||Number(x.qty)<1||!Number.isInteger(Number(x.position))||Number(x.position)<1)throw new Error('Cantidad o posición inválida.');
    if(x.photo && (typeof x.photo!=='string'||x.photo.length>1400000||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(x.photo)))throw new Error('Fotografía no válida.');
  }
}
// Import/demonstration marks local data dirty. Cloud downloads are applied atomically
// only when the local edit sequence has not changed during a network request.
async function replaceAll(data,cloud=null) {
  const d=await db();const settings=data.settings||defaultSettings();
  await new Promise((resolve,reject)=>{
    const tx=d.transaction(['boxes','items','settings','syncmeta'],'readwrite');
    const m=tx.objectStore('syncmeta'),q=m.get('main');
    q.onsuccess=()=>{
      const old=q.result||{id:'main',revision:0,seq:0,dirty:false,ownerId:''};
      if(cloud && old.seq!==cloud.expectedSeq){tx.abort();return;}
      const next=cloud
        ? {...old,ownerId:cloud.userId,revision:cloud.revision,dirty:false}
        : {...old,seq:(old.seq||0)+1,dirty:true};
      tx.objectStore('items').clear();tx.objectStore('boxes').clear();tx.objectStore('settings').clear();
      data.boxes.forEach(b=>tx.objectStore('boxes').put(b));
      data.items.forEach(i=>tx.objectStore('items').put(i));
      tx.objectStore('settings').put(settings);m.put(next);
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
async function importJSON(file) {
  if(!file)return;
  try{if(file.size>60*1024*1024)throw new Error('Archivo demasiado grande.');const data=JSON.parse(await file.text());validateRestore(data);if(!confirm(`Restaurar ${data.boxes.length} cajas y ${data.items.length} objetos? Esto REEMPLAZARÁ todo lo actual.`))return;await replaceAll(data);$('#home-search').value='';$('#items-filter').value='';$('#box-filter').value='';$('#item-box-filter').value='';await reload();toast('Respaldo restaurado correctamente.');}catch(e){console.error(e);toast(e.message||'Error al restaurar.',true);}finally{$('#import-json').value='';}
}
async function loadDemo() {
  if(state.boxes.length||state.items.length)return toast('Los ejemplos solo se pueden cargar con el inventario vacío.',true);
  const boxes=[{id:'C001',name:'Decoración de Navidad',area:state.settings.bodega,zone:'C',shelf:'E01',level:'2',order:1,notes:'Caja transparente'},{id:'C002',name:'Herramientas pequeñas',area:state.settings.bodega,zone:'B',shelf:'E01',level:'2',order:2,notes:'Caja gris'},{id:'C003',name:'Artículos de camping',area:state.settings.bodega,zone:'A',shelf:'E02',level:'1',order:1,notes:''}];
  const items=[['Luces de Navidad','Navidad',2,'C001',1],['Adornos rojos','Navidad',12,'C001',2],['Martillo','Herramientas',1,'C002',1],['Destornilladores','Herramientas',4,'C002',2],['Linterna','Camping',1,'C003',1]].map(([name,category,qty,boxId,position])=>({id:crypto.randomUUID(),name,category,qty,boxId,position,notes:'',photo:'',updatedAt:new Date().toISOString()}));
  await replaceAll({boxes,items,settings:state.settings});await reload();view('inicio');toast('Datos de ejemplo cargados. ¡Prueba el buscador!');
}
function parseCode(raw){const s=nice(raw).toUpperCase();const match=s.match(/^(?:MI-BODEGA\||CAJA:)?(C\d{3,12})$/);return match?.[1]||'';}
function locate(raw){const id=parseCode(raw);if(!id)return toast('Código no reconocido. Usa un código de caja como C001.',true);closeDialog('scan-dialog');stopScan();details(id);}
async function startScan() {
  if(!navigator.mediaDevices?.getUserMedia){$('#scanner-message').textContent='La cámara requiere HTTPS o localhost y un navegador compatible. Usa el código manual.';return;}
  if(!('BarcodeDetector' in window)){$('#scanner-message').textContent='Tu navegador no admite lectura QR integrada. Usa el código manual o Chrome de Android compatible.';return;}
  try{const supported=await BarcodeDetector.getSupportedFormats();if(!supported.includes('qr_code'))throw new Error('No se admite QR en este dispositivo.');const detector=new BarcodeDetector({formats:['qr_code']});const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});state.cameraStream=stream;state.scanning=true;const video=$('#camera-preview');video.srcObject=stream;$('#camera-box').hidden=false;$('#stop-camera').hidden=false;$('#start-camera').hidden=true;$('#scanner-message').textContent='Escaneando…';await video.play();async function tick(){if(!state.scanning)return;try{const codes=await detector.detect(video);if(codes.length){const code=parseCode(codes[0].rawValue);if(code){locate(code);return;}}}catch(e){console.warn('Escaneo',e);}if(state.scanning)requestAnimationFrame(tick);}tick();}catch(e){stopScan();$('#scanner-message').textContent=`No se pudo abrir la cámara: ${e.message}. Puedes ingresar el código manualmente.`;}
}
function stopScan(){state.scanning=false;if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}$('#camera-preview').srcObject=null;$('#camera-box').hidden=true;$('#stop-camera').hidden=true;$('#start-camera').hidden=false;}
function initActions() {
  $$('[data-view]').forEach(btn=>btn.addEventListener('click',()=>view(btn.dataset.view)));
  $$('[data-view-link]').forEach(btn=>btn.addEventListener('click',()=>view(btn.dataset.viewLink)));
  $('#hero-add-box').onclick=$('#add-box').onclick=$('#locations-new-box').onclick=()=>newBox();
  $('#locations-form').addEventListener('submit',e=>saveLocations(e).catch(err=>toast(err.message,true)));
  $('#add-zone').onclick=addZone;
  $('#box-on-floor').onclick=()=>{$('#box-shelf').value='SUELO';$('#box-level').value='N00';};
  $('#item-box').addEventListener('change',toggleLooseFields);
  $('#hero-add-item').onclick=$('#add-item').onclick=$('#add-item-header').onclick=()=>newItem();
  $('#box-form').addEventListener('submit',e=>saveBox(e).catch(err=>toast(err.message,true)));
  $('#item-form').addEventListener('submit',e=>saveItem(e).catch(err=>toast(err.message,true)));
  $$('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeDialog(btn.dataset.close)));
  $$('.modal').forEach(dialog=>{dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});dialog.addEventListener('close',()=>{if(dialog.id==='scan-dialog')stopScan();});});
  $('#home-search').addEventListener('input',renderHomeResults);
  $('#home-search-btn').onclick=renderHomeResults;
  $('#box-filter').addEventListener('input',renderBoxes);
  $('#items-filter').addEventListener('input',renderItems);
  $('#item-box-filter').addEventListener('change',renderItems);
  $('#remove-photo').onclick=()=>{state.editingPhoto='';$('#item-photo').value='';updatePhotoPreview();};
  $('#item-photo').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.editingPhoto=await resizePhoto(f);updatePhotoPreview();}catch(err){e.target.value='';toast(err.message,true);}});
  $('#details-print').onclick=()=>printBox(state.detailsId);
  $('#scan-btn').onclick=()=>{openDialog('scan-dialog');$('#scanner-message').textContent='';$('#manual-code').value='';};
  $('#start-camera').onclick=startScan;$('#stop-camera').onclick=stopScan;$('#find-code').onclick=()=>locate($('#manual-code').value);
  $('#manual-code').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();locate(e.target.value);}});
  $('#export-json').onclick=exportJSON;$('#export-csv').onclick=exportCSV;
  $('#import-json').addEventListener('change',e=>importJSON(e.target.files[0]));
  $('#demo-btn').onclick=()=>loadDemo().catch(err=>toast(err.message,true));
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn)return;const action=btn.dataset.action,id=btn.dataset.id;if(action==='edit-box')newBox(id);if(action==='edit-item')newItem(id);if(action==='details')details(id);if(action==='print')printBox(id);if(action==='delete-item')deleteItem(id);if(action==='delete-box')deleteBox(id);if(action==='add-to-box'){closeDialog('details-dialog');newItem('',id);}});
}
async function init() {
  initActions();
  if (!('indexedDB' in window)) {toast('Este navegador no admite almacenamiento local IndexedDB.',true);return;}
  try{await reload();const params=new URLSearchParams(location.search);if(params.has('c'))details(parseCode(params.get('c'))||params.get('c'));}catch(e){console.error(e);toast('No fue posible abrir la base de datos. Revisa el modo privado o permisos del navegador.',true);}
  window.dispatchEvent(new Event('mi-bodega-ready'));
  initAppUpdates();
}
// The SW downloads new releases automatically. Reload only after a safe moment:
// never while a user is editing an object or a box.
function initAppUpdates(){
  if(!('serviceWorker' in navigator) || !['http:','https:'].includes(location.protocol))return;
  const banner=$('#update-banner');let reloadPending=false;
  const editing=()=>!!document.querySelector('dialog[open]') || !!document.querySelector('form input:focus, form textarea:focus');
  const activate=()=>{if(!editing())location.reload();else{reloadPending=true;banner.hidden=false;}};
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(navigator.serviceWorker.controller)activate();});
  $('#update-now').addEventListener('click',()=>{if(editing())return toast('Cierra el formulario después de guardar antes de actualizar.',true);location.reload();});
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
    reg.update().catch(()=>{});
    window.setInterval(()=>{if(navigator.onLine)reg.update().catch(()=>{});},15*60*1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){reg.update().catch(()=>{});if(reloadPending&&!editing())location.reload();}});
  }).catch(console.warn);
}
document.addEventListener('DOMContentLoaded',init);
