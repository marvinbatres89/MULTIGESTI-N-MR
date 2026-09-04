(() => {
  'use strict';

  const SUPABASE_URL = 'https://nbnrktcvpuzlqdjqziky.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ry-zp0PyMU1-p6hKXGz9IQ_d_mLddpCAPI';

  if (!window.supabase?.createClient) {
    console.error('Supabase JS no está disponible');
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const state = {
    session: null,
    user: null,
    members: [],
    businesses: [],
    movements: [],
    sharedLinkMode: false,
    initialized: false
  };

  const mapBusiness = b => ({
    id: b.id,
    name: b.name,
    type: b.activity || '',
    description: b.description || '',
    ownerId: b.owner_id,
    active: b.active,
    createdAt: b.created_at ? new Date(b.created_at).getTime() : Date.now(),
    updatedAt: b.updated_at ? new Date(b.updated_at).getTime() : undefined,
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
    createdAt: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
    updatedAt: m.updated_at ? new Date(m.updated_at).getTime() : undefined,
    cloud: true
  });

  function currentUserId() { return state.user?.id || null; }

  function roleForBusiness(businessId) {
    const b = state.businesses.find(x => x.id === businessId);
    if (b?.ownerId && b.ownerId === currentUserId()) return 'admin';
    return state.members.find(m => m.business_id === businessId && m.user_id === currentUserId() && m.active)?.role || null;
  }

  function canCreateBusiness() {
    return !!state.user && !state.user.is_anonymous;
  }

  function canAddMovement(businessId) {
    return ['admin', 'collaborator'].includes(roleForBusiness(businessId));
  }

  function canEditMovement(movement) {
    const role = roleForBusiness(movement.businessId);
    return role === 'admin' || (role === 'collaborator' && movement.createdBy === currentUserId());
  }

  function canDeleteMovement(businessId) { return roleForBusiness(businessId) === 'admin'; }
  function canAdminBusiness(businessId) { return roleForBusiness(businessId) === 'admin'; }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function randomToken() {
    const a = new Uint8Array(32);
    crypto.getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function redeemSharedLinkIfPresent() {
    const url = new URL(location.href);
    const token = url.searchParams.get('access');
    if (!token) return;
    state.sharedLinkMode = true;

    let { data: { session } } = await client.auth.getSession();
    if (!session) {
      const { data, error } = await client.auth.signInAnonymously({ options: { data: { display_name: 'Colaborador' } } });
      if (error) throw error;
      session = data.session;
    }

    const { error } = await client.rpc('redeem_access_link', { p_token: token });
    if (error && !String(error.message || '').includes('already')) throw error;

    url.searchParams.delete('access');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function init() {
    if (state.initialized) return state;
    await redeemSharedLinkIfPresent();
    const { data } = await client.auth.getSession();
    state.session = data.session || null;
    state.user = state.session?.user || null;
    state.initialized = true;
    client.auth.onAuthStateChange((_event, session) => {
      state.session = session || null;
      state.user = session?.user || null;
      window.dispatchEvent(new CustomEvent('mg-auth-changed'));
    });
    return state;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.session = data.session;
    state.user = data.user;
    return data;
  }

  async function signUp(email, password, displayName) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || 'Administrador' } }
    });
    if (error) throw error;
    state.session = data.session || null;
    state.user = data.user || null;
    return data;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    state.session = null;
    state.user = null;
    state.members = [];
    state.businesses = [];
    state.movements = [];
  }

  async function fetchData() {
    if (!state.user) return { businesses: [], movements: [] };
    const [bRes, mRes, memberRes] = await Promise.all([
      client.from('businesses').select('*').eq('active', true).order('created_at', { ascending: true }),
      client.from('movements').select('*').order('movement_date', { ascending: false }).order('created_at', { ascending: false }),
      client.from('business_members').select('business_id,user_id,role,active')
    ]);
    if (bRes.error) throw bRes.error;
    if (mRes.error) throw mRes.error;
    if (memberRes.error) throw memberRes.error;
    state.businesses = (bRes.data || []).map(mapBusiness);
    state.movements = (mRes.data || []).map(mapMovement);
    state.members = memberRes.data || [];
    return { businesses: state.businesses, movements: state.movements };
  }

  async function createBusiness({ name, type, description }) {
    if (!state.user) throw new Error('Inicie sesión');
    const { data, error } = await client.from('businesses').insert({
      name,
      activity: type,
      description,
      owner_id: state.user.id
    }).select('*').single();
    if (error) throw error;
    return mapBusiness(data);
  }

  async function deleteBusiness(id) {
    const { error } = await client.from('businesses').delete().eq('id', id);
    if (error) throw error;
  }

  async function createMovement(m) {
    if (!state.user) throw new Error('Inicie sesión');
    const payload = {
      business_id: m.businessId,
      movement_date: m.date,
      movement_type: m.type,
      category: m.category,
      concept: m.concept,
      quantity: m.quantity,
      unit: m.unit,
      unit_price: m.unitPrice,
      total: m.total,
      party: m.party,
      payment_method: m.paymentMethod,
      notes: m.notes,
      created_by: state.user.id,
      updated_by: state.user.id
    };
    const { data, error } = await client.from('movements').insert(payload).select('*').single();
    if (error) throw error;
    return mapMovement(data);
  }

  async function updateMovement(m) {
    if (!state.user) throw new Error('Inicie sesión');
    const payload = {
      movement_date: m.date,
      movement_type: m.type,
      category: m.category,
      concept: m.concept,
      quantity: m.quantity,
      unit: m.unit,
      unit_price: m.unitPrice,
      total: m.total,
      party: m.party,
      payment_method: m.paymentMethod,
      notes: m.notes,
      updated_by: state.user.id
    };
    const { data, error } = await client.from('movements').update(payload).eq('id', m.id).select('*').single();
    if (error) throw error;
    return mapMovement(data);
  }

  async function deleteMovement(id) {
    const { error } = await client.from('movements').delete().eq('id', id);
    if (error) throw error;
  }

  async function generateAccessLink(businessId, role = 'collaborator') {
    if (!state.user) throw new Error('Inicie sesión');
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const { data, error } = await client.from('access_links').insert({
      business_id: businessId,
      created_by: state.user.id,
      token_hash: tokenHash,
      role,
      active: true
    }).select('id,created_at,role,active').single();
    if (error) throw error;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('access', token);
    return { ...data, url: url.toString() };
  }

  async function listAccessLinks(businessId) {
    const { data, error } = await client.from('access_links').select('id,role,active,expires_at,max_uses,uses_count,created_at').eq('business_id', businessId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function revokeAccessLink(id) {
    const { error } = await client.from('access_links').update({ active: false }).eq('id', id);
    if (error) throw error;
  }

  async function migrateLocal(localBusinesses, localMovements) {
    if (!state.user || state.user.is_anonymous) throw new Error('Solo el administrador puede migrar datos locales');
    const map = new Map();
    for (const b of localBusinesses) {
      const cloudB = await createBusiness({ name: b.name, type: b.type, description: b.description || '' });
      map.set(b.id, cloudB.id);
    }
    for (const m of localMovements) {
      const businessId = map.get(m.businessId);
      if (!businessId) continue;
      await createMovement({ ...m, id: undefined, businessId });
    }
    return map;
  }

  window.MGCloud = {
    client,
    state,
    init,
    signIn,
    signUp,
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
