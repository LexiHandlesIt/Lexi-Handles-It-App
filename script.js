'use strict';

/* ===== CONFIG ===== */
const FORMSPREE_URL = 'YOUR_FORM_ID'; // Replace with your Formspree endpoint

/* ===== STORAGE KEYS ===== */
const KEY_CO   = 'tq_co';
const KEY_PL   = 'tq_pl';
const KEY_SAVED = 'tq_saved';
const KEY_REF   = 'tq_refseq';
const KEY_INV   = 'tq_invseq';
const KEY_REC   = 'tq_recseq';
const KEY_ONBOARDED    = 'tq_onboarded';
const KEY_PL_ONBOARDED = 'tq_pl_onboarded';
const KEY_PREVIEW_FIRST_SUPPRESSED = 'tq_preview_first_suppressed';

/* ===== DEFAULT COLOURS ===== */
const DEFAULT_COLOURS = { primary: '#7D5730', accent: '#6B7C5C', bg: '#F5F0E8' };

/* ===== COLOUR HELPERS ===== */
// Returns true when a hex colour is perceptually light (text should be dark)
function isColorLight(hex) {
  try {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.substr(0, 2), 16);
    const g = parseInt(full.substr(2, 2), 16);
    const b = parseInt(full.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
  } catch { return false; }
}

/* ===== STATE ===== */
let state = {
  company: {
    firstName: '', lastName: '', businessName: '',
    trade: '',
    phone: '', email: '', website: '', address: '', postcode: '',
    companyNumber: '',
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
    type: '',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: '', validFor: '14', validCustom: '',
    ref: '',
    items: [],
    vatRate: '20', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  },
  saved: [],
  editingDocId: null,       // when editing a saved doc
  editingFromTerms: false   // true when edit was launched from Job Terms in customer dashboard
};

/* ===== ACTIVE MODAL CONTEXT ===== */
let activeDocId = null;   // for invoice/receipt modals
let editingJobId = null;  // tracks inline edit to prevent search from blowing it away
let pendingRefNum = null; // ref number held in memory until quote is actually saved
let pendingReceiptDocId = null;
let pendingPreviewSend = null;
let activePhotoDocId = null;
let activeEditChoiceDocId = null;
let activeCustomerGroup = null;   // group object while customer dashboard is open
let receiptPreviewed = false;
let quotePreviewed = false;
let activeQuoteDraftDoc = null;
let voiceRecogniser = null;
let voiceRecording = false;
/* ===== PAYMENT HELPERS ===== */
// Sorts a payments array in-place by date ascending (Payment 1 = earliest)
function sortPaymentsByDate(payments) {
  payments.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// Returns doc.payments array, synthesising one entry from legacy paidAmount/paidDate if needed
function getDocPayments(doc) {
  // If doc.payments array exists and is authoritative, always use it (even if empty — empty means no payments)
  if (Array.isArray(doc.payments)) return doc.payments;
  // Legacy docs that only have paidAmount scalar
  if (doc.paidAmount > 0) return [{ amount: doc.paidAmount, date: doc.paidDate || todayStr() }];
  return [];
}
// Recalculates doc.paidAmount / doc.paid / doc.paidDate from doc.payments array
function recalcDocPayments(doc) {
  const payments = Array.isArray(doc.payments) ? doc.payments : [];
  doc.payments   = payments;
  doc.paidAmount = payments.reduce((s, p) => s + (p.amount || 0), 0);
  // Only mark paid if there is a real total > 0 AND paidAmount covers it
  doc.paid       = doc.total > 0 && doc.paidAmount >= doc.total;
  doc.paidDate   = payments.length ? payments[payments.length - 1].date : '';
}

function businessNameCompliment(name) {
  return "I've saved your details.";
}

function traderFirstName() {
  return (state.company.firstName || '').trim() || 'there';
}

function hasRequiredSetup() {
  return (state.company.firstName || '').trim() !== '' &&
         (state.company.lastName  || '').trim() !== '';
}

function requireSetupGuard() {
  toast('Please enter your first and last name to continue.', 'error');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page1')?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const el = document.getElementById('p1FirstName');
  if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('error'); }
}

function personaliseText() {
  const first = traderFirstName();
  const p1Sub = document.getElementById('page1Sub');
  if (p1Sub && document.getElementById('page1')?.classList.contains('active')) {
    const hasSetUp = (state.company.lastName || '').trim() !== '';
    p1Sub.textContent = hasSetUp
      ? `Brilliant ${first}, your business is progressing. Let's get your details up to date.`
      : `So what's your trade? Tell me about your business so I can customise your documents.`;
  }
  const p3Sub = document.getElementById('page3Sub');
  if (p3Sub) {
    p3Sub.textContent = `Hey ${first}, who is this for?`;
  }
  const pageJobsSub = document.getElementById('pageJobsSub');
  if (pageJobsSub) {
    const custFirst = (state.quote.custFirstName || '').trim();
    pageJobsSub.textContent = custFirst
      ? `What work are you doing for ${custFirst}?`
      : 'What work are you doing for this customer?';
  }
  const savedTitle = document.getElementById('savedJobsTitle');
  if (savedTitle) savedTitle.textContent = `${first}'s Jobs`;
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  setupOnboarding();
  setupNewJobPicker();
  setupDescriptionHelp();
  setupNavigation();
  setupNavHint();
  setupPage1();
  setupPage2();
  setupPage3();
  setupPageJobs();
  setupPageCompletion();
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
  populateAuthSig();
  personaliseText();

  // Returning user lands on their jobs page; new users start onboarding
  if (hasRequiredSetup()) {
    showPage('page4');
  } else {
    showPage('page1');
  }

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
  // Migrate: ensure every price list item has an id
  let needsSave = false;
  state.priceList.forEach(j => {
    if (!j.id) { j.id = uid(); needsSave = true; }
  });
  if (needsSave) ls(KEY_PL, state.priceList);
}

function ls(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function nextRef(prefix, key) {
  const n = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, n);
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${String(now.getDate()).padStart(2,'0')}${months[now.getMonth()]}${String(now.getFullYear()).slice(-2)}`;
  return `LEXI-${String(n).padStart(3, '0')}-${dateStr}`;
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

function showSavedPopup(label, onDone, duration = 2500) {
  const overlay = document.createElement('div');
  overlay.className = 'saved-popup-overlay';
  overlay.innerHTML = `
    <div class="saved-popup-box">
      <div class="saved-popup-tick">✓</div>
      <div class="saved-popup-msg">${label || "I've saved that for you."}</div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      if (onDone) onDone();
    }, 350);
  }, duration);
}

const KEY_NAV_HINT = 'tq_nav_hint_suppressed';

function showNavHint() {
  if (localStorage.getItem(KEY_NAV_HINT)) return;
  const popup = document.getElementById('navHintPopup');
  const msg = popup?.querySelector('.nav-hint-msg');
  if (msg) {
    msg.innerHTML = `What would you like to do next ${traderFirstName()}? Use the menu <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" style="vertical-align:-2px;display:inline-block" aria-hidden="true"><circle cx="12" cy="5" r="2.5" fill="currentColor"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="19" r="2.5" fill="currentColor"/></svg> above to explore everything Lexi can help you with.`;
  }
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
  if (pageId !== 'page1' && !hasRequiredSetup()) {
    requireSetupGuard();
    return;
  }
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
        p1Title.innerHTML = 'Edit My Business';
      } else {
        p1Title.innerHTML = '<span class="page-num">1.</span> Set Up Your Business';
      }
    }
    if (p1Sub) {
      if (hasSetUp) {
        p1Sub.textContent = `Brilliant ${traderFirstName()}, your business is progressing. Let's get your details up to date.`;
        p1Sub.style.display = '';
        p1Sub.style.textAlign = 'left';
      } else {
        p1Sub.textContent = `So what's your trade? Tell me about your business so I can customise your documents.`;
        p1Sub.style.display = '';
        p1Sub.style.textAlign = '';
      }
    }
  }

  // Update page1 footer button based on whether price list exists
  if (pageId === 'page1') {
    updatePriceListBtn();
  }

  // Update page2 header based on whether price list already has content
  if (pageId === 'page2') {
    updatePage2Header();
  }

  personaliseText();

  // Update page3 title
  if (pageId === 'page3') {
    const titleEl = document.getElementById('page3Title');
    if (titleEl) titleEl.textContent = 'Add Customer';
  }

  // Ensure signature preview is always populated when reaching the completion page
  if (pageId === 'page-completion') {
    const authSig = document.getElementById('authSig');
    const custSigText = document.getElementById('custSigText');
    if (authSig && custSigText && !custSigText.value && !custSigText.dataset.userEdited) {
      custSigText.value = authSig.value;
    }
    // Personalise the intro text with the customer's first name
    const introEl = document.getElementById('completionIntroText');
    if (introEl) {
      const first = (state.quote.custFirstName || '').trim();
      introEl.textContent = `${first ? first + ', ' : ''}is this an estimate or a quote?`;
    }
    // Close tooltip if it was left open
    const tooltip = document.getElementById('estQuoteTooltip');
    if (tooltip) tooltip.style.display = 'none';
  }
}

function updatePriceListBtn() {
  const btn = document.getElementById('goToPriceListBtn');
  if (!btn) return;
  if (state.priceList.length > 0) {
    btn.innerHTML = 'Edit My Price List';
  } else {
    btn.innerHTML = 'Add Price List';
  }
}

function updatePage2Header() {
  const title = document.getElementById('page2Title');
  const sub   = document.getElementById('page2Sub');
  if (state.priceList.length > 0) {
    if (title) title.textContent = 'Edit My Price List';
    if (sub) {
      sub.textContent = `${traderFirstName()}, expanding your offer or focusing on a niche? Make sure you charge the price you deserve for your expertise.`;
      sub.style.display = '';
    }
  } else {
    if (title) title.innerHTML = '<span class="page-num">2.</span> Build Your Price List';
    if (sub) { sub.textContent = `${traderFirstName()}, add the jobs you do most. You can always edit these later.`; sub.style.display = ''; }
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
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    const onCompletion = document.getElementById('page-completion')?.classList.contains('active');
    if (onCompletion && !state.quote.type) { docTypeGuard(); return; }
    navMenu.classList.contains('open') ? closeMenu() : openMenu();
  });
  overlay.addEventListener('click', closeMenu);

  // Menu items + any other [data-target] elements (e.g. what-next-bar)
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const onCompletion = document.getElementById('page-completion')?.classList.contains('active');
      if (onCompletion && !state.quote.type) {
        closeMenu();
        docTypeGuard();
        return;
      }
      closeMenu();
      if (target === 'page3') prepareNewQuote();
      showPage(target);
    });
  });

  // New Invoice from menu
  document.getElementById('menuNewInvoice')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    closeMenu();
    openClientPicker('invoice');
  });

  // New Receipt from menu
  document.getElementById('menuNewReceipt')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    closeMenu();
    openClientPicker('receipt');
  });


  document.getElementById('menuBizInfo')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    closeMenu();
    openBizInfoModal();
  });

  document.getElementById('menuShareLexi')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    closeMenu();
    shareLexiApp();
  });

  // Backup & Restore menu item
  const backupBtn = document.getElementById('menuBackupRestore');
  if (backupBtn) {
    backupBtn.addEventListener('click', () => {
      if (!hasRequiredSetup()) { requireSetupGuard(); return; }
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
    if (!saveBusinessDetails(false)) return;
    // Skip onboarding if they already have prices OR have seen it before
    if (!localStorage.getItem(KEY_PL_ONBOARDED) && state.priceList.length === 0) {
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
    if (state.priceList.length === 0) {
      showSavedPopup("Add at least one job to your price list before creating an estimate or quote.");
      return;
    }
    showPage('page3');
  });
  document.getElementById('saveCustomerGoToJobsBtn')?.addEventListener('click', () => {
    const first = (getVal('custFirstName') || '').trim();
    const last  = (getVal('custLastName')  || '').trim();
    if (!first && !last) {
      toast('Please enter the customer\'s first or last name.', 'error');
      document.getElementById('custFirstName').focus();
      return;
    }
    showPage('page-jobs');
    setVal('jobPickerSearch', '');
    updateJobPicker();
    renderQuoteItems();
    setTimeout(() => document.getElementById('jobPickerSearch')?.focus(), 300);
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

  // Logo colour extraction checkbox
  document.getElementById('useLogoColours').addEventListener('change', e => {
    if (e.target.checked) {
      extractLogoColours();
    } else {
      setColour('header', DEFAULT_COLOURS.primary);
      setColour('accent', DEFAULT_COLOURS.accent);
      setColour('bg',     DEFAULT_COLOURS.bg);
      updateColourPreview();
    }
  });

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
      document.getElementById('useLogoColours').checked = false;
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
    if (document.getElementById('useLogoColours')?.checked) {
      extractLogoColours();
    } else {
      showSavedPopup("Great Logo, you'll really stand out", null, 5000);
    }
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
  setVal('p1Address',      c.address);
  setVal('p1Postcode',      c.postcode);
  setVal('p1Phone',         c.phone);
  setVal('p1Email',         c.email);
  setVal('p1Website',       c.website);
  setVal('p1CompanyNumber', c.companyNumber || '');
  setVal('p1Trade',         c.trade || '');

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
  const firstName = getVal('p1FirstName').trim();
  const lastName = getVal('p1LastName').trim();
  if (!firstName) {
    document.getElementById('p1FirstName').classList.add('error');
    document.getElementById('p1FirstName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (showToast) toast('First name is required.', 'error');
    return false;
  }
  document.getElementById('p1FirstName').classList.remove('error');
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

  const colourChanged =
    (state.company.brandPrimary || DEFAULT_COLOURS.primary) !== document.getElementById('colourHeader').value ||
    (state.company.brandAccent  || DEFAULT_COLOURS.accent)  !== document.getElementById('colourAccent').value ||
    (state.company.brandBg      || DEFAULT_COLOURS.bg)      !== document.getElementById('colourBg').value;

  const methods = [];
  if (document.getElementById('payBankTransfer').checked) methods.push('bank');
  if (document.getElementById('payCash').checked)         methods.push('cash');
  if (document.getElementById('payPaypal').checked)       methods.push('paypal');
  if (document.getElementById('payOther').checked)        methods.push('other');

  state.company = {
    ...state.company,
    firstName:    firstName,
    lastName:     lastName,
    businessName: getVal('p1BusinessName'),
    trade:        getVal('p1Trade'),
    address:      getVal('p1Address'),
    postcode:     getVal('p1Postcode'),
    phone:        getVal('p1Phone'),
    email:        getVal('p1Email'),
    website:       getVal('p1Website'),
    companyNumber: getVal('p1CompanyNumber'),
    payMethods:    methods,
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
  personaliseText();
  if (showToast) showSavedPopup(
    businessNameCompliment(getVal('p1BusinessName') || (firstName + ' ' + lastName)),
    null,
    2500
  );
  return true;
}

/* ===== COLOUR PICKER ===== */
// HSV helpers
function hsvToRgb(h, s, v) {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i];
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: max ? d / max : 0, v: max };
}

function setupColourPicker(name, hexId, defaultVal) {
  const hexEl = document.getElementById(hexId);
  if (!hexEl) return;
  // Always use our custom picker — same UI on every device
  hexEl.addEventListener('pointerdown', e => { e.preventDefault(); openCustomColorPicker(hexEl); });
  hexEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCustomColorPicker(hexEl); }
  });
}

