// ============================================================
// AULA — App Logic
// Firebase Auth + Firestore (real-time)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============ FIREBASE CONFIG ============
const firebaseConfig = {
  apiKey: "AIzaSyC7KCyzUCYtsE0S4exyDuhMnedRoqJVSyA",
  authDomain: "my-web-11fc4.firebaseapp.com",
  projectId: "my-web-11fc4",
  storageBucket: "my-web-11fc4.firebasestorage.app",
  messagingSenderId: "54023141783",
  appId: "1:54023141783:web:e3c93ed9de1a8187c96cd2",
  measurementId: "G-KV1QDZ7QQP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============ APP STATE ============
const state = {
  user: null,         // firebase user
  profile: null,      // firestore user doc { name, email, role }
  materials: [],      // [{ id, name, teacher, color }]
  tasks: [],          // [{ id, title, ... }]
  requests: [],       // [{ id, taskId, proposed, reason, status, ... }]
  users: [],          // admin-only
  filter: 'all',      // 'all' | materialId
  search: '',
  view: 'tareas',
  doneTasks: new Set(),  // local-only "completed by me"
  unsubs: []
};

// load local done state
try {
  const saved = JSON.parse(localStorage.getItem('aula_done') || '[]');
  state.doneTasks = new Set(saved);
} catch {}

const saveDone = () => {
  localStorage.setItem('aula_done', JSON.stringify([...state.doneTasks]));
};

// ============ HELPERS ============
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MATERIAL_COLORS = [
  '#ff5e3a', '#f5b800', '#5d6b3a', '#2d5d8f',
  '#6b2d5c', '#d97570', '#8aa37b', '#1a1814'
];

const toast = (msg, type = '') => {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => { el.className = 'toast'; }, 2800);
};

const fmtDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  const opts = { day: '2-digit', month: 'short' };
  return d.toLocaleDateString('es-ES', opts);
};

const daysUntil = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T12:00:00');
  due.setHours(0, 0, 0, 0);
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
};

const getDuePill = (dateStr) => {
  const d = daysUntil(dateStr);
  if (d < 0) return { cls: 'urgent', txt: 'Vencida' };
  if (d === 0) return { cls: 'today', txt: 'Hoy' };
  if (d === 1) return { cls: 'urgent', txt: 'Mañana' };
  if (d <= 2) return { cls: 'urgent', txt: `${d} días` };
  if (d <= 5) return { cls: 'warn', txt: `${d} días` };
  return { cls: '', txt: `${d} días` };
};

const initials = (name) => {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
};

const escapeHtml = (s) => {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
};

const isAdmin = () => state.profile?.role === 'admin' || state.profile?.role === 'presidente';
const isStrictAdmin = () => state.profile?.role === 'admin';

// ============ AUTH UI ============
const splash = $('#splash');
const authScreen = $('#auth-screen');
const appShell = $('#app');

const showAuth = () => {
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
};

const showApp = () => {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
};

// tab toggle
$$('.auth-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    $('#login-form').classList.toggle('hidden', which !== 'login');
    $('#register-form').classList.toggle('hidden', which !== 'register');
    $('#login-error').textContent = '';
    $('#register-error').textContent = '';
  });
});

// LOGIN
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#login-error');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  try {
    await signInWithEmailAndPassword(auth, fd.get('email'), fd.get('password'));
    // onAuthStateChanged se encargará del resto
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
});

// REGISTER
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#register-error');
  errEl.textContent = '';
  const fd = new FormData(e.target);
  const name = fd.get('name').trim();
  const email = fd.get('email').trim();
  const password = fd.get('password');

  try {
    // crear usuario
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });

    // determinar si es el primer usuario => admin
    const usersSnap = await getDocs(collection(db, 'users'));
    const isFirst = usersSnap.empty;
    const role = isFirst ? 'admin' : 'estudiante';

    await setDoc(doc(db, 'users', cred.user.uid), {
      name,
      email,
      role,
      createdAt: serverTimestamp()
    });

    if (isFirst) {
      toast('¡Bienvenido! Eres el administrador del curso.', 'success');
    } else {
      toast('Cuenta creada. ¡Bienvenido!', 'success');
    }
  } catch (err) {
    errEl.textContent = friendlyAuthError(err);
  }
});

