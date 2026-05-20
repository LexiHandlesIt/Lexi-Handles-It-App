'use strict';

/* ===== CONFIG ===== */
const FORMSPREE_URL = 'YOUR_FORM_ID'; // Replace with your Formspree endpoint

/* ===== STORAGE KEYS ===== */
const KEY_CO   = 'tq_co';
const KEY_PL   = 'tq_pl';
const KEY_SAVED = 'tq_saved';
const KEY_REF   = 'tq_refseq';
const KEY_INV   = 'tq_invseq';
const KEY_ONBOARDED    = 'tq_onboarded';
const KEY_PL_ONBOARDED = 'tq_pl_onboarded';

/* ===== DEFAULT COLOURS ===== */
const DEFAULT_COLOURS = { primary: '#7D5730', accent: '#6B7C5C', bg: '#F5F0E8' };

/* ===== STATE ===== */
let state = {
  company: {
    firstName: '', lastName: '', businessName: '',
    phone: '', email: '', website: '', address: '', postcode: '',
    logo: '',
    payMethods: [],
    bankAccHolder: '', bankName: '', bankSort: '', bankAcc: '',
    paypalRef: '', payOther: '',
    brandPrimary: DEFAULT_COLOURS.primary,
    brandAccent:  DEFAULT_COLOURS.accent,
    brandBg:      DEFAULT_COLOURS.bg
  },
  priceList: [],
  quote: {
    type: 'Estimate',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: '', validFor: '30', validCustom: '',
    ref: '',
    items: [],
    vatRate: '0', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  },
  saved: [],
  editingDocId: null  // when editing a saved doc
};

/* ===== ACTIVE MODAL CONTEXT ===== */
let activeDocId = null;   // for invoice/receipt modals
let editingJobId = null;  // tracks inline edit to prevent search from blowing it away
let pendingRefNum = null; // ref number held in memory until quote is actually saved

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  setupOnboarding();
  setupNavigation();
  setupNavHint();
  setupPage1();
  setupPage2();
  setupPage3();
  setupPage4();
  setupModals();
  updateSavedBadge();
  populatePage1Fields();
  refreshPriceList();
  refreshSavedDocs();
  setTodayDate();
  generateRef();
  updateJobPicker();
  updateColourPreview();
  syncRGBfromHex('header');
  syncRGBfromHex('accent');
  syncRGBfromHex('bg');
  populateAuthSig();

  // Start on page1 (or wherever nav left off)
  showPage('page1');
});

/* ===== STORAGE ===== */
function save() {
  try {
    ls(KEY_CO,    state.company);
    ls(KEY_PL,    state.priceList);
    ls(KEY_SAVED, state.saved);
  } catch(e) { toast('Storage full. Some data may not have saved.', 'error'); }
}

function loadFromStorage() {
  state.company   = lsGet(KEY_CO)    || state.company;
  state.priceList = lsGet(KEY_PL)    || [];
  state.saved     = lsGet(KEY_SAVED) || [];
}

function ls(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function nextRef(prefix, key) {
  const n = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, n);
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/* ===== TOAST ===== */
function toast(msg, type = '', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

function showSavedPopup(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'saved-popup-overlay';
  overlay.innerHTML = `
    <div class="saved-popup-box">
      <div class="saved-popup-tick">✓</div>
      <div class="saved-popup-msg">Saved!</div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      if (onDone) onDone();
    }, 350);
  }, 1200);
}

const KEY_NAV_HINT = 'tq_nav_hint_suppressed';

function showNavHint() {
  if (localStorage.getItem(KEY_NAV_HINT)) return;
  const popup = document.getElementById('navHintPopup');
  if (popup) popup.style.display = 'block';
}

function setupNavHint() {
  const popup    = document.getElementById('navHintPopup');
  const closeBtn = document.getElementById('navHintClose');
  const suppress = document.getElementById('navHintSuppress');
  if (!popup || !closeBtn || !suppress) return;

  closeBtn.addEventListener('click', () => {
    if (suppress.checked) localStorage.setItem(KEY_NAV_HINT, '1');
    popup.style.display = 'none';
  });

  suppress.addEventListener('change', () => {
    if (suppress.checked) localStorage.setItem(KEY_NAV_HINT, '1');
    else localStorage.removeItem(KEY_NAV_HINT);
  });
}

/* ===== PAGE NAVIGATION ===== */
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById(pageId);
  if (pg) {
    pg.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update page1 title if business already set up
  if (pageId === 'page1') {
    const hasSetUp = (state.company.lastName || '').trim() !== '';
    const p1Title = document.getElementById('page1Title');
    const p1Sub   = document.getElementById('page1Sub');
    if (p1Title) {
      if (hasSetUp) {
        p1Title.innerHTML = 'Edit Your Business';
      } else {
        p1Title.innerHTML = '<span class="page-num">1.</span> Set Up Your Business';
      }
    }
    if (p1Sub) p1Sub.style.display = hasSetUp ? 'none' : '';
  }

  // Update page3 title after first save
  if (pageId === 'page3') {
    const hasSaved = state.saved.length > 0 || state.editingDocId;
    const titleEl = document.getElementById('page3Title');
    if (hasSaved) {
      titleEl.textContent = 'New Estimate or Quote';
    } else {
      titleEl.innerHTML = '<span class="page-num">3.</span> Create Estimate or Quote';
    }
  }
}

function setupNavigation() {
  const hamburger = document.getElementById('hamburgerBtn');
  const navMenu   = document.getElementById('navMenu');
  const overlay   = document.getElementById('navMenuOverlay');

  function openMenu() {
    hamburger.classList.add('open');
    navMenu.classList.add('open');
    overlay.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    navMenu.setAttribute('aria-hidden', 'false');
  }

  function closeMenu() {
    hamburger.classList.remove('open');
    navMenu.classList.remove('open');
    overlay.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    navMenu.setAttribute('aria-hidden', 'true');
  }

  hamburger.addEventListener('click', () => {
    navMenu.classList.contains('open') ? closeMenu() : openMenu();
  });
  overlay.addEventListener('click', closeMenu);

  // Menu items + any other [data-target] elements (e.g. what-next-bar)
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      closeMenu();
      if (target === 'page3') prepareNewQuote();
      showPage(target);
    });
  });

  // Backup & Restore menu item
  const backupBtn = document.getElementById('menuBackupRestore');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      closeMenu();
      document.getElementById('backupRestoreModal').style.display = 'flex';
    });
  }

  // Sign Out
  const signOutBtn = document.getElementById('menuSignOut');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      closeMenu();
      if (confirm('Sign out? Your saved jobs will remain on this device.')) {
        localStorage.removeItem('tq_onboarded');
        localStorage.removeItem('tq_pl_onboarded');
        location.reload();
      }
    });
  }

  // Page footer nav buttons
  document.getElementById('goToPriceListBtn').addEventListener('click', () => {
    saveBusinessDetails(false);
    if (!localStorage.getItem(KEY_PL_ONBOARDED)) {
      document.getElementById('plOnboardingModal').style.display = 'flex';
    } else {
      showPage('page2');
    }
  });

  document.getElementById('plOnboardingBtn').addEventListener('click', () => {
    localStorage.setItem(KEY_PL_ONBOARDED, '1');
    document.getElementById('plOnboardingModal').style.display = 'none';
    showPage('page2');
  });
  document.getElementById('goToQuoteBtn').addEventListener('click', () => {
    showPage('page3');
  });
  document.getElementById('backToSetupBtn').addEventListener('click', () => showPage('page1'));
  document.getElementById('createFirstQuoteBtn')?.addEventListener('click', () => {
    prepareNewQuote();
    showPage('page3');
  });
}

/* ===== ONBOARDING ===== */
function setupOnboarding() {
  const modal = document.getElementById('onboardingModal');
  const onboarded = localStorage.getItem(KEY_ONBOARDED);
  if (onboarded) { modal.style.display = 'none'; return; }

  modal.style.display = 'flex';
  modal.classList.add('for-onboarding');

  document.getElementById('startBtn').addEventListener('click', () => {
    const source = document.getElementById('referralSource').value;
    submitReferral(source);
    localStorage.setItem(KEY_ONBOARDED, '1');
    modal.style.display = 'none';
    showPage('page1');
  });
}

async function submitReferral(source) {
  if (!FORMSPREE_URL || FORMSPREE_URL === 'YOUR_FORM_ID') return;
  try {
    await fetch(`https://formspree.io/f/${FORMSPREE_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral: source })
    });
  } catch {}
}