function openCustomColorPicker(inputEl) {
  document.querySelector('.ccp-overlay')?.remove();

  const startHex = inputEl.value || '#000000';
  const rgb0 = hexToRgb(startHex);
  const hsv0 = rgbToHsv(rgb0.r, rgb0.g, rgb0.b);
  let H = hsv0.h, S = hsv0.s, V = hsv0.v;

  const overlay = document.createElement('div');
  overlay.className = 'ccp-overlay';
  overlay.innerHTML = `
    <div class="ccp-panel" role="dialog" aria-label="Colour picker">
      <div class="ccp-header">
        <span class="ccp-title">Pick a colour</span>
        <button type="button" class="ccp-close" aria-label="Cancel">✕</button>
      </div>
      <div class="ccp-sv-wrap">
        <canvas class="ccp-sv-canvas"></canvas>
        <div class="ccp-sv-thumb"></div>
      </div>
      <div class="ccp-hue-wrap">
        <canvas class="ccp-hue-canvas"></canvas>
        <div class="ccp-hue-thumb"></div>
      </div>
      <div class="ccp-bottom">
        <div class="ccp-swatch"></div>
        <span class="ccp-hash">#</span>
        <input class="ccp-hex-input" type="text" maxlength="6" spellcheck="false">
        <button type="button" class="btn btn-primary ccp-done">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const panel    = overlay.querySelector('.ccp-panel');
  const svCanvas = overlay.querySelector('.ccp-sv-canvas');
  const hueCanvas= overlay.querySelector('.ccp-hue-canvas');
  const svThumb  = overlay.querySelector('.ccp-sv-thumb');
  const hueThumb = overlay.querySelector('.ccp-hue-thumb');
  const swatch   = overlay.querySelector('.ccp-swatch');
  const hexInput = overlay.querySelector('.ccp-hex-input');

  // Size canvases to match CSS layout
  function sizeCanvases() {
    const svW = svCanvas.offsetWidth   || 264;
    const svH = svCanvas.offsetHeight  || 160;
    const huW = hueCanvas.offsetWidth  || 264;
    const huH = hueCanvas.offsetHeight || 20;
    svCanvas.width  = svW;  svCanvas.height = svH;
    hueCanvas.width = huW; hueCanvas.height = huH;
  }

  function drawSV() {
    const ctx = svCanvas.getContext('2d');
    const W = svCanvas.width, H = svCanvas.height;
    const { r, g, b } = hsvToRgb(H, 1, 1);
    const gradX = ctx.createLinearGradient(0, 0, W, 0);
    gradX.addColorStop(0, '#fff');
    gradX.addColorStop(1, `rgb(${r},${g},${b})`);
    ctx.fillStyle = gradX; ctx.fillRect(0, 0, W, H);
    const gradY = ctx.createLinearGradient(0, 0, 0, H);
    gradY.addColorStop(0, 'rgba(0,0,0,0)');
    gradY.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradY; ctx.fillRect(0, 0, W, H);
  }

  function drawHue() {
    const ctx = hueCanvas.getContext('2d');
    const W = hueCanvas.width, H = hueCanvas.height;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) {
      const { r, g, b } = hsvToRgb(i * 60, 1, 1);
      grad.addColorStop(i / 6, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  }

  function positionThumbs() {
    const svW = svCanvas.offsetWidth, svH = svCanvas.offsetHeight;
    const huW = hueCanvas.offsetWidth;
    svThumb.style.left  = (S * svW) + 'px';
    svThumb.style.top   = ((1 - V) * svH) + 'px';
    hueThumb.style.left = (H / 360 * huW) + 'px';
  }

  function applyColour() {
    const { r, g, b } = hsvToRgb(H, S, V);
    const hex = rgbToHex(r, g, b);
    swatch.style.background = hex;
    hexInput.value = hex.replace('#', '');
    inputEl.value  = hex;
    updateColourPreview();
  }

  function canvasXY(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    const cy = (e.touches ? e.touches[0].clientY : e.clientY);
    return {
      x: Math.max(0, Math.min(1, (cx - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (cy - rect.top)  / rect.height))
    };
  }

  // SV drag
  let svDragging = false;
  function onSV(e) {
    e.preventDefault();
    const { x, y } = canvasXY(svCanvas, e);
    S = x; V = 1 - y;
    positionThumbs(); applyColour();
  }
  svCanvas.addEventListener('pointerdown', e => { svDragging = true; svCanvas.setPointerCapture(e.pointerId); onSV(e); });
  svCanvas.addEventListener('pointermove', e => { if (svDragging) onSV(e); });
  svCanvas.addEventListener('pointerup',   () => { svDragging = false; });

  // Hue drag
  let hueDragging = false;
  function onHue(e) {
    e.preventDefault();
    const { x } = canvasXY(hueCanvas, e);
    H = x * 360;
    drawSV(); positionThumbs(); applyColour();
  }
  hueCanvas.addEventListener('pointerdown', e => { hueDragging = true; hueCanvas.setPointerCapture(e.pointerId); onHue(e); });
  hueCanvas.addEventListener('pointermove', e => { if (hueDragging) onHue(e); });
  hueCanvas.addEventListener('pointerup',   () => { hueDragging = false; });

  // Hex input
  hexInput.addEventListener('input', () => {
    const v = '#' + hexInput.value.replace(/[^0-9a-f]/gi, '');
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      const rgb = hexToRgb(v);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      H = hsv.h; S = hsv.s; V = hsv.v;
      drawSV(); positionThumbs();
      swatch.style.background = v;
      inputEl.value = v; updateColourPreview();
    }
  });

  // Done / cancel
  overlay.querySelector('.ccp-done').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.ccp-close').addEventListener('click', () => {
    inputEl.value = startHex; updateColourPreview(); overlay.remove();
  });
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) { inputEl.value = startHex; updateColourPreview(); overlay.remove(); } });

  // Init — wait one frame for layout so offsetWidth is accurate
  requestAnimationFrame(() => {
    sizeCanvases();
    drawSV();
    drawHue();
    positionThumbs();
    applyColour();
  });
}

function hexToRgb(hex) {
  const clean = String(hex || '#000000').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('');
}

function clampRgb(v) {
  return Math.max(0, Math.min(255, parseInt(v, 10) || 0));
}

function setColour(name, hex) {
  const map = { header: 'colourHeader', accent: 'colourAccent', bg: 'colourBg' };
  const el = document.getElementById(map[name]);
  if (el) el.value = hex;
}

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

function extractLogoColours() {
  const logo = state.company.logo;
  if (!logo) {
    showSavedPopup('Sure, upload your logo so I can extract the colours');
    setTimeout(() => document.getElementById('logoFile').click(), 4000);
    return;
  }

  const img = new Image();
  img.onload = () => {
    // Draw onto a small canvas for speed
    const canvas = document.createElement('canvas');
    const MAX = 100;
    const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
    canvas.width  = Math.max(1, Math.round(img.width  * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let data;
    try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
    catch (e) { return; } // tainted canvas safety

    // Tally colours — quantize RGB to 32 levels per channel
    const tally = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;                         // skip transparent
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 230 && g > 230 && b > 230) continue;             // skip near-white
      if (r < 20  && g < 20  && b < 20)  continue;             // skip near-black
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      tally[key] = (tally[key] || 0) + 1;
    }

    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    // Pick up to 3 visually distinct colours from the most frequent
    const picked = [];
    for (const [key] of sorted) {
      if (picked.length >= 3) break;
      const [rq, gq, bq] = key.split(',').map(Number);
      const r = (rq << 3) + 4, g = (gq << 3) + 4, b = (bq << 3) + 4;
      const isDistinct = picked.every(p =>
        Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) > 60
      );
      if (picked.length === 0 || isDistinct) picked.push({ r, g, b });
    }

    if (!picked.length) {
      document.getElementById('useLogoColours').checked = false;
      showSavedPopup("Hmm, couldn't pull colours from this logo. Try adjusting manually.");
      return;
    }

    // Sort by luminance: darkest → header, next → accent
    picked.sort((a, b) => {
      const lum = c => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      return lum(a) - lum(b);
    });

    const header = picked[0];
    const accent = picked.length > 1 ? picked[1] : picked[0];

    // Background: very light tint derived from the header colour
    const bgR = Math.round(header.r * 0.12 + 242 * 0.88);
    const bgG = Math.round(header.g * 0.12 + 242 * 0.88);
    const bgB = Math.round(header.b * 0.12 + 242 * 0.88);

    setColour('header', rgbToHex(header.r, header.g, header.b));
    setColour('accent', rgbToHex(accent.r, accent.g, accent.b));
    setColour('bg',     rgbToHex(bgR, bgG, bgB));
    updateColourPreview();
    showSavedPopup('Done! Colours extracted from your logo.');
  };
  img.src = logo;
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

  // Paste zone: accept text or screenshot image
  document.getElementById('bulkPaste').addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          const zone = document.querySelector('.paste-zone');
          // Remove any existing preview
          const old = zone.querySelector('.paste-img-preview');
          if (old) old.remove();
          // Create preview
          const wrap = document.createElement('div');
          wrap.className = 'paste-img-preview';
          wrap.innerHTML = `<img src="${ev.target.result}" alt="Pasted price list">
            <button type="button" class="paste-img-clear" aria-label="Remove image">&#x2715;</button>`;
          zone.appendChild(wrap);
          wrap.querySelector('.paste-img-clear').addEventListener('click', () => wrap.remove());
        };
        reader.readAsDataURL(file);
        return; // image handled — stop checking items
      }
    }
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
      toast("Can't read your input - remember format: job, price", 'error');
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
      toast("Can't read your input - remember format: job, price", 'error');
    }
  };
  reader.readAsText(file);
}

function parseJobLines(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0, skipped = 0;
  lines.forEach(line => {
    let name, rest;
    const commaIdx = line.indexOf(',');
    if (commaIdx !== -1) {
      // Comma present: split on first comma
      name = line.slice(0, commaIdx).trim();
      rest = line.slice(commaIdx + 1).trim();
    } else {
      // No comma: find the last number (with optional currency symbol) at the end of the line
      const noCommaMatch = line.match(/^(.*)\s+[£$€]?([\d]+(?:\.\d{1,2})?)\s*$/);
      if (!noCommaMatch) { skipped++; return; }
      name = noCommaMatch[1].trim();
      rest = noCommaMatch[2];
    }
    const priceMatch = rest.match(/[£$€]?([\d,]+(?:\.\d+)?)/);
    if (!priceMatch) { skipped++; return; }
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    const afterPrice = rest.slice(priceMatch.index + priceMatch[0].length).replace(/^\s*,\s*/, '').trim();
    const unit = afterPrice || '';
    if (!name || isNaN(price)) { skipped++; return; }
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
      showSavedPopup('Added', null, 3000);
    });
    return;
  }

  addJob(name, price, unit);
  save();
  setVal('jobName',''); setVal('jobPrice',''); setVal('jobUnit','');
  refreshPriceList();
  updateJobPicker();
  showSavedPopup('Added', null, 3000);
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

  // Keep page1 button and page2 header in sync as the list changes
  updatePriceListBtn();
  updatePage2Header();

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
    <div class="price-item-edit-row">
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
    showSavedPopup("I've updated that job for you.");
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

/* ===== PAGE 3 — CUSTOMER DETAILS ===== */
function setupPage3() {
  // Doc type chooser now lives on page-completion — nothing needed here
}

/* ===== PAGE JOBS — ADD JOBS ===== */
function setupPageJobs() {
  // Job picker search
  document.getElementById('jobPickerSearch').addEventListener('input', () => updateJobPicker());

  // Picker click listeners are attached directly in updateJobPicker()

  // Custom item
  document.getElementById('addCustomItemBtn').addEventListener('click', addCustomItem);

  // Mic / voice button
  document.getElementById('voiceBtn')?.addEventListener('click', toggleVoice);

  // Back to customer details
  document.getElementById('backToCustomerBtn')?.addEventListener('click', () => {
    showPage('page3');
  });

  // Save and go to completion
  document.getElementById('saveJobsGoToCompletionBtn')?.addEventListener('click', () => {
    recalcTotals();
    const titleEl = document.querySelector('#page-completion .page-title');
    if (titleEl) titleEl.textContent = 'Save';
    showPage('page-completion');
  });
}

/* ===== PAGE COMPLETION — TOTALS, SIGNATURE & SAVE ===== */
function setupPageCompletion() {
  // Doc type radio checkboxes
  document.getElementById('dtEstimate').addEventListener('change', () => setDocType('Estimate'));
  document.getElementById('dtQuote').addEventListener('change',    () => setDocType('Quote'));

  // Estimate vs Quote tooltip
  document.getElementById('estQuoteTooltipBtn').addEventListener('click', () => {
    const t = document.getElementById('estQuoteTooltip');
    t.style.display = t.style.display === 'none' ? 'block' : 'none';
  });

  // Valid for
  document.getElementById('docValidFor').addEventListener('change', e => {
    document.getElementById('validCustomGroup').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });

  // VAT
  document.getElementById('vatSelect').addEventListener('change', e => {
    document.getElementById('vatCustom').style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
    recalcTotals();
  });
  document.getElementById('vatCustom').addEventListener('input', recalcTotals);

  // Discount
  document.getElementById('discountPct').addEventListener('change', e => {
    document.getElementById('discountCustom').style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
    recalcTotals();
  });
  document.getElementById('discountCustom').addEventListener('input', recalcTotals);

  // Sync signature preview whenever the Authorised Signature name changes
  document.getElementById('authSig').addEventListener('input', () => {
    const sigText = document.getElementById('custSigText');
    // Only auto-sync if the user hasn't manually edited the preview
    if (!sigText.dataset.userEdited) {
      sigText.value = document.getElementById('authSig').value;
    }
  });
  document.getElementById('custSigText').addEventListener('input', () => {
    // Mark as manually edited so auto-sync stops overwriting it
    document.getElementById('custSigText').dataset.userEdited = '1';
  });

  // Quote footer buttons
  document.getElementById('previewQuoteBtn').addEventListener('click', () => { if (docTypeGuard()) openPreview(buildQuoteDoc(), 'quote'); });
  document.getElementById('saveQuoteBtn').addEventListener('click', saveQuote);
  document.getElementById('printQuoteBtn').addEventListener('click', () => { if (docTypeGuard()) printDoc(buildQuoteDoc()); });
  document.getElementById('sendQuoteBtn').addEventListener('click', () => { if (docTypeGuard()) openQuoteModalFromCurrentForm(); });

  // Signature canvas
  setupSignatureCanvas();
}

function setDocType(type) {
  state.quote.type = type;
  const estEl = document.getElementById('dtEstimate');
  const quoteEl = document.getElementById('dtQuote');
  if (estEl) estEl.checked = (type === 'Estimate');
  if (quoteEl) quoteEl.checked = (type === 'Quote');
  generateRef();
  personaliseText();
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
    type: '',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: todayStr(), validFor: '14', validCustom: '',
    ref: buildRef(pendingRefNum),
    items: [],
    vatRate: '20', vatCustom: '',
    discount: '0',
    notes: '', privateNotes: '',
    selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  };
  state.editingDocId = null;
  const saveBtn = document.getElementById('saveQuoteBtn');
  if (saveBtn) saveBtn.textContent = '✓ Save';
  populateQuoteForm();
}

function loadQuoteFromDoc(doc) {
  const q = doc.quote || {};
  state.quote = {
    ...q,
    // Deep-copy items so editing never mutates the stored doc's array
    items: (q.items || []).map(i => ({ ...i }))
  };
  populateQuoteForm();
}

function populateQuoteForm() {
  const q = state.quote;
  setDocType(q.type || '');
  setVal('custTitle',     q.custTitle);
  setVal('custFirstName', q.custFirstName);
  setVal('custLastName',  q.custLastName);
  setVal('custAddr',      q.custAddr);
  setVal('custPostcode',  q.custPostcode);
  setVal('custPhone',     q.custPhone);
  setVal('custEmail',     q.custEmail);
  setVal('docRef',        q.ref);
  setVal('docDate',       q.date || todayStr());
  setVal('docValidFor',   q.validFor || '14');
  setVal('docValidCustom',q.validCustom || '');
  setVal('quoteNotes',    q.notes);
  setVal('quotePrivateNotes', q.privateNotes);
  setVal('customTerms',   q.customTerms || '');
  const traderName = (state.company.firstName + ' ' + state.company.lastName).trim() || state.company.businessName || '';
  const sigName = q.authSig || traderName;
  setVal('authSig',     sigName);
  // Always show the name in the signature preview — never blank
  setVal('custSigText', q.custSigText || sigName);
  // Reset user-edited flag so authSig changes still sync
  const sigEl = document.getElementById('custSigText');
  if (sigEl) delete sigEl.dataset.userEdited;
  // Set discount select (backwards-compat: old docs stored any number, new ones use preset or 'custom')
  const savedDisc = String(q.discount || '0');
  const discPresets = ['0', '5', '10', '20'];
  if (discPresets.includes(savedDisc)) {
    document.getElementById('discountPct').value = savedDisc;
    document.getElementById('discountCustom').style.display = 'none';
    setVal('discountCustom', '');
  } else {
    document.getElementById('discountPct').value = 'custom';
    setVal('discountCustom', savedDisc);
    document.getElementById('discountCustom').style.display = 'inline-block';
  }
  setVal('vatCustom',     q.vatCustom || '');
  document.getElementById('vatSelect').value = q.vatRate || '20';
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
  const name = (state.company.firstName + ' ' + state.company.lastName).trim() || state.company.businessName || '';
  const authSigEl = document.getElementById('authSig');
  if (authSigEl && !authSigEl.value) authSigEl.value = name;
  const custSigEl = document.getElementById('custSigText');
  if (custSigEl && !custSigEl.value && !custSigEl.dataset.userEdited) custSigEl.value = name;
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
  if (!container) return;

  container.innerHTML = '';

  if (!filtered.length) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#888;font-size:0.85rem;padding:8px 0';
    msg.textContent = q ? 'No jobs match your search.' : 'No jobs in your price list yet.';
    container.appendChild(msg);
    return;
  }

  filtered.forEach(item => {
    const quoteItem = (state.quote.items || []).find(qi => qi.id === item.id || qi.name === item.name);
    const inQuote = !!quoteItem;
    const qty = quoteItem ? quoteItem.qty : 0;

    const el = document.createElement('div');
    el.className = 'pick-item' + (inQuote ? ' added' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Add ' + (item.name || '') + ' to quote');
    el.innerHTML = `
      <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
      <span class="pick-price">${fmtPrice(item.price)}</span>
      <span class="pick-add-btn">${inQuote ? qty : '+'}</span>
    `;

    const doAdd = () => addJobToQuote(item.id || item.name);
    el.addEventListener('click', doAdd);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doAdd(); } });

    container.appendChild(el);
  });
}


function addJobToQuote(jobId) {
  // Match by id first, fall back to name (handles legacy items without ids)
  const job = state.priceList.find(j => j.id === jobId) || state.priceList.find(j => j.name === jobId);
  if (!job) return;
  // Ensure the job has an id going forward
  if (!job.id) { job.id = uid(); ls(KEY_PL, state.priceList); }
  const existing = state.quote.items.find(i => i.id === job.id || i.name === job.name);
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

  if (!Array.isArray(state.quote.items)) state.quote.items = [];

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
  const subtotal  = (state.quote.items || []).reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const vatSel    = document.getElementById('vatSelect').value;
  const vatRate   = vatSel === 'custom' ? parseFloat(getVal('vatCustom')) || 0 : parseFloat(vatSel) || 0;
  const discSel   = document.getElementById('discountPct').value;
  const discPct   = discSel === 'custom' ? parseFloat(getVal('discountCustom')) || 0 : parseFloat(discSel) || 0;
  const discount  = subtotal * discPct / 100;
  const afterDisc = subtotal - discount;
  const vatAmt    = afterDisc * vatRate / 100;
  const total     = afterDisc + vatAmt;

  document.getElementById('qSubtotal').textContent  = fmtPrice(subtotal);
  document.getElementById('qVatAmount').textContent  = fmtPrice(vatAmt);
  document.getElementById('qDiscount').textContent   = `-${fmtPrice(discount)}`;
  document.getElementById('qTotal').textContent      = fmtPrice(total);

  // Show/hide discount and VAT rows in the totals block
  const discountRow = document.getElementById('discountRow');
  const vatRow = document.getElementById('vatRow');
  if (discountRow) discountRow.style.display = discount > 0 ? '' : 'none';
  if (vatRow) vatRow.style.display = vatAmt > 0 ? '' : 'none';
}

function collectQuoteState() {
  const vatSel  = document.getElementById('vatSelect').value;
  const discSel = document.getElementById('discountPct').value;
  const discount = discSel === 'custom' ? getVal('discountCustom') : discSel;
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
    discount:      discount,
    notes:         getVal('quoteNotes'),
    privateNotes:  getVal('quotePrivateNotes'),
    selectedTerms,
    customTerms:   getVal('customTerms'),
    authSig:       getVal('authSig'),
    custSigText:   getVal('custSigText'),
    custSig:       '',
    sigDate:       todayStr()
  };
}

