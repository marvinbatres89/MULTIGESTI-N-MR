(() => {
  'use strict';

  /* =========================================================
     MULTIGESTIÓN MR
     CLOUD.JS
     VERSIÓN 1.3.3

     SEGURIDAD DE ACCESO COMPARTIDO:
     - Enlaces vinculados a un negocio específico.
     - Un solo uso por enlace.
     - Solo administrador puede generar/revocar enlaces.
     - Colaborador anónimo no puede crear negocios.
     - Colaborador solo puede trabajar en negocios autorizados.
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

  const client = window.supabase.createClient(
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
    sharedLinkMode: false,
    initialized: false,
    recoveryMode: false
  };

  const mapBusiness = b => ({
    id: b.id,
    name: b.name,
    type: b.activity || '',
    description: b.description || '',
    ownerId: b.owner_id,
    active: b.active,
    createdAt: b.created_at
      ? new Date(b.created_at).getTime()
      : Date.now(),
    updatedAt: b.updated_at
      ? new Date(b.updated_at).getTime()
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
    quantity: Number(m.quantity || 0),
    unit: m.unit || '',
    unitPrice: Number(m.unit_price || 0),
    total: Number(m.total || 0),
    party: m.party || '',
    paymentMethod: m.payment_method || '',
    notes: m.notes || '',
    createdBy: m.created_by,
    updatedBy: m.updated_by,
    createdAt: m.created_at
      ? new Date(m.created_at).getTime()
      : Date.now(),
    updatedAt: m.updated_at
      ? new Date(m.updated_at).getTime()
      : undefined,
    cloud: true
  });

  function currentUserId() {
    return state.user?.id || null;
  }

  function roleForBusiness(businessId) {
    const b = state.businesses.find(
      x => x.id === businessId
    );

    if (
      b?.ownerId &&
      b.ownerId === currentUserId()
    ) {
      return 'admin';
    }

    return (
      state.members.find(
        m =>
          m.business_id === businessId &&
          m.user_id === currentUserId() &&
          m.active
      )?.role || null
    );
  }

  function canCreateBusiness() {
    return (
      !!state.user &&
      !state.user.is_anonymous
    );
  }

  function canAddMovement(businessId) {
    return [
      'admin',
      'collaborator'
    ].includes(
      roleForBusiness(businessId)
    );
  }

  function canEditMovement(movement) {
    const role =
      roleForBusiness(
        movement.businessId
      );

    return (
      role === 'admin' ||
      (
        role === 'collaborator' &&
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

  async function sha256Hex(text) {
    const data =
      new TextEncoder().encode(text);

    const digest =
      await crypto.subtle.digest(
        'SHA-256',
        data
      );

    return [
      ...new Uint8Array(digest)
    ]
      .map(
        b =>
          b
            .toString(16)
            .padStart(2, '0')
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
            .padStart(2, '0')
      )
      .join('');
  }

  function cleanAccessParameter() {
    const url =
      new URL(location.href);

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
      lower.includes('max')
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

  async function redeemSharedLinkIfPresent() {
    const url =
      new URL(location.href);

    const token =
      url.searchParams.get(
        'access'
      );

    if (!token) {
      return;
    }

    state.sharedLinkMode = true;

    try {
      let {
        data: {
          session
        }
      } =
        await client.auth.getSession();

      if (!session) {
        const {
          data,
          error
        } =
          await client.auth.signInAnonymously(
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
      }

      if (!session?.user) {
        throw new Error(
          'No fue posible iniciar la sesión del colaborador.'
        );
      }

      const {
        data,
        error
      } =
        await client.rpc(
          'redeem_access_link',
          {
            p_token: token
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

      cleanAccessParameter();

      window.dispatchEvent(
        new CustomEvent(
          'mg-shared-link-redeemed',
          {
            detail: {
              businessId: data
            }
          }
        )
      );

      return data;

    } catch (error) {
      cleanAccessParameter();

      const normalized =
        normalizeAccessError(
          error
        );

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

  async function init() {
    if (state.initialized) {
      return state;
    }

    /*
      Registrar el observador ANTES
      de leer la sesión.

      En enlaces de recuperación,
      Supabase puede emitir
      PASSWORD_RECOVERY durante
      el arranque.
    */
    client.auth.onAuthStateChange(
      (event, session) => {
        state.session =
          session || null;

        state.user =
          session?.user || null;

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

        window.dispatchEvent(
          new CustomEvent(
            'mg-auth-changed'
          )
        );
      }
    );

    await redeemSharedLinkIfPresent();

    const currentUrl =
      new URL(location.href);

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
      await client.auth.getSession();

    if (error) {
      throw error;
    }

    state.session =
      data.session || null;

    state.user =
      state.session?.user || null;

    state.initialized =
      true;

    /*
      Respaldo para navegadores
      donde PASSWORD_RECOVERY
      ocurrió antes de que la
      interfaz terminara de cargar.
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

  async function signIn(
    email,
    password
  ) {
    const {
      data,
      error
    } =
      await client.auth.signInWithPassword(
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
      await client.auth.signUp(
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
      data.session || null;

    state.user =
      data.user || null;

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
      await client.auth.resetPasswordForEmail(
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
      await client.auth.updateUser(
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
      await client.auth.signOut();

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

    state.sharedLinkMode =
      false;
  }

  async function fetchData() {
    if (!state.user) {
      return {
        businesses: [],
        movements: []
      };
    }

    const [
      bRes,
      mRes,
      memberRes
    ] =
      await Promise.all([
        client
          .from('businesses')
          .select('*')
          .eq(
            'active',
            true
          )
          .order(
            'created_at',
            {
              ascending: true
            }
          ),

        client
          .from('movements')
          .select('*')
          .order(
            'movement_date',
            {
              ascending: false
            }
          )
          .order(
            'created_at',
            {
              ascending: false
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

    if (bRes.error) {
      throw bRes.error;
    }

    if (mRes.error) {
      throw mRes.error;
    }

    if (memberRes.error) {
      throw memberRes.error;
    }

    state.businesses =
      (bRes.data || [])
        .map(mapBusiness);

    state.movements =
      (mRes.data || [])
        .map(mapMovement);

    state.members =
      memberRes.data || [];

    return {
      businesses:
        state.businesses,

      movements:
        state.movements
    };
  }

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

    if (!canCreateBusiness()) {
      throw new Error(
        'El colaborador no tiene permiso para crear negocios.'
      );
    }

    const {
      data,
      error
    } =
      await client
        .from('businesses')
        .insert({
          name,
          activity: type,
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
      mapBusiness(data);

    state.businesses.push(
      mapped
    );

    return mapped;
  }

  async function deleteBusiness(
    id
  ) {
    if (
      !canAdminBusiness(id)
    ) {
      throw new Error(
        'Solo el administrador puede eliminar este negocio.'
      );
    }

    const {
      error
    } =
      await client
        .from('businesses')
        .delete()
        .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async function createMovement(
    m
  ) {
    if (!state.user) {
      throw new Error(
        'Inicie sesión'
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
        .from('movements')
        .insert(payload)
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
    if (!state.user) {
      throw new Error(
        'Inicie sesión'
      );
    }

    const existing =
      state.movements.find(
        x => x.id === m.id
      ) || m;

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
        .from('movements')
        .update(payload)
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
        m => m.id === id
      );

    if (!movement) {
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
        .from('movements')
        .delete()
        .eq('id', id);

    if (error) {
      throw error;
    }
  }

  async function generateAccessLink(
    businessId,
    role = 'collaborator'
  ) {
    if (!state.user) {
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

    /*
      Seguridad:
      En esta versión solamente
      permitimos enlaces de
      COLABORADOR.
    */
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

          /*
            V1.3.3
            Cada enlace tiene
            UN SOLO USO.
          */
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

    /*
      Eliminar cualquier parámetro
      anterior antes de generar
      el enlace nuevo.
    */
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
            ascending: false
          }
        );

    if (error) {
      throw error;
    }

    return data || [];
  }

  async function revokeAccessLink(
    id
  ) {
    if (!state.user) {
      throw new Error(
        'Inicie sesión'
      );
    }

    /*
      Primero localizamos el enlace
      para conocer a qué negocio
      pertenece.
    */
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

    if (findError) {
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
          active: false
        })
        .eq(
          'id',
          id
        );

    if (error) {
      throw error;
    }
  }
