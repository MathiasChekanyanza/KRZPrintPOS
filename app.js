'use strict';
const KEY='krz_print_pos_data_v1';
const SESSION_KEY='krz_print_pos_session_user';
const round2=n=>Math.round((Number(n)||0)*100)/100;
const money=n=>new Intl.NumberFormat('en-JM',{style:'currency',currency:'JMD'}).format(round2(n));
const localDate=d=>{try{return (d?new Date(d):new Date()).toLocaleDateString('en-CA')}catch(e){return String(d||'').slice(0,10)}};
const today=()=>localDate();
const now=()=>new Date().toISOString();
const defaultUsers=()=>([{id:1,username:'admin',name:'Administrator',pin:'1234',role:'Admin',active:true}]);
const defaultSettings=()=>({
 shopName:'KRZ PRINT',trn:'',phone:'',address:'',openingFloat:0,
 receiptFooter:'Thank you for your business!',taxMode:'off',taxRate:15,lastBackupAt:null
});
const defaultData=()=>({
 version:3,products:[],sales:[],customers:[],jobs:[],expenses:[],stockLog:[],
 users:defaultUsers(),
 settings:defaultSettings(),
 nextProductId:1,nextSaleId:1,nextCustomerId:1,nextJobId:1,nextExpenseId:1,nextUserId:2
});
let db=null,cart=[],currentUser=null,sqliteConnected=false;
db=loadData();

function nextId(arr){return Math.max(0,...(Array.isArray(arr)?arr:[]).map(x=>Number(x?.id)||0))+1}
function upgradeDb(x){
 x.products=Array.isArray(x.products)?x.products:[];
 x.sales=Array.isArray(x.sales)?x.sales:[];
 x.customers=Array.isArray(x.customers)?x.customers:[];
 x.jobs=Array.isArray(x.jobs)?x.jobs:[];
 x.expenses=Array.isArray(x.expenses)?x.expenses:[];
 x.stockLog=Array.isArray(x.stockLog)?x.stockLog:[];
 x.users=Array.isArray(x.users)&&x.users.length?x.users:defaultUsers();
 if(!x.users.some(u=>u.active!==false&&u.role==='Admin'))x.users[0].active=true,x.users[0].role='Admin';
 x.settings=Object.assign(defaultSettings(),x.settings||{});
 x.products.forEach(p=>{if(p.trackStock===undefined)p.trackStock=true;if(p.taxable===undefined)p.taxable=true});
 x.sales.forEach(s=>{if(!s.status)s.status='Completed'});
 x.nextProductId=Math.max(Number(x.nextProductId)||1,nextId(x.products));
 x.nextSaleId=Math.max(Number(x.nextSaleId)||1,nextId(x.sales));
 x.nextCustomerId=Math.max(Number(x.nextCustomerId)||1,nextId(x.customers));
 x.nextJobId=Math.max(Number(x.nextJobId)||1,nextId(x.jobs));
 x.nextExpenseId=Math.max(Number(x.nextExpenseId)||1,nextId(x.expenses));
 x.nextUserId=Math.max(Number(x.nextUserId)||2,nextId(x.users));
 x.version=3;
 x.singleStation=true;
 return x;
}
function loadFromSqliteApi(){
 try{
  if(typeof XMLHttpRequest!=='undefined'&&typeof location!=='undefined'&&(location.hostname==='localhost'||location.hostname==='127.0.0.1')){
   const xhr=new XMLHttpRequest();
   xhr.open('GET','/api/db',false);
   xhr.send(null);
   if(xhr.status===200){
    const res=JSON.parse(xhr.responseText);
    if(res&&res.ok){sqliteConnected=true;return res.state}
   }
  }
 }catch(e){}
 return null;
}
function saveToSqlite(str){
 if(typeof window!=='undefined'&&window.krzDesktop?.saveDiskData){
  try{window.krzDesktop.saveDiskData(str);sqliteConnected=true}catch(e){}
  return;
 }
 if(typeof fetch!=='undefined'&&typeof location!=='undefined'&&(location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json'},body:str}).then(r=>{if(r.ok)sqliteConnected=true}).catch(()=>{});
 }
}
function loadData(){
 try{
  // 1. Electron SQLite bridge
  if(typeof window!=='undefined'&&window.krzDesktop?.loadDiskData){
   sqliteConnected=true;
   const diskRaw=window.krzDesktop.loadDiskData();
   if(diskRaw){
    const parsed=JSON.parse(diskRaw);
    if(parsed&&Array.isArray(parsed.products)&&Array.isArray(parsed.sales)){
     const up=upgradeDb(parsed);
     localStorage.setItem(KEY,JSON.stringify(up));
     return up;
    }
   }
  }
  // 2. Local Single-Station SQLite Server (/api/db)
  const apiState=loadFromSqliteApi();
  if(apiState&&Array.isArray(apiState.products)&&Array.isArray(apiState.sales)){
   const up=upgradeDb(apiState);
   localStorage.setItem(KEY,JSON.stringify(up));
   return up;
  }
  // 3. Fallback / First-run migration from localStorage into SQLite
  const raw=localStorage.getItem(KEY);
  if(raw){
   const x=JSON.parse(raw);
   if(x&&Array.isArray(x.products)&&Array.isArray(x.sales)){
    const up=upgradeDb(x);
    if(sqliteConnected)saveToSqlite(JSON.stringify(up));
    return up;
   }
  }
 }catch(e){}
 const def=defaultData();
 if(sqliteConnected)saveToSqlite(JSON.stringify(def));
 return def;
}
function save(){
 const str=JSON.stringify(db);
 localStorage.setItem(KEY,str);
 saveToSqlite(str);
}

// SINGLE-STATION LOCK (NO MULTI-TILLS)
(function initSingleStationLock(){
 if(typeof BroadcastChannel==='undefined')return;
 try{
  const stationId=Date.now()+'-'+Math.random();
  const ch=new BroadcastChannel('krz_single_station_till_lock');
  ch.postMessage({type:'CLAIM_STATION',stationId});
  ch.onmessage=ev=>{
   if(ev.data?.type==='CLAIM_STATION'&&ev.data.stationId!==stationId){
    currentUser=null;
    updateAuthUI();
    showLoginOverlay();
    const hint=document.getElementById('loginHint');
    if(hint)hint.textContent='Single-Station Lock: Another window became the active till. Sign in here to use this window.';
   }
  };
 }catch(e){}
})();
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),2600)}
function sum(a,fn){return round2(a.reduce((t,x)=>t+(Number(fn(x))||0),0))}
function activeProducts(){return db.products.filter(p=>p.active!==false)}
function activeSales(){return db.sales.filter(s=>s.status!=='Voided')}
function customerById(id){return db.customers.find(c=>c.id===Number(id))}