function docTypeGuard() {
  if (!state.quote.type) {
    const first = (state.quote.custFirstName || '').trim();
    showSavedPopup(`Before we move on${first ? ' ' + first : ''}, is this a fixed quote or an estimate?`, null, 5000);
    document.getElementById('dtEstimate')?.closest('.doc-type-chooser')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

function saveQuote() {
  if (!docTypeGuard()) return;
  const q = collectQuoteState();
  // Always use the live items array directly from state
  q.items = [...state.quote.items];
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    document.getElementById('custFirstName').focus();
    return;
  }

  const isEditing = !!state.editingDocId;
  const returningFromTerms = !!state.editingFromTerms;
  const docType   = q.type || 'Document';

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
    state.editingFromTerms = false;
    // Reset save button label
    const saveBtn = document.getElementById('saveQuoteBtn');
    if (saveBtn) saveBtn.textContent = '✓ Save';
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
      paidDate: '',
      payments: []
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
  const popupLabel = isEditing ? "I've saved your changes." : `I've saved your ${docType.toLowerCase()}.`;

  if (returningFromTerms && activeCustomerGroup) {
    // Came from Job Terms edit via customer dashboard — go back to dashboard
    showSavedPopup(popupLabel, () => {
      try {
        const groups = buildCustomerGroups();
        const updated = groups.find(g => g.docs.some(d =>
          activeCustomerGroup.docs.some(ad => ad.id === d.id)
        )) || activeCustomerGroup;
        activeCustomerGroup = updated;
        renderSingleCustomerDashboard(updated, groups);
        document.getElementById('customerDashboardModal').style.display = 'flex';
      } catch(e) { console.error('Dashboard reopen error:', e); }
    });
  } else {
    showSavedPopup(popupLabel);
    showPage('page4');
    showNavHint();
  }
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

/* ===== VOICE RECOGNITION ===== */
function toggleVoice() {
  const isSR = ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  if (!isSR) {
    toast('Voice input needs Chrome or Edge.', 'error');
    return;
  }
  if (voiceRecording) {
    voiceRecogniser && voiceRecogniser.stop();
    stopVoiceUI();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  voiceRecogniser = new SR();
  voiceRecogniser.continuous     = false;
  voiceRecogniser.interimResults = false;
  voiceRecogniser.lang           = 'en-GB';
  voiceRecogniser.maxAlternatives = 1;

  voiceRecogniser.onstart = () => {
    voiceRecording = true;
    document.getElementById('voiceBtn')?.classList.add('recording');
    showVoiceBox('Listening… speak a job name.');
  };
  voiceRecogniser.onresult = e => {
    const transcript = e.results[0][0].transcript;
    showVoiceBox(`Heard: "${transcript}"`);
    matchVoiceToJob(transcript);
  };
  voiceRecogniser.onerror = e => {
    const msgs = {
      'not-allowed':  'Microphone access denied. Please allow mic access in your browser settings.',
      'no-speech':    'No speech detected. Tap the mic and try again.',
      'network':      'Voice needs an internet connection and HTTPS to work.',
      'audio-capture':'No microphone found. Check your device settings.',
      'aborted':      ''
    };
    const msg = msgs[e.error] || `Voice error: ${e.error}. Try using the search instead.`;
    if (msg) toast(msg, 'error');
    stopVoiceUI();
  };
  voiceRecogniser.onend = () => stopVoiceUI();
  voiceRecogniser.start();
}

function stopVoiceUI() {
  voiceRecording = false;
  document.getElementById('voiceBtn')?.classList.remove('recording');
}

function showVoiceBox(msg) {
  const box = document.getElementById('voiceBox');
  if (!box) return;
  box.textContent = msg;
  box.classList.remove('hidden');
}

function matchVoiceToJob(transcript) {
  const t = transcript.toLowerCase().trim();
  // Find all matches
  const matches = state.priceList.filter(j => j.name.toLowerCase().includes(t) || t.includes(j.name.toLowerCase()));

  if (matches.length === 1) {
    // Exactly one match — add it directly
    addJobToQuote(matches[0].id || matches[0].name);
    showVoiceBox(`Added: ${matches[0].name}`);
    setTimeout(() => document.getElementById('voiceBox')?.classList.add('hidden'), 2500);
    return;
  }

  if (matches.length > 1) {
    // Multiple matches — ask which one
    document.getElementById('voiceBox')?.classList.add('hidden');
    const list = document.getElementById('voicePickList');
    list.innerHTML = '';
    matches.forEach(j => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vpick-btn';
      btn.innerHTML = `<span>${esc(j.name)}</span><span class="vpick-btn-price">${fmtPrice(j.price)}</span>`;
      btn.addEventListener('click', () => {
        addJobToQuote(j.id || j.name);
        document.getElementById('voicePickModal').style.display = 'none';
      });
      list.appendChild(btn);
    });
    document.getElementById('voicePickModal').style.display = 'flex';
    return;
  }

  // No match — open the "not found" modal pre-filled with what was heard
  document.getElementById('voiceBox')?.classList.add('hidden');
  setVal('vnfName', transcript);
  setVal('vnfPrice', '');
  setVal('vnfUnit', '');
  document.getElementById('voiceNotFoundModal').style.display = 'flex';
  setTimeout(() => document.getElementById('vnfPrice')?.focus(), 150);
}

function closeVoiceNotFoundModal() {
  document.getElementById('voiceNotFoundModal').style.display = 'none';
}

function vnfSubmit(saveToList) {
  const name  = (getVal('vnfName') || '').trim();
  const price = parseFloat(getVal('vnfPrice'));
  const unit  = (getVal('vnfUnit') || '').trim();
  if (!name) { document.getElementById('vnfName').classList.add('error'); return; }
  if (isNaN(price) || price < 0) { document.getElementById('vnfPrice').classList.add('error'); return; }
  document.getElementById('vnfName').classList.remove('error');
  document.getElementById('vnfPrice').classList.remove('error');

  if (saveToList) {
    // Add to price list
    state.priceList.push({ id: uid(), name, price, unit });
    save();
    refreshPriceList();
  }

  // Add to current quote as a one-off item
  state.quote.items.push({ id: uid(), name, unitPrice: price, unit, qty: 1 });
  renderQuoteItems();
  recalcTotals();
  updateJobPicker();
  closeVoiceNotFoundModal();
  toast(saveToList ? 'Added to your price list and this job.' : 'Added to this job.', 'success');
}

/* ===== DESCRIPTION HELP POPUP ===== */
function setupDescriptionHelp() {
  const btn   = document.getElementById('descHelpBtn');
  const popup = document.getElementById('descHelpPopup');
  const close = document.getElementById('descHelpClose');
  if (!btn || !popup) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
  });
  close?.addEventListener('click', () => { popup.style.display = 'none'; });
  document.addEventListener('click', e => {
    if (!popup.contains(e.target) && e.target !== btn) {
      popup.style.display = 'none';
    }
  });
}

/* ===== NEW JOB CUSTOMER PICKER ===== */
function openNewJobPicker() {
  document.getElementById('newJobPickerModal').style.display = 'flex';
}
function closeNewJobPicker() {
  document.getElementById('newJobPickerModal').style.display = 'none';
}
function openExistingCustPicker() {
  closeNewJobPicker();
  const modal = document.getElementById('existingCustPickerModal');
  modal.style.display = 'flex';
  renderExistingCustList('');
  const search = document.getElementById('existingCustSearch');
  if (search) { search.value = ''; search.focus(); }
}
function closeExistingCustPicker() {
  document.getElementById('existingCustPickerModal').style.display = 'none';
}

function renderExistingCustList(query) {
  const q = (query || '').toLowerCase().trim();
  // Collect unique customers from saved docs
  const seen = new Map();
  state.saved.forEach(doc => {
    const quote = doc.quote || {};
    const name  = buildCustName(quote) || doc.custName || '';
    if (!name) return;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, doc, quote });
  });
  let entries = [...seen.values()];
  if (q) entries = entries.filter(e => e.name.toLowerCase().includes(q));
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const list  = document.getElementById('existingCustList');
  const empty = document.getElementById('existingCustEmpty');
  list.innerHTML = '';

  if (!entries.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  entries.forEach(({ name, doc }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'text-align:left;padding:10px 14px;font-size:0.88rem;border-radius:10px';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      closeExistingCustPicker();
      // Pre-fill the quote state with this customer's details then go to Add Jobs
      const q = doc.quote || {};
      prepareNewQuote();
      state.quote.custTitle     = q.custTitle     || '';
      state.quote.custFirstName = q.custFirstName || '';
      state.quote.custLastName  = q.custLastName  || '';
      state.quote.custAddr      = q.custAddr      || '';
      state.quote.custPostcode  = q.custPostcode  || '';
      state.quote.custPhone     = q.custPhone     || '';
      state.quote.custEmail     = q.custEmail     || '';
      populateQuoteForm();
      showPage('page-jobs');
    });
    list.appendChild(btn);
  });
}

function setupNewJobPicker() {
  document.getElementById('closeNewJobPickerBtn')?.addEventListener('click', closeNewJobPicker);
  document.getElementById('newJobExistingBtn')?.addEventListener('click', openExistingCustPicker);
  document.getElementById('newJobNewBtn')?.addEventListener('click', () => {
    closeNewJobPicker();
    prepareNewQuote();
    showPage('page3');
  });
  document.getElementById('closeExistingCustPickerBtn')?.addEventListener('click', closeExistingCustPicker);
  document.getElementById('existingCustSearch')?.addEventListener('input', e => renderExistingCustList(e.target.value));
  // Close on backdrop click
  document.getElementById('newJobPickerModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNewJobPicker();
  });
  document.getElementById('existingCustPickerModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeExistingCustPicker();
  });
}

/* ===== PAGE 4 — SAVED DOCS ===== */
function setupPage4() {
  // "New Job" button in page header — opens customer picker
  document.getElementById('newJobBtn')?.addEventListener('click', () => {
    // If there are saved customers, offer the picker; otherwise go straight to Add Customer
    const hasSavedCustomers = state.saved.some(d => {
      const q = d.quote || {};
      return (buildCustName(q) || d.custName || '').trim() !== '';
    });
    if (hasSavedCustomers) {
      openNewJobPicker();
    } else {
      prepareNewQuote();
      showPage('page3');
    }
  });

  const sel = document.getElementById('savedFilterSelect');
  if (sel) sel.addEventListener('change', () => refreshSavedDocs());

  const expSel = document.getElementById('exportSelect');
  if (expSel) {
    expSel.addEventListener('change', () => {
      const val = expSel.value;
      if (!val) return;
      exportDocsCSV(val);
    });
  }
}

function refreshSavedDocs() {
  const sel    = document.getElementById('savedFilterSelect');
  const filter = sel ? sel.value : 'all';
  const container = document.getElementById('savedDocsList');
  const empty     = document.getElementById('savedDocsEmpty');

  let docs = [...state.saved];
  if      (filter === 'Estimate') docs = docs.filter(d => d.type === 'Estimate');
  else if (filter === 'Quote')    docs = docs.filter(d => d.type === 'Quote');
  else if (filter === 'invoiced') docs = docs.filter(d => d.invoiceSent && !d.paid);
  else if (filter === 'overdue')  docs = docs.filter(d => !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate);
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
    const docType = doc.type || (doc.quote && doc.quote.type) || 'Estimate';
    const isOverdue = !doc.paid && doc.invoiceSent && doc.invoiceDueDate && todayStr() > doc.invoiceDueDate;
    const statusBadge = doc.paid ? 'paid' : isOverdue ? 'overdue' : doc.invoiceSent ? 'invoiced' : docType.toLowerCase();
    card.className = `saved-doc-card status-${statusBadge}`;
    const statusLabel = doc.paid ? 'Paid' : isOverdue ? `Overdue since ${formatDate(doc.invoiceDueDate)}` : doc.invoiceSent ? 'Invoiced' : docType;

    // Payment totals for card status only (history shown in modal, not on card)
    const payments   = getDocPayments(doc);
    const totalPaid  = payments.reduce((s, p) => s + (p.amount || 0), 0);

    card.innerHTML = `
      <div class="saved-doc-header">
        <div>
          <span class="saved-doc-name">${esc(doc.custName || 'Unknown Customer')}</span>
          <div class="saved-doc-ref">${esc(doc.ref || '')} &bull; ${formatDate(doc.date)}</div>
        </div>
        <div style="text-align:right">
          <div class="saved-doc-total">${fmtPrice(doc.total || 0)}</div>
          <span class="type-badge ${statusBadge}">${statusLabel}</span>
        </div>
      </div>
      <div class="journey-btns">
        <button type="button" class="journey-btn btn-send-quote" data-id="${doc.id}">
          <span class="jb-circle">A</span> ${esc(docType)}
        </button>
        <button type="button" class="journey-btn btn-send-invoice" data-id="${doc.id}">
          <span class="jb-circle">B</span> Invoice
        </button>
        <button type="button" class="journey-btn btn-send-receipt" data-id="${doc.id}">
          <span class="jb-circle">C</span> Receipt
        </button>
      </div>
      <div class="saved-doc-payment-tally">
        <span class="sdpt-payment-info">
          ${totalPaid > 0
            ? `<span class="sdpt-paid">Paid ${fmtPrice(totalPaid)}</span>${totalPaid < (doc.total || 0) ? `<span class="sdpt-outstanding">&middot; ${fmtPrice(Math.max(0, (doc.total || 0) - totalPaid))} outstanding</span>` : '<span class="sdpt-full">&#10003; Paid in full</span>'}`
            : ''}
        </span>
        <button type="button" class="btn-view-customer" data-id="${doc.id}">View Customer</button>
      </div>
    `;

    container.appendChild(card);

    card.querySelector('.btn-send-quote').addEventListener('click', () => openQuoteModal(doc.id));
    card.querySelector('.btn-send-invoice').addEventListener('click', () => previewInvoice(doc.id));
    card.querySelector('.btn-send-receipt').addEventListener('click', () => handleReceiptRequest(doc.id));
    card.querySelector('.btn-view-customer').addEventListener('click', () => openCustomerDashboardForDoc(doc.id));
  });
}