function friendlyAuthError(err) {
  const code = err?.code || '';
  if (code.includes('email-already-in-use')) return 'Ese correo ya está registrado.';
  if (code.includes('invalid-email')) return 'Correo no válido.';
  if (code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Correo o contraseña incorrectos.';
  if (code.includes('user-not-found')) return 'No existe una cuenta con ese correo.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera un momento.';
  if (code.includes('network')) return 'Sin conexión. Revisa tu internet.';
  return err?.message || 'Algo salió mal. Intenta de nuevo.';
}

// LOGOUT
$('#logout-btn').addEventListener('click', async () => {
  await signOut(auth);
});

// AUTH STATE
onAuthStateChanged(auth, async (user) => {
  splash.classList.add('fade');
  setTimeout(() => splash.classList.add('hidden'), 400);

  // limpiar suscripciones previas
  state.unsubs.forEach(u => u && u());
  state.unsubs = [];

  if (!user) {
    state.user = null;
    state.profile = null;
    showAuth();
    return;
  }

  state.user = user;

  // cargar perfil
  const profileDoc = await getDoc(doc(db, 'users', user.uid));
  if (!profileDoc.exists()) {
    // auto-crear si no existe (caso edge)
    const usersSnap = await getDocs(collection(db, 'users'));
    const isFirst = usersSnap.empty;
    const profileData = {
      name: user.displayName || user.email.split('@')[0],
      email: user.email,
      role: isFirst ? 'admin' : 'estudiante',
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, 'users', user.uid), profileData);
    state.profile = profileData;
  } else {
    state.profile = profileDoc.data();
  }

  showApp();
  hydrateUserUI();
  subscribeAll();
});

// ============ USER UI ============
function hydrateUserUI() {
  $('#user-name').textContent = state.profile.name;
  $('#user-mail').textContent = state.profile.email;
  $('#user-avatar').textContent = initials(state.profile.name);

  const roleChip = $('#role-chip');
  roleChip.textContent = state.profile.role;
  roleChip.dataset.role = state.profile.role;

  // mostrar/ocultar admin-only
  const adminVisible = isAdmin();
  $$('.admin-only').forEach(el => { el.hidden = !adminVisible; });
  $$('.non-admin-only').forEach(el => { el.hidden = adminVisible; });
}

// ============ NAV ============
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(viewName) {
  state.view = viewName;
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== viewName));
  if (viewName === 'usuarios') renderUsers();
}

// ============ FIRESTORE SUBSCRIPTIONS ============
function subscribeAll() {
  // Materials
  const matQ = query(collection(db, 'materials'), orderBy('name'));
  state.unsubs.push(onSnapshot(matQ, snap => {
    state.materials = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMaterials();
    renderMaterialChips();
    renderMaterialSelects();
    renderTasks();
    updateStats();
  }));

  // Tasks
  const tasksQ = query(collection(db, 'tasks'), orderBy('dueDate'));
  state.unsubs.push(onSnapshot(tasksQ, async snap => {
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // auto-borrar las vencidas (>1 día pasada la fecha) en cliente
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const toDelete = tasks.filter(t => {
      if (!t.dueDate) return false;
      const due = new Date(t.dueDate + 'T12:00:00');
      due.setHours(0, 0, 0, 0);
      const diff = (now - due) / (1000 * 60 * 60 * 24);
      return diff > 1; // pasó más de 1 día desde el vencimiento
    });
    // borrar (cualquier user lo intenta; con reglas Firestore solo admin/autor podría)
    // pero como las reglas son abiertas por defecto, basta con un client
    for (const t of toDelete) {
      try { await deleteDoc(doc(db, 'tasks', t.id)); } catch {}
    }

    state.tasks = tasks.filter(t => !toDelete.find(x => x.id === t.id));
    renderTasks();
    updateStats();
  }));

  // Edit requests
  const reqQ = query(collection(db, 'editRequests'), orderBy('createdAt', 'desc'));
  state.unsubs.push(onSnapshot(reqQ, snap => {
    state.requests = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.status === 'pending');
    renderRequests();
    updateReqBadge();
  }));

  // Users (siempre, para mostrar autor)
  const usersQ = query(collection(db, 'users'), orderBy('name'));
  state.unsubs.push(onSnapshot(usersQ, snap => {
    state.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.view === 'usuarios') renderUsers();
    renderTasks(); // por si cambian nombres
  }));
}