// AUTHENTICATION & STAFF ACCESS
function initAuth(){
 try{
  const savedId=typeof sessionStorage!=='undefined'?Number(sessionStorage.getItem(SESSION_KEY)):0;
  const u=(db.users||[]).find(x=>x.id===savedId&&x.active!==false);
  if(u){currentUser=u;updateAuthUI();return}
 }catch(e){}
 showLoginOverlay();
}
function showLoginOverlay(){
 const ov=document.getElementById('loginOverlay');
 if(!ov)return;
 const hasDefaultAdmin=(db.users||[]).some(u=>u.active!==false&&u.username==='admin'&&u.pin==='1234');
 const hint=document.getElementById('loginHint');
 if(hint)hint.textContent=hasDefaultAdmin?'Default Admin login: username "admin" · PIN "1234"':'Enter your staff username and PIN.';
 ov.classList.remove('hidden');
 document.getElementById('loginUsername')?.focus();
}
const CASHIER_PAGES=['pos','sales','customers','jobs'];
function isCashier(){return Boolean(currentUser&&currentUser.role!=='Admin')}
function updateAuthUI(){
 const ov=document.getElementById('loginOverlay');
 if(ov)ov.classList.toggle('hidden',!!currentUser);
 const badge=document.getElementById('currentUserBadge');
 if(badge)badge.textContent=currentUser?`${currentUser.name} (${currentUser.role})`:'Not signed in';
 const cashierOnly=isCashier();
 document.querySelectorAll('nav button').forEach(b=>{
  b.classList.toggle('hidden',cashierOnly&&!CASHIER_PAGES.includes(b.dataset.page));
 });
 if(currentUser){
  const activeBtn=document.querySelector('nav button.active');
  const activePage=activeBtn?.dataset?.page||'dashboard';
  if(cashierOnly&&!CASHIER_PAGES.includes(activePage)){
   showPage('pos');
  }else{
   showPage(activePage);
  }
 }
}
function requireAdmin(actionName='this action'){
 if(!currentUser||currentUser.role==='Admin')return true;
 const pin=prompt(`Admin authorization required for ${actionName}.\nEnter an Admin PIN:`);
 if(pin===null)return false;
 const admin=(db.users||[]).find(u=>u.active!==false&&u.role==='Admin'&&u.pin===pin);
 if(!admin){alert('Invalid Admin PIN.');return false}
 return true;
}
document.getElementById('loginForm')?.addEventListener('submit',e=>{
 e.preventDefault();
 const uname=(document.getElementById('loginUsername').value||'').trim().toLowerCase();
 const pin=document.getElementById('loginPin').value||'';
 const u=(db.users||[]).find(x=>x.active!==false&&x.username.toLowerCase()===uname&&x.pin===pin);
 if(!u){alert('Invalid username or PIN.');return}
 currentUser=u;
 try{if(typeof sessionStorage!=='undefined')sessionStorage.setItem(SESSION_KEY,String(u.id))}catch(err){}
 document.getElementById('loginForm').reset();
 updateAuthUI();
 toast(`Welcome, ${u.name}`);
});
document.getElementById('logoutBtn')?.addEventListener('click',()=>{
 currentUser=null;
 try{if(typeof sessionStorage!=='undefined')sessionStorage.removeItem(SESSION_KEY)}catch(err){}
 updateAuthUI();
 showLoginOverlay();
});

function applyBrandHeader(){
 const brand=document.querySelector('header .brand');
 if(brand&&db.settings?.shopName){
  brand.innerHTML=`${esc(db.settings.shopName)} <small>OFFLINE POINT OF SALE</small>`;
 }
}

function showPage(name){
 if(isCashier()&&!CASHIER_PAGES.includes(name))name='pos';
 if((name==='backup'||name==='reports')&&!requireAdmin(name==='backup'?'Backup & Settings':'Reports'))return;
 document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));
 document.getElementById('page-'+name).classList.remove('hidden');
 document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
 ({dashboard:renderDashboard,pos:renderPOS,products:renderProducts,inventory:renderInventory,sales:renderSales,customers:renderCustomers,jobs:renderJobs,reports:renderReports,backup:renderBackup}[name]||(()=>{}))();
}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));

function jobPaymentsInRange(fromDate,toDate){
 const out=[];
 db.jobs.filter(j=>j.status!=='Cancelled'&&j.status!=='Quote').forEach(j=>{
  (j.payments||[]).forEach(p=>{
   const d=localDate(p.date);
   if((!fromDate||d>=fromDate)&&(!toDate||d<=toDate)){
    out.push({...p,jobId:j.id,jobNo:j.jobNo,localDate:d});
   }
  });
 });
 return out;
}

function renderDashboard(){
 applyBrandHeader();
 const t=today(),m=t.slice(0,7);
 const salesToday=activeSales().filter(s=>localDate(s.date)===t);
 const salesMonth=activeSales().filter(s=>localDate(s.date).slice(0,7)===m);
 const jobPayToday=jobPaymentsInRange(t,t);
 const jobPayMonth=db.jobs.filter(j=>j.status!=='Cancelled'&&j.status!=='Quote').flatMap(j=>j.payments||[]).filter(p=>localDate(p.date).slice(0,7)===m);
 document.getElementById('todaySales').textContent=money(sum(salesToday,s=>s.total)+sum(jobPayToday,p=>p.amount));
 document.getElementById('monthSales').textContent=money(sum(salesMonth,s=>s.total)+sum(jobPayMonth,p=>p.amount));
 document.getElementById('productCount').textContent=activeProducts().length;
 const low=activeProducts().filter(p=>p.trackStock!==false&&p.qty<=p.reorder);
 document.getElementById('lowCount').textContent=low.length;
 document.getElementById('recentSales').innerHTML=salesTable(db.sales.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),false);
 document.getElementById('dashboardLow').innerHTML=low.length?simpleTable(['SKU','Product','In Stock','Reorder Level'],low.map(p=>[esc(p.sku),esc(p.name),`<span class="low">${p.qty}</span>`,p.reorder])):'<div class="empty">No low-stock products. Add products to get started.</div>';
 const rem=document.getElementById('backupReminder');
 if(rem){
  const hasRecords=db.products.length+db.sales.length+db.customers.length+db.jobs.length>0;
  const last=db.settings?.lastBackupAt?new Date(db.settings.lastBackupAt).getTime():0;
  const daysSince=last?Math.floor((Date.now()-last)/86400000):999;
  if(hasRecords&&daysSince>=7){
   rem.innerHTML=`Backup reminder: ${last?`Last backup was ${daysSince} days ago (${localDate(db.settings.lastBackupAt)}).`:'You have not downloaded a backup file yet.'} <button class="btn small secondary" style="margin-left:8px" onclick="document.getElementById('exportBackup').click()">Download Backup Now</button>`;
   rem.classList.remove('hidden');
  }else{
   rem.classList.add('hidden');
  }
 }
}

