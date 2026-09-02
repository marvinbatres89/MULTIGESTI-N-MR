(() => {
  'use strict';
  const DB_NAME = 'multigestion_mr_v1';
  const DB_VERSION = 1;
  const $ = (id) => document.getElementById(id);
  let db;
  let businesses = [];
  let movements = [];
  let activeBusinessId = null;
  let deferredInstall = null;

  const money = new Intl.NumberFormat('es-SV',{style:'currency',currency:'USD'});
  const today = new Date();
  $('date').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const d=req.result;
        if(!d.objectStoreNames.contains('businesses')) d.createObjectStore('businesses',{keyPath:'id'});
        if(!d.objectStoreNames.contains('movements')){
          const s=d.createObjectStore('movements',{keyPath:'id'});
          s.createIndex('businessId','businessId',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  function store(name,mode='readonly'){return db.transaction(name,mode).objectStore(name)}
  function getAll(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
  function put(name,value){return new Promise((res,rej)=>{const r=store(name,'readwrite').put(value);r.onsuccess=()=>res(value);r.onerror=()=>rej(r.error)})}
  function remove(name,id){return new Promise((res,rej)=>{const r=store(name,'readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2200)}
  function uid(prefix){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`}
  function isExpense(m){return m.type==='gasto'||m.type==='compra'}
  function isIncome(m){return m.type==='ingreso'||m.type==='venta'}
  function calc(list){
    const income=list.filter(isIncome).reduce((s,m)=>s+Number(m.total||0),0);
    const expense=list.filter(isExpense).reduce((s,m)=>s+Number(m.total||0),0);
    return {income,expense,profit:income-expense};
  }

  async function refresh(){
    businesses=await getAll('businesses');
    movements=await getAll('movements');
    businesses.sort((a,b)=>a.createdAt-b.createdAt);
    render();
  }

  function render(){
    const all=calc(movements);
    $('mBusinesses').textContent=businesses.length;
    $('mIncome').textContent=money.format(all.income);
    $('mExpense').textContent=money.format(all.expense);
    $('mProfit').textContent=money.format(all.profit);

    $('businessList').innerHTML='';
    $('emptyBusinesses').hidden=businesses.length>0;
    businesses.forEach(b=>{
      const list=movements.filter(m=>m.businessId===b.id), c=calc(list);
      const btn=document.createElement('button');btn.type='button';btn.className='business-item'+(b.id===activeBusinessId?' active':'');
      btn.innerHTML=`<strong>${escapeHtml(b.name)}</strong><small>${escapeHtml(b.type)} · Resultado ${money.format(c.profit)}</small>`;
      btn.addEventListener('click',()=>{activeBusinessId=b.id;render()});
      $('businessList').appendChild(btn);
    });

    const active=businesses.find(b=>b.id===activeBusinessId);
    const enabled=!!active;
    $('exportBtn').disabled=!enabled;$('deleteBusinessBtn').disabled=!enabled;$('saveMovementBtn').disabled=!enabled;
    $('activeBusinessName').textContent=active?active.name:'Ninguno seleccionado';
    $('activeBusinessType').textContent=active?`${active.type}${active.description?' · '+active.description:''}`:'Cree o seleccione un negocio para comenzar.';
    const list=enabled?movements.filter(m=>m.businessId===activeBusinessId):[];
    const c=calc(list);
    $('bIncome').textContent=money.format(c.income);$('bExpense').textContent=money.format(c.expense);$('bProfit').textContent=money.format(c.profit);$('bMovements').textContent=list.length;
    renderMovements(list);
  }

  function renderMovements(baseList){
    const filter=$('filterType').value;
    const q=$('searchMovement').value.trim().toLowerCase();
    const list=baseList.filter(m=>(filter==='todos'||m.type===filter)&&(!q||`${m.category} ${m.concept} ${m.party||''} ${m.notes||''}`.toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
    $('movementRows').innerHTML='';$('emptyMovements').hidden=list.length>0;
    list.forEach(m=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${escapeHtml(m.date)}</td><td><span class="type-chip type-${m.type}">${escapeHtml(cap(m.type))}</span></td><td>${escapeHtml(m.category)}</td><td>${escapeHtml(m.concept)}</td><td>${fmtNum(m.quantity)}</td><td>${escapeHtml(m.unit)}</td><td><strong>${money.format(m.total)}</strong></td><td>${escapeHtml(m.paymentMethod)}</td><td><button class="delete-row" type="button" aria-label="Eliminar movimiento">✕</button></td>`;
      tr.querySelector('button').addEventListener('click',()=>deleteMovement(m.id));
      $('movementRows').appendChild(tr);
    });
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
  function fmtNum(n){return Number(n).toLocaleString('es-SV',{maximumFractionDigits:2})}
  function updateTotal(){const q=Math.max(0,Number($('quantity').value)||0),p=Math.max(0,Number($('unitPrice').value)||0);$('total').value=(q*p).toFixed(2)}

  $('quantity').addEventListener('input',updateTotal);$('unitPrice').addEventListener('input',updateTotal);
  $('filterType').addEventListener('change',render);$('searchMovement').addEventListener('input',render);
  $('newBusinessBtn').addEventListener('click',()=>$('businessDialog').showModal());
  $('closeBusinessDialog').addEventListener('click',()=>$('businessDialog').close());
  $('cancelBusinessBtn').addEventListener('click',()=>$('businessDialog').close());

  $('businessForm').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const name=$('businessName').value.trim(), type=$('businessType').value.trim();
    if(!name||!type) return;
    const b={id:uid('biz'),name,type,description:$('businessDescription').value.trim(),createdAt:Date.now()};
    await put('businesses',b);activeBusinessId=b.id;$('businessForm').reset();$('businessDialog').close();await refresh();toast('Negocio creado correctamente');
  });

  $('movementForm').addEventListener('submit',async(e)=>{
    e.preventDefault();
    if(!activeBusinessId){toast('Seleccione un negocio');return;}
    const quantity=Math.max(0,Number($('quantity').value)||0), unitPrice=Math.max(0,Number($('unitPrice').value)||0);
    if(quantity<=0){toast('La cantidad debe ser mayor que 0');return;}
    const m={id:uid('mov'),businessId:activeBusinessId,date:$('date').value,type:$('movementType').value,category:$('category').value.trim(),concept:$('concept').value.trim(),quantity,unit:$('unit').value,unitPrice,total:Number((quantity*unitPrice).toFixed(2)),party:$('party').value.trim(),paymentMethod:$('paymentMethod').value,notes:$('notes').value.trim(),createdAt:Date.now()};
    if(!m.date||!m.category||!m.concept){toast('Complete los campos obligatorios');return;}
    await put('movements',m);
    ['category','concept','unitPrice','party','notes'].forEach(id=>$(id).value='');$('quantity').value='1';$('total').value='0.00';
    await refresh();toast('Movimiento guardado');
  });

  async function deleteMovement(id){if(!confirm('¿Eliminar este movimiento?'))return;await remove('movements',id);await refresh();toast('Movimiento eliminado')}

  $('deleteBusinessBtn').addEventListener('click',async()=>{
    const b=businesses.find(x=>x.id===activeBusinessId);if(!b)return;
    if(!confirm(`¿Eliminar “${b.name}” y todos sus movimientos?`))return;
    const list=movements.filter(m=>m.businessId===b.id);
    for(const m of list) await remove('movements',m.id);
    await remove('businesses',b.id);activeBusinessId=null;await refresh();toast('Negocio eliminado');
  });

  $('exportBtn').addEventListener('click',()=>{
    const b=businesses.find(x=>x.id===activeBusinessId);if(!b)return;
    const list=movements.filter(m=>m.businessId===b.id).sort((a,b)=>a.date.localeCompare(b.date));
    const c=calc(list);
    const summary=[
      ['MULTIGESTIÓN MR'],['Negocio',b.name],['Actividad',b.type],['Descripción',b.description||''],[],['Ingresos',c.income],['Gastos',c.expense],['Resultado',c.profit],['Movimientos',list.length]
    ];
    const rows=list.map(m=>({Fecha:m.date,Tipo:cap(m.type),Categoría:m.category,'Producto / concepto':m.concept,Cantidad:m.quantity,Unidad:m.unit,'Precio unitario':m.unitPrice,Total:m.total,'Proveedor / cliente':m.party,'Forma de pago':m.paymentMethod,Observación:m.notes}));
    const safe=b.name.replace(/[^a-z0-9áéíóúñ_-]+/gi,'_').slice(0,40)||'negocio';
    if(window.XLSX){
      const wb=XLSX.utils.book_new();
      const wsSummary=XLSX.utils.aoa_to_sheet(summary);
      const wsMov=XLSX.utils.json_to_sheet(rows.length?rows:[{'Sin movimientos':''}]);
      const expenses=rows.filter(r=>r.Tipo==='Gasto'||r.Tipo==='Compra');
      const incomes=rows.filter(r=>r.Tipo==='Ingreso'||r.Tipo==='Venta');
      XLSX.utils.book_append_sheet(wb,wsSummary,'Resumen');
      XLSX.utils.book_append_sheet(wb,wsMov,'Movimientos');
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(expenses.length?expenses:[{'Sin gastos':''}]),'Gastos y Compras');
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(incomes.length?incomes:[{'Sin ingresos':''}]),'Ingresos y Ventas');
      XLSX.writeFile(wb,`MULTIGESTION_MR_${safe}.xlsx`);toast('Excel generado');
    }else{
      const headers=['Fecha','Tipo','Categoría','Producto / concepto','Cantidad','Unidad','Precio unitario','Total','Proveedor / cliente','Forma de pago','Observación'];
      const csv=[headers.join(','),...list.map(m=>[m.date,cap(m.type),m.category,m.concept,m.quantity,m.unit,m.unitPrice,m.total,m.party,m.paymentMethod,m.notes].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))].join('\n');
      const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`MULTIGESTION_MR_${safe}.csv`;a.click();URL.revokeObjectURL(a.href);toast('Se generó CSV compatible con Excel');
    }
  });

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installBtn').hidden=false});
  $('installBtn').addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').hidden=true});
  if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

  (async()=>{
    try{db=await openDB();await refresh();updateTotal()}
    catch(err){console.error(err);toast('No se pudo abrir la base de datos local')}
  })();
})();