function exportDocsCSV(filter) {
  // Apply the same filter logic as refreshSavedDocs
  let docs = [...state.saved];
  if      (filter === 'Estimate') docs = docs.filter(d => d.type === 'Estimate');
  else if (filter === 'Quote')    docs = docs.filter(d => d.type === 'Quote');
  else if (filter === 'invoiced') docs = docs.filter(d => d.invoiceSent && !d.paid);
  else if (filter === 'overdue')  docs = docs.filter(d => !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate);
  else if (filter === 'paid')     docs = docs.filter(d => d.paid);
  else if (filter === 'unpaid')   docs = docs.filter(d => !d.paid);

  if (!docs.length) {
    toast('No jobs match that filter to export.', 'error');
    return;
  }

  // CSV helper — wraps a value in quotes and escapes internal quotes
  const csv = v => {
    const s = String(v == null ? '' : v).replace(/"/g, '""');
    return `"${s}"`;
  };

  const headers = [
    'Reference', 'Type', 'Date', 'Valid For',
    'Title', 'First Name', 'Last Name',
    'Address', 'Postcode', 'Phone', 'Email',
    'Jobs', 'Subtotal (£)', 'Discount (%)', 'VAT (%)', 'Total (£)',
    'Invoice Sent', 'Paid', 'Amount Paid (£)', 'Date Paid',
    'Notes'
  ];

  const rows = docs.map(doc => {
    const q   = doc.quote || {};
    const items = (q.items || []).map(i => `${i.name} x${i.qty} @ £${(i.unitPrice||0).toFixed(2)}`).join('; ');

    const sub     = (q.items || []).reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
    const vatRate = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
    const disc    = parseFloat(q.discount) || 0;
    const after   = sub - sub * disc / 100;
    const total   = after + after * vatRate / 100;

    const validFor = q.validFor === 'custom'
      ? (q.validCustom ? q.validCustom + ' days' : '')
      : (q.validFor ? q.validFor + ' days' : '');

    return [
      csv(doc.ref      || q.ref      || ''),
      csv(doc.type     || q.type     || ''),
      csv(doc.date     || q.date     || ''),
      csv(validFor),
      csv(q.custTitle     || ''),
      csv(q.custFirstName || ''),
      csv(q.custLastName  || ''),
      csv(q.custAddr      || ''),
      csv(q.custPostcode  || ''),
      csv(q.custPhone     || ''),
      csv(q.custEmail     || ''),
      csv(items),
      csv(sub.toFixed(2)),
      csv(disc || '0'),
      csv(vatRate || '0'),
      csv((doc.total != null ? doc.total : total).toFixed(2)),
      csv(doc.invoiceSent ? 'Yes' : 'No'),
      csv(doc.paid ? 'Yes' : (doc.paidAmount > 0 ? 'Partial' : 'No')),
      csv(doc.paidAmount ? doc.paidAmount.toFixed(2) : ''),
      csv(getDocPayments(doc).map(p => `${fmtPrice(p.amount)} on ${formatDate(p.date)}`).join('; ') || ''),
      csv(q.notes || '')
    ].join(',');
  });

  const csvContent = [headers.map(h => csv(h)).join(','), ...rows].join('\r\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const filterLabel = { all: 'All', Estimate: 'Estimates', Quote: 'Quotes', invoiced: 'Invoiced', overdue: 'Overdue', paid: 'Paid', unpaid: 'Unpaid' }[filter] || filter;
  a.href     = url;
  a.download = `Lexi-Jobs-${filterLabel}-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported ${docs.length} job${docs.length !== 1 ? 's' : ''} to spreadsheet.`, 'success');
}

function editDoc(id) {
  state.editingDocId = id;
  const doc = state.saved.find(d => d.id === id);
  if (!doc) { state.editingDocId = null; return; }
  loadQuoteFromDoc(doc);
  setVal('jobPickerSearch', '');
  updateJobPicker();
  renderQuoteItems();
  showPage('page-jobs');
  // Update save button to reflect edit mode
  const saveBtn = document.getElementById('saveQuoteBtn');
  if (saveBtn) saveBtn.textContent = '✓ Save Changes';
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
  // Voice disambiguation modal
  document.getElementById('closeVoicePickModal').addEventListener('click', () => {
    document.getElementById('voicePickModal').style.display = 'none';
  });
  document.getElementById('voicePickNoneBtn').addEventListener('click', () => {
    document.getElementById('voicePickModal').style.display = 'none';
    setVal('vnfName', '');
    setVal('vnfPrice', '');
    setVal('vnfUnit', '');
    document.getElementById('voiceNotFoundModal').style.display = 'flex';
    setTimeout(() => document.getElementById('vnfName')?.focus(), 150);
  });

  // Voice not-found modal
  document.getElementById('closeVoiceNotFoundModal').addEventListener('click', closeVoiceNotFoundModal);
  document.getElementById('vnfAddBothBtn').addEventListener('click', () => vnfSubmit(true));
  document.getElementById('vnfAddOnceBtn').addEventListener('click', () => vnfSubmit(false));

  document.getElementById('closePreviewBtn').addEventListener('click', closePreview);
  document.getElementById('closeQuoteBtn').addEventListener('click', () => document.getElementById('quoteModal').style.display = 'none');
  document.getElementById('closeInvoiceBtn').addEventListener('click', () => document.getElementById('invoiceModal').style.display = 'none');
  document.getElementById('closeReceiptBtn').addEventListener('click', () => document.getElementById('receiptModal').style.display = 'none');
  document.getElementById('closeMarkPaidBtn').addEventListener('click', () => { document.getElementById('markPaidModal').style.display = 'none'; reopenDashboardAfterMoneyIn(); });
  document.getElementById('cancelMarkPaidBtn').addEventListener('click', () => { document.getElementById('markPaidModal').style.display = 'none'; reopenDashboardAfterMoneyIn(); });
  document.getElementById('mpAmount').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmMarkPaidBtn').click(); } });
  document.getElementById('closeEditPaymentsBtn').addEventListener('click', () => document.getElementById('editPaymentsModal').style.display = 'none');
  document.getElementById('doneEditPaymentsBtn').addEventListener('click', () => document.getElementById('editPaymentsModal').style.display = 'none');
  document.getElementById('closeClientPickerBtn').addEventListener('click', () => document.getElementById('clientPickerModal').style.display = 'none');
  document.getElementById('closeEditChoiceBtn')?.addEventListener('click', () => document.getElementById('editChoiceModal').style.display = 'none');
  document.getElementById('closePhotosBtn')?.addEventListener('click', closePhotosAndReturn);
  document.getElementById('savePhotosBtn')?.addEventListener('click', closePhotosAndReturn);
  document.getElementById('closeOutstandingBtn')?.addEventListener('click', closeOutstandingReceipt);
  document.getElementById('outstandingNoBtn')?.addEventListener('click', closeOutstandingReceipt);
  document.getElementById('outstandingYesBtn')?.addEventListener('click', () => {
    const docId = pendingReceiptDocId;
    closeOutstandingReceipt();
    if (docId) previewReceipt(docId);
  });
  document.getElementById('closePreviewFirstBtn')?.addEventListener('click', closePreviewFirstModal);
  document.getElementById('previewFirstYesBtn')?.addEventListener('click', () => {
    rememberPreviewChoice();
    const fn = pendingPreviewSend;
    closePreviewFirstModal();
    if (fn) fn(true);
  });
  document.getElementById('previewFirstNoBtn')?.addEventListener('click', () => {
    rememberPreviewChoice();
    const fn = pendingPreviewSend;
    closePreviewFirstModal();
    if (fn) fn(false);
  });
  document.getElementById('closeBizInfoBtn')?.addEventListener('click', () => document.getElementById('bizInfoModal').style.display = 'none');
  document.getElementById('bizInfoOptions')?.addEventListener('change', updateBizInfoPreview);
  document.getElementById('copyBizInfoBtn')?.addEventListener('click', copyBizInfo);
  document.getElementById('shareBizInfoBtn')?.addEventListener('click', shareBizInfo);
  document.getElementById('closeCustomerDashboardBtn')?.addEventListener('click', () => {
    document.getElementById('customerDashboardModal').style.display = 'none';
    activeCustomerGroup = null;
  });
  document.getElementById('closeCustEditChoiceBtn')?.addEventListener('click', () => document.getElementById('customerEditChoiceModal').style.display = 'none');
  document.getElementById('custEditDetailsBtn')?.addEventListener('click', () => customerEditPickDoc('details'));
  document.getElementById('custEditJobBtn')?.addEventListener('click', () => customerEditPickDoc('job'));
  document.getElementById('custEditMoneyBtn')?.addEventListener('click', () => customerEditPickDoc('money'));
  document.getElementById('custEditTermsBtn')?.addEventListener('click', () => customerEditPickDoc('terms'));
  document.getElementById('custEditAddPhotoBtn')?.addEventListener('click', () => {
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (docId) openPhotosModal(docId);
  });
  document.getElementById('custEditDownloadBtn')?.addEventListener('click', () => {
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    if (activeCustomerGroup) {
      const body = document.getElementById('customerDashboardBody');
      downloadCustomerDashboard(activeCustomerGroup.name, body.innerHTML);
    }
  });
  document.getElementById('custEditDeleteBtn')?.addEventListener('click', () => {
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    document.getElementById('customerDashboardModal').style.display = 'none';
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (docId) deleteDoc(docId);
  });
  document.getElementById('closeCustDetailsEditBtn')?.addEventListener('click', () => document.getElementById('customerDetailsEditModal').style.display = 'none');
  document.getElementById('saveCustDetailsBtn')?.addEventListener('click', saveCustomerDetails);
  document.getElementById('nextToJobDetailsBtn')?.addEventListener('click', () => {
    document.getElementById('customerDetailsEditModal').style.display = 'none';
    const docId = activeEditDocId || (activeCustomerGroup?.docs[0]?.id);
    if (docId) openJobDetailsEdit(docId);
  });
  document.getElementById('closeJobDetailsEditBtn')?.addEventListener('click', () => document.getElementById('jobDetailsEditModal').style.display = 'none');
  document.getElementById('backToCustDetailsBtn')?.addEventListener('click', () => {
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    if (activeJobDetailsDocId) openCustomerDetailsEdit(activeJobDetailsDocId);
  });
  document.getElementById('saveJobDetailsBtn')?.addEventListener('click', saveJobDetails);
  document.getElementById('nextToJobTermsBtn')?.addEventListener('click', () => {
    const docId = activeJobDetailsDocId;
    const doc = state.saved.find(d => d.id === docId);
    if (!doc) return;
    // Silently save job details before navigating
    const items = [];
    document.querySelectorAll('#jdeItemsList .jde-item-row').forEach(row => {
      const name = (row.querySelector('.jde-item-name')?.value || '').trim();
      const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
      if (name || price) items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
    });
    const notes = document.getElementById('jdeNotes')?.value || '';
    const totalOverride = parseFloat(document.getElementById('jdeTotalOverride')?.value) || 0;
    if (!doc.quote) doc.quote = {};
    doc.quote.items = items;
    doc.quote.notes = notes;
    if (items.length > 0) {
      const subtotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
      const vatPct = parseFloat(doc.quote.vatRate) || 0;
      doc.total = subtotal * (1 + vatPct / 100);
    } else if (totalOverride > 0) {
      doc.total = totalOverride;
    }
    doc.custName = buildCustName(doc.quote);
    save();
    refreshSavedDocs();
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    loadQuoteFromDoc(doc);
    state.editingDocId = docId;
    state.editingFromTerms = true;
    const titleEl = document.querySelector('#page-completion .page-title');
    if (titleEl) titleEl.textContent = 'Edit Job Terms';
    showPage('page-completion');
  });
  document.getElementById('clientPickerNewCustomerBtn')?.addEventListener('click', createNewCustomerFromPicker);
  document.getElementById('editChoiceMoneyBtn')?.addEventListener('click', () => {
    const docId = activeEditChoiceDocId;
    document.getElementById('editChoiceModal').style.display = 'none';
    if (docId) openEditPayments(docId);
  });
  document.getElementById('editChoiceJobBtn')?.addEventListener('click', () => {
    const docId = activeEditChoiceDocId;
    document.getElementById('editChoiceModal').style.display = 'none';
    if (docId) {
      openQuoteModal(docId);
      // Override the modal title so it says "Edit Quote/Estimate" not "Send"
      const doc = state.saved.find(d => d.id === docId);
      const docType = doc?.quote?.type || doc?.type || 'Quote';
      const titleEl = document.getElementById('quoteModalTitle');
      if (titleEl) titleEl.textContent = 'Edit ' + docType;
    }
  });
  document.getElementById('beforePhotosInput')?.addEventListener('change', e => handlePhotoUpload(e, 'before'));
  document.getElementById('afterPhotosInput')?.addEventListener('change', e => handlePhotoUpload(e, 'after'));

  // Close on overlay click
  [document.getElementById('previewModal'),
   document.getElementById('quoteModal'),
   document.getElementById('invoiceModal'),
   document.getElementById('receiptModal'),
   document.getElementById('markPaidModal'),
   document.getElementById('editPaymentsModal'),
   document.getElementById('clientPickerModal'),
   document.getElementById('editChoiceModal'),
   document.getElementById('photosModal'),
   document.getElementById('receiptOutstandingModal'),
   document.getElementById('previewFirstModal'),
   document.getElementById('bizInfoModal'),
   document.getElementById('customerDashboardModal'),
   document.getElementById('customerEditChoiceModal'),
   document.getElementById('customerDetailsEditModal')].forEach(m => {
    m?.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; });
  });

  document.getElementById('previewEditBtn').addEventListener('click', () => {
    closePreview();
    const { type, docId } = previewContext;
    if (type === 'quote' && docId) {
      // Open the full job details edit modal for saved estimates/quotes
      openJobDetailsEdit(docId);
    } else if (type === 'quote' && !docId) {
      // New quote in progress — already on page3, nothing needed
    } else if (type === 'invoice') {
      openInvoiceModal(docId);
    } else if (type === 'receipt') {
      openReceiptModal(docId);
    }
  });

  document.getElementById('previewPrintBtn').addEventListener('click', () => {
    const html = document.getElementById('previewContent').innerHTML;
    printRaw(html);
  });

  document.getElementById('previewSaveBtn').addEventListener('click', () => {
    const { type, docId } = previewContext;
    if (type === 'quote' && !docId) {
      // Save the current page3 form state as a quote
      closePreview();
      saveQuote();
      return;
    }
    // Modal flows: save edits to doc without sending
    if (type === 'quote' && docId) {
      const doc = state.saved.find(d => d.id === docId);
      if (doc) {
        const quoteData = collectQuoteSendForm();
        Object.assign(doc, applyDocEdits(doc, quoteData));
        save();
        refreshSavedDocs();
      }
      document.getElementById('quoteModal').style.display = 'none';
    } else if (type === 'invoice') {
      const doc = state.saved.find(d => d.id === activeDocId);
      if (doc) {
        const invData = collectInvoiceForm();
        Object.assign(doc, applyDocEdits(doc, invData));
        doc.invoiceSent    = true;
        doc.invoiceRef     = invData.invRef;
        doc.invoiceDueDate = invData.dueDate || '';
        save();
        refreshSavedDocs();
      }
      document.getElementById('invoiceModal').style.display = 'none';
    } else if (type === 'receipt') {
      const doc = state.saved.find(d => d.id === activeDocId);
      if (doc) {
        const recData = collectReceiptForm();
        Object.assign(doc, applyDocEdits(doc, recData));
        if (recData.recRef) doc.receiptRef = recData.recRef;
        recordReceiptPayment(doc, recData);
        save();
        refreshSavedDocs();
      }
      document.getElementById('receiptModal').style.display = 'none';
    }
    closePreview();
    showSavedPopup("I've saved that.");
  });

  document.getElementById('previewSendBtn').addEventListener('click', () => {
    const html = document.getElementById('previewContent').innerHTML;
    const wrapped = wrapDoc(html);
    sendDocRaw(wrapped, 'document.html');
  });

  // Quote modal
  document.getElementById('quotePreviewBtn').addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    quotePreviewed = true;
    openPreview(buildDocHtml(applyDocEdits(doc, quoteData), 'quote', quoteData), 'quote', doc.id || null);
  });
  document.getElementById('quoteSendBtn').addEventListener('click', () => {
    if (!quotePreviewed && !localStorage.getItem(KEY_PREVIEW_FIRST_SUPPRESSED)) {
      pendingPreviewSend = previewFirst => {
        if (previewFirst) {
          document.getElementById('quotePreviewBtn').click();
        } else {
          sendQuoteFromModal();
        }
      };
      document.getElementById('previewFirstModal').style.display = 'flex';
      return;
    }
    sendQuoteFromModal();
  });

  function sendQuoteFromModal() {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    const editedDoc = applyDocEdits(doc, quoteData);
    const html = buildDocHtml(editedDoc, 'quote', quoteData);
    if (activeDocId) {
      const savedDoc = state.saved.find(d => d.id === activeDocId);
      if (savedDoc) {
        Object.assign(savedDoc, editedDoc);
        save();
        refreshSavedDocs();
      }
    }
    document.getElementById('quoteModal').style.display = 'none';
    // Pass the notes (pre-filled with the intro paragraph) as the share message body
    const shareMessage = quoteData.quoteNotes || '';
    sendDoc(html, getDocFilenameFromRef(quoteData.ref || editedDoc.ref || 'quote'), shareMessage);
    toast('Quote sent!', 'success');
  }

  // Invoice modal
  document.getElementById('invPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    openPreview(buildDocHtml(applyDocEdits(doc, invData), 'invoice', invData), 'invoice');
  });
  document.getElementById('invSendBtn').addEventListener('click', () => {
    sendInvoiceFromModal();
  });

  function sendInvoiceFromModal() {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    const editedDoc = applyDocEdits(doc, invData);
    const html = buildDocHtml(editedDoc, 'invoice', invData);
    Object.assign(doc, editedDoc);
    doc.invoiceSent    = true;
    doc.invoiceRef     = invData.invRef;
    doc.invoiceDueDate = invData.dueDate || '';   // persisted for overdue tracking
    save();
    refreshSavedDocs();
    document.getElementById('invoiceModal').style.display = 'none';
    sendDoc(html, getDocFilenameFromRef(invData.invRef || 'invoice'));
    toast('Invoice sent!', 'success');
  }

  // Receipt modal
  document.getElementById('recPreviewBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    receiptPreviewed = true;
    openPreview(buildDocHtml(applyDocEdits(doc, recData), 'receipt', recData), 'receipt');
  });
  document.getElementById('recSendBtn').addEventListener('click', () => {
    if (!receiptPreviewed && !localStorage.getItem(KEY_PREVIEW_FIRST_SUPPRESSED)) {
      pendingPreviewSend = previewFirst => {
        if (previewFirst) {
          document.getElementById('recPreviewBtn').click();
        } else {
          sendReceiptFromModal();
        }
      };
      document.getElementById('previewFirstModal').style.display = 'flex';
      return;
    }
    sendReceiptFromModal();
  });

  function sendReceiptFromModal() {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    const editedDoc = applyDocEdits(doc, recData);
    Object.assign(doc, editedDoc);
    // Persist the receipt ref so re-opens reuse the same number
    if (recData.recRef) doc.receiptRef = recData.recRef;
    recordReceiptPayment(doc, recData);
    const html = buildDocHtml(doc, 'receipt', recData);
    save();
    refreshSavedDocs();
    sendDoc(html, 'receipt.html');
    document.getElementById('receiptModal').style.display = 'none';
    toast('Receipt sent!', 'success');
  }

  // Quote modal — Edit (go to full page3 builder) and Save (save without sending)
  document.getElementById('quoteEditBtn')?.addEventListener('click', () => {
    document.getElementById('quoteModal').style.display = 'none';
    if (activeDocId) {
      editDoc(activeDocId);
    }
  });
  document.getElementById('quoteSaveBtn')?.addEventListener('click', () => {
    const doc = getActiveQuoteDoc();
    if (!doc) return;
    const quoteData = collectQuoteSendForm();
    const editedDoc = applyDocEdits(doc, quoteData);
    if (activeDocId) {
      const savedDoc = state.saved.find(d => d.id === activeDocId);
      if (savedDoc) {
        Object.assign(savedDoc, editedDoc);
        save();
        refreshSavedDocs();
      }
    }
    document.getElementById('quoteModal').style.display = 'none';
    showSavedPopup("I've saved that.");
  });

  // Invoice modal — Edit (open quoteModal for same doc) and Save (save without sending)
  document.getElementById('invEditBtn')?.addEventListener('click', () => {
    document.getElementById('invoiceModal').style.display = 'none';
    if (activeDocId) openQuoteModal(activeDocId);
  });
  document.getElementById('invSaveBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const invData = collectInvoiceForm();
    Object.assign(doc, applyDocEdits(doc, invData));
    doc.invoiceRef      = invData.invRef;
    doc.invoiceDueDate  = invData.dueDate || '';
    doc.invoicePayMethods = invData.payMethods;
    save();
    refreshSavedDocs();
    document.getElementById('invoiceModal').style.display = 'none';
    // Return to preview with updated invoice
    const html = buildDocHtml(doc, 'invoice', invData);
    openPreview(html, 'invoice', activeDocId);
    showSavedPopup("I've saved that.");
  });

  // Receipt modal — Edit (open quoteModal for same doc) and Save (save without sending)
  document.getElementById('recEditBtn')?.addEventListener('click', () => {
    document.getElementById('receiptModal').style.display = 'none';
    if (activeDocId) openReceiptModal(activeDocId);
  });
  document.getElementById('recSaveBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const recData = collectReceiptForm();
    Object.assign(doc, applyDocEdits(doc, recData));
    if (recData.recRef)    doc.receiptRef    = recData.recRef;
    if (recData.date)      doc.receiptDate   = recData.date;
    if (recData.method)    doc.receiptMethod = recData.method;
    save();
    refreshSavedDocs();
    document.getElementById('receiptModal').style.display = 'none';
    // Return to preview with updated receipt
    const html = buildDocHtml(doc, 'receipt', recData);
    openPreview(html, 'receipt', activeDocId);
    showSavedPopup("I've saved that.");
  });

  // Add Payment button inside editPaymentsModal
  document.getElementById('addPaymentBtn')?.addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const amount = parseFloat(document.getElementById('epAddAmount').value) || 0;
    const date   = document.getElementById('epAddDate').value || todayStr();
    if (!amount) { toast('Please enter an amount.', 'error'); return; }
    if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
    doc.payments.push({ amount, date });
    sortPaymentsByDate(doc.payments);
    recalcDocPayments(doc);
    save();
    refreshSavedDocs();
    renderEditPaymentsList(doc);
    document.getElementById('epAddAmount').value = '';
    setVal('epAddDate', todayStr());
    toast('Payment added.', 'success');
  });

  // Money In — push new payment to payments array
  document.getElementById('confirmMarkPaidBtn').addEventListener('click', () => {
    const doc = state.saved.find(d => d.id === activeDocId);
    if (!doc) return;
    const amount = parseFloat(getVal('mpAmount')) || 0;
    const date   = getVal('mpDate') || todayStr();
    if (amount <= 0) { toast('Enter an amount received.', 'error'); return; }
    // Migrate legacy single-payment docs
    if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
    doc.payments.push({ amount, date });
    sortPaymentsByDate(doc.payments);
    recalcDocPayments(doc);
    save();
    refreshSavedDocs();
    document.getElementById('markPaidModal').style.display = 'none';
    // Return to customer dashboard if it was open when Money In was triggered
    if (activeCustomerGroup) {
      try {
        const groups = buildCustomerGroups();
        const updatedGroup = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
        activeCustomerGroup = updatedGroup;
        document.getElementById('customerDashboardModal').style.display = 'flex';
        renderSingleCustomerDashboard(updatedGroup, groups);
      } catch(e) { console.error('Dashboard re-render error:', e); }
    }
    showSavedPopup(doc.paid ? 'Brilliant, that one is now paid in full.' : "I've saved that payment.");
  });
}

let previewContext = { type: 'quote', docId: null };

function openPreview(html, type, docId = null) {
  previewContext = { type, docId };
  document.getElementById('previewContent').innerHTML = html;
  const modal = document.getElementById('previewModal');
  modal.classList.add('modal-front');
  modal.style.display = 'flex';
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.style.display = 'none';
  modal.classList.remove('modal-front');
}

/* ===== CLIENT PICKER (New Invoice / New Receipt from menu) ===== */
function openClientPicker(mode) {
  const titleEl   = document.getElementById('clientPickerTitle');
  const listEl    = document.getElementById('clientPickerList');
  const warningEl = document.getElementById('clientPickerWarning');

  titleEl.textContent = mode === 'invoice'
    ? `Who would you like to invoice ${traderFirstName()}?`
    : `Who is this receipt for ${traderFirstName()}?`;
  listEl.dataset.mode = mode;
  warningEl.style.display = 'none';
  warningEl.innerHTML = '';

  const docs = [...state.saved].sort((a, b) => {
    const aq = a.quote || {};
    const bq = b.quote || {};
    return (aq.custLastName || '').localeCompare(bq.custLastName || '') ||
      (aq.custFirstName || '').localeCompare(bq.custFirstName || '');
  });

  if (!docs.length) {
    listEl.innerHTML = '<p class="cp-empty">No saved jobs yet - create an estimate or quote first.</p>';
    document.getElementById('clientPickerModal').style.display = 'flex';
    return;
  }

  listEl.innerHTML = docs.map(doc => {
    const payments    = getDocPayments(doc);
    const totalPaid   = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const statusClass = doc.paid ? 'paid' : doc.invoiceSent ? 'invoiced' : (doc.type || 'estimate').toLowerCase();
    const statusLabel = doc.paid ? 'Paid' : doc.invoiceSent ? 'Invoiced' : (doc.type || 'Estimate');
    const jobDesc     = doc.quote?.items?.[0]?.name || doc.ref || 'Job';
    return `
      <button type="button" class="cp-row" data-id="${doc.id}">
        <div class="cp-row-main">
          <span class="cp-name">${esc(doc.custName || 'Unknown')}</span>
          <span class="cp-job">${esc(jobDesc)}</span>
        </div>
        <div class="cp-row-right">
          <span class="cp-total">${fmtPrice(doc.total || 0)}</span>
          <span class="type-badge ${statusClass}">${statusLabel}</span>
        </div>
      </button>`;
  }).join('');

  listEl.querySelectorAll('.cp-row').forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.dataset.id;
      const doc   = state.saved.find(d => d.id === docId);
      if (!doc) return;

      if (mode === 'invoice') {
        document.getElementById('clientPickerModal').style.display = 'none';
        openInvoiceModal(docId);
      } else {
        // Receipt mode — warn if not fully paid
        const payments  = getDocPayments(doc);
        const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
        if (totalPaid === 0) {
          showPickerWarning(docId,
            `⚠️ No payment has been recorded for ${esc(doc.custName || 'this client')} yet. Do you still want to create a receipt?`);
        } else if (!doc.paid) {
          showPickerWarning(docId,
            `⚠️ ${esc(doc.custName || 'This client')} has only paid ${fmtPrice(totalPaid)} of ${fmtPrice(doc.total || 0)}. Do you still want to create a receipt?`);
        } else {
          document.getElementById('clientPickerModal').style.display = 'none';
          openReceiptModal(docId);
        }
      }
    });
  });

  document.getElementById('clientPickerModal').style.display = 'flex';
}