/* ===== PAGE 1 — BUSINESS SETUP ===== */
function setupPage1() {
  // Logo upload
  const logoArea   = document.getElementById('logoUploadArea');
  const logoFile   = document.getElementById('logoFile');
  const changeBtn  = document.getElementById('changeLogoBtn');
  const removeBtn  = document.getElementById('removeLogoBtn');

  logoArea.addEventListener('click', (e) => {
    if (!e.target.closest('.logo-actions')) logoFile.click();
  });
  logoArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') logoFile.click(); });
  logoFile.addEventListener('change', handleLogoUpload);
  changeBtn.addEventListener('click', (e) => { e.stopPropagation(); logoFile.click(); });
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.company.logo = '';
    showLogoState();
    save();
  });

  // Payment method toggles
  document.getElementById('payBankTransfer').addEventListener('change', e => {
    document.getElementById('bankDetails').style.display = e.target.checked ? 'block' : 'none';
  });

  // Sort code auto-format: XX-XX-XX
  document.getElementById('bankSort').addEventListener('input', function () {
    const pos = this.selectionStart;
    let digits = this.value.replace(/\D/g, '').slice(0, 6);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
    else if (digits.length > 2) formatted = digits.slice(0, 2) + '-' + digits.slice(2);
    this.value = formatted;
    // Restore cursor position (accounting for inserted hyphens)
    const err = document.getElementById('bankSortError');
    if (err) err.style.display = 'none';
    this.classList.remove('error');
  });
  document.getElementById('payPaypal').addEventListener('change', e => {
    document.getElementById('paypalDetails').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('payOther').addEventListener('change', e => {
    document.getElementById('payOtherDetails').style.display = e.target.checked ? 'block' : 'none';
  });

  // Colour pickers
  setupColourPicker('header', 'colourHeader', DEFAULT_COLOURS.primary);
  setupColourPicker('accent', 'colourAccent', DEFAULT_COLOURS.accent);
  setupColourPicker('bg',     'colourBg',     DEFAULT_COLOURS.bg);

  // Brand tooltip
  document.getElementById('brandTooltipBtn').addEventListener('click', () => {
    const t = document.getElementById('brandTooltip');
    t.style.display = t.style.display === 'none' ? 'block' : 'none';
  });

  // Reset colour menu
  document.getElementById('resetColourMenu').addEventListener('click', () => {
    const dd = document.getElementById('resetColourDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  });

  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.reset;
      if (r === 'all' || r === 'header') { setColour('header', DEFAULT_COLOURS.primary); }
      if (r === 'all' || r === 'accent') { setColour('accent', DEFAULT_COLOURS.accent); }
      if (r === 'all' || r === 'bg')     { setColour('bg',     DEFAULT_COLOURS.bg); }
      document.getElementById('resetColourDropdown').style.display = 'none';
      updateColourPreview();
    });
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.colour-reset-row')) {
      document.getElementById('resetColourDropdown').style.display = 'none';
    }
  });

  // Save button
  document.getElementById('saveBusinessBtn').addEventListener('click', () => saveBusinessDetails(true));

  // Backup/restore (page 1 card)
  document.getElementById('exportDataBtn').addEventListener('click', exportData);
  document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('importDataFile').click());
  document.getElementById('importDataFile').addEventListener('change', importData);

  // Backup/restore modal (from menu)
  document.getElementById('exportDataBtn2').addEventListener('click', exportData);
  document.getElementById('importDataBtn2').addEventListener('click', () => document.getElementById('importDataFile2').click());
  document.getElementById('importDataFile2').addEventListener('change', importData);
  document.getElementById('closeBackupModal').addEventListener('click', () => {
    document.getElementById('backupRestoreModal').style.display = 'none';
  });
  document.getElementById('backupRestoreModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    state.company.logo = ev.target.result;
    showLogoState();
    save();
  };
  reader.readAsDataURL(file);
}

function showLogoState() {
  const haslLogo = !!state.company.logo;
  document.getElementById('logoPlaceholder').style.display = haslLogo ? 'none' : 'flex';
  document.getElementById('logoPreview').style.display     = haslLogo ? 'flex' : 'none';
  if (haslLogo) document.getElementById('logoImg').src = state.company.logo;
}

function populatePage1Fields() {
  const c = state.company;
  setVal('p1FirstName',    c.firstName);
  setVal('p1LastName',     c.lastName);
  setVal('p1BusinessName', c.businessName);
  setVal('p1Phone',        c.phone);
  setVal('p1Email',        c.email);
  setVal('p1Website',      c.website);
  setVal('p1Address',      c.address);
  setVal('p1Postcode',     c.postcode);

  showLogoState();

  // Payment methods
  const methods = c.payMethods || [];
  const bankCk = document.getElementById('payBankTransfer');
  const paypalCk = document.getElementById('payPaypal');
  const otherCk  = document.getElementById('payOther');
  bankCk.checked  = methods.includes('bank');
  paypalCk.checked = methods.includes('paypal');
  document.getElementById('payCash').checked = methods.includes('cash');
  otherCk.checked = methods.includes('other');

  document.getElementById('bankDetails').style.display    = bankCk.checked  ? 'block' : 'none';
  document.getElementById('paypalDetails').style.display  = paypalCk.checked ? 'block' : 'none';
  document.getElementById('payOtherDetails').style.display = otherCk.checked ? 'block' : 'none';

  setVal('bankAccHolder', c.bankAccHolder);
  setVal('bankName',      c.bankName);
  setVal('bankSort',      c.bankSort);
  setVal('bankAcc',       c.bankAcc);
  setVal('paypalRef',     c.paypalRef);
  setVal('payOtherText',  c.payOther);

  // Colours
  setColour('header', c.brandPrimary || DEFAULT_COLOURS.primary);
  setColour('accent', c.brandAccent  || DEFAULT_COLOURS.accent);
  setColour('bg',     c.brandBg      || DEFAULT_COLOURS.bg);
  updateColourPreview();
}

function saveBusinessDetails(showToast = true) {
  const lastName = getVal('p1LastName').trim();
  if (!lastName) {
    document.getElementById('p1LastName').classList.add('error');
    document.getElementById('p1LastName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (showToast) toast('Last name is required.', 'error');
    return false;
  }
  document.getElementById('p1LastName').classList.remove('error');

  // Sort code validation: must be empty OR exactly 6 digits (XX-XX-XX)
  const sortVal = getVal('bankSort').trim();
  if (sortVal) {
    const digits = sortVal.replace(/\D/g, '');
    if (digits.length !== 6) {
      const sortEl = document.getElementById('bankSort');
      const sortErr = document.getElementById('bankSortError');
      sortEl.classList.add('error');
      if (sortErr) sortErr.style.display = 'block';
      sortEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (showToast) toast('Sort code must be 6 digits.', 'error');
      return false;
    }
    document.getElementById('bankSort').classList.remove('error');
    const sortErr = document.getElementById('bankSortError');
    if (sortErr) sortErr.style.display = 'none';
  }

  const methods = [];
  if (document.getElementById('payBankTransfer').checked) methods.push('bank');
  if (document.getElementById('payCash').checked)         methods.push('cash');
  if (document.getElementById('payPaypal').checked)       methods.push('paypal');
  if (document.getElementById('payOther').checked)        methods.push('other');

  state.company = {
    ...state.company,
    firstName:    getVal('p1FirstName'),
    lastName:     lastName,
    businessName: getVal('p1BusinessName'),
    phone:        getVal('p1Phone'),
    email:        getVal('p1Email'),
    website:      getVal('p1Website'),
    address:      getVal('p1Address'),
    postcode:     getVal('p1Postcode'),
    payMethods:   methods,
    bankAccHolder: getVal('bankAccHolder'),
    bankName:     getVal('bankName'),
    bankSort:     getVal('bankSort'),
    bankAcc:      getVal('bankAcc'),
    paypalRef:    getVal('paypalRef'),
    payOther:     getVal('payOtherText'),
    brandPrimary: document.getElementById('colourHeader').value,
    brandAccent:  document.getElementById('colourAccent').value,
    brandBg:      document.getElementById('colourBg').value
  };
  save();
  updateColourPreview();
  if (showToast) toast('Business details saved!', 'success');
  return true;
}

/* ===== COLOUR PICKER ===== */
function setupColourPicker(name, hexId, defaultVal) {
  const hex = document.getElementById(hexId);
  const rId = hexId + 'R', gId = hexId + 'G', bId = hexId + 'B';

  hex.addEventListener('input', () => {
    syncRGBfromHex(name);
    updateColourPreview();
  });

  [rId, gId, bId].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      syncHexFromRGB(name);
      updateColourPreview();
    });
  });
}