// ============ MATERIALS ============
function renderMaterials() {
  const grid = $('#materials-grid');
  const empty = $('#materials-empty');
  if (state.materials.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = state.materials.map(m => {
    const count = state.tasks.filter(t => t.materialId === m.id).length;
    return `
      <div class="mat-card" style="--mat-color: ${m.color}">
        <div class="mat-color-strip" style="background: ${m.color}"></div>
        <div class="mat-name">${escapeHtml(m.name)}</div>
        <div class="mat-teacher">${escapeHtml(m.teacher || 'Sin profesor asignado')}</div>
        <div class="mat-count"><strong>${count}</strong> tareas activas</div>
        ${isAdmin() ? `
        <div class="mat-actions">
          <button class="btn-danger" data-del-mat="${m.id}">Eliminar</button>
        </div>` : ''}
      </div>
    `;
  }).join('');

  // delete handlers
  $$('[data-del-mat]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delMat;
      const hasTasks = state.tasks.some(t => t.materialId === id);
      if (hasTasks) {
        toast('No puedes eliminar una materia con tareas activas.', 'error');
        return;
      }
      if (!confirm('¿Eliminar esta materia?')) return;
      await deleteDoc(doc(db, 'materials', id));
      toast('Materia eliminada.');
    });
  });
}

function renderMaterialChips() {
  const wrap = $('#material-chips');
  wrap.innerHTML = state.materials.map(m => `
    <button class="chip ${state.filter === m.id ? 'chip-active' : ''}" data-filter="${m.id}">
      <span class="chip-dot" style="background: ${m.color}"></span>
      ${escapeHtml(m.name)}
    </button>
  `).join('');
}

function renderMaterialSelects() {
  ['#task-material', '#req-material'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    const current = el.value;
    el.innerHTML = '<option value="">— Selecciona —</option>' +
      state.materials.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    if (current) el.value = current;
  });
}

// new material modal
$('#new-material-btn').addEventListener('click', () => {
  const picker = $('#color-picker');
  picker.innerHTML = MATERIAL_COLORS.map((c, i) => `
    <div class="color-dot ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background: ${c}"></div>
  `).join('');
  $('#material-color').value = MATERIAL_COLORS[0];
  picker.addEventListener('click', (e) => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    $$('.color-dot', picker).forEach(d => d.classList.remove('selected'));
    dot.classList.add('selected');
    $('#material-color').value = dot.dataset.color;
  });
  openModal('material-modal');
});

$('#material-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await addDoc(collection(db, 'materials'), {
      name: fd.get('name').trim(),
      teacher: fd.get('teacher').trim(),
      color: fd.get('color'),
      createdAt: serverTimestamp(),
      createdBy: state.user.uid
    });
    closeModal('material-modal');
    e.target.reset();
    toast('Materia creada.', 'success');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// ============ TASKS ============
