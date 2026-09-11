(() => {
  'use strict';

  const APP_VERSION = '1.3.4';
  const DB_NAME = 'multigestion_mr_v1';
  const DB_VERSION = 2;

  const $ = id => document.getElementById(id);

  let db;
  let businesses = [];
  let movements = [];
  let smartMemory = [];

  let activeBusinessId = null;
  let editingMovementId = null;
  let smartField = null;

  const money = new Intl.NumberFormat('es-SV', {
    style: 'currency',
    currency: 'USD'
  });

  const today = new Date();

  $('date').value =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const logo = $('brandLogo');

  if (logo?.src) {
    document.documentElement.style.setProperty(
      '--watermark-logo',
      `url("${logo.src}")`
    );
  }

  $('versionPill').textContent =
    `V${APP_VERSION.replace(/\.0$/, '')}`;

  /* =========================================================
     BASE LOCAL
     ========================================================= */

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const d = req.result;

        if (!d.objectStoreNames.contains('businesses')) {
          d.createObjectStore('businesses', {
            keyPath: 'id'
          });
        }

        if (!d.objectStoreNames.contains('movements')) {
          const s = d.createObjectStore('movements', {
            keyPath: 'id'
          });

          s.createIndex(
            'businessId',
            'businessId',
            {
              unique: false
            }
          );
        }

        if (!d.objectStoreNames.contains('smartMemory')) {
          const s = d.createObjectStore('smartMemory', {
            keyPath: 'id'
          });

          s.createIndex(
            'businessId',
            'businessId',
            {
              unique: false
            }
          );

          s.createIndex(
            'field',
            'field',
            {
              unique: false
            }
          );
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function store(name, mode = 'readonly') {
    return db
      .transaction(name, mode)
      .objectStore(name);
  }

  function getAll(name) {
    return new Promise((res, rej) => {
      const r = store(name).getAll();

      r.onsuccess = () =>
        res(r.result || []);

      r.onerror = () =>
        rej(r.error);
    });
  }

  function put(name, value) {
    return new Promise((res, rej) => {
      const r =
        store(name, 'readwrite')
          .put(value);

      r.onsuccess = () =>
        res(value);

      r.onerror = () =>
        rej(r.error);
    });
  }

  function remove(name, id) {
    return new Promise((res, rej) => {
      const r =
        store(name, 'readwrite')
          .delete(id);

      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  function uid() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2, 14)}`;
  }

  function normalize(v) {
    return String(v || '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function memoryKey(v) {
    return normalize(v)
      .toLocaleLowerCase('es');
  }

  function toast(msg) {
    const t = $('toast');

    if (!t) return;

    t.textContent = msg;
    t.classList.add('show');

    clearTimeout(toast.timer);

    toast.timer =
      setTimeout(
        () => t.classList.remove('show'),
        2500
      );
  }

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(
        /[&<>'"]/g,
        c => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[c])
      );
  }

  function cap(s) {
    s = String(s || '');

    return s
      ? s.charAt(0).toUpperCase() + s.slice(1)
      : '';
  }

  function fmtNum(n) {
    return Number(n || 0)
      .toLocaleString(
        'es-SV',
        {
          maximumFractionDigits: 2
        }
      );
  }

  function isExpense(m) {
    return (
      m.type === 'gasto' ||
      m.type === 'compra'
    );
  }

  function isIncome(m) {
    return (
      m.type === 'ingreso' ||
      m.type === 'venta'
    );
  }

  function calc(list) {
    const income =
      list
        .filter(isIncome)
        .reduce(
          (s, m) =>
            s + Number(m.total || 0),
          0
        );

    const expense =
      list
        .filter(isExpense)
        .reduce(
          (s, m) =>
            s + Number(m.total || 0),
          0
        );

    return {
      income,
      expense,
      profit: income - expense
    };
  }

  function businessMovements(
    id = activeBusinessId
  ) {
    return id
      ? movements.filter(
          m => m.businessId === id
        )
      : [];
  }

  /* =========================================================
     NUBE
     ========================================================= */

  const cloud =
    () => window.MGCloud;

  const cloudActive =
    () => !!cloud()?.state?.user;

  function canAdminBusiness(
    id = activeBusinessId
  ) {
    return (
      !cloudActive() ||
      cloud().canAdminBusiness(id)
    );
  }

  function canAddToBusiness(
    id = activeBusinessId
  ) {
    return (
      !cloudActive() ||
      cloud().canAddMovement(id)
    );
  }

  function canEditRecord(m) {
    return (
      !cloudActive() ||
      cloud().canEditMovement(m)
    );
  }

  async function refresh() {
    smartMemory =
      await getAll('smartMemory');

    if (cloudActive()) {
      try {
        const remote =
          await cloud().fetchData();

        businesses =
          remote.businesses;

        movements =
          remote.movements;

      } catch (err) {
        console.error(err);

        toast(
          `Nube: ${
            err.message ||
            'no fue posible sincronizar'
          }`
        );

        businesses =
          await getAll('businesses');

        movements =
          await getAll('movements');
      }
    } else {
      businesses =
        await getAll('businesses');

      movements =
        await getAll('movements');
    }

    businesses.sort(
      (a, b) =>
        (a.createdAt || 0) -
        (b.createdAt || 0)
    );

    if (
      activeBusinessId &&
      !businesses.some(
        b => b.id === activeBusinessId
      )
    ) {
      activeBusinessId = null;
    }

    render();
  }

  function renderCloudUI(active) {
    const c = cloud();
    const online = cloudActive();

    if ($('cloudDot')) {
      $('cloudDot')
        .classList
        .toggle(
          'online',
          online
        );
    }

    if ($('cloudStatus')) {
      $('cloudStatus').textContent =
        online
          ? 'Nube conectada'
          : 'Modo local';
    }

    if ($('cloudUserLabel')) {
      $('cloudUserLabel').textContent =
        online
          ? (
              c.state.user?.is_anonymous
                ? 'Colaborador autorizado'
                : (
                    c.state.user?.email ||
                    'Administrador conectado'
                  )
            )
          : 'Conecte la nube para compartir la plataforma.';
    }

    if ($('openAuthBtn')) {
      $('openAuthBtn').hidden =
        online;
    }

    if ($('logoutBtn')) {
      $('logoutBtn').hidden =
        !online;
    }

    if ($('sharedAccessBanner')) {
      $('sharedAccessBanner').hidden =
        !(
          online &&
          c.state.user?.is_anonymous
        );
    }

    if ($('newBusinessBtn')) {
      $('newBusinessBtn').hidden =
        online &&
        !c.canCreateBusiness();
    }

    if ($('accessPanel')) {
      $('accessPanel').hidden =
        !(
          online &&
          active &&
          c.canAdminBusiness(active.id)
        );
    }

    if ($('migrateLocalBtn')) {
      $('migrateLocalBtn').hidden =
        !(
          online &&
          !c.state.user?.is_anonymous
        ) ||
        localStorage.getItem(
          'mg_cloud_migrated_v13'
        ) === '1';
    }
  }

  /* =========================================================
     RENDER PRINCIPAL
     ========================================================= */

  function render() {
    const active =
      businesses.find(
        b => b.id === activeBusinessId
      );

    const list =
      active
        ? businessMovements(active.id)
        : [];

    const c = calc(list);
    const general = calc(movements);

    renderCloudUI(active);

    const hint =
      active
        ? active.name
        : 'Sin negocio seleccionado';

    $('metricBusinessTitle').textContent =
      active
        ? active.name
        : 'Seleccione un negocio';

    $('mIncome').textContent =
      money.format(c.income);

    $('mExpense').textContent =
      money.format(c.expense);

    $('mProfit').textContent =
      money.format(c.profit);

    $('mMovements').textContent =
      list.length;

    $('mIncomeHint').textContent =
      hint;

    $('mExpenseHint').textContent =
      hint;

    $('mProfitHint').textContent =
      hint;

    $('gBusinesses').textContent =
      businesses.length;

    $('gIncome').textContent =
      money.format(general.income);

    $('gExpense').textContent =
      money.format(general.expense);

    $('gProfit').textContent =
      money.format(general.profit);

    $('businessList').innerHTML = '';

    $('emptyBusinesses').hidden =
      businesses.length > 0;

    businesses.forEach(b => {
      const own =
        businessMovements(b.id);

      const ownCalc =
        calc(own);

      const btn =
        document.createElement('button');

      btn.type = 'button';

      btn.className =
        'business-item' +
        (
          b.id === activeBusinessId
            ? ' active'
            : ''
        );

      btn.innerHTML = `
        <span class="business-dot"></span>
        <span>
          <strong>${escapeHtml(b.name)}</strong>
          <small>
            ${escapeHtml(b.type)}
            · ${own.length} movimientos
            · Resultado ${money.format(ownCalc.profit)}
          </small>
        </span>
      `;

      btn.addEventListener(
        'click',
        () => {
          if (
            editingMovementId &&
            !confirm(
              'Hay un registro en edición. ¿Cambiar de negocio y cancelar la edición?'
            )
          ) {
            return;
          }

          cancelEditing(false);

          activeBusinessId =
            b.id;

          render();
        }
      );

      $('businessList')
        .appendChild(btn);
    });

    const enabled =
      !!active;

    $('exportBtn').disabled =
      !enabled;

    $('deleteBusinessBtn').disabled =
      !enabled ||
      !canAdminBusiness(active?.id);

    $('saveMovementBtn').disabled =
      !enabled ||
      !canAddToBusiness(active?.id);

    $('activeBusinessName').textContent =
      active
        ? active.name
        : 'Ninguno seleccionado';

    $('activeBusinessType').textContent =
      active
        ? `${active.type}${
            active.description
              ? ' · ' + active.description
              : ''
          }`
        : 'Cree o seleccione un negocio para comenzar.';

    $('bIncome').textContent =
      money.format(c.income);

    $('bExpense').textContent =
      money.format(c.expense);

    $('bProfit').textContent =
      money.format(c.profit);

    $('bMovements').textContent =
      list.length;

    renderMovements(list);
  }

  function renderMovements(baseList) {
    const filter =
      $('filterType').value;

    const q =
      $('searchMovement')
        .value
        .trim()
        .toLowerCase();

    const list =
      baseList
        .filter(
          m =>
            (
              filter === 'todos' ||
              m.type === filter
            ) &&
            (
              !q ||
              `${
                m.category
              } ${
                m.concept
              } ${
                m.party || ''
              } ${
                m.notes || ''
              }`
                .toLowerCase()
                .includes(q)
            )
        )
        .sort(
          (a, b) =>
            String(b.date)
              .localeCompare(
                String(a.date)
              ) ||
            (b.createdAt || 0) -
            (a.createdAt || 0)
        );

    $('movementRows').innerHTML = '';

    $('emptyMovements').hidden =
      list.length > 0;

    list.forEach(m => {
      const tr =
        document.createElement('tr');

      if (
        m.id === editingMovementId
      ) {
        tr.classList.add(
          'editing-row'
        );
      }

      const editable =
        canEditRecord(m);

      const deletable =
        !cloudActive() ||
        cloud().canDeleteMovement(
          m.businessId
        );

      tr.innerHTML = `
        <td>${escapeHtml(m.date)}</td>

        <td>
          <span class="type-chip type-${escapeHtml(m.type)}">
            ${escapeHtml(cap(m.type))}
          </span>
        </td>

        <td>${escapeHtml(m.category)}</td>
        <td>${escapeHtml(m.concept)}</td>
        <td>${fmtNum(m.quantity)}</td>
        <td>${escapeHtml(m.unit)}</td>

        <td>
          <strong>
            ${money.format(Number(m.total || 0))}
          </strong>
        </td>

        <td>
          ${escapeHtml(m.paymentMethod || '')}
        </td>

        <td class="row-actions">

          ${
            editable
              ? '<button class="mini-btn edit" type="button" data-action="edit">✏️ Editar</button>'
              : ''
          }

          ${
            editable
              ? `<button class="mini-btn save" type="button" data-action="save" ${
                  m.id === editingMovementId
                    ? ''
                    : 'disabled'
                }>💾 Guardar</button>`
              : ''
          }

          ${
            deletable
              ? '<button class="mini-btn delete" type="button" data-action="delete">🗑️ Eliminar</button>'
              : ''
          }

          ${
            !editable &&
            !deletable
              ? '<span class="permission-note">Solo consulta</span>'
              : ''
          }

        </td>
      `;

      tr
        .querySelector(
          '[data-action="edit"]'
        )
        ?.addEventListener(
          'click',
          () => startEditing(m.id)
        );

      tr
        .querySelector(
          '[data-action="save"]'
        )
        ?.addEventListener(
          'click',
          () =>
            saveEditedMovement(m.id)
        );

      tr
        .querySelector(
          '[data-action="delete"]'
        )
        ?.addEventListener(
          'click',
          () =>
            deleteMovement(m.id)
        );

      $('movementRows')
        .appendChild(tr);
    });
  }

  /* =========================================================
     FORMULARIO MOVIMIENTOS
     ========================================================= */

  function updateTotal() {
    const q =
      Math.max(
        0,
        Number(
          $('quantity').value
        ) || 0
      );

    const p =
      Math.max(
        0,
        Number(
          $('unitPrice').value
        ) || 0
      );

    $('total').value =
      (q * p).toFixed(2);
  }

  function movementFromForm(
    existing = null
  ) {
    const quantity =
      Math.max(
        0,
        Number(
          $('quantity').value
        ) || 0
      );

    const unitPrice =
      Math.max(
        0,
        Number(
          $('unitPrice').value
        ) || 0
      );

    const m = {
      id:
        existing?.id ||
        uid(),

      businessId:
        existing?.businessId ||
        activeBusinessId,

      date:
        $('date').value,

      type:
        $('movementType').value,

      category:
        normalize(
          $('category').value
        ),

      concept:
        normalize(
          $('concept').value
        ),

      quantity,

      unit:
        $('unit').value,

      unitPrice,

      total:
        Number(
          (
            quantity *
            unitPrice
          ).toFixed(2)
        ),

      party:
        normalize(
          $('party').value
        ),

      paymentMethod:
        $('paymentMethod').value,

      notes:
        normalize(
          $('notes').value
        ),

      createdBy:
        existing?.createdBy,

      createdAt:
        existing?.createdAt ||
        Date.now(),

      updatedAt:
        existing
          ? Date.now()
          : undefined
    };

    if (
      !m.date ||
      !m.category ||
      !m.concept
    ) {
      return {
        error:
          'Complete los campos obligatorios'
      };
    }

    if (quantity <= 0) {
      return {
        error:
          'La cantidad debe ser mayor que 0'
      };
    }

    return {
      movement: m
    };
  }

  function resetMovementForm() {
    const keepDate =
      $('date').value;

    $('movementForm').reset();

    $('date').value =
      keepDate ||
      new Date()
        .toISOString()
        .slice(0, 10);

    $('quantity').value =
      '1';

    $('total').value =
      '0.00';

    $('movementType').value =
      'gasto';

    $('unit').value =
      'unidad';

    $('paymentMethod').value =
      'Efectivo';
  }

  function startEditing(id) {
    const m =
      movements.find(
        x =>
          x.id === id &&
          x.businessId ===
            activeBusinessId
      );

    if (!m) return;

    if (!canEditRecord(m)) {
      return toast(
        'No tiene permiso para editar este registro'
      );
    }

    editingMovementId =
      id;

    $('date').value =
      m.date;

    $('movementType').value =
      m.type;

    $('category').value =
      m.category;

    $('concept').value =
      m.concept;

    $('quantity').value =
      m.quantity;

    $('unit').value =
      m.unit;

    $('unitPrice').value =
      m.unitPrice;

    $('total').value =
      Number(
        m.total || 0
      ).toFixed(2);

    $('party').value =
      m.party || '';

    $('paymentMethod').value =
      m.paymentMethod ||
      'Efectivo';

    $('notes').value =
      m.notes || '';

    $('movementFormTitle').textContent =
      'Editar movimiento';

    $('editBadge').hidden =
      false;

    $('cancelEditBtn').hidden =
      false;

    $('saveMovementBtn').textContent =
      '💾 Guardar cambios';

    renderMovements(
      businessMovements()
    );

    $('movementForm')
      .scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

    toast(
      'Registro cargado completo para editar'
    );
  }

  function cancelEditing(
    show = true
  ) {
    if (
      !editingMovementId &&
      $('editBadge').hidden
    ) {
      return;
    }

    editingMovementId =
      null;

    $('movementFormTitle').textContent =
      'Registrar movimiento';

    $('editBadge').hidden =
      true;

    $('cancelEditBtn').hidden =
      true;

    $('saveMovementBtn').textContent =
      '💾 Guardar movimiento';

    resetMovementForm();

    if (show) {
      toast(
        'Edición cancelada'
      );
    }
  }

  async function rememberMovement(m) {
    for (
      const [field, value]
      of [
        ['category', m.category],
        ['concept', m.concept],
        ['party', m.party]
      ]
    ) {
      const clean =
        normalize(value);

      if (!clean) continue;

      const key =
        memoryKey(clean);

      const id =
        `${m.businessId}|${field}|${key}`;

      const existing =
        smartMemory.find(
          x => x.id === id
        );

      await put(
        'smartMemory',
        {
          id,
          businessId:
            m.businessId,
          field,
          key,
          value:
            existing?.value ||
            clean,
          createdAt:
            existing?.createdAt ||
            Date.now(),
          lastUsedAt:
            Date.now()
        }
      );
    }
  }

  async function migrateMemory() {
    if (
      smartMemory.length ||
      !movements.length
    ) {
      return;
    }

    for (
      const m
      of movements
    ) {
      await rememberMovement(m);
    }

    smartMemory =
      await getAll(
        'smartMemory'
      );
  }

  async function saveEditedMovement(
    id = editingMovementId
  ) {
    if (
      !id ||
      id !== editingMovementId
    ) {
      return;
    }

    const existing =
      movements.find(
        x => x.id === id
      );

    if (!existing) return;

    if (!canEditRecord(existing)) {
      return toast(
        'No tiene permiso para editar este registro'
      );
    }

    const {
      movement,
      error
    } =
      movementFromForm(
        existing
      );

    if (error) {
      return toast(error);
    }

    try {
      if (cloudActive()) {
        await cloud()
          .updateMovement(
            movement
          );
      } else {
        await put(
          'movements',
          movement
        );
      }
    } catch (err) {
      return toast(
        err.message ||
        'No se pudo guardar'
      );
    }

    await rememberMovement(
      movement
    );

    editingMovementId =
      null;

    $('movementFormTitle').textContent =
      'Registrar movimiento';

    $('editBadge').hidden =
      true;

    $('cancelEditBtn').hidden =
      true;

    $('saveMovementBtn').textContent =
      '💾 Guardar movimiento';

    resetMovementForm();

    await refresh();

    toast(
      'Cambios guardados sin duplicar el registro'
    );
  }

  /* =========================================================
     MEMORIA INTELIGENTE
     ========================================================= */

  function smartValues(field) {
    const map =
      new Map();

    smartMemory
      .filter(
        x =>
          x.businessId ===
            activeBusinessId &&
          x.field === field
      )
      .forEach(x => {
        if (
          !map.has(x.key)
        ) {
          map.set(
            x.key,
            x.value
          );
        }
      });

    return [...map.values()]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'es',
            {
              sensitivity:
                'base'
            }
          )
      );
  }

  function smartLabel(field) {
    return field === 'category'
      ? 'Categorías guardadas'
      : field === 'concept'
        ? 'Productos / conceptos guardados'
        : 'Proveedores / clientes guardados';
  }

  let smartMenu = null;

  function closeSmart() {
    if (smartMenu) {
      smartMenu.remove();
      smartMenu = null;
    }

    smartField = null;
  }

  function renderInlineSmart() {
    if (
      !smartMenu ||
      !smartField
    ) {
      return;
    }

    const input =
      $(smartField);

    const q =
      normalize(
        input.value
      )
        .toLocaleLowerCase(
          'es'
        );

    const values =
      smartValues(
        smartField
      )
        .filter(
          v =>
            !q ||
            v
              .toLocaleLowerCase('es')
              .includes(q)
        );

    smartMenu.innerHTML =
      '';

    const head =
      document.createElement(
        'div'
      );

    head.className =
      'smart-inline-head';

    head.innerHTML = `
      <strong>
        ${escapeHtml(
          smartLabel(
            smartField
          )
        )}
      </strong>

      <small>
        ${values.length}
        opción${
          values.length === 1
            ? ''
            : 'es'
        }
      </small>
    `;

    smartMenu.appendChild(
      head
    );

    if (!values.length) {
      const empty =
        document.createElement(
          'div'
        );

      empty.className =
        'smart-inline-empty';

      empty.textContent =
        q
          ? 'No hay coincidencias. Puede escribir un nombre nuevo y se guardará al registrar.'
          : 'Todavía no hay nombres guardados en este campo para este negocio.';

      smartMenu.appendChild(
        empty
      );

      return;
    }

    values.forEach(v => {
      const b =
        document.createElement(
          'button'
        );

      b.type =
        'button';

      b.className =
        'smart-inline-choice';

      b.innerHTML = `
        <span>
          ${escapeHtml(v)}
        </span>
        <small>Usar</small>
      `;

      b.addEventListener(
        'pointerdown',
        e => e.preventDefault()
      );

      b.addEventListener(
        'click',
        () => {
          input.value = v;

          closeSmart();

          toast(
            `${v} seleccionado`
          );
        }
      );

      smartMenu.appendChild(b);
    });
  }

  function openSmart(field) {
    if (!activeBusinessId) {
      return toast(
        'Seleccione un negocio'
      );
    }

    if (
      smartMenu &&
      smartField === field
    ) {
      closeSmart();
      return;
    }

    closeSmart();

    smartField =
      field;

    const input =
      $(field);

    const control =
      input.closest(
        '.smart-control'
      );

    if (!control) return;

    const beforeY =
      window.scrollY;

    smartMenu =
      document.createElement(
        'div'
      );

    smartMenu.className =
      'smart-inline-menu';

    smartMenu.setAttribute(
      'role',
      'listbox'
    );

    control.appendChild(
      smartMenu
    );

    renderInlineSmart();

    requestAnimationFrame(
      () => {
        if (
          Math.abs(
            window.scrollY -
            beforeY
          ) > 2
        ) {
          window.scrollTo({
            top: beforeY,
            left: 0,
            behavior: 'auto'
          });
        }
      }
    );
  }

  /* =========================================================
     EVENTOS GENERALES
     ========================================================= */

  $('quantity')
    .addEventListener(
      'input',
      updateTotal
    );

  $('unitPrice')
    .addEventListener(
      'input',
      updateTotal
    );

  $('filterType')
    .addEventListener(
      'change',
      render
    );

  $('searchMovement')
    .addEventListener(
      'input',
      render
    );

  $('cancelEditBtn')
    .addEventListener(
      'click',
      () => {
        cancelEditing(true);
        render();
      }
    );

  document
    .querySelectorAll(
      '.smart-open'
    )
    .forEach(
      b => {
        b.addEventListener(
          'pointerdown',
          e =>
            e.preventDefault()
        );

        b.addEventListener(
          'click',
          () =>
            openSmart(
              b.dataset.smart
            )
        );
      }
    );

  [
    'category',
    'concept',
    'party'
  ].forEach(
    id =>
      $(id)
        .addEventListener(
          'input',
          () => {
            if (
              smartMenu &&
              smartField === id
            ) {
              renderInlineSmart();
            }
          }
        )
  );

  document.addEventListener(
    'pointerdown',
    e => {
      if (
        smartMenu &&
        !e.target.closest(
          '.smart-control'
        )
      ) {
        closeSmart();
      }
    }
  );

  $('newBusinessBtn')
    .addEventListener(
      'click',
      () =>
        $('businessDialog')
          .showModal()
    );

  $('closeBusinessDialog')
    .addEventListener(
      'click',
      () =>
        $('businessDialog')
          .close()
    );

  $('cancelBusinessBtn')
    .addEventListener(
      'click',
      () =>
        $('businessDialog')
          .close()
    );

  $('businessForm')
    .addEventListener(
      'submit',
      async e => {
        e.preventDefault();

        const name =
          normalize(
            $('businessName').value
          );

        const type =
          normalize(
            $('businessType').value
          );

        if (
          !name ||
          !type
        ) {
          return;
        }

        let b;

        try {
          if (cloudActive()) {
            if (
              !cloud()
                .canCreateBusiness()
            ) {
              return toast(
                'Este acceso no puede crear negocios'
              );
            }

            b =
              await cloud()
                .createBusiness({
                  name,
                  type,
                  description:
                    normalize(
                      $('businessDescription').value
                    )
                });

          } else {
            b = {
              id: uid(),
              name,
              type,
              description:
                normalize(
                  $('businessDescription').value
                ),
              createdAt:
                Date.now()
            };

            await put(
              'businesses',
              b
            );
          }

        } catch (err) {
          return toast(
            err.message ||
            'No se pudo crear el negocio'
          );
        }

        activeBusinessId =
          b.id;

        $('businessForm')
          .reset();

        $('businessDialog')
          .close();

        await refresh();

        toast(
          'Negocio creado correctamente'
        );
      }
    );

  $('movementForm')
    .addEventListener(
      'submit',
      async e => {
        e.preventDefault();

        if (!activeBusinessId) {
          return toast(
            'Seleccione un negocio'
          );
        }

        if (editingMovementId) {
          return saveEditedMovement(
            editingMovementId
          );
        }

        const {
          movement,
          error
        } =
          movementFromForm();

        if (error) {
          return toast(error);
        }

        try {
          if (cloudActive()) {
            await cloud()
              .createMovement(
                movement
              );
          } else {
            await put(
              'movements',
              movement
            );
          }

        } catch (err) {
          return toast(
            err.message ||
            'No se pudo guardar el movimiento'
          );
        }

        await rememberMovement(
          movement
        );

        resetMovementForm();

        await refresh();

        toast(
          'Movimiento guardado y memoria actualizada'
        );
      }
    );

  async function deleteMovement(id) {
    const m =
      movements.find(
        x => x.id === id
      );

    if (!m) return;

    if (
      cloudActive() &&
      !cloud()
        .canDeleteMovement(
          m.businessId
        )
    ) {
      return toast(
        'Solo el administrador puede eliminar movimientos'
      );
    }

    if (
      !confirm(
        `¿Eliminar este movimiento?\n${m.concept} · ${money.format(Number(m.total || 0))}`
      )
    ) {
      return;
    }

    try {
      if (cloudActive()) {
        await cloud()
          .deleteMovement(id);
      } else {
        await remove(
          'movements',
          id
        );
      }

    } catch (err) {
      return toast(
        err.message ||
        'No se pudo eliminar'
      );
    }

    if (
      editingMovementId === id
    ) {
      cancelEditing(false);
    }

    await refresh();

    toast(
      'Movimiento eliminado'
    );
  }

  $('deleteBusinessBtn')
    .addEventListener(
      'click',
      async () => {
        const b =
          businesses.find(
            x =>
              x.id ===
              activeBusinessId
          );

        if (!b) return;

        if (
          !canAdminBusiness(
            b.id
          )
        ) {
          return toast(
            'Solo el administrador puede eliminar el negocio'
          );
        }

        if (
          !confirm(
            `¿Eliminar “${b.name}” y todos sus movimientos?`
          )
        ) {
          return;
        }

        try {
          if (cloudActive()) {
            await cloud()
              .deleteBusiness(
                b.id
              );

          } else {
            for (
              const m
              of businessMovements(
                b.id
              )
            ) {
              await remove(
                'movements',
                m.id
              );
            }

            for (
              const mem
              of smartMemory.filter(
                x =>
                  x.businessId ===
                  b.id
              )
            ) {
              await remove(
                'smartMemory',
                mem.id
              );
            }

            await remove(
              'businesses',
              b.id
            );
          }

        } catch (err) {
          return toast(
            err.message ||
            'No se pudo eliminar el negocio'
          );
        }

        activeBusinessId =
          null;

        cancelEditing(false);

        await refresh();

        toast(
          'Negocio eliminado'
        );
      }
    );

  /* =========================================================
     EXCEL
     ========================================================= */

  function reportPeriod(list) {
    if (!list.length) {
      return 'Sin movimientos registrados';
    }

    const dates =
      list
        .map(m => m.date)
        .filter(Boolean)
        .sort();

    return (
      dates[0] ===
      dates[
        dates.length - 1
      ]
    )
      ? dates[0]
      : `${dates[0]} al ${dates[dates.length - 1]}`;
  }

  function safeName(name) {
    return normalize(name)
      .replace(
        /[^a-z0-9áéíóúñ_-]+/gi,
        '_'
      )
      .slice(0, 40) ||
      'negocio';
  }

  async function makeWatermarkBase64(
    src,
    opacity = .055
  ) {
    return new Promise(
      resolve => {
        try {
          const img =
            new Image();

          img.onload =
            () => {
              const max =
                900;

              const scale =
                Math.min(
                  1,
                  max /
                    Math.max(
                      img.naturalWidth ||
                        1,
                      img.naturalHeight ||
                        1
                    )
                );

              const w =
                Math.max(
                  1,
                  Math.round(
                    (
                      img.naturalWidth ||
                      800
                    ) *
                    scale
                  )
                );

              const h =
                Math.max(
                  1,
                  Math.round(
                    (
                      img.naturalHeight ||
                      800
                    ) *
                    scale
                  )
                );

              const canvas =
                document.createElement(
                  'canvas'
                );

              canvas.width =
                w;

              canvas.height =
                h;

              const ctx =
                canvas.getContext(
                  '2d'
                );

              ctx.clearRect(
                0,
                0,
                w,
                h
              );

              ctx.globalAlpha =
                opacity;

              ctx.drawImage(
                img,
                0,
                0,
                w,
                h
              );

              resolve(
                canvas.toDataURL(
                  'image/png'
                )
              );
            };

          img.onerror =
            () =>
              resolve(null);

          img.src =
            src;

        } catch (_) {
          resolve(null);
        }
      }
    );
  }

  async function exportProfessionalExcel() {
    const b =
      businesses.find(
        x =>
          x.id ===
          activeBusinessId
      );

    if (!b) return;

    const list =
      businessMovements(
        b.id
      )
        .slice()
        .sort(
          (a, z) =>
            String(a.date)
              .localeCompare(
                String(z.date)
              ) ||
            (a.createdAt || 0) -
            (z.createdAt || 0)
        );

    const c =
      calc(list);

    if (!window.ExcelJS) {
      return exportXlsxFallback(
        b,
        list,
        c
      );
    }

    try {
      const wb =
        new ExcelJS.Workbook();

      wb.creator =
        'MULTIGESTIÓN MR';

      wb.subject =
        `Registro de movimientos - ${b.name}`;

      wb.created =
        new Date();

      const navy =
        '123B63';

      const navy2 =
        '0A2F52';

      const green =
        '14875B';

      const greenSoft =
        'E3F4E9';

      const red =
        'C43B3B';

      const redSoft =
        'FCE8E8';

      const gold =
        'D39B24';

      const goldSoft =
        'FFF5D6';

      const blueSoft =
        'E9F2FB';

      const white =
        'FFFFFF';

      const ink =
        '172B3A';

      const muted =
        '667085';

      const line =
        'C9D3DD';

      const alt =
        'F7FAFC';

      const border = {
        style: 'thin',
        color: {
          argb: line
        }
      };

      const allBorder = {
        top: border,
        left: border,
        bottom: border,
        right: border
      };

      const currencyFmt =
        '"$"#,##0.00;[Red]-"$"#,##0.00';

      const ws =
        wb.addWorksheet(
          'Movimientos'
        );

      ws.views = [
        {
          state: 'frozen',
          ySplit: 6,
          showGridLines:
            false
        }
      ];

      ws.pageSetup = {
        orientation:
          'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: .22,
          right: .22,
          top: .42,
          bottom: .42,
          header: .15,
          footer: .15
        },
        printTitlesRow:
          '1:6'
      };

      ws.headerFooter.oddFooter =
        '&LMULTIGESTIÓN MR&C&P de &N&RDocumento editable';

      ws.columns = [
        { width: 5 },
        { width: 11 },
        { width: 10 },
        { width: 16 },
        { width: 24 },
        { width: 9 },
        { width: 10 },
        { width: 12 },
        { width: 13 }
      ];

      ws.pageSetup.horizontalCentered =
        true;

      ws.pageSetup.pageOrder =
        'downThenOver';

      let logoId = null;
      let watermarkId = null;

      try {
        const src =
          $('brandLogo').src;

        const raw =
          src.includes(',')
            ? src.split(',')[1]
            : null;

        if (raw) {
          logoId =
            wb.addImage({
              base64: raw,
              extension: 'png'
            });
        }

        const wm =
          await makeWatermarkBase64(
            src,
            .045
          );

        if (wm) {
          watermarkId =
            wb.addImage({
              base64:
                wm.split(',')[1],
              extension:
                'png'
            });
        }

      } catch (_) {}

      ws.mergeCells(
        'A1:I1'
      );

      const title =
        ws.getCell('A1');

      title.value =
        'MULTIGESTIÓN MR';

      title.font = {
        bold: true,
        size: 22,
        color: {
          argb: white
        }
      };

      title.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: navy2
        }
      };

      title.alignment = {
        horizontal:
          'center',
        vertical:
          'middle'
      };

      ws.getRow(1).height =
        34;

      ws.mergeCells(
        'A2:I2'
      );

      const name =
        ws.getCell('A2');

      name.value =
        b.name.toUpperCase();

      name.font = {
        bold: true,
        size: 16,
        color: {
          argb: green
        }
      };

      name.alignment = {
        horizontal:
          'center',
        vertical:
          'middle'
      };

      ws.getRow(2).height =
        25;

      ws.mergeCells(
        'A3:I3'
      );

      const activity =
        ws.getCell('A3');

      activity.value =
        `${String(b.type || '').toUpperCase()}${
          b.description
            ? ' · ' + b.description
            : ''
        }`;

      activity.font = {
        bold: true,
        size: 11,
        color: {
          argb: ink
        }
      };

      activity.alignment = {
        horizontal:
          'center',
        vertical:
          'middle'
      };

      ws.mergeCells(
        'A4:F4'
      );

      ws.getCell('A4').value =
        `PERÍODO: ${reportPeriod(list)}`;

      ws.getCell('A4').font = {
        bold: true,
        color: {
          argb: navy
        }
      };

      ws.mergeCells(
        'G4:I4'
      );

      ws.getCell('G4').value =
        `EMISIÓN: ${new Date().toLocaleDateString('es-SV')}`;

      ws.getCell('G4').font = {
        bold: true,
        color: {
          argb: navy
        }
      };

      ws.getCell('G4').alignment = {
        horizontal:
          'right'
      };

      ws.mergeCells(
        'A5:I5'
      );

      ws.getCell('A5').value =
        'REGISTRO DE MOVIMIENTOS · ARCHIVO XLSX EDITABLE';

      ws.getCell('A5').font = {
        bold: true,
        size: 10,
        color: {
          argb: muted
        }
      };

      ws.getCell('A5').alignment = {
        horizontal:
          'center'
      };

      if (logoId !== null) {
        ws.addImage(
          logoId,
          {
            tl: {
              col: .05,
              row: .05
            },
            ext: {
              width: 76,
              height: 54
            },
            editAs:
              'absolute'
          }
        );
      }

      const headers = [
        'N.º',
        'FECHA',
        'TIPO',
        'CATEGORÍA',
        'CONCEPTO',
        'CANTIDAD',
        'UNIDAD',
        'TOTAL',
        'PAGO'
      ];

      const hr =
        ws.getRow(6);

      hr.values =
        headers;

      hr.height =
        29;

      hr.eachCell(
        cell => {
          cell.font = {
            bold: true,
            size: 10,
            color: {
              argb: white
            }
          };

          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: navy
            }
          };

          cell.alignment = {
            horizontal:
              'center',
            vertical:
              'middle',
            wrapText:
              true
          };

          cell.border =
            allBorder;
        }
      );

      let rowNo =
        7;

      list.forEach(
        (m, i) => {
          const row =
            ws.getRow(
              rowNo + i
            );

          row.values = [
            i + 1,
            m.date,
            cap(m.type),
            m.category,
            m.concept,
            m.quantity,
            m.unit,
            Number(m.total || 0),
            m.paymentMethod || ''
          ];

          row.height =
            23;

          row.eachCell(
            cell => {
              cell.border =
                allBorder;

              cell.alignment = {
                vertical:
                  'middle',
                wrapText:
                  true
              };

              if (
                i % 2 === 1
              ) {
                cell.fill = {
                  type:
                    'pattern',
                  pattern:
                    'solid',
                  fgColor: {
                    argb: alt
                  }
                };
              }
            }
          );

          row.getCell(1).alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          row.getCell(2).alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          row.getCell(3).alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          row.getCell(6).alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          row.getCell(7).alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          row.getCell(8).numFmt =
            currencyFmt;

          row.getCell(8).font = {
            bold: true,
            color: {
              argb: ink
            }
          };

          row.getCell(8).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: goldSoft
            }
          };

          row.getCell(9).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: blueSoft
            }
          };

          if (isExpense(m)) {
            row.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: {
                argb: redSoft
              }
            };

            row.getCell(3).font = {
              bold: true,
              color: {
                argb: red
              }
            };

          } else if (
            isIncome(m)
          ) {
            row.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: {
                argb: greenSoft
              }
            };

            row.getCell(3).font = {
              bold: true,
              color: {
                argb: green
              }
            };
          }
        }
      );

      if (!list.length) {
        ws.mergeCells(
          'A7:I10'
        );

        const empty =
          ws.getCell('A7');

        empty.value =
          'SIN MOVIMIENTOS REGISTRADOS PARA ESTE NEGOCIO';

        empty.font = {
          bold: true,
          italic: true,
          color: {
            argb: muted
          }
        };

        empty.alignment = {
          horizontal:
            'center',
          vertical:
            'middle'
        };

        empty.border =
          allBorder;

        rowNo =
          11;

      } else {
        rowNo =
          7 +
          list.length;
      }

      const lastData =
        Math.max(
          7,
          6 + list.length
        );

      if (list.length) {
        ws.autoFilter = {
          from: 'A6',
          to:
            `I${lastData}`
        };
      }

      const watermarkStart =
        rowNo + 1;

      const watermarkEnd =
        watermarkStart + 8;

      for (
        let r = watermarkStart;
        r <= watermarkEnd;
        r++
      ) {
        ws.getRow(r).height =
          25;
      }

      if (
        watermarkId !== null
      ) {
        ws.addImage(
          watermarkId,
          {
            tl: {
              col: 1.15,
              row:
                watermarkStart -
                1
            },
            ext: {
              width: 445,
              height: 170
            },
            editAs:
              'absolute'
          }
        );
      }

      const totalStart =
        watermarkEnd + 2;

      [
        [
          'A',
          'C',
          'TOTAL INGRESOS',
          c.income,
          green,
          greenSoft
        ],
        [
          'D',
          'F',
          'TOTAL GASTOS',
          c.expense,
          red,
          redSoft
        ],
        [
          'G',
          'I',
          'RESULTADO',
          c.profit,
          c.profit < 0
            ? red
            : green,
          c.profit < 0
            ? redSoft
            : greenSoft
        ]
      ].forEach(
        ([
          from,
          to,
          label,
          val,
          strong,
          soft
        ]) => {
          ws.mergeCells(
            `${from}${totalStart}:${to}${totalStart}`
          );

          const l =
            ws.getCell(
              `${from}${totalStart}`
            );

          l.value =
            label;

          l.font = {
            bold: true,
            color: {
              argb: white
            }
          };

          l.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: strong
            }
          };

          l.alignment = {
            horizontal:
              'center'
          };

          ws.mergeCells(
            `${from}${totalStart + 1}:${to}${totalStart + 2}`
          );

          const v =
            ws.getCell(
              `${from}${totalStart + 1}`
            );

          v.value =
            val;

          v.numFmt =
            currencyFmt;

          v.font = {
            bold: true,
            size: 17,
            color: {
              argb: strong
            }
          };

          v.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb: soft
            }
          };

          v.alignment = {
            horizontal:
              'center',
            vertical:
              'middle'
          };

          v.border =
            allBorder;
        }
      );

      ws.mergeCells(
        `A${totalStart + 4}:I${totalStart + 4}`
      );

      const note =
        ws.getCell(
          `A${totalStart + 4}`
        );

      note.value =
        'MULTIGESTIÓN MR · Documento generado desde el negocio seleccionado. Las celdas permanecen editables.';

      note.font = {
        italic: true,
        size: 9,
        color: {
          argb: muted
        }
      };

      note.alignment = {
        horizontal:
          'center'
      };

      ws.pageSetup.printArea =
        `A1:I${totalStart + 4}`;

      const buffer =
        await wb.xlsx.writeBuffer();

      const blob =
        new Blob(
          [buffer],
          {
            type:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const a =
        document.createElement(
          'a'
        );

      a.href =
        url;

      a.download =
        `MG_MR_${safeName(b.name)}.xlsx`;

      document.body.appendChild(
        a
      );

      a.click();
      a.remove();

      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        1500
      );

      toast(
        'Excel profesional editable generado'
      );

    } catch (err) {
      console.error(err);

      exportXlsxFallback(
        b,
        list,
        c
      );
    }
  }

  function exportXlsxFallback(
    b,
    list,
    c
  ) {
    if (!window.XLSX) {
      return toast(
        'No se pudo cargar el generador de Excel'
      );
    }

    const rows = [
      ['MULTIGESTIÓN MR'],
      [b.name.toUpperCase()],
      [String(b.type || '').toUpperCase()],
      [`PERÍODO: ${reportPeriod(list)}`],
      [],
      [
        'N.º',
        'FECHA',
        'TIPO',
        'CATEGORÍA',
        'CONCEPTO',
        'CANTIDAD',
        'UNIDAD',
        'TOTAL',
        'PAGO'
      ]
    ];

    list.forEach(
      (m, i) =>
        rows.push([
          i + 1,
          m.date,
          cap(m.type),
          m.category,
          m.concept,
          m.quantity,
          m.unit,
          Number(m.total || 0),
          m.paymentMethod || ''
        ])
    );

    rows.push(
      [],
      [
        'TOTAL INGRESOS',
        c.income,
        'TOTAL GASTOS',
        c.expense,
        'RESULTADO',
        c.profit
      ]
    );

    const wb =
      XLSX.utils.book_new();

    const ws =
      XLSX.utils.aoa_to_sheet(
        rows
      );

    ws['!cols'] = [
      { wch: 7 },
      { wch: 13 },
      { wch: 13 },
      { wch: 21 },
      { wch: 32 },
      { wch: 12 },
      { wch: 14 },
      { wch: 16 },
      { wch: 18 }
    ];

    XLSX.utils
      .book_append_sheet(
        wb,
        ws,
        'Movimientos'
      );

    XLSX.writeFile(
      wb,
      `MG_MR_${safeName(b.name)}.xlsx`
    );

    toast(
      'Excel editable generado'
    );
  }

  $('exportBtn')
    .addEventListener(
      'click',
      exportProfessionalExcel
    );

  /* =========================================================
     SERVICE WORKER
     ========================================================= */

  async function registerFreshWorker() {
    if (
      !(
        'serviceWorker'
        in navigator
      ) ||
      !location.protocol
        .startsWith(
          'http'
        )
    ) {
      return;
    }

    try {
      const regs =
        await navigator
          .serviceWorker
          .getRegistrations();

      for (
        const reg
        of regs
      ) {
        try {
          await reg.update();
        } catch (_) {}
      }

      await navigator
        .serviceWorker
        .register(
          './sw.js?v=134',
          {
            updateViaCache:
              'none'
          }
        );

    } catch (err) {
      console.warn(
        'SW',
        err
      );
    }
  }

  /* =========================================================
     NUBE / AUTENTICACIÓN / ACCESOS
     V1.3.4
     ========================================================= */

  function cloudMessage(
    message,
    type = 'info',
    target = 'authMessage'
  ) {
    const box =
      $(target);

    if (!box) {
      return toast(message);
    }

    box.textContent =
      message;

    box.className =
      `auth-message ${type}`;

    box.hidden =
      false;
  }

  function clearCloudMessage(
    target = 'authMessage'
  ) {
    const box =
      $(target);

    if (!box) return;

    box.hidden =
      true;

    box.textContent =
      '';

    box.className =
      'auth-message';
  }

  function openRecoveryDialog() {
    try {
      if (
        $('authDialog')?.open
      ) {
        $('authDialog')
          .close();
      }
    } catch (_) {}

    try {
      if (
        !$('resetPasswordDialog')?.open
      ) {
        $('resetPasswordDialog')
          ?.showModal();
      }
    } catch (_) {}

    cloudMessage(
      'Enlace de recuperación validado. Escriba y confirme su nueva contraseña.',
      'success',
      'resetPasswordMessage'
    );
  }

  $('openAuthBtn')
    ?.addEventListener(
      'click',
      () => {
        clearCloudMessage();

        $('authDialog')
          .showModal();
      }
    );

  $('closeAuthDialog')
    ?.addEventListener(
      'click',
      () =>
        $('authDialog')
          .close()
    );

  $('authForm')
    ?.addEventListener(
      'submit',
      async e => {
        e.preventDefault();

        clearCloudMessage();

        cloudMessage(
          'Conectando con la nube…',
          'info'
        );

        try {
          await cloud()
            .signIn(
              normalize(
                $('authEmail').value
              ),
              $('authPassword').value
            );

          cloudMessage(
            'Nube conectada correctamente.',
            'success'
          );

          activeBusinessId =
            null;

          await refresh();

          setTimeout(
            () => {
              $('authDialog')
                ?.close();

              toast(
                'Nube conectada'
              );
            },
            650
          );

        } catch (err) {
          cloudMessage(
            err.message ||
            'No fue posible iniciar sesión',
            'error'
          );
        }
      }
    );

  $('signUpBtn')
    ?.addEventListener(
      'click',
      async () => {
        clearCloudMessage();

        const email =
          normalize(
            $('authEmail').value
          );

        const password =
          $('authPassword').value;

        const name =
          normalize(
            $('authName').value
          );

        if (
          !email ||
          password.length < 6
        ) {
          return cloudMessage(
            'Ingrese correo y una contraseña de al menos 6 caracteres.',
            'error'
          );
        }

        cloudMessage(
          'Creando acceso administrador…',
          'info'
        );

        try {
          const data =
            await cloud()
              .signUp(
                email,
                password,
                name
              );

          if (data.session) {
            cloudMessage(
              'Administrador creado y conectado.',
              'success'
            );

            await refresh();

            setTimeout(
              () => {
                $('authDialog')
                  ?.close();

                toast(
                  'Administrador creado y conectado'
                );
              },
              650
            );

          } else {
            cloudMessage(
              'Cuenta creada. Revise el correo de confirmación y luego inicie sesión.',
              'success'
            );
          }

        } catch (err) {
          cloudMessage(
            err.message ||
            'No se pudo crear el acceso',
            'error'
          );
        }
      }
    );

  $('forgotPasswordBtn')
    ?.addEventListener(
      'click',
      async () => {
        clearCloudMessage();

        const email =
          normalize(
            $('authEmail').value
          );

        if (!email) {
          cloudMessage(
            'Escriba primero el correo del administrador.',
            'error'
          );

          $('authEmail')
            ?.focus();

          return;
        }

        cloudMessage(
          'Enviando correo de recuperación…',
          'info'
        );

        try {
          await cloud()
            .resetPasswordForEmail(
              email
            );

          cloudMessage(
            'Correo de recuperación enviado. Revise su bandeja de entrada y abra el enlace recibido.',
            'success'
          );

        } catch (err) {
          cloudMessage(
            err.message ||
            'No se pudo enviar el correo de recuperación',
            'error'
          );
        }
      }
    );

  $('closeResetPasswordDialog')
    ?.addEventListener(
      'click',
      () =>
        $('resetPasswordDialog')
          ?.close()
    );

  $('resetPasswordForm')
    ?.addEventListener(
      'submit',
      async e => {
        e.preventDefault();

        clearCloudMessage(
          'resetPasswordMessage'
        );

        const password =
          $('newPassword')
            ?.value ||
          '';

        const confirmPassword =
          $('confirmNewPassword')
            ?.value ||
          '';

        if (
          password.length < 6
        ) {
          return cloudMessage(
            'La contraseña debe tener al menos 6 caracteres.',
            'error',
            'resetPasswordMessage'
          );
        }

        if (
          password !==
          confirmPassword
        ) {
          return cloudMessage(
            'Las contraseñas no coinciden.',
            'error',
            'resetPasswordMessage'
          );
        }

        cloudMessage(
          'Guardando la nueva contraseña…',
          'info',
          'resetPasswordMessage'
        );

        try {
          await cloud()
            .updatePassword(
              password
            );

          $('resetPasswordForm')
            ?.reset();

          cloudMessage(
            'Contraseña actualizada correctamente. Ya puede iniciar sesión.',
            'success',
            'resetPasswordMessage'
          );

          setTimeout(
            () => {
              $('resetPasswordDialog')
                ?.close();

              toast(
                'Contraseña actualizada correctamente'
              );
            },
            900
          );

        } catch (err) {
          cloudMessage(
            err.message ||
            'No se pudo actualizar la contraseña',
            'error',
            'resetPasswordMessage'
          );
        }
      }
    );

  window.addEventListener(
    'mg-password-recovery',
    openRecoveryDialog
  );

  $('logoutBtn')
    ?.addEventListener(
      'click',
      async () => {
        try {
          await cloud()
            .signOut();

          activeBusinessId =
            null;

          await refresh();

          toast(
            'Sesión cerrada. Modo local activo'
          );

        } catch (err) {
          toast(
            err.message ||
            'No se pudo cerrar sesión'
          );
        }
      }
    );

  /* =========================================================
     GENERAR INVITACIÓN
     ========================================================= */

  $('generateAccessLinkBtn')
    ?.addEventListener(
      'click',
      async () => {
        if (
          !activeBusinessId
        ) {
          return toast(
            'Seleccione un negocio'
          );
        }

        try {
          const link =
            await cloud()
              .generateAccessLink(
                activeBusinessId,
                'collaborator'
              );

          $('generatedAccessLink').value =
            link.url;

          $('generatedLinkBox').hidden =
            false;

          await renderAccessLinks();

          toast(
            'Enlace privado generado'
          );

        } catch (err) {
          toast(
            err.message ||
            'No se pudo generar el enlace'
          );
        }
      }
    );

  $('copyAccessLinkBtn')
    ?.addEventListener(
      'click',
      async () => {
        const value =
          $('generatedAccessLink').value;

        if (!value) return;

        try {
          await navigator
            .clipboard
            .writeText(
              value
            );

          toast(
            'Enlace copiado'
          );

        } catch (_) {
          $('generatedAccessLink')
            .select();

          document.execCommand(
            'copy'
          );

          toast(
            'Enlace copiado'
          );
        }
      }
    );

  /* =========================================================
     COLABORADORES Y ENLACES
     ========================================================= */

  async function renderAccessLinks() {
    if (
      !cloudActive() ||
      !activeBusinessId ||
      !cloud()
        .canAdminBusiness(
          activeBusinessId
        ) ||
      !$('accessLinksList')
    ) {
      return;
    }

    const box =
      $('accessLinksList');

    box.innerHTML =
      '<small class="muted-text">Cargando accesos y colaboradores…</small>';

    try {
      const links =
        await cloud()
          .listAccessLinks(
            activeBusinessId
          );

      const members =
        (
          cloud()
            .state
            .members ||
          []
        )
          .filter(
            m =>
              m.business_id ===
                activeBusinessId &&
              m.role ===
                'collaborator'
          );

      box.innerHTML =
        '';

      /* -------------------------
         COLABORADORES
         ------------------------- */

      const membersTitle =
        document.createElement(
          'div'
        );

      membersTitle.className =
        'permission-note';

      membersTitle.innerHTML =
        '<strong>COLABORADORES AUTORIZADOS</strong>';

      box.appendChild(
        membersTitle
      );

      if (!members.length) {
        const emptyMembers =
          document.createElement(
            'div'
          );

        emptyMembers.className =
          'access-link-row';

        emptyMembers.innerHTML =
          '<small class="muted-text">Todavía no hay colaboradores vinculados.</small>';

        box.appendChild(
          emptyMembers
        );
      }

      members.forEach(
        member => {
          const row =
            document.createElement(
              'div'
            );

          row.className =
            'access-link-row';

          const shortId =
            String(
              member.user_id ||
              ''
            )
              .replace(
                /-/g,
                ''
              )
              .slice(
                0,
                8
              )
              .toUpperCase();

          row.innerHTML = `
            <div>
              <strong>
                Colaborador ${escapeHtml(shortId)}
              </strong>

              <div class="permission-note">
                ${
                  member.active
                    ? 'Acceso autorizado'
                    : 'Acceso revocado'
                }
              </div>
            </div>

            ${
              member.active
                ? '<button class="btn danger revoke-member" type="button">Revocar acceso</button>'
                : '<button class="btn reactivate-member" type="button">Reactivar acceso</button>'
            }
          `;

          row
            .querySelector(
              '.revoke-member'
            )
            ?.addEventListener(
              'click',
              async () => {
                if (
                  !confirm(
                    '¿Desea quitarle el acceso a este colaborador? Sus movimientos anteriores no se eliminarán.'
                  )
                ) {
                  return;
                }

                try {
                  await cloud()
                    .revokeBusinessMember(
                      activeBusinessId,
                      member.user_id
                    );

                  await cloud()
                    .fetchData();

                  await renderAccessLinks();

                  toast(
                    'Acceso del colaborador revocado'
                  );

                } catch (err) {
                  console.error(
                    err
                  );

                  toast(
                    err.message ||
                    'No se pudo revocar el acceso del colaborador'
                  );
                }
              }
            );

          row
            .querySelector(
              '.reactivate-member'
            )
            ?.addEventListener(
              'click',
              async () => {
                if (
                  !confirm(
                    '¿Desea devolverle el acceso a este colaborador?'
                  )
                ) {
                  return;
                }

                try {
                  await cloud()
                    .reactivateBusinessMember(
                      activeBusinessId,
                      member.user_id
                    );

                  await cloud()
                    .fetchData();

                  await renderAccessLinks();

                  toast(
                    'Acceso del colaborador reactivado'
                  );

                } catch (err) {
                  console.error(
                    err
                  );

                  toast(
                    err.message ||
                    'No se pudo reactivar el acceso del colaborador'
                  );
                }
              }
            );

          box.appendChild(
            row
          );
        }
      );

      /* -------------------------
         ENLACES DE INVITACIÓN
         ------------------------- */

      const linksTitle =
        document.createElement(
          'div'
        );

      linksTitle.className =
        'permission-note';

      linksTitle.style.marginTop =
        '14px';

      linksTitle.innerHTML =
        '<strong>ENLACES DE INVITACIÓN</strong>';

      box.appendChild(
        linksTitle
      );

      if (!links.length) {
        const emptyLinks =
          document.createElement(
            'div'
          );

        emptyLinks.className =
          'access-link-row';

        emptyLinks.innerHTML =
          '<small class="muted-text">Todavía no hay enlaces creados.</small>';

        box.appendChild(
          emptyLinks
        );

        return;
      }

      links.forEach(
        link => {
          const row =
            document.createElement(
              'div'
            );

          row.className =
            'access-link-row';

          const used =
            Number(
              link.uses_count ||
              0
            );

          const status =
            used >= 1
              ? 'Utilizado'
              : link.active
                ? 'Disponible'
                : 'Revocado';

          row.innerHTML = `
            <div>
              <strong>
                Invitación de colaborador
              </strong>

              <div class="permission-note">
                ${new Date(
                  link.created_at
                ).toLocaleString(
                  'es-SV'
                )}
                · usos ${used}
                · ${status}
              </div>
            </div>

            ${
              link.active &&
              used === 0
                ? '<button class="btn danger revoke-link" type="button">Revocar enlace</button>'
                : `<span class="permission-chip">${status}</span>`
            }
          `;

          row
            .querySelector(
              '.revoke-link'
            )
            ?.addEventListener(
              'click',
              async () => {
                if (
                  !confirm(
                    '¿Desea invalidar este enlace de invitación?'
                  )
                ) {
                  return;
                }

                try {
                  await cloud()
                    .revokeAccessLink(
                      link.id
                    );

                  await renderAccessLinks();

                  toast(
                    'Enlace de invitación revocado'
                  );

                } catch (err) {
                  console.error(
                    err
                  );

                  toast(
                    err.message ||
                    'No se pudo revocar el enlace'
                  );
                }
              }
            );

          box.appendChild(
            row
          );
        }
      );

    } catch (err) {
      console.error(err);

      box.innerHTML = `
        <small class="muted-text">
          ${escapeHtml(
            err.message ||
            'No se pudieron cargar los accesos'
          )}
        </small>
      `;
    }
  }

  /* =========================================================
     MIGRACIÓN LOCAL
     ========================================================= */

  $('migrateLocalBtn')
    ?.addEventListener(
      'click',
      async () => {
        if (
          !cloudActive() ||
          cloud()
            .state
            .user
            ?.is_anonymous
        ) {
          return toast(
            'Solo administrador'
          );
        }

        const localBusinesses =
          await getAll(
            'businesses'
          );

        const localMovements =
          await getAll(
            'movements'
          );

        if (
          !localBusinesses.length
        ) {
          return toast(
            'No hay datos locales para migrar'
          );
        }

        if (
          !confirm(
            `Se copiarán ${localBusinesses.length} negocios y ${localMovements.length} movimientos a la nube. Los datos locales quedarán como respaldo. ¿Continuar?`
          )
        ) {
          return;
        }

        try {
          await cloud()
            .migrateLocal(
              localBusinesses,
              localMovements
            );

          localStorage.setItem(
            'mg_cloud_migrated_v13',
            '1'
          );

          activeBusinessId =
            null;

          await refresh();

          toast(
            'Datos locales migrados a la nube'
          );

        } catch (err) {
          console.error(
            err
          );

          toast(
            err.message ||
            'No se pudo completar la migración'
          );
        }
      }
    );

  window.addEventListener(
    'mg-auth-changed',
    async () => {
      activeBusinessId =
        null;

      await refresh();
    }
  );

  /* =========================================================
     EXTENSIÓN DEL RENDER
     ========================================================= */

  const originalRender =
    render;

  render = function () {
    originalRender();

    if (
      cloudActive() &&
      activeBusinessId &&
      cloud()
        .canAdminBusiness(
          activeBusinessId
        )
    ) {
      renderAccessLinks();
    }
  };

  /* =========================================================
     INICIO
     ========================================================= */

  (async () => {
    try {
      db =
        await openDB();

      businesses =
        await getAll(
          'businesses'
        );

      movements =
        await getAll(
          'movements'
        );

      smartMemory =
        await getAll(
          'smartMemory'
        );

      await migrateMemory();

      if (cloud()) {
        await cloud()
          .init();

        if (
          cloud()
            .state
            ?.recoveryMode
        ) {
          openRecoveryDialog();
        }
      }

      await refresh();

      registerFreshWorker();

    } catch (err) {
      console.error(
        err
      );

      toast(
        err.message ||
        'No fue posible iniciar MULTIGESTIÓN MR'
      );
    }
  })();

})();