function showPickerWarning(docId, message) {
  const warningEl = document.getElementById('clientPickerWarning');
  warningEl.style.display = 'block';
  warningEl.innerHTML = `
    <p class="cp-warning-msg">${message}</p>
    <div class="cp-warning-actions">
      <button type="button" class="btn btn-outline btn-sm" id="cpWarnCancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm" id="cpWarnConfirm">Create Receipt</button>
    </div>`;
  warningEl.querySelector('#cpWarnCancel').addEventListener('click', () => {
    warningEl.style.display = 'none';
  });
  warningEl.querySelector('#cpWarnConfirm').addEventListener('click', () => {
    document.getElementById('clientPickerModal').style.display = 'none';
    openReceiptModal(docId);
  });
  warningEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function previewReceipt(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const payments  = getDocPayments(doc);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const recRef = doc.receiptRef || nextRef('REC', KEY_REC);
  const html = buildDocHtml(doc, 'receipt', {
    recRef,
    date:   doc.receiptDate || todayStr(),
    amount: totalPaid > 0 ? totalPaid : (doc.total || 0),
    method: doc.receiptMethod || ''
  });
  openPreview(html, 'receipt', docId);
}

function handleReceiptRequest(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (doc.paid) {
    previewReceipt(docId);
    return;
  }
  // Not fully paid — warn with personalised message
  pendingReceiptDocId = docId;
  const first = (doc.quote?.custFirstName || '').trim();
  const msg = document.getElementById('outstandingMsg');
  if (msg) {
    msg.textContent = first
      ? `${first}, the payment history shows funds outstanding. Do you still wish to send a receipt anyway?`
      : 'The payment history shows funds outstanding. Do you still wish to send a receipt anyway?';
  }
  document.getElementById('receiptOutstandingModal').style.display = 'flex';
}

function closeOutstandingReceipt() {
  pendingReceiptDocId = null;
  document.getElementById('receiptOutstandingModal').style.display = 'none';
}

function openQuoteModalFromCurrentForm() {
  const q = collectQuoteState();
  q.items = [...state.quote.items];
  if (!q.custLastName && !q.custFirstName) {
    toast('Please add a customer name.', 'error');
    document.getElementById('custFirstName').focus();
    return;
  }
  activeDocId = null;
  activeQuoteDraftDoc = {
    id: null,
    quote: q,
    company: { ...state.company },
    custName: buildCustName(q),
    total: calcTotal(q),
    type: q.type,
    date: q.date,
    ref: q.ref,
    photos: { before: [], after: [] }
  };
  populateQuoteSendModal(activeQuoteDraftDoc);
}

function openQuoteModal(docId) {
  activeDocId = docId;
  activeQuoteDraftDoc = null;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  // Show a live preview of the estimate/quote — Edit button will open job details edit
  const html = buildDocHtml(doc, 'quote');
  openPreview(html, 'quote', docId);
}

function populateQuoteSendModal(doc) {
  quotePreviewed = false;
  const q = doc.quote || {};
  const label = q.type || doc.type || 'Quote';
  document.getElementById('quoteModalTitle').textContent = label;
  setVal('quoteCustFirst', q.custFirstName || '');
  setVal('quoteCustLast', q.custLastName || '');
  setVal('quoteRef', q.ref || doc.ref || '');
  setVal('quoteSendDate', q.date || doc.date || todayStr());
  setVal('quoteItemsText', (q.items || []).map(i => `${i.name}, ${Number(i.unitPrice || 0).toFixed(2)}`).join('\n'));
  setVal('quoteTotalOverride', (doc.total || calcTotal(q) || 0).toFixed(2));
  // Pre-fill the send notes with the courtesy intro paragraph so it goes as the message body when sharing
  const docTypeLower = (q.type || doc.type || 'quote').toLowerCase();
  const introMsg = `Thank you for allowing me to give you this free, no obligation ${docTypeLower} today. Please find below a full breakdown of the proposed work and costs. There is no pressure and no obligation to proceed. Please read through at your leisure, discuss it with anyone you need to, and let me know if you have any questions.`;
  setVal('quoteSendNotes', introMsg);
  document.getElementById('quoteIncludePhotos').checked = false;
  document.getElementById('quoteModal').style.display = 'flex';
}

function getActiveQuoteDoc() {
  if (activeDocId) {
    return state.saved.find(d => d.id === activeDocId) || activeQuoteDraftDoc || null;
  }
  return activeQuoteDraftDoc || null;
}

function previewInvoice(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const invRef  = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
  const dueDate = doc.invoiceDueDate || addDays(todayStr(), 30);
  const html = buildDocHtml(doc, 'invoice', { invRef, invDate: todayStr(), dueDate });
  openPreview(html, 'invoice', docId);
}

function openInvoiceModal(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const invRef = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
  const q = doc.quote || {};
  setVal('invRef',     invRef);
  setVal('invDate',    todayStr());
  setVal('invDueDate', doc.invoiceDueDate || addDays(todayStr(), 30));
  setVal('invCustFirst', q.custFirstName || '');
  setVal('invCustLast', q.custLastName || '');
  setVal('invItemsText', (q.items || []).map(i => `${i.name}, ${Number(i.unitPrice || 0).toFixed(2)}`).join('\n'));
  setVal('invTotalOverride', (doc.total || 0).toFixed(2));
  const storedMethods = Array.isArray(doc.invoicePayMethods) ? doc.invoicePayMethods
    : (doc.invoicePayMethod ? [doc.invoicePayMethod] : []);
  document.querySelectorAll('input[name="invPayMethod"]').forEach(cb => {
    cb.checked = storedMethods.includes(cb.value);
  });
  document.getElementById('invIncludePhotos').checked = false;
  setVal('invNotes',   '');
  document.getElementById('invoiceModal').style.display = 'flex';
}

function openReceiptModal(docId) {
  activeDocId = docId;
  receiptPreviewed = false;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const payments  = getDocPayments(doc);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const q = doc.quote || {};
  // Reuse existing receiptRef if the receipt was already sent; otherwise generate a new one
  const recRef = doc.receiptRef || nextRef('REC', KEY_REC);
  setVal('recRef',     recRef);
  setVal('recCustFirst', q.custFirstName || '');
  setVal('recCustLast', q.custLastName || '');
  setVal('recAmount', (totalPaid > 0 ? totalPaid : (doc.total || 0)).toFixed(2));
  setVal('recDate',   todayStr());
  // Pre-fill payment split checkboxes and amounts
  const storedSplit = Array.isArray(doc.receiptPaySplit) ? doc.receiptPaySplit
    : (doc.receiptMethod ? [{ method: doc.receiptMethod, amount: totalPaid || doc.total || 0 }] : []);
  document.querySelectorAll('input[name="recPayMethod"]').forEach(cb => {
    const entry = storedSplit.find(s => s.method === cb.value);
    cb.checked = !!entry;
    const amtEl = document.querySelector(`input[name="recPayAmt"][data-method="${cb.value}"]`);
    if (amtEl) amtEl.value = entry ? (entry.amount || '') : '';
  });
  document.getElementById('recIncludePhotos').checked = false;
  setVal('recNotes',  '');
  document.getElementById('receiptModal').style.display = 'flex';
}

function refreshActiveDashboard() {
  if (!activeCustomerGroup) return;
  try {
    const groups = buildCustomerGroups();
    const updated = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
    activeCustomerGroup = updated;
    renderSingleCustomerDashboard(updated, groups);
  } catch(e) { console.error('Dashboard refresh error:', e); }
}

// Called when the Money In modal is closed without logging — re-shows the customer
// dashboard (which was hidden by executeCustomerEdit before opening Money In).
function reopenDashboardAfterMoneyIn() {
  if (!activeCustomerGroup) return;
  try {
    const groups = buildCustomerGroups();
    const updated = groups.find(g => g.docs.some(d => d.id === activeDocId)) || activeCustomerGroup;
    activeCustomerGroup = updated;
    renderSingleCustomerDashboard(updated, groups);
    document.getElementById('customerDashboardModal').style.display = 'flex';
  } catch(e) { console.error('Dashboard reopen error:', e); }
}

// Updates only the totals rows inside mpPrevInfo — does NOT replace the whole innerHTML,
// so edit inputs and delete buttons remain intact and clickable.
function refreshMpTotalsOnly(doc) {
  const payments  = doc.payments || [];
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = Math.max(0, (doc.total || 0) - totalPaid);
  const prevInfo  = document.getElementById('mpPrevInfo');
  if (!prevInfo) return;
  const totalStrong = prevInfo.querySelector('.mp-totals-divider strong');
  if (totalStrong) totalStrong.textContent = fmtPrice(totalPaid);
  const outstandingStrong = prevInfo.querySelector('.mp-prev-row:not(.mp-totals-divider) strong');
  if (outstandingStrong) outstandingStrong.textContent = fmtPrice(remaining);
  // Keep the new-payment prefill in sync
  setVal('mpAmount', remaining > 0 ? remaining.toFixed(2) : '');
}

function renderMpPrevInfo() {
  const doc = state.saved.find(d => d.id === activeDocId);
  if (!doc) return;
  // Ensure doc.payments is always a real array (migrate legacy scalar)
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  const payments  = doc.payments;
  sortPaymentsByDate(payments);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const total     = doc.total || 0;
  const remaining = Math.max(0, total - totalPaid);
  const prevInfo  = document.getElementById('mpPrevInfo');
  if (!prevInfo) return;

  if (payments.length === 0) {
    prevInfo.style.display = 'none';
    const addLabel = document.getElementById('mpAddLabel');
    if (addLabel) addLabel.style.display = 'none';
    return;
  }

  prevInfo.style.display = 'block';
  prevInfo.innerHTML =
    payments.map((p, i) => `
      <div class="mp-edit-row">
        <span class="mp-edit-label">Payment ${i + 1}</span>
        <div class="mp-edit-fields">
          <div class="input-pfx mp-edit-pfx">
            <span class="pfx-symbol">£</span>
            <input type="number" class="mp-edit-val" data-idx="${i}" value="${p.amount != null ? p.amount : ''}" min="0" step="any" placeholder="0.00">
          </div>
          <input type="date" class="mp-edit-date" data-idx="${i}" value="${p.date || ''}">
          <button type="button" class="mp-delete-btn" data-idx="${i}" aria-label="Delete payment ${i + 1}">×</button>
        </div>
      </div>`).join('') +
    `<div class="mp-prev-row mp-totals-divider">
       <span>Total paid:</span><span><strong>${fmtPrice(totalPaid)}</strong></span>
     </div>
     <div class="mp-prev-row">
       <span>Still outstanding:</span><span><strong style="color:var(--walnut)">${fmtPrice(remaining)}</strong></span>
     </div>`;

  // Wire amount edits — update totals in-place (no innerHTML replace) so that
  // a pending click on the delete button is never interrupted by a DOM rebuild.
  prevInfo.querySelectorAll('.mp-edit-val').forEach(inp => {
    inp.addEventListener('change', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(inp.dataset.idx);
      if (!freshDoc.payments[idx]) return;
      freshDoc.payments[idx].amount = parseFloat(inp.value) || 0;
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      refreshMpTotalsOnly(freshDoc);   // in-place totals update — keeps delete buttons alive
    });
  });

  // Wire date edits — same: in-place update only
  prevInfo.querySelectorAll('.mp-edit-date').forEach(inp => {
    inp.addEventListener('change', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(inp.dataset.idx);
      if (!freshDoc.payments[idx]) return;
      freshDoc.payments[idx].date = inp.value;
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      refreshMpTotalsOnly(freshDoc);   // in-place totals update — keeps delete buttons alive
    });
  });

  // Wire delete buttons — full re-render is fine here since delete is the action
  prevInfo.querySelectorAll('.mp-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const freshDoc = state.saved.find(d => d.id === activeDocId);
      if (!freshDoc) return;
      const idx = parseInt(btn.dataset.idx);
      freshDoc.payments.splice(idx, 1);
      recalcDocPayments(freshDoc);
      save();
      refreshSavedDocs();
      renderMpPrevInfo();
      // Clear the "Add payment" form — the deletion is already saved.
      // Leaving it pre-filled risks the user accidentally logging a duplicate payment.
      setVal('mpAmount', '');
      showSavedPopup('Payment removed and saved.');
    });
  });

  // Show "Add another payment" label whenever the history section is visible
  const addLabel = document.getElementById('mpAddLabel');
  if (addLabel) addLabel.style.display = 'block';
}

function openMarkPaid(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;

  const titleEl = document.getElementById('markPaidTitle');
  if (titleEl) titleEl.textContent = 'Money In';

  renderMpPrevInfo();

  // Pre-fill the new-payment row with remaining balance (or total if no payments yet)
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  const totalPaid = doc.payments.reduce((s, p) => s + (p.amount || 0), 0);
  const total     = doc.total || 0;
  const remaining = Math.max(0, total - totalPaid);
  setVal('mpAmount', (remaining > 0 ? remaining : total).toFixed(2));
  setVal('mpDate', todayStr());
  document.getElementById('markPaidModal').style.display = 'flex';
}

function openEditPayments(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  // Migrate legacy single-payment docs
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  renderEditPaymentsList(doc);
  // Pre-fill date for add payment form
  setVal('epAddDate', todayStr());
  document.getElementById('epAddAmount').value = '';
  document.getElementById('editPaymentsModal').style.display = 'flex';
}

function renderEditPaymentsList(doc) {
  const listEl = document.getElementById('editPaymentsList');
  if (!listEl) return;
  const payments    = doc.payments || [];
  sortPaymentsByDate(payments);
  const totalPaid   = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = Math.max(0, (doc.total || 0) - totalPaid);

  if (!payments.length) {
    listEl.innerHTML = '<p style="text-align:center;opacity:0.5;padding:20px 0;font-size:0.9rem">No payments recorded.</p>';
    return;
  }

  listEl.innerHTML =
    payments.map((p, i) => `
      <div class="edit-payment-row">
        <span class="ep-amount">${fmtPrice(p.amount)}</span>
        <span class="ep-date">${formatDate(p.date)}</span>
        <button type="button" class="btn-delete-payment" data-idx="${i}" aria-label="Delete payment ${i + 1}">✕</button>
      </div>`).join('') +
    `<div class="ep-summary-row">
       <span>Total paid</span><strong>${fmtPrice(totalPaid)}</strong>
     </div>
     ${outstanding > 0 ? `<div class="ep-summary-row ep-outstanding">
       <span>Outstanding</span><strong>${fmtPrice(outstanding)}</strong>
     </div>` : ''}`;

  listEl.querySelectorAll('.btn-delete-payment').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      doc.payments.splice(idx, 1);
      recalcDocPayments(doc);
      save();
      refreshSavedDocs();
      renderEditPaymentsList(doc);
    });
  });
}

function collectInvoiceForm() {
  const payMethods = [...document.querySelectorAll('input[name="invPayMethod"]:checked')].map(cb => cb.value);
  return {
    invRef:    getVal('invRef'),
    invDate:   getVal('invDate'),
    dueDate:   getVal('invDueDate'),
    custFirstName: getVal('invCustFirst'),
    custLastName:  getVal('invCustLast'),
    itemsText: getVal('invItemsText'),
    totalOverride: getVal('invTotalOverride'),
    payMethods,
    payMethod: payMethods[0] || '',   // legacy single-value compat
    includePhotos: document.getElementById('invIncludePhotos')?.checked || false,
    notes:     getVal('invNotes')
  };
}

function collectQuoteSendForm() {
  return {
    custFirstName: getVal('quoteCustFirst'),
    custLastName:  getVal('quoteCustLast'),
    ref: getVal('quoteRef'),
    date: getVal('quoteSendDate'),
    itemsText: getVal('quoteItemsText'),
    totalOverride: getVal('quoteTotalOverride'),
    quoteNotes: getVal('quoteSendNotes'),
    includePhotos: document.getElementById('quoteIncludePhotos')?.checked || false
  };
}

function collectReceiptForm() {
  const paySplit = [];
  document.querySelectorAll('input[name="recPayMethod"]:checked').forEach(cb => {
    const amtEl = document.querySelector(`input[name="recPayAmt"][data-method="${cb.value}"]`);
    paySplit.push({ method: cb.value, amount: parseFloat(amtEl?.value) || 0 });
  });
  const method = paySplit.map(p => p.method).join(', ');
  return {
    recRef:        getVal('recRef'),
    custFirstName: getVal('recCustFirst'),
    custLastName:  getVal('recCustLast'),
    amount:        getVal('recAmount'),
    date:          getVal('recDate'),
    paySplit,
    method,        // flattened string for legacy compat
    includePhotos: document.getElementById('recIncludePhotos')?.checked || false,
    notes:         getVal('recNotes')
  };
}

function applyDocEdits(doc, data = {}) {
  const edited = {
    ...doc,
    quote: {
      ...(doc.quote || {}),
      items: ((doc.quote || {}).items || []).map(i => ({ ...i }))
    }
  };
  const q = edited.quote;
  if ('custFirstName' in data) q.custFirstName = data.custFirstName || '';
  if ('custLastName' in data) q.custLastName = data.custLastName || '';
  if ('ref' in data) {
    q.ref = data.ref || '';
    edited.ref = q.ref;
  }
  if ('date' in data) {
    q.date = data.date || '';
    edited.date = q.date;
  }
  if ('quoteNotes' in data) q.notes = data.quoteNotes || '';
  edited.custName = buildCustName(q);

  if (data.itemsText != null) {
    const parsed = parseEditableItems(data.itemsText);
    if (parsed.length) q.items = parsed;
  }
  if (data.totalOverride !== undefined && data.totalOverride !== '') {
    const total = parseFloat(data.totalOverride);
    if (!isNaN(total)) edited.total = total;
  } else {
    edited.total = calcTotal(q);
  }
  return edited;
}

function parseEditableItems(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    const parts = line.split(',');
    const name = (parts[0] || '').trim();
    const price = parseFloat((parts[1] || '').replace(/[£,]/g, '').trim());
    if (!name) return null;
    return { id: uid(), name, unitPrice: isNaN(price) ? 0 : price, unit: '', qty: 1 };
  }).filter(Boolean);
}

function recordReceiptPayment(doc, recData) {
  const amount = parseFloat(recData.amount) || 0;
  if (amount <= 0) return;
  if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
  if (doc.total && amount >= doc.total) {
    doc.payments = [{ amount: doc.total, date: recData.date || todayStr(), method: recData.method || '' }];
    recalcDocPayments(doc);
    return;
  }
  const exists = doc.payments.some(p =>
    Math.abs((p.amount || 0) - amount) < 0.01 &&
    (p.date || '') === (recData.date || todayStr()) &&
    (p.method || '') === (recData.method || '')
  );
  if (!exists) doc.payments.push({ amount, date: recData.date || todayStr(), method: recData.method || '' });
  recalcDocPayments(doc);
}

function openEditChoice(docId) {
  activeEditChoiceDocId = docId;
  document.getElementById('editChoiceModal').style.display = 'flex';
}

function closePhotosAndReturn() {
  document.getElementById('photosModal').style.display = 'none';
  // If photos were opened from the customer dashboard, go back to it
  if (activeCustomerGroup) {
    const groups = buildCustomerGroups();
    const group = groups.find(g => g.docs.some(d => d.id === activePhotoDocId)) || activeCustomerGroup;
    activeCustomerGroup = group;
    document.getElementById('customerDashboardModal').style.display = 'flex';
    renderSingleCustomerDashboard(group, groups);
  }
}

function openPhotosModal(docId) {
  activePhotoDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (!doc.photos) doc.photos = { before: [], after: [] };
  document.getElementById('beforePhotosInput').value = '';
  document.getElementById('afterPhotosInput').value = '';
  renderPhotosPreview(doc);
  document.getElementById('photosModal').style.display = 'flex';
}

function handlePhotoUpload(e, which) {
  const doc = state.saved.find(d => d.id === activePhotoDocId);
  if (!doc) return;
  if (!doc.photos) doc.photos = { before: [], after: [] };
  const files = [...(e.target.files || [])].slice(0, 3);
  Promise.all(files.map(fileToDataUrl)).then(urls => {
    doc.photos[which] = urls.slice(0, 3);
    save();
    renderPhotosPreview(doc);
  });
}

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.readAsDataURL(file);
  });
}