function simpleTable(headers,rows){
 if(!rows.length)return '<div class="empty">No records found.</div>';
 return `<div style="overflow:auto"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderProducts(){
 const q=(document.getElementById('productSearch').value||'').toLowerCase();
 const rows=activeProducts().filter(p=>(p.name+' '+p.sku+' '+p.category).toLowerCase().includes(q));
 document.getElementById('productsTable').innerHTML=simpleTable(['SKU','Product','Category','Cost','Selling Price','Stock','Actions'],rows.map(p=>[
  esc(p.sku),esc(p.name)+(p.taxable===false?' <span class="badge">Tax Exempt</span>':''),esc(p.category||'General'),money(p.cost),money(p.price),
  p.trackStock===false?'<span class="badge">Service</span>':p.qty,
  `<button class="btn small secondary" onclick="editProduct(${p.id})">Edit</button> <button class="btn small danger" onclick="deactivateProduct(${p.id})">Archive</button>`
 ]));
}

function openProduct(p=null){
 if(!requireAdmin(p?'editing products':'adding products'))return;
 document.getElementById('productForm').reset();
 document.getElementById('editId').value=p?.id||'';
 document.getElementById('productDialogTitle').textContent=p?'Edit Product':'Add Product';
 document.getElementById('pSku').value=p?.sku||'';
 document.getElementById('pName').value=p?.name||'';
 document.getElementById('pCategory').value=p?.category||'';
 document.getElementById('pCost').value=p?.cost??0;
 document.getElementById('pPrice').value=p?.price??0;
 document.getElementById('pQty').value=p?.qty??0;
 document.getElementById('pReorder').value=p?.reorder??5;
 document.getElementById('pTrackStock').checked=p?p.trackStock!==false:true;
 document.getElementById('pTaxable').checked=p?p.taxable!==false:true;
 document.getElementById('productDialog').showModal();
}
window.editProduct=id=>{const p=db.products.find(x=>x.id===id);if(p)openProduct(p)};
window.deactivateProduct=id=>{
 if(!requireAdmin('archiving products'))return;
 const p=db.products.find(x=>x.id===id);
 if(p&&confirm(`Archive ${p.name}? It will no longer appear for sale; old sales remain.`)){p.active=false;save();renderProducts();toast('Product archived')}
};
document.getElementById('addProduct').onclick=()=>openProduct();
document.getElementById('cancelProduct').onclick=()=>document.getElementById('productDialog').close();
document.getElementById('productForm').onsubmit=e=>{
 e.preventDefault();
 const id=Number(document.getElementById('editId').value)||null,sku=document.getElementById('pSku').value.trim(),name=document.getElementById('pName').value.trim();
 if(db.products.some(p=>p.sku.toLowerCase()===sku.toLowerCase()&&p.id!==id)){alert('That SKU / barcode already exists.');return}
 const trackStock=document.getElementById('pTrackStock').checked;
 const taxable=document.getElementById('pTaxable').checked;
 const newQty=Math.max(0,Math.floor(Number(document.getElementById('pQty').value)||0));
 const existing=id?db.products.find(p=>p.id===id):null;
 const n={
  id:id||db.nextProductId++,sku,name,category:document.getElementById('pCategory').value.trim()||'General',
  cost:round2(document.getElementById('pCost').value),price:round2(document.getElementById('pPrice').value),
  qty:trackStock?newQty:0,reorder:Math.max(0,Math.floor(Number(document.getElementById('pReorder').value)||0)),
  trackStock,taxable,active:true
 };
 if(existing&&trackStock&&existing.qty!==newQty){
  db.stockLog.push({date:now(),productId:n.id,change:newQty-(Number(existing.qty)||0),note:`Product edit adjustment (${currentUser?.name||'Admin'})`});
 }
 if(id){const i=db.products.findIndex(p=>p.id===id);db.products[i]=n}else db.products.push(n);
 save();document.getElementById('productDialog').close();renderProducts();toast('Product saved');
};
document.getElementById('productSearch').addEventListener('input',renderProducts);

function renderInventory(){
 const q=(document.getElementById('inventorySearch').value||'').toLowerCase();
 const ps=activeProducts().filter(p=>(p.sku+' '+p.name).toLowerCase().includes(q));
 document.getElementById('inventoryTable').innerHTML=simpleTable(['SKU','Product','On Hand','Reorder At','Status','Adjustment'],ps.map(p=>[
  esc(p.sku),esc(p.name),
  p.trackStock===false?'—':p.qty,
  p.trackStock===false?'—':p.reorder,
  p.trackStock===false?'<span class="badge">Service Item</span>':(p.qty<=p.reorder?'<span class="low">LOW STOCK</span>':'<span class="good">In Stock</span>'),
  p.trackStock===false?'<span class="muted">Not tracked</span>':`<button class="btn small secondary" onclick="adjustStock(${p.id})">Adjust</button>`
 ]));
 const logs=(db.stockLog||[]).slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);
 const logEl=document.getElementById('stockLogTable');
 if(logEl){
  logEl.innerHTML=logs.length?simpleTable(['Date','Product','Change','Reason'],logs.map(l=>{
   const p=db.products.find(x=>x.id===l.productId);
   return [new Date(l.date).toLocaleString(),esc(p?p.name:`Product #${l.productId}`),l.change>0?`<span class="good">+${l.change}</span>`:`<span class="low">${l.change}</span>`,esc(l.note||'Adjustment')];
  })):'<div class="empty">No stock movements recorded yet.</div>';
 }
}
window.adjustStock=id=>{
 if(!requireAdmin('stock adjustment'))return;
 const p=db.products.find(x=>x.id===id);if(!p||p.trackStock===false)return;
 const v=prompt(`Stock adjustment for ${p.name}.\nEnter the CHANGE: positive to add, negative to remove. Current: ${p.qty}`);
 if(v===null)return;
 const n=Number(v);
 if(!Number.isInteger(n)||p.qty+n<0){alert('Enter a whole number. Stock cannot go below zero.');return}
 if(n===0)return;
 p.qty+=n;
 db.stockLog=db.stockLog||[];
 db.stockLog.push({date:now(),productId:id,change:n,note:`Manual adjustment (${currentUser?.name||'Admin'})`});
 save();renderInventory();toast('Stock updated');
};
document.getElementById('inventorySearch').addEventListener('input',renderInventory);

function refreshPosCustomerOptions(){
 const sel=document.getElementById('posCustomer');
 if(!sel)return;
 const cur=sel.value;
 sel.innerHTML='<option value="">Walk-in Customer</option>'+db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('');
 sel.value=cur;
}

function renderPOS(){
 refreshPosCustomerOptions();
 const q=(document.getElementById('posSearch').value||'').toLowerCase();
 const ps=activeProducts().filter(p=>(p.name+' '+p.sku+' '+p.category).toLowerCase().includes(q));
 document.getElementById('posProducts').innerHTML=ps.map(p=>{
  const outOfStock=p.trackStock!==false&&p.qty<=0;
  const stockLabel=p.trackStock===false?'Service':`Stock: ${p.qty}`;
  return `<button class="product-tile" onclick="addToCart(${p.id})" ${outOfStock?'disabled':''}><b>${esc(p.name)}</b><span>${money(p.price)}</span><small>${esc(p.sku)} · ${stockLabel}</small></button>`;
 }).join('')||'<div class="empty">No matching products. Add products first.</div>';
 renderCart();
}

window.addToCart=id=>{
 const p=db.products.find(x=>x.id===id&&x.active!==false);if(!p)return;
 const c=cart.find(x=>x.id===id),wanted=(c?.qty||0)+1;
 if(p.trackStock!==false&&wanted>p.qty){toast('Not enough stock available');return}
 if(c)c.qty++;
 else cart.push({id:p.id,name:p.name,price:p.price,cost:p.cost,qty:1,trackStock:p.trackStock!==false,taxable:p.taxable!==false});
 renderCart();
};

function calcCartTotals(){
 const subtotal=sum(cart,c=>c.price*c.qty);
 const discount=Math.min(subtotal,Math.max(0,round2(document.getElementById('discount').value)));
 const netBeforeTax=round2(Math.max(0,subtotal-discount));
 const taxMode=db.settings?.taxMode||'off';
 const taxRate=Math.max(0,Number(db.settings?.taxRate)||0);
 const taxableSubtotal=sum(cart.filter(c=>c.taxable!==false),c=>c.price*c.qty);
 const taxableShare=subtotal>0?(taxableSubtotal/subtotal):0;
 const taxableNet=round2(netBeforeTax*taxableShare);
 let tax=0,total=netBeforeTax;
 if(taxMode==='exclusive'&&taxRate>0){
  tax=round2(taxableNet*(taxRate/100));
  total=round2(netBeforeTax+tax);
 }else if(taxMode==='inclusive'&&taxRate>0){
  tax=round2(taxableNet-(taxableNet/(1+taxRate/100)));
  total=netBeforeTax;
 }
 const tendered=Math.max(0,round2(document.getElementById('cashTendered')?.value||0));
 const change=tendered>total?round2(tendered-total):0;
 return {subtotal,discount,tax,taxMode,taxRate,total,tendered,change};
}

