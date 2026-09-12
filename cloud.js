(() => {
  'use strict';

  /* =========================================================
     MULTIGESTIÓN MR
     CLOUD.JS
     VERSIÓN 1.4.0

     SEGURIDAD DE ACCESO COMPARTIDO:
     - Enlaces vinculados a un negocio específico.
     - Un solo uso por enlace.
     - Solo administrador puede generar/revocar enlaces.
     - Colaborador anónimo no puede crear negocios.
     - Colaborador solo puede trabajar en negocios autorizados.
     - Un enlace utilizado/revocado/vencido activa BLOQUEO TOTAL.
     - Una sesión anónima temporal se elimina si el enlace falla.
     - RLS de Supabase continúa siendo la seguridad principal.
     ========================================================= */

  const SUPABASE_URL =
    'https://nbnrktcvpuzlqdjqziky.supabase.co';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_ry-zp0PyMU1-p6hKXGz9IQ_d_mLddpC';

  if (!window.supabase?.createClient) {
    console.error('Supabase JS no está disponible');
    return;
  }

  /* =========================================================
     ESTADO INICIAL DEL ENLACE
     ========================================================= */

  function accessParameterExists() {
    try {
      const url =
        new URL(location.href);

      return url.searchParams.has(
        'access'
      );
    } catch (_) {
      return false;
    }
  }

  const initialAccessPending =
    accessParameterExists();

  const client =
    window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.sessionStorage
        }
      }
    );

  const state = {
    session: null,
    user: null,
    members: [],
    businesses: [],
    movements: [],
    tasks: [],
    sharedLinkMode:
      initialAccessPending,
    initialized: false,
    recoveryMode: false,

    /*
      ACCESS GATE

      none:
      apertura normal.

      pending:
      hay un enlace privado
      siendo validado.

      granted:
      enlace válido y consumido.

      denied:
      enlace utilizado,
      revocado, vencido
      o inválido.
    */
    accessGate: {
      mode:
        initialAccessPending
          ? 'pending'
          : 'none',

      message: ''
    }
  };

  /* =========================================================
     MAPEOS
     ========================================================= */

  const mapBusiness = b => ({
    id: b.id,
    name: b.name,
    type: b.activity || '',
    description: b.description || '',
    ownerId: b.owner_id,
    active: b.active,

    createdAt:
      b.created_at
        ? new Date(
            b.created_at
          ).getTime()
        : Date.now(),

    updatedAt:
      b.updated_at
        ? new Date(
            b.updated_at
          ).getTime()
        : undefined,

    cloud: true
  });

  const mapMovement = m => ({
    id: m.id,
    businessId: m.business_id,
    date: m.movement_date,
    type: m.movement_type,
    category: m.category || '',
    concept: m.concept || '',
    quantity:
      Number(
        m.quantity || 0
      ),
    unit: m.unit || '',
    unitPrice:
      Number(
        m.unit_price || 0
      ),
    total:
      Number(
        m.total || 0
      ),
    party: m.party || '',
    paymentMethod:
      m.payment_method || '',
    notes: m.notes || '',
    createdBy:
      m.created_by,
    updatedBy:
      m.updated_by,

    createdAt:
      m.created_at
        ? new Date(
            m.created_at
          ).getTime()
        : Date.now(),

    updatedAt:
      m.updated_at
        ? new Date(
            m.updated_at
          ).getTime()
        : undefined,

    cloud: true
  });

  const mapTask = t => ({
    id: t.id,
    businessId: t.business_id,
    title: t.title || '',
    description: t.description || '',
    taskType: t.task_type || '',
    scheduledDate: t.scheduled_date,
    status: t.status || 'pending',
    priority: t.priority || 'normal',
    recurrenceDays: t.recurrence_days == null ? null : Number(t.recurrence_days),
    completedAt: t.completed_at || null,
    referenceDate: t.reference_date || null,
    relativeDay: t.relative_day == null ? null : Number(t.relative_day),
    createdBy: t.created_by,
    updatedBy: t.updated_by,
    createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    updatedAt: t.updated_at ? new Date(t.updated_at).getTime() : undefined,
    cloud: true
  });

  /* =========================================================
     ACCESS GATE
     ========================================================= */

  function setAccessGate(
    mode,
    message = ''
  ) {
    state.accessGate = {
      mode,
      message:
        String(
          message || ''
        )
    };

    window.dispatchEvent(
      new CustomEvent(
        'mg-access-gate-changed',
        {
          detail: {
            mode,
            message:
              state.accessGate.message
          }
        }
      )
    );
  }

  function getAccessGate() {
    return {
      ...(state.accessGate || {
        mode: 'none',
        message: ''
      })
    };
  }

  function isAccessDenied() {
    return (
      state.accessGate?.mode ===
      'denied'
    );
  }

  function isAccessPending() {
    return (
      state.accessGate?.mode ===
      'pending'
    );
  }

  /* =========================================================
     PERMISOS
     ========================================================= */

  function currentUserId() {
    return (
      state.user?.id ||
      null
    );
  }

  function roleForBusiness(
    businessId
  ) {
    const b =
      state.businesses.find(
        x =>
          x.id === businessId
      );

    if (
      b?.ownerId &&
      b.ownerId ===
        currentUserId()
    ) {
      return 'admin';
    }

    return (
      state.members.find(
        m =>
          m.business_id ===
            businessId &&
          m.user_id ===
            currentUserId() &&
          m.active
      )?.role ||
      null
    );
  }

  function canCreateBusiness() {
    return (
      !!state.user &&
      !state.user.is_anonymous
    );
  }

  function canAddMovement(
    businessId
  ) {
    return [
      'admin',
      'collaborator'
    ].includes(
      roleForBusiness(
        businessId
      )
    );
  }

  function canEditMovement(
    movement
  ) {
    const role =
      roleForBusiness(
        movement.businessId
      );

    return (
      role === 'admin' ||
      (
        role ===
          'collaborator' &&
        movement.createdBy ===
          currentUserId()
      )
    );
  }

  function canDeleteMovement(
    businessId
  ) {
    return (
      roleForBusiness(
        businessId
      ) === 'admin'
    );
  }

  function canAdminBusiness(
    businessId
  ) {
    return (
      roleForBusiness(
        businessId
      ) === 'admin'
    );
  }

  function canAddTask(businessId) {
    return ['admin', 'collaborator'].includes(roleForBusiness(businessId));
  }

  function canEditTask(task) {
    return ['admin', 'collaborator'].includes(roleForBusiness(task.businessId));
  }

  function canDeleteTask(businessId) {
    return roleForBusiness(businessId) === 'admin';
  }

  /* =========================================================
     TOKENS
     ========================================================= */

  async function sha256Hex(
    text
  ) {
    const data =
      new TextEncoder()
        .encode(text);

    const digest =
      await crypto.subtle.digest(
        'SHA-256',
        data
      );

    return [
      ...new Uint8Array(
        digest
      )
    ]
      .map(
        b =>
          b
            .toString(16)
            .padStart(
              2,
              '0'
            )
      )
      .join('');
  }

  function randomToken() {
    const a =
      new Uint8Array(32);

    crypto.getRandomValues(a);

    return [...a]
      .map(
        b =>
          b
            .toString(16)
            .padStart(
              2,
              '0'
            )
      )
      .join('');
  }

  /* =========================================================
     URL DE ACCESO
     ========================================================= */

  function cleanAccessParameter() {
    const url =
      new URL(
        location.href
      );

    if (
      !url.searchParams.has(
        'access'
      )
    ) {
      return;
    }

    url.searchParams.delete(
      'access'
    );

    history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  /* =========================================================
     ERRORES DE ACCESO
     ========================================================= */

  function normalizeAccessError(
    error
  ) {
    const original =
      String(
        error?.message ||
        error ||
        ''
      );

    const lower =
      original.toLowerCase();

    if (
      lower.includes('already') ||
      lower.includes('used') ||
      lower.includes('inactive') ||
      lower.includes('expired') ||
      lower.includes('invalid') ||
      lower.includes('not found') ||
      lower.includes('max') ||
      lower.includes('utilizado') ||
      lower.includes('vencido') ||
      lower.includes('revocado')
    ) {
      return new Error(
        'Este enlace ya fue utilizado o ya no es válido. Solicite un nuevo acceso al administrador.'
      );
    }

    return new Error(
      original ||
      'No fue posible validar el enlace de acceso.'
    );
  }

  /* =========================================================
     CANJEAR ENLACE COMPARTIDO
     ========================================================= */

  async function redeemSharedLinkIfPresent() {
    const url =
      new URL(
        location.href
      );

    const token =
      url.searchParams.get(
        'access'
      );

    if (!token) {
      setAccessGate(
        'none',
        ''
      );

      return null;
    }

    state.sharedLinkMode =
      true;

    setAccessGate(
      'pending',
      'Validando acceso privado…'
    );

    let createdAnonymousSession =
      false;

    try {
      let {
        data: {
          session
        },
        error:
          sessionError
      } =
        await client.auth
          .getSession();

      if (sessionError) {
        throw sessionError;
      }

      /*
        Si no existe sesión,
        creamos una identidad
        anónima únicamente para
        intentar canjear el enlace.
      */
      if (!session) {
        const {
          data,
          error
        } =
          await client.auth
            .signInAnonymously(
              {
                options: {
                  data: {
                    display_name:
                      'Colaborador'
                  }
                }
              }
            );

        if (error) {
          throw error;
        }

        session =
          data.session;

        createdAnonymousSession =
          true;
      }

      if (!session?.user) {
        throw new Error(
          'No fue posible iniciar la sesión del colaborador.'
        );
      }

      /*
        Supabase valida:
        - token
        - active
        - vencimiento
        - max_uses
        - uses_count
      */
      const {
        data,
        error
      } =
        await client.rpc(
          'redeem_access_link',
          {
            p_token:
              token
          }
        );

      if (error) {
        throw normalizeAccessError(
          error
        );
      }

      if (!data) {
        throw new Error(
          'El enlace no devolvió un negocio válido.'
        );
      }

      state.session =
        session;

      state.user =
        session.user;

      /*
        IMPORTANTE:
        el parámetro access
        solamente se elimina
        cuando el canje fue
        realmente exitoso.
      */
      cleanAccessParameter();

      setAccessGate(
        'granted',
        ''
      );

      window.dispatchEvent(
        new CustomEvent(
          'mg-shared-link-redeemed',
          {
            detail: {
              businessId:
                data
            }
          }
        )
      );

      window.dispatchEvent(
        new CustomEvent(
          'mg-auth-changed'
        )
      );

      return data;

    } catch (error) {
      const normalized =
        normalizeAccessError(
          error
        );

      /*
        NO ELIMINAR ?access=
        cuando el enlace falla.

        Así, aunque recargue
        la página, continuará
        bloqueado y no podrá
        entrar accidentalmente
        por una sesión anterior.
      */

      setAccessGate(
        'denied',
        normalized.message
      );

      /*
        Si creamos una sesión
        anónima solamente para
        probar este enlace y
        el enlace no era válido,
        esa identidad temporal
        se elimina inmediatamente.
      */
      if (
        createdAnonymousSession
      ) {
        try {
          await client.auth
            .signOut();
        } catch (_) {}

        state.session =
          null;

        state.user =
          null;
      }

      window.dispatchEvent(
        new CustomEvent(
          'mg-shared-link-error',
          {
            detail: {
              message:
                normalized.message
            }
          }
        )
      );

      throw normalized;
    }
  }

  /* =========================================================
     INICIALIZACIÓN
     ========================================================= */

  async function init() {
    if (
      state.initialized
    ) {
      return state;
    }

    /*
      Registrar el observador
      antes de leer la sesión.

      IMPORTANTE:
      si el enlace privado
      está PENDIENTE o DENEGADO,
      no permitimos que
      mg-auth-changed haga que
      la interfaz se muestre
      antes de terminar
      la validación.
    */
    client.auth.onAuthStateChange(
      (
        event,
        session
      ) => {
        state.session =
          session ||
          null;

        state.user =
          session?.user ||
          null;

        if (
          event ===
          'PASSWORD_RECOVERY'
        ) {
          state.recoveryMode =
            true;

          window.dispatchEvent(
            new CustomEvent(
              'mg-password-recovery'
            )
          );
        }

        if (
          state.accessGate?.mode !==
            'pending' &&
          state.accessGate?.mode !==
            'denied'
        ) {
          window.dispatchEvent(
            new CustomEvent(
              'mg-auth-changed'
            )
          );
        }
      }
    );

    /*
      PRIMERO validamos
      cualquier enlace privado.
    */
    await redeemSharedLinkIfPresent();

    const currentUrl =
      new URL(
        location.href
      );

    const hashParams =
      new URLSearchParams(
        location.hash.replace(
          /^#/,
          ''
        )
      );

    const recoveryInUrl =
      currentUrl.searchParams.get(
        'type'
      ) === 'recovery' ||
      hashParams.get(
        'type'
      ) === 'recovery';

    const {
      data,
      error
    } =
      await client.auth
        .getSession();

    if (error) {
      throw error;
    }

    state.session =
      data.session ||
      null;

    state.user =
      state.session?.user ||
      null;

    state.initialized =
      true;

    /*
      Respaldo para navegadores
      donde PASSWORD_RECOVERY
      ocurrió antes de que la
      interfaz terminara de
      cargar.
    */
    if (
      recoveryInUrl &&
      state.session
    ) {
      state.recoveryMode =
        true;

      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent(
              'mg-password-recovery'
            )
          ),
        0
      );
    }

    return state;
  }

  /* =========================================================
     AUTENTICACIÓN
     ========================================================= */

  async function signIn(
    email,
    password
  ) {
    const {
      data,
      error
    } =
      await client.auth
        .signInWithPassword(
          {
            email,
            password
          }
        );

    if (error) {
      throw error;
    }

    state.session =
      data.session;

    state.user =
      data.user;

    return data;
  }

  async function signUp(
    email,
    password,
    displayName
  ) {
    const {
      data,
      error
    } =
      await client.auth
        .signUp(
          {
            email,
            password,

            options: {
              data: {
                display_name:
                  displayName ||
                  'Administrador'
              }
            }
          }
        );

    if (error) {
      throw error;
    }

    state.session =
      data.session ||
      null;

    state.user =
      data.user ||
      null;

    return data;
  }

  async function resetPasswordForEmail(
    email
  ) {
    const redirectTo =
      'https://marvinbatres89.github.io/MULTIGESTI-N-MR/';

    const {
      data,
      error
    } =
      await client.auth
        .resetPasswordForEmail(
          email,
          {
            redirectTo
          }
        );

    if (error) {
      throw error;
    }

    return data;
  }

  async function updatePassword(
    newPassword
  ) {
    const {
      data,
      error
    } =
      await client.auth
        .updateUser(
          {
            password:
              newPassword
          }
        );

    if (error) {
      throw error;
    }

    state.recoveryMode =
      false;

    return data;
  }

  async function signOut() {
    const {
      error
    } =
      await client.auth
        .signOut();

    if (error) {
      throw error;
    }

    state.session =
      null;

    state.user =
      null;

    state.members =
      [];

    state.businesses =
      [];

    state.movements =
      [];

    state.tasks =
      [];

    state.sharedLinkMode =
      false;

    if (
      !accessParameterExists()
    ) {
      setAccessGate(
        'none',
        ''
      );
    }
  }

  /* =========================================================
     SINCRONIZAR DATOS
     ========================================================= */

  async function fetchData() {
    if (
      isAccessDenied()
    ) {
      throw new Error(
        state.accessGate.message ||
        'Acceso no autorizado.'
      );
    }

    if (
      !state.user
    ) {
      return {
        businesses: [],
        movements: [],
        tasks: []
      };
    }

    const [
      bRes,
      mRes,
      tRes,
      memberRes
    ] =
      await Promise.all([
        client
          .from(
            'businesses'
          )
          .select('*')
          .eq(
            'active',
            true
          )
          .order(
            'created_at',
            {
              ascending:
                true
            }
          ),

        client
          .from(
            'movements'
          )
          .select('*')
          .order(
            'movement_date',
            {
              ascending:
                false
            }
          )
          .order(
            'created_at',
            {
              ascending:
                false
            }
          ),

        client
          .from(
            'business_tasks'
          )
          .select('*')
          .order(
            'scheduled_date',
            {
              ascending:
                true
            }
          )
          .order(
            'created_at',
            {
              ascending:
                true
            }
          ),

        client
          .from(
            'business_members'
          )
          .select(
            'business_id,user_id,role,active'
          )
      ]);

    if (
      bRes.error
    ) {
      throw bRes.error;
    }

    if (
      mRes.error
    ) {
      throw mRes.error;
    }

    if (
      tRes.error
    ) {
      throw tRes.error;
    }

    if (
      memberRes.error
    ) {
      throw memberRes.error;
    }

    state.businesses =
      (
        bRes.data ||
        []
      )
        .map(
          mapBusiness
        );

    state.movements =
      (
        mRes.data ||
        []
      )
        .map(
          mapMovement
        );

    state.tasks =
      (tRes.data || []).map(mapTask);

    state.members =
      memberRes.data ||
      [];

    return {
      businesses:
        state.businesses,

      movements:
        state.movements,

      tasks:
        state.tasks
    };
  }

  /* =========================================================
     NEGOCIOS
     ========================================================= */

  async function createBusiness({
    name,
    type,
    description
  }) {
    if (!state.user) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      isAccessDenied()
    ) {
      throw new Error(
        'Acceso no autorizado.'
      );
    }

    if (
      !canCreateBusiness()
    ) {
      throw new Error(
        'El colaborador no tiene permiso para crear negocios.'
      );
    }

    const {
      data,
      error
    } =
      await client
        .from(
          'businesses'
        )
        .insert({
          name,
          activity:
            type,
          description,
          owner_id:
            state.user.id
        })
        .select('*')
        .single();

    if (error) {
      throw error;
    }

    const mapped =
      mapBusiness(
        data
      );

    state.businesses.push(
      mapped
    );

    return mapped;
  }

  async function deleteBusiness(
    id
  ) {
    if (
      !canAdminBusiness(
        id
      )
    ) {
      throw new Error(
        'Solo el administrador puede eliminar este negocio.'
      );
    }

    const {
      error
    } =
      await client
        .from(
          'businesses'
        )
        .delete()
        .eq(
          'id',
          id
        );

    if (error) {
      throw error;
    }
  }

  /* =========================================================
     MOVIMIENTOS
     ========================================================= */

  async function createMovement(
    m
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      isAccessDenied()
    ) {
      throw new Error(
        'Acceso no autorizado.'
      );
    }

    if (
      !canAddMovement(
        m.businessId
      )
    ) {
      throw new Error(
        'No tiene permiso para agregar movimientos en este negocio.'
      );
    }

    const payload = {
      business_id:
        m.businessId,

      movement_date:
        m.date,

      movement_type:
        m.type,

      category:
        m.category,

      concept:
        m.concept,

      quantity:
        m.quantity,

      unit:
        m.unit,

      unit_price:
        m.unitPrice,

      total:
        m.total,

      party:
        m.party,

      payment_method:
        m.paymentMethod,

      notes:
        m.notes,

      created_by:
        state.user.id,

      updated_by:
        state.user.id
    };

    const {
      data,
      error
    } =
      await client
        .from(
          'movements'
        )
        .insert(
          payload
        )
        .select('*')
        .single();

    if (error) {
      throw error;
    }

    return mapMovement(
      data
    );
  }

  async function updateMovement(
    m
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      isAccessDenied()
    ) {
      throw new Error(
        'Acceso no autorizado.'
      );
    }

    const existing =
      state.movements.find(
        x =>
          x.id === m.id
      ) ||
      m;

    if (
      !canEditMovement(
        existing
      )
    ) {
      throw new Error(
        'No tiene permiso para editar este movimiento.'
      );
    }

    const payload = {
      movement_date:
        m.date,

      movement_type:
        m.type,

      category:
        m.category,

      concept:
        m.concept,

      quantity:
        m.quantity,

      unit:
        m.unit,

      unit_price:
        m.unitPrice,

      total:
        m.total,

      party:
        m.party,

      payment_method:
        m.paymentMethod,

      notes:
        m.notes,

      updated_by:
        state.user.id
    };

    const {
      data,
      error
    } =
      await client
        .from(
          'movements'
        )
        .update(
          payload
        )
        .eq(
          'id',
          m.id
        )
        .select('*')
        .single();

    if (error) {
      throw error;
    }

    return mapMovement(
      data
    );
  }

  async function deleteMovement(
    id
  ) {
    const movement =
      state.movements.find(
        m =>
          m.id === id
      );

    if (
      !movement
    ) {
      throw new Error(
        'Movimiento no encontrado.'
      );
    }

    if (
      !canDeleteMovement(
        movement.businessId
      )
    ) {
      throw new Error(
        'Solo el administrador puede eliminar movimientos.'
      );
    }

    const {
      error
    } =
      await client
        .from(
          'movements'
        )
        .delete()
        .eq(
          'id',
          id
        );

    if (error) {
      throw error;
    }
  }

  /* =========================================================
     AGENDA / PLAN DE LABORES - V1.4.0
     ========================================================= */

  async function createTask(task) {
    if (!state.user) throw new Error('Inicie sesión');
    if (isAccessDenied()) throw new Error('Acceso no autorizado.');
    if (!canAddTask(task.businessId)) {
      throw new Error('No tiene permiso para agregar tareas en este negocio.');
    }

    const payload = {
      business_id: task.businessId,
      title: String(task.title || '').trim(),
      description: task.description || null,
      task_type: task.taskType || null,
      scheduled_date: task.scheduledDate,
      status: task.status || 'pending',
      priority: task.priority || 'normal',
      recurrence_days: task.recurrenceDays === '' || task.recurrenceDays == null ? null : Number(task.recurrenceDays),
      completed_at: task.completedAt || null,
      reference_date: task.referenceDate || null,
      relative_day: task.relativeDay === '' || task.relativeDay == null ? null : Number(task.relativeDay),
      created_by: state.user.id,
      updated_by: state.user.id
    };

    if (!payload.title) throw new Error('La tarea necesita un título.');
    if (!payload.scheduled_date) throw new Error('La tarea necesita una fecha programada.');

    const { data, error } = await client.from('business_tasks').insert(payload).select('*').single();
    if (error) throw error;
    const mapped = mapTask(data);
    state.tasks.push(mapped);
    return mapped;
  }

  async function updateTask(task) {
    if (!state.user) throw new Error('Inicie sesión');
    if (isAccessDenied()) throw new Error('Acceso no autorizado.');

    const existing = state.tasks.find(x => x.id === task.id) || task;
    if (!canEditTask(existing)) throw new Error('No tiene permiso para editar esta tarea.');

    const status = task.status || existing.status || 'pending';
    const payload = {
      title: String(task.title || '').trim(),
      description: task.description || null,
      task_type: task.taskType || null,
      scheduled_date: task.scheduledDate,
      status,
      priority: task.priority || 'normal',
      recurrence_days: task.recurrenceDays === '' || task.recurrenceDays == null ? null : Number(task.recurrenceDays),
      completed_at: status === 'completed' ? (task.completedAt || existing.completedAt || new Date().toISOString()) : null,
      reference_date: task.referenceDate || null,
      relative_day: task.relativeDay === '' || task.relativeDay == null ? null : Number(task.relativeDay),
      updated_by: state.user.id
    };

    if (!payload.title) throw new Error('La tarea necesita un título.');
    if (!payload.scheduled_date) throw new Error('La tarea necesita una fecha programada.');

    const { data, error } = await client.from('business_tasks').update(payload).eq('id', task.id).select('*').single();
    if (error) throw error;
    const mapped = mapTask(data);
    const i = state.tasks.findIndex(x => x.id === mapped.id);
    if (i >= 0) state.tasks[i] = mapped;
    return mapped;
  }

  async function deleteTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error('Tarea no encontrada.');
    if (!canDeleteTask(task.businessId)) {
      throw new Error('Solo el administrador puede eliminar tareas.');
    }
    const { error } = await client.from('business_tasks').delete().eq('id', id);
    if (error) throw error;
    state.tasks = state.tasks.filter(t => t.id !== id);
  }

  /* =========================================================
     GENERAR ENLACE
     ========================================================= */

  async function generateAccessLink(
    businessId,
    role = 'collaborator'
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      !canAdminBusiness(
        businessId
      )
    ) {
      throw new Error(
        'Solo el administrador puede generar enlaces de acceso.'
      );
    }

    const safeRole =
      'collaborator';

    const token =
      randomToken();

    const tokenHash =
      await sha256Hex(
        token
      );

    const {
      data,
      error
    } =
      await client
        .from(
          'access_links'
        )
        .insert({
          business_id:
            businessId,

          created_by:
            state.user.id,

          token_hash:
            tokenHash,

          role:
            safeRole,

          active:
            true,

          max_uses:
            1,

          uses_count:
            0
        })
        .select(
          'id,created_at,role,active,max_uses,uses_count'
        )
        .single();

    if (error) {
      throw error;
    }

    const url =
      new URL(
        location.href
      );

    url.search =
      '';

    url.hash =
      '';

    url.searchParams.set(
      'access',
      token
    );

    return {
      ...data,

      url:
        url.toString()
    };
  }

  /* =========================================================
     LISTAR ENLACES
     ========================================================= */

  async function listAccessLinks(
    businessId
  ) {
    if (
      !canAdminBusiness(
        businessId
      )
    ) {
      throw new Error(
        'Solo el administrador puede consultar los enlaces de acceso.'
      );
    }

    const {
      data,
      error
    } =
      await client
        .from(
          'access_links'
        )
        .select(
          'id,role,active,expires_at,max_uses,uses_count,created_at'
        )
        .eq(
          'business_id',
          businessId
        )
        .order(
          'created_at',
          {
            ascending:
              false
          }
        );

    if (error) {
      throw error;
    }

    return (
      data ||
      []
    );
  }

  /* =========================================================
     REVOCAR ENLACE
     ========================================================= */

  async function revokeAccessLink(
    id
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    const {
      data:
        linkData,

      error:
        findError
    } =
      await client
        .from(
          'access_links'
        )
        .select(
          'id,business_id'
        )
        .eq(
          'id',
          id
        )
        .single();

    if (
      findError
    ) {
      throw findError;
    }

    if (
      !canAdminBusiness(
        linkData.business_id
      )
    ) {
      throw new Error(
        'Solo el administrador puede revocar enlaces de acceso.'
      );
    }

    const {
      error
    } =
      await client
        .from(
          'access_links'
        )
        .update({
          active:
            false
        })
        .eq(
          'id',
          id
        );

    if (error) {
      throw error;
    }
  }

  /* =========================================================
     REVOCAR COLABORADOR
     ========================================================= */

  async function revokeBusinessMember(
    businessId,
    userId
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      !canAdminBusiness(
        businessId
      )
    ) {
      throw new Error(
        'Solo el administrador puede revocar colaboradores.'
      );
    }

    const {
      data,
      error
    } =
      await client.rpc(
        'revoke_business_member',
        {
          p_business_id:
            businessId,

          p_user_id:
            userId
        }
      );

    if (error) {
      throw error;
    }

    const member =
      state.members.find(
        m =>
          m.business_id ===
            businessId &&
          m.user_id ===
            userId
      );

    if (member) {
      member.active =
        false;
    }

    return data;
  }

  /* =========================================================
     REACTIVAR COLABORADOR
     ========================================================= */

  async function reactivateBusinessMember(
    businessId,
    userId
  ) {
    if (
      !state.user
    ) {
      throw new Error(
        'Inicie sesión'
      );
    }

    if (
      !canAdminBusiness(
        businessId
      )
    ) {
      throw new Error(
        'Solo el administrador puede reactivar colaboradores.'
      );
    }

    const {
      data,
      error
    } =
      await client.rpc(
        'reactivate_business_member',
        {
          p_business_id:
            businessId,

          p_user_id:
            userId
        }
      );

    if (error) {
      throw error;
    }

    const member =
      state.members.find(
        m =>
          m.business_id ===
            businessId &&
          m.user_id ===
            userId
      );

    if (member) {
      member.active =
        true;
    }

    return data;
  }

  /* =========================================================
     MIGRACIÓN LOCAL
     ========================================================= */

  async function migrateLocal(
    localBusinesses,
    localMovements
  ) {
    if (
      !state.user ||
      state.user.is_anonymous
    ) {
      throw new Error(
        'Solo el administrador puede migrar datos locales'
      );
    }

    const map =
      new Map();

    for (
      const b
      of localBusinesses
    ) {
      const cloudB =
        await createBusiness({
          name:
            b.name,

          type:
            b.type,

          description:
            b.description ||
            ''
        });

      map.set(
        b.id,
        cloudB.id
      );
    }

    for (
      const m
      of localMovements
    ) {
      const businessId =
        map.get(
          m.businessId
        );

      if (
        !businessId
      ) {
        continue;
      }

      await createMovement({
        ...m,

        id:
          undefined,

        businessId
      });
    }

    return map;
  }

  /* =========================================================
     API GLOBAL
     ========================================================= */

  window.MGCloud = {
    client,
    state,

    init,

    signIn,
    signUp,
    resetPasswordForEmail,
    updatePassword,
    signOut,

    fetchData,

    createBusiness,
    deleteBusiness,

    createMovement,
    updateMovement,
    deleteMovement,

    createTask,
    updateTask,
    deleteTask,

    generateAccessLink,
    listAccessLinks,
    revokeAccessLink,

    revokeBusinessMember,
    reactivateBusinessMember,

    migrateLocal,

    roleForBusiness,
    canCreateBusiness,
    canAddMovement,
    canEditMovement,
    canDeleteMovement,
    canAdminBusiness,

    canAddTask,
    canEditTask,
    canDeleteTask,

    currentUserId,

    /*
      Nuevas funciones V1.3.5
    */
    getAccessGate,
    isAccessDenied,
    isAccessPending
  };

})();