function renderPhotosPreview(doc) {
  const render = (id, list) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (list || []).map(src => `<img src="${src}" alt="Job photo">`).join('') ||
      '<p class="photo-empty">No photos added yet.</p>';
  };
  render('beforePhotosPreview', doc.photos?.before || []);
  render('afterPhotosPreview', doc.photos?.after || []);
}

function rememberPreviewChoice() {
  if (document.getElementById('dontShowPreviewFirst')?.checked) {
    localStorage.setItem(KEY_PREVIEW_FIRST_SUPPRESSED, '1');
  }
}

function closePreviewFirstModal() {
  pendingPreviewSend = null;
  document.getElementById('previewFirstModal').style.display = 'none';
}

function createNewCustomerFromPicker() {
  const mode = document.getElementById('clientPickerList')?.dataset.mode || 'invoice';
  document.getElementById('clientPickerModal').style.display = 'none';
  const q = {
    type: mode === 'invoice' ? 'Invoice' : 'Receipt',
    custTitle: '', custFirstName: '', custLastName: '',
    custAddr: '', custPostcode: '', custPhone: '', custEmail: '',
    date: todayStr(), validFor: '14', validCustom: '',
    ref: buildRef((parseInt(localStorage.getItem(KEY_REF) || '100') || 100) + 1),
    items: [{ id: uid(), name: 'Job', unitPrice: 0, unit: '', qty: 1 }],
    vatRate: '0', vatCustom: '', discount: '0',
    notes: '', privateNotes: '', selectedTerms: [], customTerms: '',
    authSig: '', custSig: '', sigDate: ''
  };
  const doc = {
    id: uid(),
    quote: q,
    company: { ...state.company },
    custName: '',
    total: 0,
    type: q.type,
    date: q.date,
    ref: q.ref,
    invoiceSent: false,
    paid: false,
    paidAmount: 0,
    paidDate: '',
    payments: [],
    photos: { before: [], after: [] }
  };
  state.saved.unshift(doc);
  save();
  updateSavedBadge();
  refreshSavedDocs();
  if (mode === 'receipt') openReceiptModal(doc.id);
  else openInvoiceModal(doc.id);
}

/* ===== SEND MY BUSINESS INFO ===== */

function bizInfoSections() {
  // Returns an array of section descriptors for all info the user has entered.
  // Each section: { id, label, text, checked }
  const c = state.company;
  const methods = c.payMethods || [];
  const bizName = (c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim()).trim();
  const sections = [];

  // ── Business contact details ─────────────────────────────────
  const contactLines = [bizName];
  if (c.address)   contactLines.push(c.address);
  if (c.postcode)  contactLines.push(c.postcode);
  if (c.email)     contactLines.push(c.email);
  if (c.website)   contactLines.push(c.website);
  sections.push({
    id: 'contact',
    label: `Business Name & Address${c.email ? ' / Email' : ''}${c.website ? ' / Website' : ''}`,
    text: contactLines.filter(Boolean).join('\n'),
    checked: true
  });

  // ── Phone ────────────────────────────────────────────────────
  if (c.phone) {
    sections.push({ id: 'phone', label: `Phone:  ${c.phone}`, text: `Phone: ${c.phone}`, checked: true });
  }

  // ── Company / Registration number ────────────────────────────
  if (c.companyNumber) {
    sections.push({ id: 'companyNum', label: `Company Number:  ${c.companyNumber}`, text: `Company / Registration Number: ${c.companyNumber}`, checked: true });
  }

  // ── Bank transfer ────────────────────────────────────────────
  if (methods.includes('bank') && c.bankAcc) {
    const bankLines = ['Bank Transfer'];
    if (c.bankAccHolder) bankLines.push(`Account Name: ${c.bankAccHolder}`);
    if (c.bankName)      bankLines.push(`Bank: ${c.bankName}`);
    if (c.bankSort)      bankLines.push(`Sort Code: ${c.bankSort}`);
    bankLines.push(`Account Number: ${c.bankAcc}`);
    sections.push({ id: 'bank', label: 'Bank Transfer details', text: bankLines.join('\n'), checked: true });
  }

  // ── PayPal ───────────────────────────────────────────────────
  if (methods.includes('paypal') && c.paypalRef) {
    sections.push({ id: 'paypal', label: `PayPal:  ${c.paypalRef}`, text: `PayPal: ${c.paypalRef}`, checked: true });
  }

  // ── Cash ─────────────────────────────────────────────────────
  if (methods.includes('cash')) {
    sections.push({ id: 'cash', label: 'Cash on Completion', text: 'Cash on Completion accepted', checked: false });
  }

  // ── Other payment method ─────────────────────────────────────
  if (methods.includes('other') && c.payOther) {
    sections.push({ id: 'other', label: c.payOther, text: c.payOther, checked: true });
  }

  return sections;
}

function buildBizInfoText() {
  const parts = [];
  document.querySelectorAll('#bizInfoOptions input[type="checkbox"]:checked').forEach(cb => {
    const text = cb.dataset.text;
    if (text) parts.push(text);
  });
  return parts.join('\n\n') || 'No items selected.';
}

function updateBizInfoPreview() {
  setVal('bizInfoShareText', buildBizInfoText());
}

function openBizInfoModal() {
  const sections = bizInfoSections();
  const container = document.getElementById('bizInfoOptions');
  if (!container) return;

  container.innerHTML = sections.map(s => `
    <label class="checkbox-label biz-info-check">
      <input type="checkbox" name="bizInfo" value="${s.id}"
             data-text="${s.text.replace(/"/g, '&quot;')}"
             ${s.checked ? 'checked' : ''}>
      ${s.label}
    </label>`).join('');

  updateBizInfoPreview();
  document.getElementById('bizInfoModal').style.display = 'flex';
}

async function copyBizInfo() {
  const text = getVal('bizInfoShareText');
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.', 'success');
  } catch {
    toast('Select the text and copy manually.', 'info');
  }
}

async function shareBizInfo() {
  const text = getVal('bizInfoShareText');
  if (navigator.share) {
    try { await navigator.share({ text, title: 'My Business Info' }); return; } catch(e) {}
  }
  copyBizInfo();
}

async function shareLexiApp() {
  const text = 'Estimates, quotes, invoices and receipts - done in minutes, right there on site. Match your brand and look professional, straight from your phone. No faff. No spreadsheets. No sitting at a laptop at 10pm. Worth two minutes of your time - take a look!';
  const url = 'https://www.lexihandlesit.com';
  if (navigator.share) {
    try { await navigator.share({ title: 'Lexi Handles It', text, url }); return; } catch(e) {}
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link copied to clipboard.', 'success');
  } catch {
    toast('Share is not available on this device.', 'error');
  }
}

function openCustomerDashboardForDoc(docId) {
  const groups = buildCustomerGroups();
  const group = groups.find(g => g.docs.some(d => d.id === docId));
  if (!group) return;
  document.getElementById('customerDashboardModal').style.display = 'flex';
  renderSingleCustomerDashboard(group, groups);
}

function openCustomerDashboard() {
  const body = document.getElementById('customerDashboardBody');
  if (!state.saved.length) {
    body.innerHTML = '<p class="cp-empty">No saved customers yet.</p>';
  } else {
    renderCustomerSelector(buildCustomerGroups());
  }
  document.getElementById('customerDashboardModal').style.display = 'flex';
}

function getCustomerDisplayName(doc) {
  const q = doc.quote || {};
  const built = buildCustName(q).trim();
  return built || (doc.custName || '').trim() || 'Customer details missing';
}