function colourIds(name) {
  const map = { header: 'colourHeader', accent: 'colourAccent', bg: 'colourBg' };
  return { hexId: map[name], rId: map[name]+'R', gId: map[name]+'G', bId: map[name]+'B' };
}

function setColour(name, hex) {
  const ids = colourIds(name);
  document.getElementById(ids.hexId).value = hex;
  syncRGBfromHex(name);
}

function syncRGBfromHex(name) {
  const ids = colourIds(name);
  const hex = document.getElementById(ids.hexId).value;
  const [r,g,b] = hexToRgb(hex);
  const rEl = document.getElementById(ids.rId);
  const gEl = document.getElementById(ids.gId);
  const bEl = document.getElementById(ids.bId);
  if (rEl) { rEl.value = r; gEl.value = g; bEl.value = b; }
}

function syncHexFromRGB(name) {
  const ids = colourIds(name);
  const r = parseInt(document.getElementById(ids.rId)?.value || '0');
  const g = parseInt(document.getElementById(ids.gId)?.value || '0');
  const b = parseInt(document.getElementById(ids.bId)?.value || '0');
  const hex = rgbToHex(clamp(r), clamp(g), clamp(b));
  document.getElementById(ids.hexId).value = hex;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return [0,0,0];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function rgbToHex(r,g,b) {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function clamp(n) { return Math.max(0, Math.min(255, isNaN(n) ? 0 : n)); }

function updateColourPreview() {
  const primary = document.getElementById('colourHeader').value;
  const accent  = document.getElementById('colourAccent').value;
  const bg      = document.getElementById('colourBg').value;

  const cpHeader = document.getElementById('cpHeader');
  const cpBody   = document.getElementById('cpBody');
  const cpLabel  = document.getElementById('cpAccentSample');

  if (cpHeader) cpHeader.style.backgroundColor = primary;
  if (cpBody)   cpBody.style.backgroundColor   = bg;
  if (cpLabel)  cpLabel.style.color            = accent;

  const bizName = getVal('p1BusinessName') || getVal('p1LastName') || 'Ace Trades';
  const cpBiz = document.getElementById('cpBusinessName');
  if (cpBiz) cpBiz.textContent = bizName;
}

/* ===== PAGE 2 — PRICE LIST ===== */
function setupPage2() {
  // CSV upload
  const csvZone = document.getElementById('csvUploadZone');
  const csvFile = document.getElementById('csvFile');

  csvZone.addEventListener('click', (e) => {
    if (!e.target.closest('button')) csvFile.click();
  });
  csvZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') csvFile.click(); });
  csvFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readCSV(file);
  });

  // Drag & drop
  csvZone.addEventListener('dragover', e => { e.preventDefault(); csvZone.classList.add('dragover'); });
  csvZone.addEventListener('dragleave', () => csvZone.classList.remove('dragover'));
  csvZone.addEventListener('drop', e => {
    e.preventDefault();
    csvZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readCSV(file);
  });

  document.getElementById('downloadTemplateBtn').addEventListener('click', e => {
    e.stopPropagation();
    downloadTemplate();
  });

  // Bulk paste
  document.getElementById('parseBulkBtn').addEventListener('click', () => {
    const text = getVal('bulkPaste');
    if (!text.trim()) { toast('Paste some jobs first.', 'error'); return; }
    const { added, skipped } = parseJobLines(text);
    setVal('bulkPaste', '');
    if (added) {
      let msg = `${added} job${added===1?'':'s'} added.`;
      if (skipped) msg += ` ${skipped} skipped (already in your list).`;
      toast(msg, 'success');
    } else if (skipped) {
      toast(`All jobs already in your list.`, 'error');
    } else {
      toast('No valid jobs found. Format: Job name, price', 'error');
    }
  });

  // Individual add
  document.getElementById('addJobBtn').addEventListener('click', addIndividualJob);
  document.getElementById('jobName').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });
  document.getElementById('jobPrice').addEventListener('keydown', e => { if (e.key==='Enter') addIndividualJob(); });

  // Search — skip rebuild if an inline edit is active
  document.getElementById('priceListSearch').addEventListener('input', () => {
    if (!editingJobId) refreshPriceList();
  });

  // Select all
  document.getElementById('selectAllJobs').addEventListener('change', e => {
    document.querySelectorAll('.job-check').forEach(cb => cb.checked = e.target.checked);
    document.getElementById('deleteSelectedBtn').style.display = e.target.checked ? 'flex' : 'none';
  });

  // Delete selected — no confirm() as it is unreliable on mobile
  document.getElementById('deleteSelectedBtn').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.job-check:checked')].map(cb => cb.dataset.id);
    if (!checked.length) return;
    state.priceList = state.priceList.filter(j => !checked.includes(j.id));
    document.getElementById('selectAllJobs').checked = false;
    document.getElementById('deleteSelectedBtn').style.display = 'none';
    save();
    refreshPriceList();
    updateJobPicker();
    toast(`Deleted ${checked.length} job${checked.length===1?'':'s'}.`);
  });

  // Sort
  document.getElementById('sortJobs').addEventListener('change', () => refreshPriceList());
}

function readCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const { added, skipped } = parseJobLines(e.target.result);
    if (added) {
      let msg = `${added} job${added===1?'':'s'} added from file.`;
      if (skipped) msg += ` ${skipped} skipped (already in your list).`;
      toast(msg, 'success');
    } else if (skipped) {
      toast('All jobs already in your list.', 'error');
    } else {
      toast('No valid rows found. Format: Job name, price', 'error');
    }
  };
  reader.readAsText(file);
}

function parseJobLines(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  lines.forEach(line => {
    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) return;
    const name = line.slice(0, commaIdx).trim();
    const rest = line.slice(commaIdx + 1).trim();
    const priceMatch = rest.match(/[£$€]?([\d,]+(?:\.\d+)?)/);
    if (!priceMatch) return;
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    const afterPrice = rest.slice(priceMatch.index + priceMatch[0].length).replace(/^\s*,\s*/, '').trim();
    const unit = afterPrice || '';
    if (!name || isNaN(price)) return;
    const duplicate = state.priceList.find(j => j.name.toLowerCase() === name.toLowerCase());
    if (duplicate) { skipped++; return; }
    addJob(name, price, unit);
    added++;
  });
  if (added) { save(); refreshPriceList(); updateJobPicker(); }
  return { added, skipped };
}