function renderCart(){
 const host=document.getElementById('cartLines');
 host.innerHTML=cart.length?cart.map(c=>`<div class="cartline"><div><b>${esc(c.name)}</b><small>${money(c.price)} each · <button class="btn small secondary" onclick="changeQty(${c.id},-1)">−</button> ${c.qty} <button class="btn small secondary" onclick="changeQty(${c.id},1)">+</button></small></div><div><b>${money(c.price*c.qty)}</b><br><button class="btn small danger" onclick="removeCart(${c.id})">Remove</button></div></div>`).join(''):'<div class="empty">No items added yet.</div>';
 const t=calcCartTotals();
 document.getElementById('cartTotal').textContent=money(t.total);
 const summaryEl=document.getElementById('cartSummary');
 if(summaryEl){
  const parts=[`Subtotal: ${money(t.subtotal)}`];
  if(t.discount>0)parts.push(`Discount: −${money(t.discount)}`);
  if(t.taxMode!=='off'&&t.taxRate>0)parts.push(`GCT (${t.taxRate}%${t.taxMode==='inclusive'?' incl.':''}): ${money(t.tax)}`);
  if(t.tendered>0)parts.push(`Change Due: <b>${money(t.change)}</b>`);
  summaryEl.innerHTML=cart.length?parts.join(' · '):'';
 }
}
window.changeQty=(id,d)=>{
 const c=cart.find(x=>x.id===id),p=db.products.find(x=>x.id===id);if(!c)return;
 const n=c.qty+d;
 if(n<=0){removeCart(id);return}
 if(p&&p.trackStock!==false&&n>p.qty){toast('Not enough stock');return}
 c.qty=n;renderCart();
};
window.removeCart=id=>{cart=cart.filter(x=>x.id!==id);renderCart()};
document.getElementById('posSearch').addEventListener('input',renderPOS);
document.getElementById('posSearch').addEventListener('keydown',e=>{
 if(e.key==='Enter'){
  e.preventDefault();
  const q=(e.target.value||'').trim().toLowerCase();
  if(!q)return;
  const exact=activeProducts().find(p=>p.sku.toLowerCase()===q);
  const matches=exact?[exact]:activeProducts().filter(p=>(p.name+' '+p.sku+' '+p.category).toLowerCase().includes(q));
  if(matches.length===1){
   addToCart(matches[0].id);
   e.target.value='';
   renderPOS();
  }
 }
});
document.getElementById('clearSearch').onclick=()=>{document.getElementById('posSearch').value='';renderPOS()};
document.getElementById('discount').addEventListener('input',renderCart);
document.getElementById('cashTendered')?.addEventListener('input',renderCart);
document.getElementById('clearCart').onclick=()=>{
 if(cart.length&&confirm('Clear this sale?')){
  cart=[];
  document.getElementById('discount').value='0';
  if(document.getElementById('cashTendered'))document.getElementById('cashTendered').value='';
  if(document.getElementById('posCustomer'))document.getElementById('posCustomer').value='';
  renderCart();
 }
};
document.getElementById('completeSale').onclick=()=>{
 if(!cart.length){alert('Add at least one product.');return}
 const rawDiscount=round2(document.getElementById('discount').value);
 const subtotal=sum(cart,c=>c.price*c.qty);
 if(rawDiscount>subtotal){alert('Discount cannot be greater than the subtotal.');return}
 for(const c of cart){
  const p=db.products.find(x=>x.id===c.id);
  if(!p||(p.trackStock!==false&&p.qty<c.qty)){alert(`Insufficient stock for ${c.name}. Refresh the sale and try again.`);return}
 }
 const t=calcCartTotals();
 const method=document.getElementById('payment').value;
 if(t.tendered>0&&t.tendered<t.total){alert('Amount tendered cannot be less than the total due.');return}
 const customerId=Number(document.getElementById('posCustomer')?.value)||null;
 const changeNote=t.tendered>0?`\nTendered: ${money(t.tendered)} · Change Due: ${money(t.change)}`:'';
 if(!confirm(`Complete ${method} sale for ${money(t.total)}?${changeNote}`))return;
 const sale={
  id:db.nextSaleId++,receipt:'KRZ-'+Date.now(),date:now(),
  subtotal:t.subtotal,discount:t.discount,tax:t.tax,taxMode:t.taxMode,taxRate:t.taxRate,
  total:t.total,tendered:t.tendered,change:t.change,method,customerId,
  cashier:currentUser?.name||'Admin',status:'Completed',
  items:cart.map(c=>({...c}))
 };
 cart.forEach(c=>{const p=db.products.find(x=>x.id===c.id);if(p&&p.trackStock!==false)p.qty-=c.qty});
 db.sales.push(sale);save();
 cart=[];
 document.getElementById('discount').value='0';
 if(document.getElementById('cashTendered'))document.getElementById('cashTendered').value='';
 if(document.getElementById('posCustomer'))document.getElementById('posCustomer').value='';
 renderCart();renderPOS();toast('Sale saved successfully');
 if(confirm(`Sale completed.\nReceipt: ${sale.receipt}\nTotal: ${money(t.total)}${changeNote}\n\nPrint receipt now?`))printReceipt(sale);
};