async function revokeBusinessMember(businessId, userId) {
  if (!state.user) {
    throw new Error('Inicie sesión');
  }

  if (!canAdminBusiness(businessId)) {
    throw new Error('Solo el administrador puede revocar colaboradores.');
  }

  const { data, error } = await client.rpc(
    'revoke_business_member',
    {
      p_business_id: businessId,
      p_user_id: userId
    }
  );

  if (error) throw error;

  const member = state.members.find(
    m =>
      m.business_id === businessId &&
      m.user_id === userId
  );

  if (member) {
    member.active = false;
  }

  return data;
}

async function reactivateBusinessMember(businessId, userId) {
  if (!state.user) {
    throw new Error('Inicie sesión');
  }

  if (!canAdminBusiness(businessId)) {
    throw new Error('Solo el administrador puede reactivar colaboradores.');
  }

  const { data, error } = await client.rpc(
    'reactivate_business_member',
    {
      p_business_id: businessId,
      p_user_id: userId
    }
  );

  if (error) throw error;

  const member = state.members.find(
    m =>
      m.business_id === businessId &&
      m.user_id === userId
  );

  if (member) {
    member.active = true;
  }

  return data;
}
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
      const b of
      localBusinesses
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
      const m of
      localMovements
    ) {
      const businessId =
        map.get(
          m.businessId
        );

      if (!businessId) {
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

    currentUserId
  };

})();