function downloadTemplate() {
  const csv = 'Job Name,Price,Unit (optional)\nFit door handle,45,each\nHang door,85,\nRepair fence panel,60,per panel';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lexi-price-list-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function addIndividualJob() {
  const name  = getVal('jobName').trim();
  const price = parseFloat(getVal('jobPrice'));
  const unit  = getVal('jobUnit').trim();
  if (!name)   { document.getElementById('jobName').classList.add('error');  return; }
  if (isNaN(price)) { document.getElementById('jobPrice').classList.add('error'); return; }
  document.getElementById('jobName').classList.remove('error');
  document.getElementById('jobPrice').classList.remove('error');

  const duplicate = state.priceList.find(j => j.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    showDuplicatePrompt(name, () => {
      addJob(name, price, unit);
      save();
      setVal('jobName',''); setVal('jobPrice',''); setVal('jobUnit','');
      refreshPriceList();
      updateJobPicker();
      toast('Added as alternative.', 'success');
    });
    return;
  }

  addJob(name, price, unit);
  save();
  setVal('jobName',''); setVal('jobPrice',''); setVal('jobUnit','');
  refreshPriceList();
  updateJobPicker();
  toast('Job added.', 'success');
}

function showDuplicatePrompt(name, onConfirm) {
  // Remove any existing duplicate prompt
  document.getElementById('dupPrompt')?.remove();
  const el = document.createElement('div');
  el.id = 'dupPrompt';
  el.className = 'dup-prompt';
  el.innerHTML = `
    <span>"${esc(name)}" is already in your list. Add as an alternative?</span>
    <div class="dup-prompt-btns">
      <button class="btn btn-sm btn-sage" id="dupYes">Yes, add it</button>
      <button class="btn btn-sm btn-outline" id="dupNo">Cancel</button>
    </div>
  `;
  const individual = document.querySelector('.individual-add');
  individual.appendChild(el);
  el.querySelector('#dupYes').addEventListener('click', () => { el.remove(); onConfirm(); });
  el.querySelector('#dupNo').addEventListener('click', () => el.remove());
}

function addJob(name, price, unit) {
  state.priceList.push({ id: uid(), name, price, unit });
}

function refreshPriceList() {
  const q    = getVal('priceListSearch').toLowerCase();
  const sort = (document.getElementById('sortJobs')?.value) || 'added';
  let filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  if (sort === 'name')  filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'price') filtered = [...filtered].sort((a, b) => a.price - b.price);
  const container = document.getElementById('priceListContainer');
  const empty     = document.getElementById('priceListEmpty');
  const badge     = document.getElementById('priceListBadge');

  badge.textContent = state.priceList.length;
  const bulkCount = document.getElementById('bulkJobCount');
  if (bulkCount) bulkCount.textContent = state.priceList.length;

  // Remove job rows but keep #priceListEmpty so it is never destroyed by innerHTML
  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!state.priceList.length) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  filtered.forEach(job => {
    const row = document.createElement('div');
    row.className = 'price-item';
    row.dataset.id = job.id;
    row.innerHTML = `
      <div class="price-item-check">
        <input type="checkbox" class="job-check" data-id="${job.id}" aria-label="Select ${esc(job.name)}">
      </div>
      <div class="price-item-info">
        <div class="price-item-name">${esc(job.name)}</div>
        ${job.unit ? `<div class="price-item-meta">${esc(job.unit)}</div>` : ''}
      </div>
      <div class="price-item-price">${fmtPrice(job.price)}</div>
      <div class="price-item-actions">
        <button class="icon-btn edit" data-id="${job.id}" title="Edit" aria-label="Edit ${esc(job.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn delete" data-id="${job.id}" title="Delete" aria-label="Delete ${esc(job.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    container.appendChild(row);

    row.querySelector('.job-check').addEventListener('change', () => {
      const anyChecked = container.querySelectorAll('.job-check:checked').length > 0;
      document.getElementById('deleteSelectedBtn').style.display = anyChecked ? 'flex' : 'none';
    });

    row.querySelector('.edit').addEventListener('click', () => editJobInline(row, job), { once: true });
    row.querySelector('.delete').addEventListener('click', () => deleteJob(job.id));
  });
}

function editJobInline(row, job) {
  if (editingJobId === job.id) return;  // prevent re-entry on rapid taps
  editingJobId = job.id;

  row.innerHTML = `
    <div class="price-item-edit-row" style="width:100%;display:grid;grid-template-columns:1fr 90px 80px auto auto;gap:8px;align-items:center">
      <input type="text" class="edit-name" value="${esc(job.name)}" placeholder="Job name" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:15px">
      <input type="number" class="edit-price" value="${job.price}" placeholder="Price" min="0" step="0.01" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:15px">
      <input type="text" class="edit-unit" value="${esc(job.unit||'')}" placeholder="Unit" style="padding:8px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:15px">
      <button class="btn btn-sm btn-primary save-edit">✓</button>
      <button class="btn btn-sm btn-outline cancel-edit">✕</button>
    </div>
  `;
  row.querySelector('.edit-name').focus();

  const done = () => { editingJobId = null; };

  const saveEdit = () => {
    const name  = row.querySelector('.edit-name').value.trim();
    const price = parseFloat(row.querySelector('.edit-price').value);
    const unit  = row.querySelector('.edit-unit').value.trim();
    if (!name || isNaN(price)) { toast('Name and price are required.', 'error'); return; }
    const idx = state.priceList.findIndex(j => j.id === job.id);
    if (idx > -1) state.priceList[idx] = { ...job, name, price, unit };
    done();
    save();
    refreshPriceList();
    updateJobPicker();
    toast('Job updated.', 'success');
  };

  row.querySelector('.save-edit').addEventListener('click', saveEdit);
  row.querySelector('.cancel-edit').addEventListener('click', () => { done(); refreshPriceList(); });
  row.querySelector('.edit-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') { done(); refreshPriceList(); }
  });
}

function deleteJob(id) {
  state.priceList = state.priceList.filter(j => j.id !== id);
  save();
  refreshPriceList();
  updateJobPicker();
  toast('Job deleted.');
}

/* ===== PAGE 3 — QUOTE BUILDER ===== */
function setupPage3() {
  // Doc type toggle
  document.getElementById('dtEstimate').addEventListener('click', () => setDocType('Estimate'));
  document.getElementById('dtQuote').addEventListener('click',    () => setDocType('Quote'));

  // Valid for
  document.getElementById('docValidFor').addEventListener('change', e => {
    document.getElementById('validCustomGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });

  // Job picker search
  document.getElementById('jobPickerSearch').addEventListener('input', () => updateJobPicker());

  // Picker click — event delegation so it works after every innerHTML redraw
  const pickerContainer = document.getElementById('jobPickerList');
  pickerContainer.addEventListener('click', e => {
    const item = e.target.closest('.pick-item');
    if (item) addJobToQuote(item.dataset.jobId);
  });
  pickerContainer.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.pick-item');
      if (item) { e.preventDefault(); addJobToQuote(item.dataset.jobId); }
    }
  });

  // Custom item
  document.getElementById('addCustomItemBtn').addEventListener('click', addCustomItem);

  // VAT
  document.getElementById('vatSelect').addEventListener('change', e => {
    document.getElementById('vatCustom').style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
    recalcTotals();
  });
  document.getElementById('vatCustom').addEventListener('input', recalcTotals);
  document.getElementById('discountPct').addEventListener('input', recalcTotals);

  // Signature canvas
  setupSignatureCanvas();

  // Type-to-sign
  document.getElementById('custSigText').addEventListener('input', () => {
    if (getVal('custSigText')) clearCanvas();
  });

  // Auto-populate sig text from authSig name field
  document.getElementById('authSig').addEventListener('input', () => {
    const sigText = document.getElementById('custSigText');
    // Only pre-fill if the canvas is blank and the sig text hasn't been manually changed
    if (!sigText.dataset.userEdited) {
      sigText.value = document.getElementById('authSig').value;
    }
  });
  document.getElementById('custSigText').addEventListener('input', () => {
    document.getElementById('custSigText').dataset.userEdited = '1';
  });

  document.getElementById('clearSigBtn').addEventListener('click', () => {
    clearCanvas();
    setVal('custSigText', '');
    delete document.getElementById('custSigText').dataset.userEdited;
  });

  // Quote footer buttons
  document.getElementById('previewQuoteBtn').addEventListener('click', () => openPreview(buildQuoteDoc(), 'quote'));
  document.getElementById('saveQuoteBtn').addEventListener('click', saveQuote);
  document.getElementById('printQuoteBtn').addEventListener('click', () => printDoc(buildQuoteDoc()));
  document.getElementById('sendQuoteBtn').addEventListener('click', () => sendDoc(buildQuoteDoc(), getDocFilename('quote')));
}

function setDocType(type) {
  state.quote.type = type;
  document.getElementById('dtEstimate').classList.toggle('active', type === 'Estimate');
  document.getElementById('dtQuote').classList.toggle('active', type === 'Quote');
  generateRef();
}

function prepareNewQuote() {
  if (state.editingDocId) {
    const doc = state.saved.find(d => d.id === state.editingDocId);
    if (doc) {
      loadQuoteFromDoc(doc);
      return;
    }
  }
  // Fresh quote
  const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
  pendingRefNum = Math.max(stored, 100) + 1;
  state.quote = {
    type: 'Estimate',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: todayStr(), validFor: '30', validCustom: '',
    ref: buildRef(pendingRefNum),
    items: [],
    vatRate: '0', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  };
  state.editingDocId = null;
  populateQuoteForm();
}

function loadQuoteFromDoc(doc) {
  state.quote = { ...doc.quote };
  populateQuoteForm();
}

function populateQuoteForm() {
  const q = state.quote;
  setDocType(q.type || 'Estimate');
  setVal('custTitle',     q.custTitle);
  setVal('custFirstName', q.custFirstName);
  setVal('custLastName',  q.custLastName);
  setVal('custAddr',      q.custAddr);
  setVal('custPostcode',  q.custPostcode);
  setVal('custPhone',     q.custPhone);
  setVal('custEmail',     q.custEmail);
  setVal('docRef',        q.ref);
  setVal('docDate',       q.date || todayStr());
  setVal('docValidFor',   q.validFor || '30');
  setVal('docValidCustom',q.validCustom || '');
  setVal('quoteNotes',    q.notes);
  setVal('quotePrivateNotes', q.privateNotes);
  setVal('customTerms',   q.customTerms || '');
  setVal('authSig',       q.authSig || state.company.businessName || '');
  setVal('custSigText',   '');
  setVal('discountPct',   q.discount || '0');
  setVal('vatCustom',     q.vatCustom || '');
  document.getElementById('vatSelect').value = q.vatRate || '0';
  document.getElementById('vatCustom').style.display = q.vatRate === 'custom' ? 'inline-block' : 'none';
  document.getElementById('validCustomGroup').style.display = q.validFor === 'custom' ? 'block' : 'none';

  // Terms
  document.querySelectorAll('[name="terms"]').forEach(cb => {
    cb.checked = (q.selectedTerms || []).includes(cb.value);
  });

  clearCanvas();
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
}

function populateAuthSig() {
  const authSigEl = document.getElementById('authSig');
  if (authSigEl && !authSigEl.value) {
    authSigEl.value = state.company.businessName || (state.company.firstName + ' ' + state.company.lastName).trim() || '';
  }
}

function setTodayDate() {
  const el = document.getElementById('docDate');
  if (el && !el.value) el.value = todayStr();
}

function buildRef(num) {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `LEXI-${num}-${dd}${mm}${yy}`;
}

function generateRef() {
  if (state.editingDocId) return; // keep original ref when editing
  const el = document.getElementById('docRef');
  if (!el) return;
  const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
  pendingRefNum = Math.max(stored, 100) + 1;
  el.value = buildRef(pendingRefNum);
}

function updateJobPicker() {
  const q = getVal('jobPickerSearch').toLowerCase();
  const filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  const container = document.getElementById('jobPickerList');

  if (!filtered.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:8px 0">No jobs match your search.</p>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const quoteItem = state.quote.items.find(qi => qi.id === item.id || qi.name === item.name);
    const inQuote = !!quoteItem;
    const qty = quoteItem ? quoteItem.qty : 0;
    return `
      <div class="pick-item${inQuote ? ' added' : ''}"
           data-job-id="${esc(item.id)}"
           role="button" tabindex="0"
           aria-label="Add ${esc(item.name)} to quote">
        <div class="pick-name">
          ${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}
        </div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        <span class="pick-add-btn">${inQuote ? qty : '+'}</span>
      </div>
    `;
  }).join('');

}


function addJobToQuote(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const existing = state.quote.items.find(i => i.id === job.id);
  if (existing) {
    existing.qty++;
  } else {
    state.quote.items.push({ id: job.id, name: job.name, unitPrice: job.price, unit: job.unit, qty: 1 });
  }
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
}

function addCustomItem() {
  const name  = getVal('customItemName').trim();
  const price = parseFloat(getVal('customItemPrice'));
  const unit  = getVal('customItemUnit').trim();
  if (!name)        { document.getElementById('customItemName').classList.add('error');  return; }
  if (isNaN(price)) { document.getElementById('customItemPrice').classList.add('error'); return; }
  document.getElementById('customItemName').classList.remove('error');
  document.getElementById('customItemPrice').classList.remove('error');

  state.quote.items.push({ id: uid(), name, unitPrice: price, unit, qty: 1 });
  setVal('customItemName',''); setVal('customItemPrice',''); setVal('customItemUnit','');
  renderQuoteItems();
  recalcTotals();
}

function renderQuoteItems() {
  const container = document.getElementById('quoteItemsContainer');
  const empty     = document.getElementById('quoteItemsEmpty');

  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!state.quote.items.length) {
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  state.quote.items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'quote-item';
    const lineTotal = item.unitPrice * item.qty;
    row.innerHTML = `
      <div class="quote-item-info">
        <div class="quote-item-name">${esc(item.name)}</div>
        <div class="quote-item-unit-price">${fmtPrice(item.unitPrice)}${item.unit ? ' / ' + esc(item.unit) : ''}</div>
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-btn qty-minus" data-idx="${idx}" aria-label="Decrease quantity">−</button>
        <span class="qty-value">${item.qty}</span>
        <button type="button" class="qty-btn qty-plus"  data-idx="${idx}" aria-label="Increase quantity">+</button>
      </div>
      <div class="quote-item-total">${fmtPrice(lineTotal)}</div>
      <button type="button" class="icon-btn delete" data-idx="${idx}" aria-label="Remove ${esc(item.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    container.appendChild(row);

    row.querySelector('.qty-minus').addEventListener('click', () => {
      if (item.qty > 1) { item.qty--; } else { state.quote.items.splice(idx, 1); }
      renderQuoteItems(); recalcTotals();
    });
    row.querySelector('.qty-plus').addEventListener('click', () => {
      item.qty++; renderQuoteItems(); recalcTotals();
    });
    row.querySelector('.delete').addEventListener('click', () => {
      state.quote.items.splice(idx, 1); renderQuoteItems(); recalcTotals();
    });
  });
}