function printReceipt(s){
 const w=window.open('','_blank','width=420,height=650');if(!w){alert('Allow pop-ups to print receipts.');return}
 const shop=db.settings||defaultSettings();
 const cust=s.customerId?customerById(s.customerId):null;
 const shopMeta=[shop.address,shop.phone,shop.trn?`TRN: ${shop.trn}`:''].filter(Boolean).map(esc).join('<br>');
 const taxRow=(s.tax&&s.tax>0)?`<tr><td>GCT (${s.taxRate||15}%${s.taxMode==='inclusive'?' incl.':''})</td><td class="r">${money(s.tax)}</td></tr>`:'';
 const tenderRows=(s.tendered&&s.tendered>0)?`<tr><td>Tendered</td><td class="r">${money(s.tendered)}</td></tr><tr><td>Change</td><td class="r">${money(s.change||0)}</td></tr>`:'';
 w.document.write(`<html><head><title>${esc(s.receipt)}</title><style>body{font:13px Arial;padding:18px;width:300px}h2{text-align:center;margin-bottom:3px}.center{text-align:center}.line{border-top:1px dashed #555;margin:12px 0}table{width:100%;font-size:12px}td{padding:5px 0}.r{text-align:right}</style></head><body><h2>${esc(shop.shopName||'KRZ PRINT')}</h2>${shopMeta?`<div class="center">${shopMeta}</div>`:''}<div class="center">SALES RECEIPT${s.status==='Voided'?' (VOIDED)':''}</div><div class="line"></div><div>Receipt: ${esc(s.receipt)}<br>Date: ${new Date(s.date).toLocaleString()}<br>Payment: ${esc(s.method)}${s.cashier?`<br>Served by: ${esc(s.cashier)}`:''}${cust?`<br>Customer: ${esc(cust.name)}`:''}</div><div class="line"></div><table>${s.items.map(i=>`<tr><td>${esc(i.name)} x ${i.qty}</td><td class="r">${money(i.price*i.qty)}</td></tr>`).join('')}</table><div class="line"></div><table><tr><td>Subtotal</td><td class="r">${money(s.subtotal)}</td></tr><tr><td>Discount</td><td class="r">${money(s.discount)}</td></tr>${taxRow}<tr><td><b>TOTAL</b></td><td class="r"><b>${money(s.total)}</b></td></tr>${tenderRows}</table><div class="line"></div><div class="center">${esc(shop.receiptFooter||'Thank you for your business!')}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
 w.document.close();
}

function salesTable(arr,showActions=true){
 if(!arr.length)return '<div class="empty">No sales recorded yet.</div>';
 const canVoid=!isCashier();
 return `<div style="overflow:auto"><table><thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Payment</th><th class="right">Total</th>${showActions?'<th>Action</th>':''}</tr></thead><tbody>${arr.map(s=>{
  const cust=s.customerId?customerById(s.customerId):null;
  const isVoid=s.status==='Voided';
  return `<tr><td>${esc(s.receipt)} ${isVoid?'<span class="badge low">VOIDED</span>':''}</td><td>${new Date(s.date).toLocaleString()}</td><td>${esc(cust?.name||'Walk-in')}</td><td>${esc(s.method)}</td><td class="right">${isVoid?`<s>${money(s.total)}</s>`:money(s.total)}</td>${showActions?`<td><button class="btn small secondary" onclick="reprint('${esc(s.receipt)}')">Receipt</button> ${!isVoid&&canVoid?`<button class="btn small danger" onclick="voidSale(${s.id})">Void</button>`:(isVoid?`<small class="muted">${esc(s.voidReason||'')}</small>`:'')}</td>`:''}</tr>`;
 }).join('')}</tbody></table></div>`;
}
window.reprint=receipt=>{const s=db.sales.find(x=>x.receipt===receipt);if(s)printReceipt(s)};
window.voidSale=id=>{
 if(!requireAdmin('voiding a sale'))return;
 const s=db.sales.find(x=>x.id===id);if(!s||s.status==='Voided')return;
 const reason=prompt(`Void sale ${s.receipt} (${money(s.total)})?\nStock for tracked items will be restored.\nEnter reason for voiding:`);
 if(reason===null)return;
 s.status='Voided';
 s.voidReason=reason.trim()||'Voided by user';
 s.voidedAt=now();
 (s.items||[]).forEach(i=>{
  const p=db.products.find(x=>x.id===i.id);
  if(p&&p.trackStock!==false){
   p.qty+=i.qty;
   db.stockLog.push({date:now(),productId:p.id,change:i.qty,note:`Voided sale ${s.receipt} (${currentUser?.name||'Admin'})`});
  }
 });
 save();renderSales();toast('Sale voided and stock restored');
};
function renderSales(){
 const q=(document.getElementById('salesSearch').value||'').toLowerCase(),d=document.getElementById('salesDate').value;
 const arr=db.sales.slice().sort((a,b)=>b.date.localeCompare(a.date)).filter(s=>{
  const cust=s.customerId?customerById(s.customerId):null;
  return (!d||localDate(s.date)===d)&&(`${s.receipt} ${s.method} ${cust?.name||''} ${s.status||''}`).toLowerCase().includes(q);
 });
 document.getElementById('salesTable').innerHTML=salesTable(arr,true);
}
document.getElementById('salesSearch').addEventListener('input',renderSales);
document.getElementById('salesDate').addEventListener('change',renderSales);

// CUSTOMER RECORDS AND PRINT JOB MANAGEMENT
function renderCustomers(){
 const q=(document.getElementById('customerSearch').value||'').toLowerCase();
 const list=db.customers.filter(c=>(c.name+' '+(c.phone||'')+' '+(c.email||'')).toLowerCase().includes(q));
 document.getElementById('customersTable').innerHTML=simpleTable(['Customer','Telephone','Email','Jobs','Sales','Actions'],list.map(c=>[
  esc(c.name),esc(c.phone||'—'),esc(c.email||'—'),
  db.jobs.filter(j=>j.customerId===c.id).length,
  activeSales().filter(s=>s.customerId===c.id).length,
  `<button class="btn small secondary" onclick="editCustomer(${c.id})">Edit</button>`
 ]));
}
function openCustomer(c=null){
 document.getElementById('customerForm').reset();document.getElementById('customerEditId').value=c?.id||'';
 document.getElementById('customerDialogTitle').textContent=c?'Edit Customer':'Add Customer';
 document.getElementById('customerName').value=c?.name||'';document.getElementById('customerPhone').value=c?.phone||'';
 document.getElementById('customerEmail').value=c?.email||'';document.getElementById('customerNotes').value=c?.notes||'';
 document.getElementById('customerDialog').showModal();
}
window.editCustomer=id=>{const c=customerById(id);if(c)openCustomer(c)};
document.getElementById('addCustomer').onclick=()=>openCustomer();
document.getElementById('cancelCustomer').onclick=()=>document.getElementById('customerDialog').close();
document.getElementById('customerSearch').addEventListener('input',renderCustomers);
document.getElementById('customerForm').onsubmit=e=>{
 e.preventDefault();const id=Number(document.getElementById('customerEditId').value)||null;
 const c={id:id||db.nextCustomerId++,name:document.getElementById('customerName').value.trim(),phone:document.getElementById('customerPhone').value.trim(),email:document.getElementById('customerEmail').value.trim(),notes:document.getElementById('customerNotes').value.trim(),updatedAt:now()};
 if(id){const i=db.customers.findIndex(x=>x.id===id);db.customers[i]=c}else db.customers.push(c);
 save();document.getElementById('customerDialog').close();renderCustomers();toast('Customer saved');
};

function jobBalance(j){return round2(Math.max(0,Number(j.total||0)-Number(j.paid||0)))}
function jobStatusLabel(s){return `<span class="badge">${esc(s||'Pending')}</span>`}
function formatJobSpecs(j){
 const sp=j?.specs||{};
 return [sp.size,sp.colour,sp.finishing,sp.artwork?`File: ${sp.artwork}`:''].filter(Boolean).join(' · ');
}
function renderJobs(){
 const q=(document.getElementById('jobSearch').value||'').toLowerCase(),status=document.getElementById('jobStatusFilter').value;
 const open=db.jobs.filter(j=>!['Quote','Completed','Cancelled'].includes(j.status));
 document.getElementById('openJobsCount').textContent=open.length;
 document.getElementById('readyJobsCount').textContent=db.jobs.filter(j=>j.status==='Ready for Collection').length;
 document.getElementById('completedJobsCount').textContent=db.jobs.filter(j=>j.status==='Completed').length;
 document.getElementById('jobBalancesTotal').textContent=money(sum(db.jobs.filter(j=>!['Quote','Cancelled'].includes(j.status)),jobBalance));
 const list=db.jobs.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter(j=>{
  const c=customerById(j.customerId);
  const specText=formatJobSpecs(j);
  return (!status||j.status===status)&&(`${j.jobNo} ${c?.name||''} ${j.description} ${specText}`).toLowerCase().includes(q);
 });
 document.getElementById('jobsTable').innerHTML=simpleTable(['Job #','Customer / Description','Due','Status','Total','Paid','Balance','Actions'],list.map(j=>{
  const c=customerById(j.customerId);
  const specText=formatJobSpecs(j);
  const approveBtn=j.status==='Quote'?`<button class="btn small success" onclick="approveQuote(${j.id})">Approve</button> `:'';
  return [
   esc(j.jobNo),
   `<b>${esc(c?.name||'Unknown customer')}</b><br><span class="muted">${esc(j.description)} (Qty: ${j.qty||1})</span>${specText?`<br><small class="muted">${esc(specText)}</small>`:''}`,
   esc(j.dueDate||'—'),
   jobStatusLabel(j.status),
   money(j.total),
   money(j.paid),
   jobBalance(j)>0&&j.status!=='Quote'?`<span class="low">${money(jobBalance(j))}</span>`:money(jobBalance(j)),
   `${approveBtn}<button class="btn small secondary" onclick="editJob(${j.id})">Edit</button> <button class="btn small success" onclick="recordJobPayment(${j.id})" ${jobBalance(j)<=0||j.status==='Cancelled'?'disabled':''}>Payment</button> <button class="btn small secondary" onclick="viewJobPayments(${j.id})">History</button> <button class="btn small secondary" onclick="printJob(${j.id})">Print</button>`
  ];
 }));
}
window.approveQuote=id=>{
 const j=db.jobs.find(x=>x.id===id);if(!j)return;
 j.status='Pending';j.updatedAt=now();save();renderJobs();toast(`${j.jobNo} approved as active job`);
};
function refreshJobCustomerOptions(selected=''){
 const sel=document.getElementById('jobCustomer');sel.innerHTML='<option value="">Select customer...</option>'+db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('');sel.value=String(selected||'');
}
function openJob(j=null){
 if(!db.customers.length){alert('Add a customer first, then create a print job.');openCustomer();return}
 document.getElementById('jobForm').reset();document.getElementById('jobEditId').value=j?.id||'';refreshJobCustomerOptions(j?.customerId);
 document.getElementById('jobDialogTitle').textContent=j?'Edit Printing Job':'New Printing Job';
 document.getElementById('jobDescription').value=j?.description||'';
 document.getElementById('jobSize').value=j?.specs?.size||'';
 document.getElementById('jobColour').value=j?.specs?.colour||'';
 document.getElementById('jobFinishing').value=j?.specs?.finishing||'';
 document.getElementById('jobArtwork').value=j?.specs?.artwork||'';
 document.getElementById('jobQty').value=j?.qty??1;
 document.getElementById('jobPrice').value=j?.total??0;
 document.getElementById('jobDeposit').value=j?.paid??0;
 document.getElementById('jobDueDate').value=j?.dueDate||'';
 document.getElementById('jobStatus').value=j?.status||'Pending';
 document.getElementById('jobPaymentMethod').value=j?.payments?.[0]?.method||'Cash';
 document.getElementById('jobDialog').showModal();
}
window.editJob=id=>{const j=db.jobs.find(x=>x.id===id);if(j)openJob(j)};
document.getElementById('addJob').onclick=()=>openJob();
document.getElementById('cancelJob').onclick=()=>document.getElementById('jobDialog').close();
document.getElementById('jobSearch').addEventListener('input',renderJobs);
document.getElementById('jobStatusFilter').addEventListener('change',renderJobs);
document.getElementById('jobForm').onsubmit=e=>{
 e.preventDefault();
 const id=Number(document.getElementById('jobEditId').value)||null,customerId=Number(document.getElementById('jobCustomer').value),total=round2(document.getElementById('jobPrice').value),paid=round2(document.getElementById('jobDeposit').value);
 if(!customerById(customerId)){alert('Select a valid customer.');return}
 if(!Number.isFinite(total)||total<0||paid<0||paid>total){alert('Check the total price and deposit. Deposit cannot exceed total price.');return}
 const existing=id?db.jobs.find(x=>x.id===id):null;
 const payments=existing?.payments?existing.payments.slice():[];
 if(!existing&&paid>0)payments.push({date:now(),amount:paid,method:document.getElementById('jobPaymentMethod').value,note:'Initial deposit',by:currentUser?.name||'Admin'});
 if(existing&&paid!==round2(existing.paid||0)){
  const diff=round2(paid-round2(existing.paid||0));
  payments.push({date:now(),amount:diff,method:'Adjustment',note:'Deposit correction while editing job',by:currentUser?.name||'Admin'});
 }
 const specs={
  size:document.getElementById('jobSize').value.trim(),
  colour:document.getElementById('jobColour').value,
  finishing:document.getElementById('jobFinishing').value.trim(),
  artwork:document.getElementById('jobArtwork').value.trim()
 };
 const newId=id||db.nextJobId++;
 const j={
  id:newId,jobNo:existing?.jobNo||`JOB-${String(newId).padStart(5,'0')}`,
  customerId,description:document.getElementById('jobDescription').value.trim(),specs,
  qty:Math.max(1,Math.floor(Number(document.getElementById('jobQty').value)||1)),
  total,paid,dueDate:document.getElementById('jobDueDate').value,status:document.getElementById('jobStatus').value,
  payments,createdAt:existing?.createdAt||now(),updatedAt:now()
 };
 if(id){const i=db.jobs.findIndex(x=>x.id===id);db.jobs[i]=j}else db.jobs.push(j);
 save();document.getElementById('jobDialog').close();renderJobs();toast('Print job saved');
};
window.viewJobPayments=id=>{
 const j=db.jobs.find(x=>x.id===id);if(!j)return;
 const payments=j.payments||[];
 document.getElementById('jobPaymentsContent').innerHTML=`<p><b>${esc(j.jobNo)}</b> · ${money(j.total)} total · ${money(j.paid)} paid · <b>${money(jobBalance(j))} balance</b></p>`+(payments.length?simpleTable(['Date','Method','Amount','Note'],payments.map(p=>[new Date(p.date).toLocaleString(),esc(p.method||'—'),money(p.amount),esc(p.note||'')])):'<div class="empty">No payments recorded yet.</div>');
 document.getElementById('jobPaymentsDialog').showModal();
};
document.getElementById('closeJobPayments').onclick=()=>document.getElementById('jobPaymentsDialog').close();
window.recordJobPayment=id=>{
 const j=db.jobs.find(x=>x.id===id);if(!j)return;
 const bal=jobBalance(j);
 document.getElementById('paymentJobId').value=id;
 document.getElementById('paymentAmount').value=bal.toFixed(2);
 document.getElementById('paymentAmount').max=bal.toFixed(2);
 document.getElementById('paymentDialog').showModal();
};
document.getElementById('cancelPayment').onclick=()=>document.getElementById('paymentDialog').close();
document.getElementById('paymentForm').onsubmit=e=>{
 e.preventDefault();
 const j=db.jobs.find(x=>x.id===Number(document.getElementById('paymentJobId').value)),amount=round2(document.getElementById('paymentAmount').value);
 const bal=j?jobBalance(j):0;
 if(!j||!Number.isFinite(amount)||amount<=0||amount>bal){alert('Enter a payment greater than zero and no more than the outstanding balance.');return}
 const method=document.getElementById('jobExtraPaymentMethod').value;
 j.paid=round2(Number(j.paid||0)+amount);
 if(j.status==='Quote')j.status='Pending';
 j.payments=j.payments||[];
 j.payments.push({date:now(),amount,method,note:'Balance payment',by:currentUser?.name||'Admin'});
 j.updatedAt=now();save();document.getElementById('paymentDialog').close();renderJobs();toast('Payment recorded');
};
window.printJob=id=>{
 const j=db.jobs.find(x=>x.id===id);if(!j)return;
 const c=customerById(j.customerId)||{};
 const shop=db.settings||defaultSettings();
 const specText=formatJobSpecs(j);
 const payRows=(j.payments||[]).map(p=>`<div>${new Date(p.date).toLocaleDateString()} · ${esc(p.method)}: ${money(p.amount)} (${esc(p.note||'')})</div>`).join('');
 const w=window.open('','_blank','width=450,height=700');if(!w){alert('Allow pop-ups to print job orders.');return}
 w.document.write(`<html><head><title>${esc(j.jobNo)}</title><style>body{font:14px Arial;padding:24px;color:#222}h2{text-align:center;margin-bottom:4px}.muted{color:#666}.row{padding:9px 0;border-bottom:1px solid #ddd}.amount{font-size:20px;font-weight:bold}</style></head><body><h2>${esc(shop.shopName||'KRZ PRINT')}</h2><center>${j.status==='Quote'?'PRINTING QUOTE / ESTIMATE':'PRINTING JOB ORDER'}</center><hr><div class="row"><b>Job:</b> ${esc(j.jobNo)}<br><b>Date:</b> ${new Date(j.createdAt).toLocaleString()}<br><b>Due:</b> ${esc(j.dueDate||'Not specified')}<br><b>Status:</b> ${esc(j.status)}</div><div class="row"><b>Customer:</b> ${esc(c.name||'')}<br><b>Telephone:</b> ${esc(c.phone||'')}</div><div class="row"><b>Work:</b><br>${esc(j.description)}${specText?`<br><b>Specs:</b> ${esc(specText)}`:''}<br><b>Quantity:</b> ${j.qty}</div><div class="row">Total: ${money(j.total)}<br>Paid: ${money(j.paid)}<br><span class="amount">Balance: ${money(jobBalance(j))}</span></div>${payRows?`<div class="row"><b>Payments:</b><br>${payRows}</div>`:''}<p class="muted">${esc(shop.receiptFooter||'Thank you for choosing KRZ PRINT.')}</p><script>window.onload=()=>window.print()<\/script></body></html>`);
 w.document.close();
};

// REPORTS, EXPENSES & DAILY Z-REPORT
function renderReports(){
 const from=document.getElementById('reportFrom')?.value||'';
 const to=document.getElementById('reportTo')?.value||'';
 const inRange=iso=>{const d=localDate(iso);return (!from||d>=from)&&(!to||d<=to)};
 const sales=activeSales().filter(s=>inRange(s.date));
 const jobPays=jobPaymentsInRange(from,to);
 const exps=(db.expenses||[]).filter(e=>inRange(e.date));
 const gross=sum(sales,s=>s.subtotal);
 const discount=sum(sales,s=>s.discount);
 const posNet=sum(sales,s=>s.total);
 const posProfit=round2(sum(sales,s=>sum(s.items||[],i=>(i.price-i.cost)*i.qty))-discount);
 const jobRev=sum(jobPays,p=>p.amount);
 const expTotal=sum(exps,e=>e.amount);
 const netProfit=round2(posProfit+jobRev-expTotal);

 document.getElementById('reportGross').textContent=money(gross);
 document.getElementById('reportDiscount').textContent=money(discount);
 document.getElementById('reportProfit').textContent=money(posProfit);
 document.getElementById('reportCount').textContent=sales.length;

 const colEl=document.getElementById('collectionsSummary');
 if(colEl){
  colEl.innerHTML=simpleTable(['Metric','Amount'],[
   ['POS Net Sales (Completed)',money(posNet)],
   ['Print Job Payments Collected',money(jobRev)],
   ['<b>Total Revenue Collected</b>',`<b>${money(posNet+jobRev)}</b>`],
   ['Recorded Shop Expenses',`<span class="low">−${money(expTotal)}</span>`],
   ['<b>Estimated Net Income (POS Profit + Job Payments − Expenses)</b>',`<b>${money(netProfit)}</b>`]
  ]);
 }

 const methods={};
 ['Cash','Card','Bank Transfer','Other'].forEach(m=>methods[m]={pos:0,jobs:0});
 sales.forEach(s=>{
  const m=methods[s.method]?s.method:'Other';
  methods[m].pos=round2(methods[m].pos+s.total);
 });
 jobPays.forEach(p=>{
  const m=methods[p.method]?p.method:'Other';
  methods[m].jobs=round2(methods[m].jobs+p.amount);
 });
 document.getElementById('paymentReport').innerHTML=simpleTable(['Payment Method','POS Sales','Job Payments','Total Collected'],Object.entries(methods).filter(([,v])=>v.pos>0||v.jobs>0).map(([k,v])=>[esc(k),money(v.pos),money(v.jobs),`<b>${money(v.pos+v.jobs)}</b>`]));

 const best={};
 sales.forEach(s=>(s.items||[]).forEach(i=>{
  if(!best[i.name])best[i.name]={qty:0,rev:0};
  best[i.name].qty+=i.qty;
  best[i.name].rev=round2(best[i.name].rev+(i.price*i.qty));
 }));
 document.getElementById('bestSellers').innerHTML=simpleTable(['Product','Units Sold','Revenue'],Object.entries(best).sort((a,b)=>b[1].qty-a[1].qty).slice(0,10).map(([k,v])=>[esc(k),v.qty,money(v.rev)]));

 const expEl=document.getElementById('expensesTable');
 if(expEl){
  const sortedExp=exps.slice().sort((a,b)=>b.date.localeCompare(a.date));
  expEl.innerHTML=simpleTable(['Date','Category','Description','Method','Amount','Action'],sortedExp.map(x=>[
   esc(localDate(x.date)),esc(x.category),esc(x.description),esc(x.method),money(x.amount),
   `<button class="btn small danger" onclick="deleteExpense(${x.id})">Delete</button>`
  ]));
 }
}
document.getElementById('reportFrom')?.addEventListener('change',renderReports);
document.getElementById('reportTo')?.addEventListener('change',renderReports);
document.getElementById('clearReportDates')?.addEventListener('click',()=>{
 document.getElementById('reportFrom').value='';
 document.getElementById('reportTo').value='';
 renderReports();
});
document.getElementById('addExpense')?.addEventListener('click',()=>{
 document.getElementById('expenseForm').reset();
 document.getElementById('expDate').value=today();
 document.getElementById('expenseDialog').showModal();
});
document.getElementById('cancelExpense')?.addEventListener('click',()=>document.getElementById('expenseDialog').close());
document.getElementById('expenseForm')?.addEventListener('submit',e=>{
 e.preventDefault();
 const amount=round2(document.getElementById('expAmount').value);
 if(amount<=0){alert('Enter a valid expense amount.');return}
 db.expenses.push({
  id:db.nextExpenseId++,
  date:document.getElementById('expDate').value||today(),
  category:document.getElementById('expCategory').value,
  method:document.getElementById('expMethod').value,
  amount,
  description:document.getElementById('expDesc').value.trim(),
  by:currentUser?.name||'Admin'
 });
 save();document.getElementById('expenseDialog').close();renderReports();toast('Expense recorded');
});
window.deleteExpense=id=>{
 if(!requireAdmin('deleting an expense'))return;
 if(!confirm('Remove this expense record?'))return;
 db.expenses=db.expenses.filter(e=>e.id!==id);
 save();renderReports();toast('Expense removed');
};
document.getElementById('printZReport')?.addEventListener('click',()=>{
 const d=document.getElementById('reportFrom')?.value||today();
 const sales=activeSales().filter(s=>localDate(s.date)===d);
 const voided=db.sales.filter(s=>s.status==='Voided'&&localDate(s.date)===d);
 const jobPays=jobPaymentsInRange(d,d);
 const exps=(db.expenses||[]).filter(e=>localDate(e.date)===d);
 const shop=db.settings||defaultSettings();
 const openFloat=round2(shop.openingFloat||0);
 const cashSales=sum(sales.filter(s=>s.method==='Cash'),s=>s.total);
 const cashJobs=sum(jobPays.filter(p=>p.method==='Cash'),p=>p.amount);
 const cashExp=sum(exps.filter(e=>e.method==='Cash'),e=>e.amount);
 const expectedDrawer=round2(openFloat+cashSales+cashJobs-cashExp);
 const cardTotal=sum(sales.filter(s=>s.method==='Card'),s=>s.total)+sum(jobPays.filter(p=>p.method==='Card'),p=>p.amount);
 const bankTotal=sum(sales.filter(s=>s.method==='Bank Transfer'),s=>s.total)+sum(jobPays.filter(p=>p.method==='Bank Transfer'),p=>p.amount);
 const otherTotal=sum(sales.filter(s=>s.method==='Other'),s=>s.total)+sum(jobPays.filter(p=>p.method==='Other'),p=>p.amount);
 const w=window.open('','_blank','width=420,height=680');if(!w){alert('Allow pop-ups to print Z-Report.');return}
 w.document.write(`<html><head><title>Z-Report ${esc(d)}</title><style>body{font:13px Arial;padding:18px;width:320px}h2{text-align:center;margin-bottom:4px}.center{text-align:center}.line{border-top:1px dashed #555;margin:10px 0}table{width:100%;font-size:12px}td{padding:4px 0}.r{text-align:right}</style></head><body><h2>${esc(shop.shopName||'KRZ PRINT')}</h2><div class="center">DAILY CLOSEOUT (Z-REPORT)<br>Date: ${esc(d)}</div><div class="line"></div><table><tr><td>POS Transactions</td><td class="r">${sales.length}</td></tr><tr><td>Voided Sales (${voided.length})</td><td class="r">${money(sum(voided,s=>s.total))}</td></tr><tr><td>POS Net Sales</td><td class="r">${money(sum(sales,s=>s.total))}</td></tr><tr><td>Job Payments Collected (${jobPays.length})</td><td class="r">${money(sum(jobPays,p=>p.amount))}</td></tr><tr><td><b>Total Collections</b></td><td class="r"><b>${money(sum(sales,s=>s.total)+sum(jobPays,p=>p.amount))}</b></td></tr></table><div class="line"></div><b>CASH DRAWER RECONCILIATION</b><table><tr><td>Opening Cash Float</td><td class="r">${money(openFloat)}</td></tr><tr><td>+ Cash POS Sales</td><td class="r">${money(cashSales)}</td></tr><tr><td>+ Cash Job Payments</td><td class="r">${money(cashJobs)}</td></tr><tr><td>− Cash Expenses</td><td class="r">${money(cashExp)}</td></tr><tr><td><b>Expected Cash in Drawer</b></td><td class="r"><b>${money(expectedDrawer)}</b></td></tr></table><div class="line"></div><b>NON-CASH COLLECTIONS</b><table><tr><td>Card</td><td class="r">${money(cardTotal)}</td></tr><tr><td>Bank Transfer</td><td class="r">${money(bankTotal)}</td></tr><tr><td>Other</td><td class="r">${money(otherTotal)}</td></tr></table><div class="line"></div><div class="center">Printed: ${new Date().toLocaleString()}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
 w.document.close();
});

// BACKUP, CSV EXPORTS, SETTINGS & STAFF ACCOUNTS
function renderUsers(){
 const el=document.getElementById('usersTable');
 if(!el)return;
 el.innerHTML=simpleTable(['Username','Full Name','Role','Status','Actions'],(db.users||[]).map(u=>[
  esc(u.username),esc(u.name),`<span class="badge">${esc(u.role)}</span>`,
  u.active!==false?'<span class="good">Active</span>':'<span class="low">Disabled</span>',
  `<button class="btn small secondary" onclick="editUser(${u.id})">Edit / PIN</button> <button class="btn small ${u.active!==false?'danger':'success'}" onclick="toggleUser(${u.id})">${u.active!==false?'Disable':'Enable'}</button>`
 ]));
}
function openUser(u=null){
 if(!requireAdmin('managing staff accounts'))return;
 document.getElementById('userForm').reset();
 document.getElementById('userEditId').value=u?.id||'';
 document.getElementById('userDialogTitle').textContent=u?'Edit Staff Account':'Add Staff Account';
 document.getElementById('uUsername').value=u?.username||'';
 document.getElementById('uName').value=u?.name||'';
 document.getElementById('uRole').value=u?.role||'Cashier';
 document.getElementById('uPin').value=u?.pin||'';
 document.getElementById('userDialog').showModal();
}
window.editUser=id=>{const u=(db.users||[]).find(x=>x.id===id);if(u)openUser(u)};
window.toggleUser=id=>{
 if(!requireAdmin('changing staff status'))return;
 const u=(db.users||[]).find(x=>x.id===id);if(!u)return;
 const activeAdmins=(db.users||[]).filter(x=>x.active!==false&&x.role==='Admin');
 if(u.active!==false&&u.role==='Admin'&&activeAdmins.length<=1){alert('At least one active Admin account must remain.');return}
 u.active=u.active===false;
 save();renderUsers();toast(`Staff account ${u.active?'enabled':'disabled'}`);
};
document.getElementById('addUser')?.addEventListener('click',()=>openUser());
document.getElementById('cancelUser')?.addEventListener('click',()=>document.getElementById('userDialog').close());
document.getElementById('userForm')?.addEventListener('submit',e=>{
 e.preventDefault();
 const id=Number(document.getElementById('userEditId').value)||null;
 const username=document.getElementById('uUsername').value.trim();
 const name=document.getElementById('uName').value.trim();
 const role=document.getElementById('uRole').value;
 const pin=document.getElementById('uPin').value;
 if((db.users||[]).some(u=>u.username.toLowerCase()===username.toLowerCase()&&u.id!==id)){alert('That username already exists.');return}
 const existing=id?(db.users||[]).find(u=>u.id===id):null;
 if(existing&&existing.role==='Admin'&&role!=='Admin'){
  const activeAdmins=(db.users||[]).filter(x=>x.active!==false&&x.role==='Admin');
  if(activeAdmins.length<=1){alert('At least one active Admin account must remain.');return}
 }
 const u={id:id||db.nextUserId++,username,name,role,pin,active:existing?existing.active!==false:true};
 if(id){const i=db.users.findIndex(x=>x.id===id);db.users[i]=u}else db.users.push(u);
 if(currentUser&&currentUser.id===u.id){currentUser=u;updateAuthUI()}
 save();document.getElementById('userDialog').close();renderUsers();toast('Staff account saved');
});

function renderBackup(){
 const s=db.settings||defaultSettings();
 if(document.getElementById('setShopName')){
  document.getElementById('setShopName').value=s.shopName||'KRZ PRINT';
  document.getElementById('setTrn').value=s.trn||'';
  document.getElementById('setPhone').value=s.phone||'';
  document.getElementById('setAddress').value=s.address||'';
  document.getElementById('setOpeningFloat').value=s.openingFloat??0;
  document.getElementById('setFooter').value=s.receiptFooter||'Thank you for your business!';
  document.getElementById('setTaxMode').value=s.taxMode||'off';
  document.getElementById('setTaxRate').value=s.taxRate??15;
 }
 renderUsers();
 const lastBackup=s.lastBackupAt?new Date(s.lastBackupAt).toLocaleString():'Never';
 const modeLabel=sqliteConnected?'Single-Station SQLite (krz_print_pos.sqlite)':'Single-Station Browser Storage';
 document.getElementById('storageInfo').textContent=`${db.products.length} products · ${db.sales.length} sales · ${db.customers.length} customers · ${db.jobs.length} print jobs · ${(db.expenses||[]).length} expenses · ${new Blob([JSON.stringify(db)]).size.toLocaleString()} bytes stored (${modeLabel}) · Last JSON backup: ${lastBackup}.`;
}
document.getElementById('settingsForm')?.addEventListener('submit',e=>{
 e.preventDefault();
 if(!requireAdmin('changing settings'))return;
 db.settings=Object.assign(defaultSettings(),db.settings,{
  shopName:document.getElementById('setShopName').value.trim()||'KRZ PRINT',
  trn:document.getElementById('setTrn').value.trim(),
  phone:document.getElementById('setPhone').value.trim(),
  address:document.getElementById('setAddress').value.trim(),
  openingFloat:round2(document.getElementById('setOpeningFloat').value),
  receiptFooter:document.getElementById('setFooter').value.trim()||'Thank you for your business!',
  taxMode:document.getElementById('setTaxMode').value,
  taxRate:Math.max(0,round2(document.getElementById('setTaxRate').value))
 });
 save();applyBrandHeader();renderBackup();toast('Settings saved');
});

window.exportCSV=type=>{
 const csvCell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
 let headers=[],rows=[];
 if(type==='sales'){
  headers=['Receipt','Date','Status','Cashier','Customer','Payment Method','Subtotal','Discount','Tax','Total','Void Reason'];
  rows=db.sales.map(s=>[s.receipt,s.date,s.status||'Completed',s.cashier||'',customerById(s.customerId)?.name||'Walk-in',s.method,s.subtotal,s.discount,s.tax||0,s.total,s.voidReason||'']);
 }else if(type==='jobs'){
  headers=['Job No','Created','Customer','Telephone','Description','Specs','Qty','Due Date','Status','Total','Paid','Balance'];
  rows=db.jobs.map(j=>{const c=customerById(j.customerId);return [j.jobNo,j.createdAt,c?.name||'',c?.phone||'',j.description,formatJobSpecs(j),j.qty,j.dueDate||'',j.status,j.total,j.paid,jobBalance(j)]});
 }else if(type==='products'){
  headers=['SKU','Name','Category','Cost','Price','Qty','Reorder Level','Track Stock','Taxable','Active'];
  rows=db.products.map(p=>[p.sku,p.name,p.category,p.cost,p.price,p.qty,p.reorder,p.trackStock!==false,p.taxable!==false,p.active!==false]);
 }else if(type==='customers'){
  headers=['ID','Name','Telephone','Email','Notes','Jobs Count'];
  rows=db.customers.map(c=>[c.id,c.name,c.phone||'',c.email||'',c.notes||'',db.jobs.filter(j=>j.customerId===c.id).length]);
 }else if(type==='expenses'){
  headers=['ID','Date','Category','Description','Method','Amount','Recorded By'];
  rows=(db.expenses||[]).map(x=>[x.id,x.date,x.category,x.description,x.method,x.amount,x.by||'']);
 }
 const content='\uFEFF'+[headers.map(csvCell).join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\r\n');
 const blob=new Blob([content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`KRZ_PRINT_${type.toUpperCase()}_${today()}.csv`;a.click();URL.revokeObjectURL(url);
 toast(`${type.toUpperCase()} CSV exported`);
};

document.getElementById('exportBackup').onclick=()=>{
 db.settings=db.settings||defaultSettings();
 db.settings.lastBackupAt=now();
 save();
 const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='KRZ_PRINT_BACKUP_'+today()+'.json';a.click();URL.revokeObjectURL(url);
 renderBackup();toast('Backup downloaded');
};
document.getElementById('restoreBackup').onclick=()=>{
 if(!requireAdmin('restoring a backup'))return;
 const f=document.getElementById('restoreFile').files[0];if(!f){alert('Choose a backup JSON file first.');return}
 if(!confirm('This replaces all current KRZ PRINT data. Continue?'))return;
 const reader=new FileReader();
 reader.onload=()=>{
  try{
   const x=JSON.parse(reader.result);
   if(!Array.isArray(x.products)||!Array.isArray(x.sales))throw Error('Invalid backup format');
   db=upgradeDb(x);save();cart=[];showPage('dashboard');toast('Backup restored');
  }catch(e){alert('Could not restore backup: '+e.message)}
 };
 reader.readAsText(f);
};
initAuth();
renderDashboard();renderPOS();