function renderTasks() {
  const list = $('#tasks-list');
  const empty = $('#tasks-empty');
  let tasks = state.tasks.slice();

  // filter
  if (state.filter !== 'all') {
    tasks = tasks.filter(t => t.materialId === state.filter);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    tasks = tasks.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.deliverTo || '').toLowerCase().includes(q)
    );
  }

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = tasks.map(t => {
    const mat = state.materials.find(m => m.id === t.materialId);
    const matColor = mat?.color || '#1a1814';
    const matName = mat?.name || 'Sin materia';
    const due = getDuePill(t.dueDate);
    const author = state.users.find(u => u.id === t.createdBy);
    const authorName = author?.name || t.createdByName || 'desconocido';
    const isDone = state.doneTasks.has(t.id);
    const formatIcon = t.format === 'digital'
      ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`
      : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

    return `
      <div class="task-card ${isDone ? 'done' : ''}" style="--mat-color: ${matColor}" data-task="${t.id}">
        <div class="task-check ${isDone ? 'checked' : ''}" data-check="${t.id}">
          ${isDone ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
        </div>
        <div class="task-body">
          <div class="task-meta-row">
            <span class="task-mat-tag" style="background: ${matColor}">${escapeHtml(matName)}</span>
            <span class="task-format">${formatIcon} ${t.format === 'digital' ? 'Digital' : 'Física'}</span>
            <span class="task-author">por ${escapeHtml(authorName)}</span>
          </div>
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-desc">${escapeHtml(t.description)}</div>` : ''}
          <div class="task-deliver">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(t.deliverTo || 'Sin especificar')}
          </div>
        </div>
        <div class="task-due">
          <div class="due-pill ${due.cls}">${due.txt}</div>
          <div class="due-date">${fmtDate(t.dueDate)}</div>
        </div>
        ${t.photo ? `<div class="task-photo-mini" style="background-image: url(${t.photo})"></div>` : ''}
      </div>
    `;
  }).join('');

  // click handlers
  $$('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-check]')) return;
      openTaskDetail(card.dataset.task);
    });
  });
  $$('[data-check]').forEach(c => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = c.dataset.check;
      if (state.doneTasks.has(id)) state.doneTasks.delete(id);
      else state.doneTasks.add(id);
      saveDone();
      renderTasks();
      updateStats();
    });
  });
}

// filter chips
$('#tasks-list').parentElement.querySelector('.filter-row').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  $$('.filter-row .chip').forEach(c => c.classList.toggle('chip-active', c.dataset.filter === state.filter));
  renderTasks();
});

// search
$('#search-input').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderTasks();
});

// stats
function updateStats() {
  $('#stat-total').textContent = state.tasks.length;
  const soon = state.tasks.filter(t => {
    const d = daysUntil(t.dueDate);
    return d >= 0 && d <= 2;
  }).length;
  $('#stat-soon').textContent = soon;
  $('#stat-done').textContent = [...state.doneTasks].filter(id => state.tasks.some(t => t.id === id)).length;
  $('#stat-mats').textContent = state.materials.length;
}

function updateReqBadge() {
  const badge = $('#req-badge');
  const n = state.requests.length;
  badge.textContent = n;
  badge.hidden = n === 0;
}

// ============ NEW/EDIT TASK MODAL ============
let taskEditingId = null;

$('#new-task-btn').addEventListener('click', () => {
  if (state.materials.length === 0) {
    toast('Primero el admin debe crear al menos una materia.', 'error');
    return;
  }
  openTaskModal(null);
});

function openTaskModal(taskId) {
  taskEditingId = taskId;
  const form = $('#task-form');
  form.reset();
  $('#task-photo-preview').innerHTML = '';
  $('#task-photo-preview').classList.remove('has-image');
  $('#task-error').textContent = '';
  $('#task-modal-title').textContent = taskId ? 'Editar tarea' : 'Nueva tarea';

  if (taskId) {
    const t = state.tasks.find(x => x.id === taskId);
    if (t) {
      form.title.value = t.title || '';
      form.materialId.value = t.materialId || '';
      form.dueDate.value = t.dueDate || '';
      form.description.value = t.description || '';
      form.deliverTo.value = t.deliverTo || '';
      form.format.value = t.format || 'digital';
      const radio = form.querySelector(`input[name="format"][value="${t.format || 'digital'}"]`);
      if (radio) radio.checked = true;
      if (t.photo) {
        $('#task-photo-preview').innerHTML = `<img src="${t.photo}" alt="Preview">`;
        $('#task-photo-preview').classList.add('has-image');
      }
    }
  } else {
    // por defecto, fecha mínima = hoy
    const today = new Date().toISOString().split('T')[0];
    $('#task-due').min = today;
  }
  openModal('task-modal');
}

// photo handling — convert to base64 with compression
$('#task-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) {
    $('#task-photo-preview').innerHTML = '';
    $('#task-photo-preview').classList.remove('has-image');
    return;
  }
  try {
    const dataUrl = await compressImage(file, 1024, 0.7);
    $('#task-photo-preview').innerHTML = `<img src="${dataUrl}" alt="Preview">`;
    $('#task-photo-preview').classList.add('has-image');
    $('#task-photo-preview').dataset.value = dataUrl;
  } catch (err) {
    toast('No se pudo procesar la imagen.', 'error');
  }
});

async function compressImage(file, maxDim = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else if (height > maxDim) {
          width = (width / height) * maxDim;
          height = maxDim;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// submit task
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = $('#task-error');
  errEl.textContent = '';

  const preview = $('#task-photo-preview');
  const photoData = preview.dataset.value || (state.tasks.find(t => t.id === taskEditingId)?.photo || null);

  // verificar tamaño de imagen
  if (photoData && photoData.length > 900_000) {
    errEl.textContent = 'La imagen es demasiado grande. Usa una más pequeña.';
    return;
  }

  const data = {
    title: fd.get('title').trim(),
    materialId: fd.get('materialId'),
    dueDate: fd.get('dueDate'),
    description: fd.get('description').trim(),
    format: fd.get('format'),
    deliverTo: fd.get('deliverTo').trim(),
    photo: photoData,
  };

  if (!data.title || !data.materialId || !data.dueDate) {
    errEl.textContent = 'Completa todos los campos requeridos.';
    return;
  }

  try {
    $('#task-submit').disabled = true;
    if (taskEditingId) {
      data.updatedAt = serverTimestamp();
      await updateDoc(doc(db, 'tasks', taskEditingId), data);
      toast('Tarea actualizada.', 'success');
    } else {
      data.createdAt = serverTimestamp();
      data.createdBy = state.user.uid;
      data.createdByName = state.profile.name;
      data.comments = [];
      await addDoc(collection(db, 'tasks'), data);
      toast('Tarea publicada.', 'success');
    }
    closeModal('task-modal');
    delete preview.dataset.value;
  } catch (err) {
    errEl.textContent = 'Error: ' + err.message;
  } finally {
    $('#task-submit').disabled = false;
  }
});

// ============ TASK DETAIL ============
let detailTaskId = null;

function openTaskDetail(taskId) {
  detailTaskId = taskId;
  renderTaskDetail();
  openModal('detail-modal');
}

function renderTaskDetail() {
  const t = state.tasks.find(x => x.id === detailTaskId);
  if (!t) { closeModal('detail-modal'); return; }
  const mat = state.materials.find(m => m.id === t.materialId);
  const author = state.users.find(u => u.id === t.createdBy);
  const authorName = author?.name || t.createdByName || 'desconocido';
  const canEditDirect = isAdmin() || t.createdBy === state.user.uid;
  const comments = t.comments || [];

  $('#detail-title').textContent = t.title;

  $('#detail-body').innerHTML = `
    <div class="detail-hero">
      <span class="task-mat-tag" style="background: ${mat?.color || '#1a1814'}">${escapeHtml(mat?.name || 'Sin materia')}</span>
      <span class="task-format">${t.format === 'digital' ? '💻 Digital' : '📄 Física'}</span>
      <span class="task-author">por ${escapeHtml(authorName)}</span>
    </div>

    ${t.photo ? `<img src="${t.photo}" alt="Foto" class="detail-photo">` : ''}

    <div class="detail-grid">
      <div class="detail-item">
        <div class="label">Fecha de entrega</div>
        <div class="value">${fmtDate(t.dueDate)} <span style="color:var(--ink-soft);font-size:12px;">(${getDuePill(t.dueDate).txt})</span></div>
      </div>
      <div class="detail-item">
        <div class="label">Dónde entregar</div>
        <div class="value">${escapeHtml(t.deliverTo || '—')}</div>
      </div>
    </div>

    ${t.description ? `<div class="detail-desc">${escapeHtml(t.description)}</div>` : ''}

    <div class="comments-section">
      <div class="comments-head">Comentarios (${comments.length})</div>
      <div class="comment-list">
        ${comments.length === 0 ? `<div style="color:var(--ink-soft);font-size:13px;font-style:italic;">Aún no hay comentarios. Sé el primero.</div>` : comments.map(c => `
          <div class="comment">
            <div class="comment-meta">
              <span>${escapeHtml(c.authorName || 'anónimo')}</span>
              <span>${c.at ? new Date(c.at).toLocaleString('es-ES', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) : ''}</span>
            </div>
            <div>${escapeHtml(c.text)}</div>
          </div>
        `).join('')}
      </div>
      <form class="comment-form" id="comment-form">
        <input type="text" name="text" placeholder="Escribe un comentario…" maxlength="300" required/>
        <button class="btn-primary" type="submit" style="padding: 10px 14px;">Enviar</button>
      </form>
    </div>

    <div class="detail-actions">
      <div>
        ${canEditDirect ? `<button class="btn-danger" id="detail-delete">Eliminar</button>` : ''}
      </div>
      <div style="display:flex;gap:10px;">
        ${canEditDirect
          ? `<button class="btn-ghost" id="detail-edit">Editar</button>`
          : `<button class="btn-ghost" id="detail-request-edit">Solicitar edición</button>`
        }
      </div>
    </div>
  `;

  // wire up
  $('#comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await updateDoc(doc(db, 'tasks', t.id), {
        comments: arrayUnion({
          text,
          authorId: state.user.uid,
          authorName: state.profile.name,
          at: Date.now()
        })
      });
      e.target.reset();
      // detail rerendering vendrá del snapshot
      setTimeout(renderTaskDetail, 200);
    } catch (err) {
      toast('No se pudo comentar.', 'error');
    }
  });

  if (canEditDirect) {
    $('#detail-edit')?.addEventListener('click', () => {
      closeModal('detail-modal');
      openTaskModal(t.id);
    });
    $('#detail-delete')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta tarea? No se puede deshacer.')) return;
      try {
        await deleteDoc(doc(db, 'tasks', t.id));
        closeModal('detail-modal');
        toast('Tarea eliminada.');
      } catch (err) {
        toast('Error al eliminar.', 'error');
      }
    });
  } else {
    $('#detail-request-edit')?.addEventListener('click', () => {
      openEditRequest(t);
    });
  }
}

// ============ EDIT REQUEST ============
let editReqTask = null;

function openEditRequest(t) {
  editReqTask = t;
  closeModal('detail-modal');
  const form = $('#edit-request-form');
  form.reset();
  form.title.value = t.title || '';
  form.materialId.value = t.materialId || '';
  form.dueDate.value = t.dueDate || '';
  form.description.value = t.description || '';
  form.deliverTo.value = t.deliverTo || '';
  const radio = form.querySelector(`input[name="format"][value="${t.format || 'digital'}"]`);
  if (radio) radio.checked = true;
  openModal('edit-request-modal');
}

$('#edit-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const proposed = {
    title: fd.get('title').trim(),
    materialId: fd.get('materialId'),
    dueDate: fd.get('dueDate'),
    description: fd.get('description').trim(),
    format: fd.get('format'),
    deliverTo: fd.get('deliverTo').trim(),
  };

  try {
    await addDoc(collection(db, 'editRequests'), {
      taskId: editReqTask.id,
      taskTitle: editReqTask.title,
      original: {
        title: editReqTask.title,
        materialId: editReqTask.materialId,
        dueDate: editReqTask.dueDate,
        description: editReqTask.description || '',
        format: editReqTask.format,
        deliverTo: editReqTask.deliverTo,
      },
      proposed,
      reason: fd.get('reason').trim(),
      requestedBy: state.user.uid,
      requestedByName: state.profile.name,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    closeModal('edit-request-modal');
    toast('Solicitud enviada. Espera la aprobación del admin.', 'success');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
});

// ============ REQUESTS VIEW ============
function renderRequests() {
  const list = $('#requests-list');
  const empty = $('#requests-empty');
  if (state.requests.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = state.requests.map(r => {
    const matOld = state.materials.find(m => m.id === r.original.materialId);
    const matNew = state.materials.find(m => m.id === r.proposed.materialId);
    const fields = [
      ['Título', r.original.title, r.proposed.title],
      ['Materia', matOld?.name || '—', matNew?.name || '—'],
      ['Fecha', fmtDate(r.original.dueDate), fmtDate(r.proposed.dueDate)],
      ['Formato', r.original.format, r.proposed.format],
      ['Entregar en', r.original.deliverTo, r.proposed.deliverTo],
      ['Descripción', r.original.description || '—', r.proposed.description || '—'],
    ];
    return `
      <div class="request-card">
        <div class="req-head">
          <div>
            <div class="req-title">${escapeHtml(r.taskTitle)}</div>
            <div class="req-meta">solicitado por ${escapeHtml(r.requestedByName)}</div>
          </div>
        </div>
        <div class="req-diff">
          ${fields.map(([label, oldV, newV]) => {
            const changed = oldV !== newV;
            return `
              <div class="diff-row">
                <div class="diff-label">${label}</div>
                ${changed
                  ? `<div class="diff-old">${escapeHtml(oldV)}</div><div class="diff-new">${escapeHtml(newV)}</div>`
                  : `<div class="diff-same">${escapeHtml(oldV)} <span style="opacity:0.5;">(sin cambios)</span></div>`
                }
              </div>
            `;
          }).join('')}
        </div>
        <div class="req-reason">"${escapeHtml(r.reason)}"</div>
        ${isAdmin() ? `
        <div class="req-actions">
          <button class="btn-reject" data-reject="${r.id}">Rechazar</button>
          <button class="btn-approve" data-approve="${r.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            Aprobar
          </button>
        </div>` : `<div style="text-align:right;font-size:12px;color:var(--ink-soft);">Pendiente de revisión del admin</div>`}
      </div>
    `;
  }).join('');

  $$('[data-approve]').forEach(b => b.addEventListener('click', () => approveRequest(b.dataset.approve)));
  $$('[data-reject]').forEach(b => b.addEventListener('click', () => rejectRequest(b.dataset.reject)));
}

async function approveRequest(reqId) {
  const r = state.requests.find(x => x.id === reqId);
  if (!r) return;
  try {
    // aplicar cambios a la tarea
    await updateDoc(doc(db, 'tasks', r.taskId), {
      title: r.proposed.title,
      materialId: r.proposed.materialId,
      dueDate: r.proposed.dueDate,
      description: r.proposed.description,
      format: r.proposed.format,
      deliverTo: r.proposed.deliverTo,
      updatedAt: serverTimestamp(),
      lastEditedBy: r.requestedBy,
      lastEditedByName: r.requestedByName,
    });
    await updateDoc(doc(db, 'editRequests', reqId), {
      status: 'approved',
      resolvedAt: serverTimestamp(),
      resolvedBy: state.user.uid,
    });
    toast('Solicitud aprobada. Tarea actualizada.', 'success');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function rejectRequest(reqId) {
  if (!confirm('¿Rechazar esta solicitud?')) return;
  try {
    await updateDoc(doc(db, 'editRequests', reqId), {
      status: 'rejected',
      resolvedAt: serverTimestamp(),
      resolvedBy: state.user.uid,
    });
    toast('Solicitud rechazada.');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ============ USERS VIEW ============
function renderUsers() {
  const list = $('#users-list');
  list.innerHTML = state.users.map(u => {
    const isSelf = u.id === state.user.uid;
    const canChangeRole = isStrictAdmin() && !isSelf;
    return `
      <div class="user-card">
        <div class="avatar">${initials(u.name)}</div>
        <div class="user-info">
          <h4>${escapeHtml(u.name)} ${isSelf ? '<span style="font-size:11px;color:var(--ink-soft);font-weight:400;">(tú)</span>' : ''}</h4>
          <p>${escapeHtml(u.email)}</p>
        </div>
        ${canChangeRole ? `
          <select data-role-user="${u.id}">
            <option value="estudiante" ${u.role === 'estudiante' ? 'selected' : ''}>Estudiante</option>
            <option value="presidente" ${u.role === 'presidente' ? 'selected' : ''}>Presidente</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        ` : `<span class="role-chip" data-role="${u.role}">${u.role}</span>`}
      </div>
    `;
  }).join('');

  $$('[data-role-user]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const uid = sel.dataset.roleUser;
      const newRole = sel.value;
      try {
        await updateDoc(doc(db, 'users', uid), { role: newRole });
        toast('Rol actualizado.', 'success');
      } catch (err) {
        toast('Error: ' + err.message, 'error');
      }
    });
  });
}

// ============ MODAL HELPERS ============
function openModal(id) {
  const m = document.getElementById(id);
  m.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const m = document.getElementById(id);
  m.classList.add('hidden');
  document.body.style.overflow = '';
}
$$('[data-close-modal]').forEach(b => {
  b.addEventListener('click', () => closeModal(b.dataset.closeModal));
});
$$('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', () => {
    const modal = bd.closest('.modal');
    if (modal) closeModal(modal.id);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal:not(.hidden)').forEach(m => closeModal(m.id));
  }
});

// ============ NOTIFICATIONS (browser) ============
function maybeNotifySoon() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return;

  const lastNotif = JSON.parse(localStorage.getItem('aula_notif') || '{}');
  const now = Date.now();
  state.tasks.forEach(t => {
    const d = daysUntil(t.dueDate);
    if (d >= 0 && d <= 1 && !state.doneTasks.has(t.id)) {
      const key = `${t.id}_${d}`;
      if (!lastNotif[key] || (now - lastNotif[key]) > 12 * 60 * 60 * 1000) {
        try {
          new Notification('📚 Tarea próxima a vencer', {
            body: `${t.title} — ${d === 0 ? 'vence hoy' : 'vence mañana'}`,
            tag: t.id,
          });
          lastNotif[key] = now;
        } catch {}
      }
    }
  });
  localStorage.setItem('aula_notif', JSON.stringify(lastNotif));
}

// chequear notificaciones cada 60s
setInterval(() => {
  if (state.user) maybeNotifySoon();
}, 60_000);
// también al cargar
setTimeout(() => { if (state.user) maybeNotifySoon(); }, 5_000);