function recalcTotals() {
  const subtotal  = state.quote.items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatSel    = document.getElementById('vatSelect').value;
  const vatRate   = vatSel === 'custom' ? parseFloat(getVal('vatCustom')) || 0 : parseFloat(vatSel) || 0;
  const discPct   = parseFloat(getVal('discountPct')) || 0;
  const discount  = subtotal * discPct / 100;
  const afterDisc = subtotal - discount;
  const vatAmt    = afterDisc * vatRate / 100;
  const total     = afterDisc + vatAmt;

  document.getElementById('qSubtotal').textContent  = fmtPrice(subtotal);
  document.getElementById('qVatAmount').textContent  = fmtPrice(vatAmt);
  document.getElementById('qDiscount').textContent   = `-${fmtPrice(discount)}`;
  document.getElementById('qTotal').textContent      = fmtPrice(total);
}

function collectQuoteState() {
  const vatSel = document.getElementById('vatSelect').value;
  const selectedTerms = [...document.querySelectorAll('[name="terms"]:checked')].map(cb => cb.value);
  return {
    type:          state.quote.type,
    custTitle:     getVal('custTitle'),
    custFirstName: getVal('custFirstName'),
    custLastName:  getVal('custLastName'),
    custAddr:      getVal('custAddr'),
    custPostcode:  getVal('custPostcode'),
    custPhone:     getVal('custPhone'),
    custEmail:     getVal('custEmail'),
    ref:           getVal('docRef'),
    date:          getVal('docDate'),
    validFor:      getVal('docValidFor'),
    validCustom:   getVal('docValidCustom'),
    items:         [...state.quote.items],
    vatRate:       vatSel,
    vatCustom:     getVal('vatCustom'),
    discount:      getVal('discountPct'),
    notes:         getVal('quoteNotes'),
    privateNotes:  getVal('quotePrivateNotes'),
    selectedTerms,
    customTerms:   getVal('customTerms'),
    authSig:       getVal('authSig'),
    custSig:       getCanvasDataURL(),
    sigDate:       todayStr()
  };
}