function buildCustomerGroups() {
  const groups = new Map();
  state.saved.forEach(doc => {
    const q = doc.quote || {};
    const name = getCustomerDisplayName(doc);
    const contact = (q.custEmail || q.custPhone || q.custPostcode || '').trim().toLowerCase();
    const nameKey = name.toLowerCase();
    const hasRealName = name !== 'Customer details missing';
    const key = hasRealName ? `${nameKey}|${contact}` : `missing|${doc.ref || doc.id}`;
    if (!groups.has(key)) groups.set(key, { name, contact, docs: [] });
    groups.get(key).docs.push(doc);
  });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getCustomerTotals(docs) {
  const paid = docs.reduce((s, d) => s + getDocPayments(d).reduce((p, x) => p + (x.amount || 0), 0), 0);
  const total = docs.reduce((s, d) => s + (d.total || 0), 0);
  const refs = docs.map(d => d.invoiceRef || d.ref || d.quote?.ref || 'No ref').filter(Boolean).join(', ');
  return { paid, total, outstanding: Math.max(0, total - paid), refs };
}

function renderCustomerSelector(groups) {
  const body = document.getElementById('customerDashboardBody');
  body.innerHTML = `
    <div class="customer-selector-list">
      ${groups.map((group, idx) => {
        const totals = getCustomerTotals(group.docs);
        return `
          <button type="button" class="customer-selector-row" data-idx="${idx}">
            <span class="customer-selector-name">${esc(group.name)}</span>
            <span class="customer-selector-ref">${esc(totals.refs)}</span>
            <span class="customer-selector-paid">Paid ${fmtPrice(totals.paid)}</span>
            <span class="customer-selector-outstanding">Outstanding ${fmtPrice(totals.outstanding)}</span>
          </button>`;
      }).join('')}
    </div>`;
  body.querySelectorAll('.customer-selector-row').forEach(btn => {
    btn.addEventListener('click', () => renderSingleCustomerDashboard(groups[parseInt(btn.dataset.idx, 10)], groups));
  });
}

function buildCustomerJobSection(d) {
  const q = d.quote || {};
  // items may live in q.items or (legacy) d.items
  const items = (q.items && q.items.length ? q.items : null) || (d.items && d.items.length ? d.items : null) || [];
  const subtotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const discPct  = parseFloat(q.discount) || 0;
  const discount = subtotal * discPct / 100;
  const afterDisc = subtotal - discount;
  const vatRate  = q.vatRate === 'custom' ? parseFloat(q.vatCustom) || 0 : parseFloat(q.vatRate) || 0;
  const vatAmt   = afterDisc * vatRate / 100;
  const payments = getDocPayments(d);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = Math.max(0, (d.total || 0) - totalPaid);
  const isOverdue = !d.paid && d.invoiceSent && d.invoiceDueDate && todayStr() > d.invoiceDueDate;
  const statusClass = d.paid ? 'paid' : isOverdue ? 'overdue' : d.invoiceSent ? 'invoiced' : (q.type || 'estimate').toLowerCase();
  const statusLabel = d.paid ? 'Paid' : isOverdue ? 'Overdue' : d.invoiceSent ? 'Invoiced' : (q.type || 'Estimate');
  const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
  const docDate = q.date || d.date || '';
  const photos = d.photos || {};
  const beforePhotos = photos.before || [];
  const afterPhotos  = photos.after  || [];

  const itemsHtml = items.length
    ? items.map(i => `
        <div class="cdv-item-row">
          <span class="cdv-item-name">${esc(i.name)}${i.qty > 1 ? ` <span class="cdv-item-qty">×${i.qty}</span>` : ''}</span>
          <span class="cdv-item-price">${fmtPrice((i.unitPrice || 0) * (i.qty || 1))}</span>
        </div>`).join('')
    : '';

  const totalsHtml = `
    <div class="cdv-totals">
      ${items.length ? `<div class="cdv-total-row"><span>Subtotal</span><span>${fmtPrice(subtotal)}</span></div>` : ''}
      ${discount > 0 ? `<div class="cdv-total-row cdv-discount-row"><span>Discount (${discPct}%)</span><span>-${fmtPrice(discount)}</span></div>` : ''}
      ${vatAmt   > 0 ? `<div class="cdv-total-row cdv-vat-row"><span>VAT (${vatRate}%)</span><span>${fmtPrice(vatAmt)}</span></div>` : ''}
      <div class="cdv-total-row cdv-grand-total"><span>Total</span><span>${fmtPrice(d.total || 0)}</span></div>
    </div>`;

  const paymentsHtml = payments.length ? `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Payments</div>
      ${payments.map((p, i) => `
        <div class="cdv-payment-row">
          <span class="cdv-pay-num">Payment ${i + 1}</span>
          <span class="cdv-pay-date">${formatDate(p.date)}</span>
          <span class="cdv-pay-amount">${fmtPrice(p.amount)}</span>
        </div>`).join('')}
      ${outstanding > 0
        ? `<div class="cdv-payment-row cdv-outstanding-row"><span class="cdv-pay-num">Outstanding</span><span></span><span class="cdv-pay-amount">${fmtPrice(outstanding)}</span></div>`
        : `<div class="cdv-paid-stamp">✓ Paid in full</div>`}
    </div>` : `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Payments</div>
      <p class="cdv-empty">No payment recorded yet. To update payment click Update.</p>
    </div>`;

  const notesHtml = q.notes ? `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes to Customer</div>
      <p class="cdv-note-text">${esc(q.notes)}</p>
    </div>` : '';

  const privateHtml = q.privateNotes ? `
    <div class="cdv-section cdv-private">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private Notes</div>
      <p class="cdv-note-text">${esc(q.privateNotes)}</p>
    </div>` : '';

  const photoGroup = (label, list) => list.length ? `
    <div class="cdv-photo-group">
      <div class="cdv-photo-label">${label}</div>
      <div class="cdv-photo-grid">${list.map(src => `<img src="${src}" class="cdv-photo-thumb" alt="${label} photo">`).join('')}</div>
    </div>` : '';
  const photosHtml = (beforePhotos.length || afterPhotos.length) ? `
    <div class="cdv-section">
      <div class="cdv-section-label"><svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Photos</div>
      ${photoGroup('Before', beforePhotos)}
      ${photoGroup('After', afterPhotos)}
    </div>` : '';

  return `
    <div class="cdv-job-card">
      <div class="cdv-job-header">
        <div class="cdv-job-meta">
          <span class="cdv-job-ref">${esc(ref)}</span>
          ${docDate ? `<span class="cdv-job-date">${formatDate(docDate)}</span>` : ''}
        </div>
        <span class="type-badge ${statusClass}">${esc(statusLabel)}</span>
      </div>
      <div class="cdv-items">${itemsHtml}</div>
      ${totalsHtml}
      ${paymentsHtml}
      ${notesHtml}
      ${privateHtml}
      ${photosHtml}
    </div>`;
}

function renderSingleCustomerDashboard(group, groups) {
  activeCustomerGroup = group;
  const body = document.getElementById('customerDashboardBody');
  const firstDoc = group.docs[0];
  const q = firstDoc.quote || {};
  const totals = getCustomerTotals(group.docs);

  // Contact details
  const iconPin  = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const iconPhone = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const iconMail  = `<svg class="cdv-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const contactLines = [
    q.custAddr    ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconPin}</span>${esc(q.custAddr)}${q.custPostcode ? ', ' + esc(q.custPostcode) : ''}</span>` : '',
    q.custPhone   ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconPhone}</span>${esc(q.custPhone)}</span>` : '',
    q.custEmail   ? `<span class="cdv-contact-line"><span class="cdv-contact-icon">${iconMail}</span>${esc(q.custEmail)}</span>` : '',
  ].filter(Boolean).join('');

  // Put customer name in modal title
  const titleEl = document.getElementById('customerDashboardTitle');
  if (titleEl) titleEl.textContent = group.name;

  // contentHtml = pure dashboard content (used for download — no buttons)
  const contentHtml = `
    <div class="customer-dashboard-card printable-customer-dashboard">
      <div class="cdv-header">
        ${contactLines ? `<div class="cdv-contact">${contactLines}</div>` : ''}
      </div>
      <div class="cdv-summary-bar">
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Total Charged</span>
          <span class="cdv-summary-value">${fmtPrice(totals.total)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Paid</span>
          <span class="cdv-summary-value cdv-paid">${fmtPrice(totals.paid)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Outstanding</span>
          <span class="cdv-summary-value ${totals.outstanding > 0 ? 'cdv-outstanding' : 'cdv-paid'}">${fmtPrice(totals.outstanding)}</span>
        </div>
        <div class="cdv-summary-item">
          <span class="cdv-summary-label">Jobs</span>
          <span class="cdv-summary-value">${group.docs.length}</span>
        </div>
      </div>
      <div class="cdv-jobs-list">
        ${group.docs.map(d => buildCustomerJobSection(d)).join('')}
      </div>
    </div>`;

  body.innerHTML = contentHtml;

  // Wire modal-header action buttons (all set after contentHtml is ready)
  const firstDocId = group.docs[0]?.id;
  const modal = document.getElementById('customerDashboardModal');

  const dashEditBtn = document.getElementById('custDashEditBtn');
  if (dashEditBtn) dashEditBtn.onclick = () =>
    openCustomerEditChoice(group.docs.length === 1 ? firstDocId : null);

}

/* ===== CUSTOMER EDIT CHOICE ===== */
let activeEditDocId = null; // docId pre-selected when Edit is clicked on a specific job card

function openCustomerEditChoice(docId) {
  activeEditDocId = docId || null;
  // Personalise the title with customer first name if available
  try {
    const first = (activeCustomerGroup?.docs[0]?.quote?.custFirstName || '').trim();
    const titleEl = document.getElementById('customerEditChoiceModal')?.querySelector('.modal-title');
    if (titleEl) titleEl.textContent = first ? `What would you like to edit, ${first}?` : 'What would you like to edit?';
  } catch(e) {}
  // Reset to main choice view and show
  document.getElementById('custEditChoiceMain').style.display = '';
  document.getElementById('custEditJobPicker').style.display = 'none';
  document.getElementById('customerEditChoiceModal').style.display = 'flex';
}

function customerEditPickDoc(editType) {
  const group = activeCustomerGroup;
  if (!group) return;
  // If we already know the specific doc (clicked from a job card), use it directly
  if (activeEditDocId) {
    executeCustomerEdit(editType, activeEditDocId);
    return;
  }
  if (group.docs.length === 1) {
    executeCustomerEdit(editType, group.docs[0].id);
  } else {
    // Show job picker
    document.getElementById('custEditChoiceMain').style.display = 'none';
    const jobList = document.getElementById('custEditJobPicker');
    jobList.innerHTML = `
      <p class="cec-pick-label">Which job?</p>
      ${group.docs.map(d => `
        <button type="button" class="cec-job-option" data-id="${d.id}" data-type="${editType}">
          <span class="cec-job-ref">${esc(d.invoiceRef || d.ref || d.quote?.ref || 'No ref')}</span>
          <span class="cec-job-desc">${esc((d.quote?.items || []).map(i => i.name).join(', ') || 'Job')}</span>
          <span class="cec-job-total">${fmtPrice(d.total || 0)}</span>
        </button>`).join('')}`;
    jobList.style.display = '';
    jobList.querySelectorAll('.cec-job-option').forEach(btn => {
      btn.addEventListener('click', () => executeCustomerEdit(btn.dataset.type, btn.dataset.id));
    });
  }
}

function executeCustomerEdit(editType, docId) {
  document.getElementById('customerEditChoiceModal').style.display = 'none';
  if (editType === 'details') {
    openCustomerDetailsEdit(docId);
  } else if (editType === 'job') {
    openJobDetailsEdit(docId);
  } else if (editType === 'money') {
    document.getElementById('customerDashboardModal').style.display = 'none';
    openMarkPaid(docId);
  } else if (editType === 'terms') {
    document.getElementById('customerDashboardModal').style.display = 'none';
    const doc = state.saved.find(d => d.id === docId);
    if (doc) {
      loadQuoteFromDoc(doc);
      state.editingDocId = docId;
      state.editingFromTerms = true;
      const titleEl = document.querySelector('#page-completion .page-title');
      if (titleEl) titleEl.textContent = 'Edit Job Terms';
      showPage('page-completion');
    }
  }
}

function openCustomerDetailsEdit(docId) {
  const group = activeCustomerGroup;
  if (!group) return;
  // Use the specific doc if we know which job was clicked, otherwise fall back to first doc in group
  const targetDoc = (docId && state.saved.find(d => d.id === docId)) || group.docs[0];
  const q = (targetDoc && targetDoc.quote) || {};
  setVal('cdeCustTitle',        q.custTitle        || '');
  setVal('cdeCustFirst',        q.custFirstName    || '');
  setVal('cdeCustLast',         q.custLastName     || '');
  setVal('cdeCustAddr',         q.custAddr         || '');
  setVal('cdeCustPostcode',     q.custPostcode     || '');
  setVal('cdeCustPhone',        q.custPhone        || '');
  setVal('cdeCustEmail',        q.custEmail        || '');
  setVal('cdeCustPrivateNotes', q.privateNotes     || '');
  document.getElementById('customerDetailsEditModal').style.display = 'flex';
}

function saveCustomerDetails() {
  const group = activeCustomerGroup;
  if (!group) return;
  // Customer-level fields — applied to every doc in the group
  const sharedUpdates = {
    custTitle:     getVal('cdeCustTitle'),
    custFirstName: getVal('cdeCustFirst'),
    custLastName:  getVal('cdeCustLast'),
    custAddr:      getVal('cdeCustAddr'),
    custPostcode:  getVal('cdeCustPostcode'),
    custPhone:     getVal('cdeCustPhone'),
    custEmail:     getVal('cdeCustEmail'),
  };
  // Private notes are per-job — only save to the specific doc that was edited
  const privateNotes = getVal('cdeCustPrivateNotes');
  const targetDocId = activeEditDocId || (group.docs[0] && group.docs[0].id);

  group.docs.forEach(doc => {
    if (!doc.quote) doc.quote = {};
    Object.assign(doc.quote, sharedUpdates);
    // Only update private notes on the specific job that was clicked
    if (doc.id === targetDocId) {
      doc.quote.privateNotes = privateNotes;
    }
    doc.custName = buildCustName(doc.quote);
  });
  // Update in-memory group name for re-render
  const newName = buildCustName(sharedUpdates).trim() || group.name;
  group.name = newName;
  save();
  refreshSavedDocs();

  // Close edit modals and return to dashboard
  document.getElementById('customerDetailsEditModal').style.display = 'none';
  document.getElementById('customerEditChoiceModal').style.display = 'none';

  // Re-render and show the customer dashboard
  const updatedGroups = buildCustomerGroups();
  const updatedGroup = updatedGroups.find(g => g.docs.some(d => group.docs.some(gd => gd.id === d.id))) || group;
  activeCustomerGroup = updatedGroup;
  renderSingleCustomerDashboard(updatedGroup, updatedGroups);
  document.getElementById('customerDashboardModal').style.display = 'flex';

  showSavedPopup("I've saved the details.");
}

/* ===== JOB DETAILS EDIT ===== */
let activeJobDetailsDocId = null;

function openJobDetailsEdit(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  activeJobDetailsDocId = docId;
  const q = doc.quote || {};
  const custName = buildCustName(q) || doc.custName || '';
  const subtitleEl = document.getElementById('jobDetailsEditSubtitle');
  if (subtitleEl) subtitleEl.textContent = custName ? `Job: ${custName}` : '';
  renderJobDetailsForm(doc);
  document.getElementById('jobDetailsEditModal').style.display = 'flex';
}

function jdeItemRowHtml(item) {
  return `
    <div class="jde-item-row">
      <input type="text" class="jde-item-name" placeholder="Description" value="${esc(item.name || '')}">
      <div class="input-pfx" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" class="jde-item-price" min="0" step="any" placeholder="0.00" value="${item.unitPrice != null ? item.unitPrice : ''}">
      </div>
      <button type="button" class="jde-item-remove" aria-label="Remove item">✕</button>
    </div>`;
}

function renderJobDetailsForm(doc) {
  const q = doc.quote || {};
  // Match same fallback logic as buildCustomerJobSection — quote.items first, then legacy doc.items
  const items = (q.items && q.items.length) ? q.items : ((doc.items && doc.items.length) ? doc.items : []);
  // Calculate total from items; fall back to doc.total for total-override docs
  const calcedTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const displayTotal = items.length ? calcedTotal : (doc.total || 0);
  const body = document.getElementById('jobDetailsEditBody');
  const hasPriceList = state.priceList && state.priceList.length > 0;
  body.innerHTML = `
    ${hasPriceList ? `
    <p class="jde-section-label">Add from Price List</p>
    <input type="text" id="jdePickerSearch" class="search-input" placeholder="Search your price list..." style="margin-bottom:6px">
    <div id="jdePickerList" class="jde-picker-list picker-list"></div>
    <div class="jde-divider"></div>` : ''}
    <p class="jde-section-label">Job Items</p>
    <div class="jde-item-headers">
      <span>Description</span><span>Price</span><span></span>
    </div>
    <div id="jdeItemsList" class="jde-items-list">
      ${items.length ? items.map(item => jdeItemRowHtml(item)).join('') : `<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>`}
    </div>
    <button type="button" class="btn btn-sage btn-sm" id="jdeAddItemBtn">+ One-off Item</button>
    <div class="form-group" style="margin-top:16px">
      <label for="jdeTotalOverride">Total <span class="jde-total-hint">(auto-calculated from items above, or set manually)</span></label>
      <div class="input-pfx form-group" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" id="jdeTotalOverride" min="0" step="any" placeholder="0.00" value="${displayTotal > 0 ? displayTotal : ''}">
      </div>
    </div>
    <div class="form-group" style="margin-top:4px">
      <label for="jdeNotes">Notes</label>
      <textarea id="jdeNotes" rows="3" placeholder="Any notes for this job...">${esc(q.notes || '')}</textarea>
    </div>`;

  wireJdeRemoveButtons();
  document.getElementById('jdeAddItemBtn').addEventListener('click', jdeAddItem);

  // Auto-update total field as items are edited
  body.addEventListener('input', e => {
    if (e.target.classList.contains('jde-item-price')) jdeUpdateTotal();
  });

  // Wire price list picker if present
  if (hasPriceList) {
    jdeRenderPicker('');
    document.getElementById('jdePickerSearch').addEventListener('input', e => jdeRenderPicker(e.target.value));
    document.getElementById('jdePickerList').addEventListener('click', e => {
      const item = e.target.closest('.pick-item');
      if (item) jdeAddFromPriceList(item.dataset.jobId);
    });
  }
}

function jdeRenderPicker(searchVal) {
  const q = (searchVal || '').toLowerCase();
  const filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  const container = document.getElementById('jdePickerList');
  if (!container) return;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:6px 0">No jobs match your search.</p>';
    return;
  }
  // Get names already in the items list to show as "added"
  const addedNames = new Set(
    [...document.querySelectorAll('#jdeItemsList .jde-item-name')].map(el => el.value.trim().toLowerCase())
  );
  container.innerHTML = filtered.map(item => {
    const isAdded = addedNames.has(item.name.toLowerCase());
    return `
      <div class="pick-item${isAdded ? ' added' : ''}" data-job-id="${esc(item.id)}" role="button" tabindex="0"
           aria-label="Add ${esc(item.name)}">
        <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        <span class="pick-add-btn">${isAdded ? '✓' : '+'}</span>
      </div>`;
  }).join('');
}

function jdeAddFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('jdeItemsList');
  // Remove empty hint if present
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  // Add a new editable row pre-filled with price list item
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: job.name, unitPrice: job.price });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>';
    }
    jdeUpdateTotal();
    jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
  });
  jdeUpdateTotal();
  // Refresh picker to show item as added
  jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
  // Scroll new row into view
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function jdeUpdateTotal() {
  const prices = [...document.querySelectorAll('#jdeItemsList .jde-item-price')]
    .map(el => parseFloat(el.value) || 0);
  if (prices.length > 0) {
    const total = prices.reduce((s, p) => s + p, 0);
    const totalEl = document.getElementById('jdeTotalOverride');
    if (totalEl) totalEl.value = total.toFixed(2);
  }
}

function wireJdeRemoveButtons() {
  document.querySelectorAll('#jdeItemsList .jde-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.jde-item-row');
      if (row) row.remove();
      // Show empty hint if no rows left
      const list = document.getElementById('jdeItemsList');
      if (list && !list.querySelector('.jde-item-row')) {
        list.innerHTML = '<p class="jde-empty-hint">No items yet - add one below.</p>';
      }
    });
  });
}

function jdeAddItem() {
  const list = document.getElementById('jdeItemsList');
  // Remove empty hint if present
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: '', unitPrice: '' });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet - add one below.</p>';
    }
  });
  row.querySelector('.jde-item-name').focus();
}

function saveJobDetails() {
  const docId = activeJobDetailsDocId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;

  // Collect items
  const items = [];
  document.querySelectorAll('#jdeItemsList .jde-item-row').forEach(row => {
    const name = (row.querySelector('.jde-item-name')?.value || '').trim();
    const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
    if (name || price) {
      items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
    }
  });

  const notes = document.getElementById('jdeNotes')?.value || '';
  const totalOverride = parseFloat(document.getElementById('jdeTotalOverride')?.value) || 0;

  if (!doc.quote) doc.quote = {};
  doc.quote.items = items;
  doc.quote.notes = notes;

  // Use item totals if items present; otherwise use the manual total override
  if (items.length > 0) {
    const subtotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
    const discPct = parseFloat(doc.quote.discount) || 0;
    const afterDisc = subtotal * (1 - discPct / 100);
    const vatPct = parseFloat(doc.quote.vatRate) || 0;
    doc.total = afterDisc * (1 + vatPct / 100);
  } else if (totalOverride > 0) {
    doc.total = totalOverride;
  }
  doc.custName = buildCustName(doc.quote);

  save();
  refreshSavedDocs();
  document.getElementById('jobDetailsEditModal').style.display = 'none';

  // Keep customer dashboard data fresh in the background
  try {
    const groups = buildCustomerGroups();
    const updatedGroup = groups.find(g => g.docs.some(d => d.id === docId)) || activeCustomerGroup;
    if (updatedGroup) activeCustomerGroup = updatedGroup;
  } catch (e) { console.error('Dashboard refresh error:', e); }

  // Return to a live preview of the updated estimate/quote
  const html = buildDocHtml(doc, 'quote');
  openPreview(html, 'quote', docId);
  showSavedPopup('Job details saved.');
}

/* ===== DOCUMENT GENERATION ===== */
const DOC_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;color:#1a1a1a;background:#e0e0e0;padding:20px 0}

  /* ── PAGE (full border, like the Word template) ── */
  .doc-wrap{max-width:760px;margin:0 auto;background:#fff;border:1px solid #b8b8b8}

  /* ── HEADER BAND (brand primary — set via inline style) ── */
  .doc-header{display:grid;grid-template-columns:110px 1fr 155px;align-items:center;gap:10px;padding:14px 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc-logo{max-height:56px;max-width:100px;object-fit:contain}
  .doc-logo-placeholder{width:72px;height:46px;border:1.5px dashed rgba(255,255,255,0.45);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:rgba(255,255,255,0.65)}
  .doc-biz-name{font-size:2rem;font-weight:700;text-align:center;line-height:1.2}
  .doc-type-label{font-size:1.33rem;font-weight:700;text-align:right;text-decoration:none;text-transform:uppercase;letter-spacing:0.05em;line-height:1.2}

  /* ── PREPARED BY / FOR (two cols, horizontal dividers, vertical centre line) ── */
  .doc-info{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #c4c4c4;border-bottom:1px solid #c4c4c4}
  .doc-info-col{padding:10px 18px}
  .doc-info-col+.doc-info-col{border-left:1px solid #c4c4c4}
  .doc-info-col h3{font-size:0.83rem;font-weight:700;margin-bottom:5px;text-transform:none;letter-spacing:0}
  .doc-info-col p{font-size:0.83rem;line-height:1.6;white-space:pre-wrap;color:#333}

  /* ── REFERENCE ROW (three bordered cells, label on top / value below) ── */
  .doc-ref-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #c4c4c4}
  .doc-ref-cell{padding:6px 18px;font-size:0.83rem;display:flex;flex-direction:column;gap:2px}
  .doc-ref-cell+.doc-ref-cell{border-left:1px solid #c4c4c4}
  .ref-label{font-weight:700;white-space:nowrap}
  .ref-value{color:#333}

  /* ── BODY PADDING ── */
  .doc-body{padding:14px 18px 20px}

  /* ── INTRO ── */
  .doc-intro{font-size:0.83rem;line-height:1.3;color:#333;margin-bottom:14px}

  /* ── SECTION HEADINGS (sentence-case bold + thin rule, matching Word) ── */
  .doc-section-heading{font-size:0.88rem;font-weight:700;margin-top:16px;margin-bottom:0;padding-bottom:3px;border-bottom:1px solid #888;text-transform:none;letter-spacing:0}

  /* ── DESCRIPTION BOX (brand bg — set via inline style) ── */
  .doc-desc-box{border:1px solid #ccc;border-top:none;padding:10px 12px;min-height:70px;font-size:0.83rem;line-height:1.7;color:#aaa;font-style:italic;white-space:pre-wrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc-desc-box.filled{color:#333;font-style:normal}

  /* ── ITEMS TABLE (accent header — set via inline style) ── */
  .doc-items-table{width:100%;border-collapse:collapse;border:1px solid #ccc;border-top:none}
  .doc-items-table thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .doc-items-table thead th{padding:8px 10px;font-size:0.77rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:left;color:#fff;border-right:1px solid rgba(255,255,255,0.2)}
  .doc-items-table thead th:last-child{text-align:right;border-right:none}
  .doc-items-table thead th.r{text-align:right}
  .doc-items-table tbody td{padding:8px 10px;border-bottom:1px solid #e8e8e8;border-right:1px solid #e8e8e8;font-size:0.83rem;vertical-align:top}
  .doc-items-table tbody td:last-child{text-align:right;font-weight:600;border-right:none}
  .doc-items-table tbody td.r{text-align:right}
  .item-unit{display:block;font-size:0.71rem;color:#888;margin-top:1px}
  .totals-sep td{border-top:1.5px solid #bbb!important;border-bottom:none!important;border-right:none!important;padding:6px 0 0!important;background:#fff}
  .totals-row td{padding:3px 10px;font-size:0.82rem;border:none!important;background:#fff}
  .totals-row td.r{text-align:right}
  .totals-total{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .totals-total td{padding:8px 10px;font-size:0.9rem;font-weight:700;border:none!important;color:#fff}
  .totals-total td.r{text-align:right}

  /* ── TERMS TABLE ── */
  .doc-terms-table{width:100%;border-collapse:collapse;border:1px solid #ccc;border-top:none}
  .doc-terms-table td{padding:7px 12px;font-size:0.82rem;vertical-align:top;border-bottom:1px solid #e8e8e8;line-height:1.55}
  .doc-terms-table tr:last-child td{border-bottom:none}
  .t-label{font-weight:700;width:130px;border-right:1px solid #ccc!important;white-space:nowrap;color:#1a1a1a}
  .t-value{color:#333}

  /* ── GENERIC SECTIONS (invoice/receipt extras) ── */
  .section,.doc-section{margin-top:16px;padding-top:12px;border-top:1px solid #ddd}
  .section h3,.doc-section h3{font-size:0.75rem;text-transform:uppercase;letter-spacing:.07em;color:#888;margin-bottom:7px;font-weight:700}
  .section p,.doc-section p,.section ul,.doc-section ul{font-size:0.83rem;line-height:1.7;white-space:pre-wrap}
  .section ul,.doc-section ul{list-style:disc;padding-left:18px}

  /* ── SIG BLOCK (invoice/receipt) ── */
  .sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
  .sig-box{border:1.5px solid #ddd;border-radius:4px;padding:12px;min-height:80px;display:flex;flex-direction:column;justify-content:flex-end}
  .sig-label{font-size:0.75rem;color:#888;margin-top:8px;text-transform:uppercase;letter-spacing:.06em}
  .sig-img{max-height:60px;max-width:200px}
  .sig-typed{font-family:'Dancing Script',cursive;font-size:1.5rem;color:#1a1a1a}

  /* ── PAGE FOOTER ── */
  .doc-footer{padding:8px 18px;text-align:center;font-size:0.7rem;color:#aaa;border-top:1px solid #e0e0e0}

  /* ── ACCEPTANCE PAGE (quotes/estimates — same bordered box) ── */
  .doc-accept{max-width:760px;margin:20px auto 0;background:#fff;border:1px solid #b8b8b8;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:13px;color:#1a1a1a;page-break-before:always}
  .doc-accept-body{padding:22px 18px 20px}
  .doc-accept-heading{font-size:0.88rem;font-weight:700;padding-bottom:4px;border-bottom:1px solid #888;margin-bottom:16px;text-transform:none;letter-spacing:0}
  .doc-accept-body>p{font-size:0.83rem;line-height:1.3;color:#333;margin-bottom:32px}
  .doc-sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:32px}
  .doc-sig-box{padding-top:48px;border-top:1px solid #999}
  .doc-sig-label{font-size:0.73rem;color:#666;margin-top:5px}
  .doc-sig-typed{font-family:'Dancing Script',cursive;font-size:1.4rem;color:#1a1a1a;display:block;margin-bottom:2px}
  .doc-sig-name{font-size:0.83rem;font-weight:600;color:#1a1a1a}
  .doc-accept-thanks{font-size:0.83rem;text-align:center;line-height:1.3;color:#333}

  /* ── PHOTOS ── */
  .photo-doc-page{page-break-before:always;padding-top:24px}
  .photo-doc-group{margin-top:16px}
  .photo-doc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px}
  .photo-doc-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:4px;border:1px solid #ddd}

  /* ── MOBILE (≤ 520 px) ── */
  @media (max-width:520px){
    body{padding:0;background:#fff}
    .doc-wrap{border-left:none;border-right:none;max-width:100%}

    /* Header: shrink logo column, keep type label on right */
    .doc-header{grid-template-columns:52px 1fr 82px;gap:6px;padding:10px 10px}
    .doc-logo{max-height:40px;max-width:48px}
    .doc-logo-placeholder{width:40px;height:32px;font-size:0.62rem}
    .doc-biz-name{font-size:1.3rem}
    .doc-type-label{font-size:0.88rem;letter-spacing:0.03em}

    /* Prepared by/for: stack vertically */
    .doc-info{grid-template-columns:1fr}
    .doc-info-col+.doc-info-col{border-left:none;border-top:1px solid #c4c4c4}

    /* Ref row: keep 3 cols but tighten */
    .doc-ref-cell{padding:5px 10px;font-size:0.77rem}

    /* Body */
    .doc-body{padding:10px 10px 14px}
    .doc-intro{margin-bottom:10px}
    .doc-section-heading{margin-top:12px}
    .doc-desc-box{padding:8px 10px;font-size:0.79rem}

    /* Items table */
    .doc-items-table{border-left:none;border-right:none}
    .doc-items-table thead th{padding:6px 5px;font-size:0.68rem;letter-spacing:0}
    .doc-items-table tbody td{padding:6px 5px;font-size:0.77rem}
    .item-unit{font-size:0.65rem}
    .totals-row td{padding:2px 5px;font-size:0.76rem}
    .totals-total td{padding:7px 6px;font-size:0.82rem}

    /* Terms */
    .doc-terms-table td{padding:5px 8px;font-size:0.77rem}
    .t-label{width:90px}

    /* Footer */
    .doc-footer{padding:6px 10px}

    /* Acceptance page */
    .doc-accept{margin-top:8px;border-left:none;border-right:none}
    .doc-accept-body{padding:14px 10px 14px}
    .doc-sig-grid{grid-template-columns:1fr;gap:16px}
    .doc-accept-thanks{font-size:0.79rem}
  }

  @media print{
    body{background:#fff;padding:0}
    .doc-wrap,.doc-accept{max-width:100%;margin:0;border:1px solid #b8b8b8}
    .doc-accept{margin-top:0}
  }
`;

function buildQuoteDoc() {
  const q = collectQuoteState();
  // Always pull the live items from state — collectQuoteState may be called
  // before the DOM is fully settled in some edge cases
  q.items = [...state.quote.items];
  const tempDoc = {
    quote: q,
    company: { ...state.company },
    custName: buildCustName(q),
    total: calcTotal(q)
  };
  return buildDocHtml(tempDoc, 'quote');
}

function buildDocHtml(doc, docType, extra = {}) {
  const q  = doc.quote;
  const co = doc.company || state.company;

  // ── Brand colours — read live picker values so the document always
  //    reflects the currently selected colours, even before Save ──
  const primary = document.getElementById('colourHeader')?.value || state.company.brandPrimary || DEFAULT_COLOURS.primary;
  const accent  = document.getElementById('colourAccent')?.value || state.company.brandAccent  || DEFAULT_COLOURS.accent;
  const bgCol   = document.getElementById('colourBg')?.value     || state.company.brandBg      || DEFAULT_COLOURS.bg;

  // ── Financials ───────────────────────────────────────────────────
  const sub       = (q.items||[]).reduce((s,i) => s + i.unitPrice * i.qty, 0);
  const vatRate   = q.vatRate === 'custom' ? parseFloat(q.vatCustom)||0 : parseFloat(q.vatRate)||0;
  const disc      = parseFloat(q.discount)||0;
  const afterDisc = sub - sub * disc / 100;
  const vatAmt    = afterDisc * vatRate / 100;
  const total     = doc.total != null ? doc.total : afterDisc + vatAmt;

  // ── Doc labels ───────────────────────────────────────────────────
  let docLabel  = q.type || 'Estimate';
  let refLabel  = q.ref  || '';
  let dateLabel = q.date;
  if (docType === 'invoice') { docLabel = 'Invoice'; refLabel = extra.invRef||''; dateLabel = extra.invDate||q.date; }
  if (docType === 'receipt') { docLabel = 'Receipt'; refLabel = extra.recRef||doc.receiptRef||''; dateLabel = extra.date||q.date; }

  const isQuote = (docType !== 'invoice' && docType !== 'receipt');

  // ── Names ────────────────────────────────────────────────────────
  const authFullName = [(co.firstName||''), (co.lastName||'')].filter(Boolean).join(' ');
  const bizName      = co.businessName || authFullName;
  const custName     = [q.custTitle, q.custFirstName, q.custLastName].filter(Boolean).join(' ');

  // ── Address blocks ───────────────────────────────────────────────
  const bizLines  = [co.address, co.postcode, co.phone, co.email, co.website].filter(Boolean).join('\n');
  const custLines = [custName, q.custAddr, q.custPostcode, q.custEmail, q.custPhone].filter(Boolean).join('\n');

  // ── Logo — prefer doc snapshot, fall back to live state so it always shows ──
  const logoSrc = co.logo || state.company.logo || '';
  // ── Header text colour — auto dark/light based on primary background ──
  const headerTextCol = isColorLight(primary) ? '#1a1a1a' : '#ffffff';
  const logoPlaceholderStyle = isColorLight(primary)
    ? 'border:1.5px dashed rgba(0,0,0,0.3);color:rgba(0,0,0,0.5)'
    : 'border:1.5px dashed rgba(255,255,255,0.45);color:rgba(255,255,255,0.65)';
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="Logo" class="doc-logo">`
    : `<div class="doc-logo-placeholder" style="${logoPlaceholderStyle}">Logo</div>`;

  // ── Valid for ────────────────────────────────────────────────────
  let validForText = '';
  if (isQuote) {
    if      (q.validFor === 'custom') validForText = q.validCustom ? `${q.validCustom} days` : '';
    else if (q.validFor)              validForText = `${q.validFor} days`;
  }

  // ── Line items ───────────────────────────────────────────────────
  const itemsHtml = (q.items||[]).map(item => `
    <tr>
      <td>${esc(item.name)}${item.unit ? `<span class="item-unit">${esc(item.unit)}</span>` : ''}</td>
      <td class="r">${item.qty}</td>
      <td class="r">${fmtPrice(item.unitPrice)}</td>
      <td class="r">${fmtPrice(item.unitPrice * item.qty)}</td>
    </tr>`).join('') ||
    `<tr><td colspan="4" style="text-align:center;color:#aaa;padding:14px;font-style:italic">No items added — go back and add jobs in Step 2</td></tr>`;

  // ── Totals — labels in col 3 only, amounts in col 4, fully right-justified ──
  const discRow = disc > 0
    ? `<tr class="totals-row"><td></td><td></td><td class="r" style="font-size:0.79rem">Discount (${disc}%):</td><td class="r">-${fmtPrice(sub*disc/100)}</td></tr>`
    : '';
  const totalsRows = `
    <tr class="totals-sep"><td colspan="4"></td></tr>
    <tr class="totals-row"><td></td><td></td><td class="r" style="font-size:0.79rem;font-weight:700">Subtotal:</td><td class="r">${fmtPrice(afterDisc)}</td></tr>
    ${discRow}
    <tr class="totals-row"><td></td><td></td><td class="r" style="font-size:0.79rem">VAT${vatRate>0?` (${vatRate}%)`:'  (if applicable)'}:</td><td class="r">${vatRate>0?fmtPrice(vatAmt):'—'}</td></tr>
    <tr class="totals-total" style="background:${accent}"><td colspan="2"></td><td class="r">TOTAL:</td><td class="r">${fmtPrice(total)}</td></tr>`;

  // ── Description of work — only shown when a description was entered ──
  const descHtml = q.notes
    ? `<div class="doc-section-heading">Description of Work</div>
       <div class="doc-desc-box filled" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(q.notes)}</div>`
    : '';

  // ── Terms table ──────────────────────────────────────────────────
  const termsHtml = buildNewTermsHtml(q);

  // ── Invoice / receipt extras ────────────────────────────────────
  let extraHtml = '';
  if (docType === 'invoice') {
    if (extra.dueDate) extraHtml += `<div class="section"><h3>Payment Due</h3><p>${formatDate(extra.dueDate)}</p></div>`;
    extraHtml += buildPaymentSection(co, docType, extra.payMethod);
    if (extra.notes)   extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  } else if (docType === 'receipt') {
    extraHtml = `<div class="section"><h3>Payment Received</h3><p>Amount: <strong>${fmtPrice(parseFloat(extra.amount)||0)}</strong><br>Date: ${formatDate(extra.date||todayStr())}<br>Method: ${esc(extra.method||'')}</p></div>`;
    if (extra.notes) extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  }

  // ── Sig block for invoice/receipt ───────────────────────────────
  const sigHtml = !isQuote ? buildSigSection(q, co, docType) : '';

  // ── Photos ───────────────────────────────────────────────────────
  const photosHtml = extra.includePhotos ? buildPhotosSection(doc) : '';

  // ── Acceptance page (quotes / estimates) ────────────────────────
  let acceptancePage = '';
  if (isQuote) {
    const sigText    = q.custSigText || '';
    const authName   = q.authSig || authFullName || bizName;
    const sigContent = sigText ? `<span class="doc-sig-typed">${esc(sigText)}</span>` : '';
    acceptancePage = `
      <div class="doc-accept">
        <div class="doc-accept-body">
          <div class="doc-accept-heading">Acceptance</div>
          <p>Please let me know if this meets your needs. To accept this ${(q.type||'quote').toLowerCase()} please sign below or reply confirming your acceptance.</p>
          <div class="doc-sig-grid">
            <div class="doc-sig-box">
              ${sigContent}
              ${authName ? `<div class="doc-sig-name">${esc(authName)}</div>` : ''}
              <div class="doc-sig-label">Authorised Signature</div>
            </div>
            <div class="doc-sig-box">
              <div class="doc-sig-label">Customer Signature</div>
            </div>
          </div>
          <p class="doc-accept-thanks">Thank you for the opportunity. I look forward to hearing from you.<br>Kind regards, ${esc(authName)}</p>
        </div>
        <div class="doc-footer">Powered by LexiHandlesIt.com</div>
      </div>`;
  }

  return `
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" rel="stylesheet">
    <style>${DOC_CSS}</style>
    <div class="doc-wrap">
      <div class="doc-header" style="background:${primary}">
        ${logoHtml}
        <div class="doc-biz-name" style="color:${headerTextCol}">${esc(bizName)}</div>
        <div class="doc-type-label" style="color:${headerTextCol}">${esc(docLabel)}</div>
      </div>
      <div class="doc-info">
        <div class="doc-info-col">
          <h3>Prepared By</h3>
          <p>${esc(bizLines)}</p>
        </div>
        <div class="doc-info-col">
          <h3>Prepared For</h3>
          <p>${esc(custLines)}</p>
        </div>
      </div>
      <div class="doc-ref-row">
        <div class="doc-ref-cell"><span class="ref-label">Reference No:</span><span class="ref-value">${esc(refLabel)}</span></div>
        <div class="doc-ref-cell"><span class="ref-label">Date:</span><span class="ref-value">${dateLabel ? formatDate(dateLabel) : ''}</span></div>
        <div class="doc-ref-cell"><span class="ref-label">Valid for:</span><span class="ref-value">${esc(validForText)}</span></div>
      </div>
      <div class="doc-body">
        ${descHtml}
        <div class="doc-section-heading">Itemised Breakdown</div>
        <table class="doc-items-table">
          <thead><tr style="background:${accent}">
            <th>Description</th>
            <th class="r">Qty</th>
            <th class="r">Unit Price</th>
            <th class="r" style="border-right:none">Total</th>
          </tr></thead>
          <tbody>${itemsHtml}${totalsRows}</tbody>
        </table>
        ${extraHtml}
        ${termsHtml}
        ${sigHtml}
        ${photosHtml}
      </div>
      ${isQuote ? '' : '<div class="doc-footer">Powered by LexiHandlesIt.com</div>'}
    </div>
    ${acceptancePage}`;
}

function buildPaymentSection(co, docType, preferredMethod = '') {
  if (docType !== 'invoice') return '';
  const coMethods  = co.payMethods || [];
  // preferredMethod may be a string (legacy) or array (new multi-select)
  const preferred  = Array.isArray(preferredMethod)
    ? preferredMethod
    : (preferredMethod ? [preferredMethod] : []);

  // If specific methods chosen, only show those; otherwise fall back to all company methods
  const show = preferred.length > 0 ? preferred : null;

  let lines = [];
  const want = m => !show || show.some(s => s.toLowerCase().includes(m));

  if (want('bank') && coMethods.includes('bank') && co.bankAcc) {
    lines.push(`Bank Transfer\nAccount Name: ${co.bankAccHolder || ''}\nBank: ${co.bankName || ''}\nSort Code: ${co.bankSort || ''}\nAccount Number: ${co.bankAcc}`);
  }
  if (want('cash') && coMethods.includes('cash')) lines.push('Cash on Completion');
  if (want('paypal') && coMethods.includes('paypal') && co.paypalRef) lines.push(`PayPal: ${co.paypalRef}`);
  if (want('card')) lines.push('Card Payment Accepted');
  if (want('other') && coMethods.includes('other') && co.payOther) lines.push(co.payOther);

  // If preferred methods selected but no company details match, just list the chosen methods
  if (!lines.length && preferred.length) lines = [...preferred];

  if (!lines.length) return '';
  return `<div class="section"><h3>Payment Details</h3><p style="white-space:pre-line">${esc(lines.join('\n\n'))}</p></div>`;
}

function buildPhotosSection(doc) {
  const photos = doc.photos || {};
  const before = (photos.before || []).slice(0, 3);
  const after = (photos.after || []).slice(0, 3);
  if (!before.length && !after.length) return '';
  const group = (title, list) => !list.length ? '' : `
    <div class="photo-doc-group">
      <h3>${title}</h3>
      <div class="photo-doc-grid">${list.map(src => `<img src="${src}" alt="${title} photo">`).join('')}</div>
    </div>`;
  return `
    <div class="section photo-doc-page">
      <h3>Before and After Photos</h3>
      ${group('Before', before)}
      ${group('After', after)}
    </div>`;
}

function buildTermsSection(q) {
  // Legacy — kept for compatibility; new output uses buildNewTermsHtml
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

function buildNewTermsHtml(q) {
  const presets = {
    payment30:       'Payment due within 30 days of invoice date.',
    depositRequired: 'A 50% deposit is required before work commences.',
    quotationValid:  'This quotation is valid for 30 days from the date shown.',
    materialsExtra:  'Materials are not included unless stated above.',
    cancellation:    'Cancellation within 48 hours of scheduled start date may incur a charge.'
  };
  const payKeys  = new Set(['payment30', 'depositRequired']);
  const sel      = q.selectedTerms || [];
  const payLines = sel.filter(k =>  payKeys.has(k)).map(k => presets[k]);
  const conLines = sel.filter(k => !payKeys.has(k)).map(k => presets[k]);
  const addText  = q.customTerms || '';
  if (!payLines.length && !conLines.length && !addText) return '';
  return `
    <div class="doc-section-heading">Terms and Conditions</div>
    <table class="doc-terms-table">
      <tr><td class="t-label">Payment Terms</td><td class="t-value">${esc(payLines.join(' '))}</td></tr>
      <tr><td class="t-label">Contract</td><td class="t-value">${esc(conLines.join(' '))}</td></tr>
      <tr><td class="t-label">Additional Terms</td><td class="t-value">${esc(addText)}</td></tr>
    </table>`;
}

function buildSigSection(q, co, docType) {
  // Prefer saved custSigText; only read live DOM for new page3 quotes (where custSigText not yet saved)
  const sigText = q.custSigText || document.getElementById('custSigText')?.value || '';
  if (!q.authSig && !sigText) return '';
  const authName = q.authSig || co.businessName || '';
  const authSigContent = sigText
    ? `<span class="sig-typed">${esc(sigText)}</span>`
    : '';

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

function downloadCustomerDashboard(groupName, html) {
  const safeName = (groupName || 'Customer').replace(/[^a-zA-Z0-9 \-_.]/g, '').trim().replace(/\s+/g, '-');
  const filename = `${safeName}-Dashboard.html`;
  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;color:#2C2C2C;background:#fff;padding:24px;max-width:700px;margin:0 auto}
    .customer-dashboard-card{border:1px solid #DDD5C8;border-radius:8px;overflow:hidden;padding:16px}
    .cdv-header{border-bottom:1.5px solid #DDD5C8;padding-bottom:12px;margin-bottom:14px}
    .cdv-contact{display:flex;flex-direction:column;gap:4px}
    .cdv-contact-line{display:flex;align-items:flex-start;gap:6px;font-size:0.88rem;color:#2C2C2C;line-height:1.4}
    .cdv-summary-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#F5F0E8;border-radius:8px;padding:12px;margin-bottom:16px}
    .cdv-summary-item{display:flex;flex-direction:column;gap:2px;text-align:center}
    .cdv-summary-label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin-bottom:2px}
    .cdv-summary-value{font-size:1rem;font-weight:700;color:#2C2C2C}
    .cdv-paid{color:#4A7C59}.cdv-outstanding{color:#C0392B}
    .cdv-jobs-list{display:flex;flex-direction:column;gap:12px}
    .cdv-job-card{border:1.5px solid #DDD5C8;border-radius:10px;overflow:hidden}
    .cdv-job-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#F5F0E8;border-bottom:1px solid #DDD5C8}
    .cdv-job-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .cdv-job-ref{font-weight:700;font-size:0.95rem;color:#7D5730}
    .cdv-job-date{font-size:0.82rem;color:#888}
    .cdv-items{padding:10px 14px 6px}
    .cdv-item-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0ebe3;font-size:0.9rem}
    .cdv-item-row:last-child{border-bottom:none}
    .cdv-item-name{flex:1;color:#2C2C2C}.cdv-item-qty{font-size:0.78rem;color:#999;margin-left:4px}.cdv-item-price{font-weight:600;white-space:nowrap}
    .cdv-totals{padding:8px 14px 10px;border-top:1px solid #DDD5C8;background:#F5F0E8}
    .cdv-total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:0.92rem;color:#2C2C2C}
    .cdv-discount-row{color:#4A7C59}.cdv-vat-row{opacity:0.75}
    .cdv-grand-total{font-weight:700;font-size:1rem;margin-top:4px;border-top:1px solid #DDD5C8;padding-top:4px}
    .cdv-section{padding:10px 14px;border-top:1px solid #DDD5C8}
    .cdv-section-label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#888;font-weight:600;margin-bottom:6px}
    .cdv-payment-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #DDD5C8;font-size:0.88rem}
    .cdv-payment-row:last-child{border-bottom:none}
    .cdv-pay-num{min-width:82px;color:#888;font-size:0.82rem;flex-shrink:0}.cdv-pay-date{flex:1;color:#2C2C2C}.cdv-pay-amount{font-weight:700;white-space:nowrap}
    .cdv-outstanding-row .cdv-pay-amount{color:#C0392B}
    .cdv-paid-stamp{font-size:0.82rem;color:#4A7C59;font-weight:600}
    .cdv-note-text{font-size:0.88rem;line-height:1.55;color:#2C2C2C;white-space:pre-wrap}
    .cdv-private{background:#fffbf0;border-left:3px solid #e6b800}
    .cdv-photo-group{margin-bottom:8px}.cdv-photo-label{font-size:0.78rem;font-weight:600;color:#888;margin-bottom:4px}
    .cdv-photo-grid{display:flex;gap:8px;flex-wrap:wrap}.cdv-photo-thumb{width:80px;height:80px;object-fit:cover;border-radius:6px;border:1.5px solid #DDD5C8}
    .cdv-job-actions{display:none}
    .type-badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:12px;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em}
    .type-badge.estimate{background:#e3f0d4;color:#6B7C5C}.type-badge.quote{background:#7D5730;color:#fff}
    .type-badge.invoiced{background:#dbeafe;color:#1d4ed8}.type-badge.paid{background:#dcfce7;color:#166534}
    .type-badge.overdue{background:#fecaca;color:#C0392B}`;
  const fullHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(groupName)} - Dashboard</title><style>${css}</style></head><body>${html}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printRaw(inner) {
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked. Please allow pop-ups for printing.', 'error'); return; }
  win.document.write(wrapDoc(inner));
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}

async function sendDoc(html, filename, message = '') {
  sendDocRaw(wrapDoc(html), filename, message);
}

async function sendDocRaw(htmlStr, filename, message = '') {
  const blob = new Blob([htmlStr], { type: 'text/html' });
  const file = new File([blob], filename, { type: 'text/html' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      const shareData = { files: [file], title: 'Document from Lexi Handles It' };
      if (message) shareData.text = message;
      await navigator.share(shareData);
      return;
    } catch(e) {
      if (e.name !== 'AbortError') console.warn('Share failed', e);
    }
  }

  // Fallback: download the file and (if possible) copy the message to clipboard
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  if (message && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(message);
      toast('Document downloaded. Message copied to clipboard — paste it into WhatsApp or email.', '', 6000);
    } catch(e) {
      toast('Document downloaded. Open WhatsApp or email and attach this file.', '', 5000);
    }
  } else {
    toast('Document downloaded. Open WhatsApp or email and attach this file.', '', 5000);
  }
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
  toast("I've exported your backup.", 'success');
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
      toast("I've restored your backup.", 'success');
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