function saveQuote() {
  const q = collectQuoteState();
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    document.getElementById('custFirstName').focus();
    return;
  }

  if (state.editingDocId) {
    const idx = state.saved.findIndex(d => d.id === state.editingDocId);
    if (idx > -1) {
      state.saved[idx] = {
        ...state.saved[idx],
        quote: q,
        company: { ...state.company },
        custName: buildCustName(q),
        total: calcTotal(q),
        type: q.type
      };
    }
    state.editingDocId = null;
  } else {
    state.saved.unshift({
      id: uid(),
      quote: q,
      company: { ...state.company },
      custName: buildCustName(q),
      total: calcTotal(q),
      type: q.type,
      date: q.date,
      ref: q.ref,
      invoiceSent: false,
      paid: false,
      paidAmount: 0,
      paidDate: ''
    });
    // Commit the pending ref number to storage (only on actual save, never on abandon)
    if (pendingRefNum !== null) {
      const stored = parseInt(localStorage.getItem(KEY_REF) || '100');
      if (pendingRefNum > stored) localStorage.setItem(KEY_REF, pendingRefNum);
      pendingRefNum = null;
    }
  }

  save();
  updateSavedBadge();
  refreshSavedDocs();
  showSavedPopup(() => {
    showPage('page4');
    showNavHint();
  });
}

function buildCustName(q) {
  return [q.custTitle, q.custFirstName, q.custLastName].filter(Boolean).join(' ');
}

function calcTotal(q) {
  const sub    = (q.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatRate = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
  const disc   = parseFloat(q.discount) || 0;
  const after  = sub - sub * disc / 100;
  return after + after * vatRate / 100;
}

/* ===== SIGNATURE CANVAS ===== */
function setupSignatureCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false, lastX = 0, lastY = 0;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * (canvas.width / rect.width), y: (src.clientY - rect.top) * (canvas.height / rect.height) };
  };

  const start = (e) => { e.preventDefault(); drawing = true; const p = getPos(e); lastX = p.x; lastY = p.y; };
  const draw  = (e) => {
    if (!drawing) return; e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#2C2C2C';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastX = p.x; lastY = p.y;
    setVal('custSigText', '');
  };
  const stop  = () => { drawing = false; };

  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  draw);
  canvas.addEventListener('mouseup',    stop);
  canvas.addEventListener('mouseleave', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  draw,  { passive: false });
  canvas.addEventListener('touchend',   stop);
}

function clearCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function getCanvasDataURL() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return '';
  const ctx = canvas.getContext('2d');
  const px  = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const hasDrawing = px.some(v => v !== 0);
  return hasDrawing ? canvas.toDataURL() : '';
}

/* ===== PAGE 4 — SAVED DOCS ===== */
function setupPage4() {
  const sel = document.getElementById('savedFilterSelect');
  if (sel) sel.addEventListener('change', () => refreshSavedDocs());
}

function refreshSavedDocs() {
  const sel    = document.getElementById('savedFilterSelect');
  const filter = sel ? sel.value : 'all';
  const container = document.getElementById('savedDocsList');
  const empty     = document.getElementById('savedDocsEmpty');

  let docs = [...state.saved];
  if      (filter === 'Estimate') docs = docs.filter(d => d.type === 'Estimate');
  else if (filter === 'Quote')    docs = docs.filter(d => d.type === 'Quote');
  else if (filter === 'paid')     docs = docs.filter(d => d.paid);
  else if (filter === 'unpaid')   docs = docs.filter(d => !d.paid);
  else if (filter === 'accepted') docs = docs.filter(d => d.accepted);

  // Remove all doc cards but keep the empty-state element in the DOM
  Array.from(container.children).forEach(child => {
    if (child !== empty) child.remove();
  });

  if (!docs.length) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  docs.forEach(doc => {
    const card = document.createElement('div');
    const statusBadge = doc.paid ? 'paid' : doc.invoiceSent ? 'invoiced' : doc.type.toLowerCase();
    card.className = `saved-doc-card status-${statusBadge}`;
    const statusLabel = doc.paid ? 'Paid' : doc.invoiceSent ? 'Invoiced' : doc.type;

    card.innerHTML = `
      <div class="saved-doc-header">
        <div>
          <div class="saved-doc-name">${esc(doc.custName || 'Unknown Customer')}</div>
          <div class="saved-doc-ref">${esc(doc.ref || '')} &bull; ${formatDate(doc.date)}</div>
        </div>
        <div style="text-align:right">
          <div class="saved-doc-total">${fmtPrice(doc.total || 0)}</div>
          <span class="type-badge ${statusBadge}">${statusLabel}</span>
        </div>
      </div>
      <div class="journey-btns">
        <button type="button" class="journey-btn btn-send-quote" data-id="${doc.id}">
          <span class="jb-circle">A</span> Send ${esc(doc.type)}
        </button>
        <button type="button" class="journey-btn btn-send-invoice" data-id="${doc.id}" ${!doc.invoiceSent && !doc.paid ? '' : ''}>
          <span class="jb-circle">B</span> Send Invoice
        </button>
        <button type="button" class="journey-btn btn-send-receipt" data-id="${doc.id}" ${doc.paid ? '' : 'disabled'}>
          <span class="jb-circle">C</span> Send Receipt
        </button>
      </div>
      <div class="saved-doc-actions">
        ${!doc.paid ? `<button type="button" class="btn btn-sm btn-outline btn-mark-paid" data-id="${doc.id}">✓ Mark Paid</button>` : `<span class="type-badge paid" style="margin-right:auto">Paid ${doc.paidDate ? formatDate(doc.paidDate) : ''}</span>`}
        <button type="button" class="btn btn-sm btn-outline btn-edit-doc" data-id="${doc.id}">Edit</button>
        <button type="button" class="btn btn-sm btn-danger-outline btn-delete-doc" data-id="${doc.id}">Delete</button>
      </div>
    `;

    container.appendChild(card);

    card.querySelector('.btn-send-quote').addEventListener('click', () => {
      openPreview(buildDocHtml(doc, 'quote'), 'quote', doc.id);
    });
    card.querySelector('.btn-send-invoice').addEventListener('click', () => openInvoiceModal(doc.id));
    card.querySelector('.btn-send-receipt').addEventListener('click', () => {
      if (doc.paid) openReceiptModal(doc.id);
    });
    card.querySelector('.btn-mark-paid')?.addEventListener('click', () => openMarkPaid(doc.id));
    card.querySelector('.btn-edit-doc').addEventListener('click', () => editDoc(doc.id));
    card.querySelector('.btn-delete-doc').addEventListener('click', () => deleteDoc(doc.id));
  });
}

function editDoc(id) {
  state.editingDocId = id;
  const doc = state.saved.find(d => d.id === id);
  if (!doc) return;
  loadQuoteFromDoc(doc);
  showPage('page3');
}

function deleteDoc(id) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  state.saved = state.saved.filter(d => d.id !== id);
  save();
  updateSavedBadge();
  refreshSavedDocs();
  toast('Document deleted.');
}

function updateSavedBadge() {
  const badge = document.getElementById('savedBadge');
  const count = state.saved.length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/* ===== MODALS ===== */
function setupModals() {
  document.getElementById('closePreviewBtn').addEventListener('click', closePreview);
  document.getElementById('closeInvoiceBtn').addEventListener('click', () => document.getElementById('invoiceModal').style.display = 'none');
  document.getElementById('closeReceiptBtn').addEventListener('click', () => document.getElementById('receiptModal').style.display = 'none');
  document.getElementById('closeMarkPaidBtn').addEventListener('click', () => document.getElementById('markPaidModal').style.display = 'none');
  document.getElementById('cancelMarkPaidBtn').addEventListener('click', () => document.getElementById('markPaidModal').style.display = 'none');

  // Close on overlay click
  [document.getElementById('previewModal'),
   document.getElementById('invoiceModal'),
   document.getElementById('receiptModal'),
   document.getElementById('markPaidModal')].forEach(m => {
    m?.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });

  document.getElementById('previewPrintBtn').addEventListener('click', () => {
    const html = document.getElementById('previewContent').innerHTML;
    printRaw(html);
  });

  document.getElementById('previewSendBtn').addEventListener('click', () => {
    const html = document.getElementById('previewContent').innerHTML;
    const wrapped = wrapDoc(html);
    sendDocRaw(wrapped, 'document.html');
  });

  // Invoice modal
  document.getElementById('invPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    openPreview(buildDocHtml(doc, 'invoice', invData), 'invoice');
  });
  document.getElementById('invSendBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    const html = buildDocHtml(doc, 'invoice', invData);
    doc.invoiceSent = true;
    doc.invoiceRef  = invData.invRef;
    save();
    refreshSavedDocs();
    document.getElementById('invoiceModal').style.display = 'none';
    sendDoc(html, getDocFilenameFromRef(invData.invRef || 'invoice'));
    toast('Invoice sent!', 'success');
  });

  // Receipt modal
  document.getElementById('recPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    openPreview(buildDocHtml(doc, 'receipt', recData), 'receipt');
  });
  document.getElementById('recSendBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    const html = buildDocHtml(doc, 'receipt', recData);
    sendDoc(html, 'receipt.html');
    document.getElementById('receiptModal').style.display = 'none';
    toast('Receipt sent!', 'success');
  });

  // Mark Paid
  document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    doc.paid       = true;
    doc.paidAmount = parseFloat(getVal('mpAmount')) || doc.total || 0;
    doc.paidDate   = getVal('mpDate') || todayStr();
    save();
    refreshSavedDocs();
    document.getElementById('markPaidModal').style.display = 'none';
    toast('Marked as paid!', 'success');
  });
}

let previewContext = { type: 'quote', docId: null };

function openPreview(html, type, docId = null) {
  previewContext = { type, docId };
  document.getElementById('previewContent').innerHTML = html;
  document.getElementById('previewModal').style.display = 'flex';
}

function closePreview() {
  document.getElementById('previewModal').style.display = 'none';
}

function openInvoiceModal(docId) {
  activeDocId = docId;
  const invRef = nextRef('INV', KEY_INV);
  setVal('invRef',     invRef);
  setVal('invDate',    todayStr());
  setVal('invDueDate', addDays(todayStr(), 30));
  setVal('invNotes',   '');
  document.getElementById('invoiceModal').style.display = 'flex';
}

function openReceiptModal(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  setVal('recAmount', doc ? doc.total.toFixed(2) : '');
  setVal('recDate',   todayStr());
  setVal('recMethod', 'Bank Transfer');
  setVal('recNotes',  '');
  document.getElementById('receiptModal').style.display = 'flex';
}

function openMarkPaid(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  setVal('mpAmount', doc ? doc.total.toFixed(2) : '');
  setVal('mpDate',   todayStr());
  document.getElementById('markPaidModal').style.display = 'flex';
}

function collectInvoiceForm() {
  return {
    invRef:    getVal('invRef'),
    invDate:   getVal('invDate'),
    dueDate:   getVal('invDueDate'),
    notes:     getVal('invNotes')
  };
}

function collectReceiptForm() {
  return {
    amount:  getVal('recAmount'),
    date:    getVal('recDate'),
    method:  getVal('recMethod'),
    notes:   getVal('recNotes')
  };
}

/* ===== DOCUMENT GENERATION ===== */
const DOC_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#2C2C2C;background:#fff;padding:0}
  .doc-wrap{max-width:760px;margin:0 auto;padding:32px 24px}
  .doc-header{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;color:#fff;border-radius:8px 8px 0 0}
  .doc-header-left{display:flex;align-items:center;gap:16px}
  .doc-logo{max-height:56px;max-width:160px;object-fit:contain}
  .doc-biz-name{font-size:1.3rem;font-weight:700}
  .doc-type{font-size:1.1rem;font-weight:700;opacity:.9;text-align:right}
  .doc-ref{font-size:0.85rem;opacity:.75;text-align:right}
  .doc-info{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px 0;border-bottom:1px solid #ddd5c5}
  .doc-info h3{font-size:0.75rem;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px}
  .doc-info p{font-size:0.9rem;line-height:1.6;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;margin:20px 0}
  thead th{padding:10px 12px;text-align:left;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fff}
  thead th:last-child{text-align:right}
  tbody td{padding:10px 12px;border-bottom:1px solid #eee;font-size:0.9rem;vertical-align:top}
  tbody td:last-child{text-align:right;font-weight:600}
  tbody tr:last-child td{border-bottom:none}
  .totals{margin-left:auto;width:260px;border-top:1px solid #ddd5c5;padding-top:12px}
  .totals-row{display:flex;justify-content:space-between;padding:4px 0;font-size:0.9rem}
  .totals-total{font-weight:700;font-size:1.05rem;border-top:1.5px solid #2C2C2C;padding-top:8px;margin-top:4px}
  .section{margin-top:24px;padding-top:16px;border-top:1px solid #ddd5c5}
  .section h3{font-size:0.75rem;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:8px}
  .section p,.section ul{font-size:0.875rem;line-height:1.7;white-space:pre-wrap}
  .section ul{list-style:disc;padding-left:18px}
  .sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
  .sig-box{border:1.5px solid #ddd5c5;border-radius:6px;padding:12px;min-height:80px;display:flex;flex-direction:column;justify-content:flex-end}
  .sig-label{font-size:0.75rem;color:#888;margin-top:8px;text-transform:uppercase;letter-spacing:.06em}
  .sig-img{max-height:60px;max-width:200px}
  .sig-typed{font-family:'Dancing Script',cursive;font-size:1.5rem;color:#2C2C2C}
  .doc-footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd5c5;font-size:0.75rem;color:#aaa;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px}
  @media print{body{padding:0}.doc-wrap{max-width:100%;padding:16px}}
`;

function buildQuoteDoc() {
  const q = collectQuoteState();
  const tempDoc = {
    quote: q,
    company: { ...state.company },
    custName: buildCustName(q),
    total: calcTotal(q)
  };
  return buildDocHtml(tempDoc, 'quote');
}

function buildDocHtml(doc, docType, extra = {}) {
  const q = doc.quote;
  const co = doc.company || state.company;
  const primary = co.brandPrimary || DEFAULT_COLOURS.primary;
  const accent  = co.brandAccent  || DEFAULT_COLOURS.accent;
  const bg      = co.brandBg      || DEFAULT_COLOURS.bg;

  const sub    = (q.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatRate = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
  const disc   = parseFloat(q.discount) || 0;
  const afterDisc = sub - sub * disc / 100;
  const vatAmt = afterDisc * vatRate / 100;
  const total  = afterDisc + vatAmt;

  let docLabel = q.type || 'Estimate';
  let refLabel = q.ref || '';
  let dateLabel = q.date;
  let extraSection = '';

  if (docType === 'invoice') {
    docLabel = 'Invoice';
    refLabel = extra.invRef || '';
    dateLabel = extra.invDate || q.date;
    if (extra.dueDate) extraSection += `<div class="section"><h3>Payment Due</h3><p>${formatDate(extra.dueDate)}</p></div>`;
    if (extra.notes)   extraSection += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  } else if (docType === 'receipt') {
    docLabel = 'Receipt';
    extraSection += `
      <div class="section">
        <h3>Payment Received</h3>
        <p>Amount: <strong>${fmtPrice(parseFloat(extra.amount) || 0)}</strong><br>
        Date: ${formatDate(extra.date || todayStr())}<br>
        Method: ${esc(extra.method || '')}</p>
      </div>`;
    if (extra.notes) extraSection += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  }

  const bizLines = [
    co.businessName,
    (co.firstName + ' ' + co.lastName).trim(),
    co.address,
    co.postcode,
    co.phone,
    co.email,
    co.website
  ].filter(Boolean).join('\n');

  const custName = [q.custTitle, q.custFirstName, q.custLastName].filter(Boolean).join(' ');
  const custLines = [
    custName,
    q.custAddr,
    q.custPostcode,
    q.custPhone,
    q.custEmail
  ].filter(Boolean).join('\n');

  const itemsHtml = (q.items || []).map(item => `
    <tr>
      <td>${esc(item.name)}</td>
      <td>${esc(item.unit || '')}</td>
      <td style="text-align:right">${item.qty}</td>
      <td style="text-align:right">${fmtPrice(item.unitPrice)}</td>
      <td>${fmtPrice(item.unitPrice * item.qty)}</td>
    </tr>
  `).join('');

  const paymentSection = buildPaymentSection(co, docType);
  const termsSection   = buildTermsSection(q);
  const sigSection     = buildSigSection(q, co, docType);

  const validLine = (() => {
    if (!q.validFor || docType !== 'quote') return '';
    const days = q.validFor === 'custom' ? (q.validCustom || '') : q.validFor;
    return days ? `<p style="font-size:0.8rem;color:#888;margin-top:8px">Valid for ${days} days from ${formatDate(q.date)}</p>` : '';
  })();

  const notesSection = q.notes ? `<div class="section"><h3>Notes</h3><p>${esc(q.notes)}</p></div>` : '';

  const logoHtml = co.logo
    ? `<img src="${co.logo}" alt="Logo" class="doc-logo">`
    : '';

  return `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" rel="stylesheet">
    <style>${DOC_CSS}</style>
    <div class="doc-wrap">
      <div class="doc-header" style="background:${primary}">
        <div class="doc-header-left">
          ${logoHtml}
          <div class="doc-biz-name">${esc(co.businessName || (co.firstName + ' ' + co.lastName).trim())}</div>
        </div>
        <div>
          <div class="doc-type">${docLabel}</div>
          ${refLabel ? `<div class="doc-ref">${esc(refLabel)}</div>` : ''}
          ${dateLabel ? `<div class="doc-ref">${formatDate(dateLabel)}</div>` : ''}
        </div>
      </div>
      <div class="doc-info">
        <div>
          <h3>From</h3>
          <p>${esc(bizLines)}</p>
        </div>
        <div>
          <h3>Prepared For</h3>
          <p>${esc(custLines)}</p>
        </div>
      </div>
      <table>
        <thead style="background:${accent}">
          <tr>
            <th>Description</th>
            <th>Unit</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Unit Price</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end">
        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>${fmtPrice(sub)}</span></div>
          ${disc > 0 ? `<div class="totals-row"><span>Discount (${disc}%)</span><span>-${fmtPrice(sub * disc / 100)}</span></div>` : ''}
          ${vatRate > 0 ? `<div class="totals-row"><span>VAT (${vatRate}%)</span><span>${fmtPrice(vatAmt)}</span></div>` : ''}
          <div class="totals-row totals-total"><span>Total</span><span>${fmtPrice(total)}</span></div>
        </div>
      </div>
      ${validLine}
      ${notesSection}
      ${extraSection}
      ${paymentSection}
      ${termsSection}
      ${sigSection}
      <div class="doc-footer">
        <span>Generated by Lexi Handles It</span>
        <span>${new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}</span>
      </div>
    </div>
  `;
}

function buildPaymentSection(co, docType) {
  if (docType === 'receipt') return '';
  const methods = co.payMethods || [];
  let lines = [];

  if (methods.includes('bank') && co.bankAcc) {
    lines.push(`Bank Transfer\nAccount Name: ${co.bankAccHolder || ''}\nBank: ${co.bankName || ''}\nSort Code: ${co.bankSort || ''}\nAccount Number: ${co.bankAcc}`);
  }
  if (methods.includes('cash')) lines.push('Cash on Completion');
  if (methods.includes('paypal') && co.paypalRef) lines.push(`PayPal: ${co.paypalRef}`);
  if (methods.includes('other') && co.payOther)    lines.push(co.payOther);

  if (!lines.length) return '';
  return `<div class="section"><h3>Payment Details</h3><p>${esc(lines.join('\n\n'))}</p></div>`;
}

function buildTermsSection(q) {
  const presets = {
    payment30:       'Payment due within 30 days of invoice date.',
    depositRequired: 'A 50% deposit is required before work commences.',
    quotationValid:  'This quotation is valid for 30 days from the date shown.',
    materialsExtra:  'Materials are not included unless stated above.',
    cancellation:    'Cancellation within 48 hours of scheduled start date may incur a charge.'
  };
  const lines = (q.selectedTerms || []).map(k => presets[k]).filter(Boolean);
  if (q.customTerms) lines.push(q.customTerms);
  if (!lines.length) return '';
  return `<div class="section"><h3>Terms &amp; Conditions</h3><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

function buildSigSection(q, co, docType) {
  if (!q.authSig && !q.custSig && !getVal('custSigText')) return '';
  const authName = q.authSig || co.businessName || '';
  const authSigContent = q.custSig
    ? `<img src="${q.custSig}" class="sig-img">`
    : (document.getElementById('custSigText')?.value
        ? `<span class="sig-typed">${esc(document.getElementById('custSigText')?.value || '')}</span>`
        : '');

  return `
    <div class="sig-block">
      <div class="sig-box">
        ${authSigContent}
        ${authName ? `<div style="font-size:0.9rem;font-weight:600">${esc(authName)}</div>` : ''}
        <div class="sig-label">Authorised Signature</div>
      </div>
      <div class="sig-box">
        <div class="sig-label">Customer Signature &amp; Date</div>
      </div>
    </div>`;
}

/* ===== PRINT & SHARE ===== */
function getDocFilename(type) {
  const ref = getVal('docRef') || type;
  return `${ref}-${getVal('custLastName') || 'quote'}.html`.replace(/\s+/g, '-');
}

function getDocFilenameFromRef(ref) {
  return `${ref}.html`.replace(/\s+/g, '-');
}

function wrapDoc(inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document</title></head><body>${inner}</body></html>`;
}

function printDoc(html) {
  printRaw(html);
}

function printRaw(inner) {
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked. Please allow pop-ups for printing.', 'error'); return; }
  win.document.write(wrapDoc(inner));
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

async function sendDoc(html, filename) {
  sendDocRaw(wrapDoc(html), filename);
}

async function sendDocRaw(htmlStr, filename) {
  const blob = new Blob([htmlStr], { type: 'text/html' });
  const file = new File([blob], filename, { type: 'text/html' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Document from Lexi Handles It' });
      return;
    } catch(e) {
      if (e.name !== 'AbortError') console.warn('Share failed', e);
    }
  }

  // Fallback: download
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Document downloaded. Open WhatsApp or email and attach this file.', '', 5000);
}

/* ===== BACKUP & RESTORE ===== */
function exportData() {
  const data = {
    version: 1,
    company:   state.company,
    priceList: state.priceList,
    saved:     state.saved,
    refSeq:    localStorage.getItem(KEY_REF),
    invSeq:    localStorage.getItem(KEY_INV)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lexi-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup exported!', 'success');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.company && !data.priceList) throw new Error('Invalid backup file.');
      if (!confirm('This will replace all your current data. Continue?')) return;
      if (data.company)   state.company   = data.company;
      if (data.priceList) state.priceList = data.priceList;
      if (data.saved)     state.saved     = data.saved;
      if (data.refSeq)    localStorage.setItem(KEY_REF, data.refSeq);
      if (data.invSeq)    localStorage.setItem(KEY_INV, data.invSeq);
      save();
      populatePage1Fields();
      refreshPriceList();
      refreshSavedDocs();
      updateSavedBadge();
      toast('Backup restored!', 'success');
    } catch(err) {
      toast('Invalid backup file. Please check and try again.', 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

/* ===== UTILITIES ===== */
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtPrice(n) {
  return '£' + (parseFloat(n) || 0).toFixed(2);
}

function formatDate(str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return str; }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
