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
const KEY_CUST_DATA    = 'lexi_cust_data';  // { "david okafor": { note, recurringDays } }

function custKey(name) { return (name || '').trim().toLowerCase(); }
function getCustData(name)           { const d = lsGet(KEY_CUST_DATA) || {}; return d[custKey(name)] || {}; }
function saveCustData(name, updates) {
  const all = lsGet(KEY_CUST_DATA) || {};
  const k = custKey(name);
  all[k] = { ...(all[k] || {}), ...updates };
  localStorage.setItem(KEY_CUST_DATA, JSON.stringify(all));
}

/* ===== DEFAULT COLOURS ===== */
const DEFAULT_COLOURS = { primary: '#1a1a1a', accent: '#555555', bg: '#ffffff' };

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
    vatNumber: '',
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
  return "All saved. Let's make some money.";
}

function traderFirstName() {
  return (state.company.preferredName || state.company.firstName || '').trim() || 'there';
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
      ? `Brilliant ${first}, your business is progressing. Let's keep it up to date.`
      : `Right then. Tell me about your business and I'll get your documents looking the part.`;
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
  // About You — show more toggle
  const aboutYouMoreBtn = document.getElementById('aboutYouMoreBtn');
  const aboutYouExtra   = document.getElementById('aboutYouExtra');
  if (aboutYouMoreBtn && aboutYouExtra) {
    aboutYouMoreBtn.addEventListener('click', () => {
      const open = aboutYouExtra.style.display !== 'none';
      aboutYouExtra.style.display = open ? 'none' : 'block';
      const chevron = document.getElementById('aboutYouChevron');
      if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
      aboutYouMoreBtn.childNodes[1].textContent = open ? ' Show more' : ' Show less';
    });
  }

  loadFromStorage();
  setupOnboarding();
  setupNewJobPicker();
  setupDescriptionHelp();
  setupJobTermsEdit();
  setupBizChoiceModal();
  setupNavigation();
  setupCalendar();
  setupNavHint();
  setupPage1();
  setupPage2();
  setupPage3();
  setupPageJobs();
  setupPageCompletion();
  setupPage4();
  setupModals();
  setupSendChoice();
  setupChaseAndPause();
  setupJobSearch();
  setupReviewModal();
  setupEarnings();
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

  function dismiss() {
    clearTimeout(timer);
    overlay.classList.add('fade-out');
    setTimeout(() => {
      overlay.remove();
      if (onDone) onDone();
    }, 350);
  }

  overlay.addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, duration);
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

  function closeNavHint() {
    if (suppress.checked) localStorage.setItem(KEY_NAV_HINT, '1');
    popup.style.display = 'none';
  }

  closeBtn.addEventListener('click', closeNavHint);

  // Click anywhere outside the card to dismiss
  document.addEventListener('click', e => {
    if (popup.style.display === 'none') return;
    if (!popup.contains(e.target)) closeNavHint();
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
        p1Sub.textContent = `Brilliant ${traderFirstName()}, your business is progressing. Let's keep it up to date.`;
        p1Sub.style.display = '';
        p1Sub.style.textAlign = 'left';
      } else {
        p1Sub.textContent = `Right then. Tell me about your business and I'll get your documents looking the part.`;
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

  // Render calendar when navigating to it
  if (pageId === 'page-calendar') {
    renderCalendar();
  }

  // Ensure signature preview is always populated when reaching the completion page
  if (pageId === 'page-completion') {
    const authSig = document.getElementById('authSig');
    const custSigText = document.getElementById('custSigText');
    if (authSig && custSigText && !custSigText.value && !custSigText.dataset.userEdited) {
      custSigText.value = formatSigFromName(authSig.value) || defaultAuthSig();
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
      sub.innerHTML = `${esc(traderFirstName())}, your jobs, your prices. Make sure you're charging what you're worth.<br><span style="display:inline-flex;align-items:center;gap:6px;margin-top:6px">Not sure what to charge? Check out Lexi's Pricing Guide <a href="Lexi's Pricing Guide.xlsx" download class="btn btn-outline btn-sm" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:0.75rem;text-decoration:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v13M5 16l7 7 7-7"/><path d="M3 21h18"/></svg> Download</a></span>`;
      sub.style.display = '';
    }
  } else {
    if (title) title.innerHTML = '<span class="page-num">2.</span> Build Your Price List';
    if (sub) {
      sub.innerHTML = `${esc(traderFirstName())}, what do you do most? Add those jobs here. Picking them later takes seconds.<br><span style="display:inline-flex;align-items:center;gap:6px;margin-top:6px">Not sure what to charge? Check out Lexi's Pricing Guide <a href="Lexi's Pricing Guide.xlsx" download class="btn btn-outline btn-sm" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:0.75rem;text-decoration:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v13M5 16l7 7 7-7"/><path d="M3 21h18"/></svg> Download</a></span>`;
      sub.style.display = '';
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
  // Expose globally so other modules (Chase Payments, Pause, Quals) can close the menu
  window.closeMenu = closeMenu;

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

  // Submenu toggle helper
  function setupSubmenu(triggerId, submenuId) {
    const trigger = document.getElementById(triggerId);
    const submenu = document.getElementById(submenuId);
    if (!trigger || !submenu) return;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      // Close all other submenus first
      document.querySelectorAll('.nav-submenu.open').forEach(s => {
        if (s !== submenu) { s.classList.remove('open'); s.previousElementSibling?.classList.remove('open'); }
      });
      const isOpen = submenu.classList.contains('open');
      submenu.classList.toggle('open', !isOpen);
      trigger.classList.toggle('open', !isOpen);
    });
  }

  setupSubmenu('menuNewDoc',        'navNewDocSubmenu');
  setupSubmenu('menuManageJobs',    'navManageJobsSubmenu');
  setupSubmenu('menuManageBusiness','navManageBusinessSubmenu');

  // Field info ? popup (CRN, VAT, etc.)
  document.querySelectorAll('.field-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('fieldInfoTitle').textContent = btn.dataset.title || '';
      document.getElementById('fieldInfoBody').textContent  = btn.dataset.body  || '';
      document.getElementById('fieldInfoPopup').style.display = 'flex';
    });
  });
  document.getElementById('closeFieldInfoBtn')?.addEventListener('click', () => {
    document.getElementById('fieldInfoPopup').style.display = 'none';
  });
  document.getElementById('fieldInfoPopup')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('fieldInfoPopup').style.display = 'none';
  });

  // Reference ? popup
  document.querySelectorAll('.ref-info-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('refInfoPopup').style.display = 'flex';
    });
  });
  document.getElementById('closeRefInfoBtn')?.addEventListener('click', () => {
    document.getElementById('refInfoPopup').style.display = 'none';
  });
  document.getElementById('refInfoPopup')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('refInfoPopup').style.display = 'none';
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
    setTimeout(openSendChoiceModal, 180);
  });

  // Qualifications are now shared from within Send My Business Info — no separate menu item needed

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
      showSavedPopup("Add at least one job to your price list first, then we're good to go.");
      return;
    }
    showPage('page4');
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

  // QR code upload
  const qrArea      = document.getElementById('qrUploadArea');
  const qrFile      = document.getElementById('qrFile');
  const changeQrBtn = document.getElementById('changeQrBtn');
  const removeQrBtn = document.getElementById('removeQrBtn');
  if (qrArea && qrFile) {
    qrArea.addEventListener('click', e => {
      if (!e.target.closest('.logo-actions')) qrFile.click();
    });
    qrArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') qrFile.click(); });
    qrFile.addEventListener('change', handleQRUpload);
    changeQrBtn?.addEventListener('click', e => { e.stopPropagation(); qrFile.click(); });
    removeQrBtn?.addEventListener('click', e => {
      e.stopPropagation();
      state.company.qrCode = '';
      showQRState();
      save();
    });
  }

  // Qualifications upload
  const qualsArea    = document.getElementById('qualsUploadArea');
  const qualsFile    = document.getElementById('qualsFile');
  const qualsAddMore = document.getElementById('qualsAddMoreBtn');
  if (qualsArea && qualsFile) {
    qualsArea.addEventListener('click', e => {
      if (!e.target.closest('.quals-file-list') && !e.target.closest('.quals-add-more-btn')) qualsFile.click();
    });
    qualsArea.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') qualsFile.click(); });
    qualsFile.addEventListener('change', handleQualUpload);
  }
  qualsAddMore?.addEventListener('click', e => { e.stopPropagation(); qualsFile.click(); });

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

/* ===== UNIVERSAL BACKDROP-CLICK-TO-CLOSE ===== */
// Any .modal-overlay click on the backdrop (not its children) closes the modal.
// Modals that need extra cleanup are handled with special cases.
document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  const id = e.target.id;
  if (id === 'photosModal') { closePhotosAndReturn(); return; }
  if (id === 'markPaidModal') { e.target.style.display = 'none'; reopenDashboardAfterMoneyIn(); return; }
  if (id === 'customerDashboardModal') { e.target.style.display = 'none'; activeCustomerGroup = null; return; }
  if (id === 'previewModal') { closePreview(); return; }
  if (id === 'invoiceModal' || id === 'receiptModal') {
    e.target.style.display = 'none';
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  // Default: hide the overlay
  e.target.style.display = 'none';
});

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    state.company.logo = ev.target.result;
    state.company.bizChoiceMade = null; // reset so docs are prompted to use new logo
    showLogoState();
    save();
    if (document.getElementById('useLogoColours')?.checked) {
      extractLogoColours();
    } else {
      showSavedPopup("Great Logo, you'll really stand out!", null, 5000);
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

function handleQRUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please upload an image file.', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    state.company.qrCode = ev.target.result;
    showQRState();
    save();
    showSavedPopup('QR code saved — it will appear on all your documents.', null, 3500);
  };
  reader.readAsDataURL(file);
}

function showQRState() {
  const hasQR = !!state.company.qrCode;
  const placeholder = document.getElementById('qrPlaceholder');
  const preview     = document.getElementById('qrPreview');
  const img         = document.getElementById('qrImg');
  if (placeholder) placeholder.style.display = hasQR ? 'none' : 'flex';
  if (preview)     preview.style.display     = hasQR ? 'flex' : 'none';
  if (hasQR && img) img.src = state.company.qrCode;
}

/* ===== QUALIFICATIONS ===== */
function handleQualUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const allowed = ['image/jpeg','image/png','image/gif','image/webp','application/pdf'];
  if (!allowed.includes(file.type)) { toast('Please upload a PDF or image file.', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('File must be under 10 MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    if (!state.company.qualifications) state.company.qualifications = [];
    state.company.qualifications.push({ name: file.name, type: file.type, data: ev.target.result });
    showQualsState();
    save();
    showSavedPopup('Qualification saved.', null, 2500);
  };
  reader.readAsDataURL(file);
  // Reset so same file can be re-uploaded
  e.target.value = '';
}

function showQualsState() {
  const quals       = state.company.qualifications || [];
  const placeholder = document.getElementById('qualsPlaceholder');
  const fileList    = document.getElementById('qualsFileList');
  const addMore     = document.getElementById('qualsAddMoreBtn');
  if (!placeholder || !fileList) return;

  if (quals.length === 0) {
    placeholder.style.display = 'flex';
    fileList.style.display    = 'none';
    if (addMore) addMore.style.display = 'none';
  } else {
    placeholder.style.display = 'none';
    fileList.style.display    = 'block';
    if (addMore) addMore.style.display = 'block';
    fileList.innerHTML = quals.map((q, i) => `
      <div class="quals-file-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="18" rx="2"/><path d="M10 3h8l4 4v14a2 2 0 0 1-2 2h-6"/></svg>
        <span class="quals-file-name" title="${esc(q.name)}">${esc(q.name)}</span>
        <button type="button" class="quals-remove-btn" onclick="removeQual(${i})" aria-label="Remove">&#x2715;</button>
      </div>`).join('');
  }
}

function removeQual(index) {
  if (!state.company.qualifications) return;
  state.company.qualifications.splice(index, 1);
  showQualsState();
  save();
}

function openQualsModal() {
  const quals = state.company.qualifications || [];
  const listEl = document.getElementById('qualsModalList');
  const emptyEl = document.getElementById('qualsModalEmpty');
  if (quals.length === 0) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = quals.map((q, i) => {
      const isPdf = q.type === 'application/pdf';
      return `
        <div class="quals-modal-row">
          <div class="quals-modal-row-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="18" rx="2"/><path d="M10 3h8l4 4v14a2 2 0 0 1-2 2h-6"/></svg>
            <span>${esc(q.name)}</span>
          </div>
          <div class="quals-modal-row-btns">
            <button type="button" class="btn btn-sm btn-outline" onclick="viewQual(${i})">View</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="shareQual(${i})">Share</button>
          </div>
        </div>`;
    }).join('');
  }
  document.getElementById('qualsModal').style.display = 'flex';
}

function viewQual(index) {
  const q = (state.company.qualifications || [])[index];
  if (!q) return;
  const w = window.open('', '_blank');
  if (!w) return;
  if (q.type === 'application/pdf') {
    w.document.write(`<html><body style="margin:0"><embed src="${q.data}" type="application/pdf" width="100%" height="100%" style="position:fixed;inset:0"></body></html>`);
  } else {
    w.document.write(`<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="${q.data}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`);
  }
}

function shareQual(index) {
  const q = (state.company.qualifications || [])[index];
  if (!q) return;
  if (navigator.share) {
    fetch(q.data)
      .then(r => r.blob())
      .then(blob => {
        const file = new File([blob], q.name, { type: q.type });
        navigator.share({ files: [file], title: q.name }).catch(() => {});
      });
  } else {
    // Fallback: open for download
    const a = document.createElement('a');
    a.href = q.data;
    a.download = q.name;
    a.click();
  }
}

function populatePage1Fields() {
  const c = state.company;
  setVal('p1FirstName',    c.firstName);
  setVal('p1LastName',     c.lastName);
  setVal('p1PreferredName', c.preferredName || '');
  setVal('p1BusinessName', c.businessName);
  setVal('p1Address',      c.address);
  setVal('p1Postcode',      c.postcode);
  setVal('p1Phone',         c.phone);
  setVal('p1Email',         c.email);
  setVal('p1Website',       c.website);
  setVal('p1ReviewLink',    c.reviewLink || '');
  setVal('p1CompanyNumber', c.companyNumber || '');
  setVal('p1VatNumber',     c.vatNumber || '');
  setVal('p1Trade',         c.trade || '');

  // Auto-expand "Show more" if any hidden fields already have data
  const extraFields = [c.phone, c.address, c.postcode, c.email, c.website, c.reviewLink, c.companyNumber, c.vatNumber, c.trade];
  if (extraFields.some(v => v && String(v).trim())) {
    const extra = document.getElementById('aboutYouExtra');
    const btn   = document.getElementById('aboutYouMoreBtn');
    if (extra) extra.style.display = 'block';
    if (btn) {
      btn.childNodes[1].textContent = ' Show less';
      const chevron = document.getElementById('aboutYouChevron');
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    }
  }

  showLogoState();
  showQRState();
  showQualsState();

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
    bizChoiceMade: null,   // reset so modal appears again for any docs that differ from new details
    firstName:    firstName,
    lastName:     lastName,
    preferredName: getVal('p1PreferredName').trim(),
    businessName: getVal('p1BusinessName'),
    trade:        getVal('p1Trade'),
    address:      getVal('p1Address'),
    postcode:     getVal('p1Postcode'),
    phone:        getVal('p1Phone'),
    email:        getVal('p1Email'),
    website:       getVal('p1Website'),
    reviewLink:    getVal('p1ReviewLink').trim(),
    companyNumber: getVal('p1CompanyNumber'),
    vatNumber:     getVal('p1VatNumber'),
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
    showSavedPopup("Done! I've extracted those great colours from your logo.");
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
      showSavedPopup('On the list.', null, 3000);
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
    showSavedPopup("Updated. Good to go.");
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
  // Expand/collapse extra customer fields
  document.getElementById('custMoreToggle')?.addEventListener('click', () => {
    const extra   = document.getElementById('custExtraFields');
    const toggle  = document.getElementById('custMoreToggle');
    const chevron = document.getElementById('custMoreChevron');
    const label   = document.getElementById('custMoreLabel');
    const isOpen  = extra.style.display !== 'none';
    extra.style.display = isOpen ? 'none' : 'block';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (label)   label.textContent = isOpen ? 'Add more details' : 'Show less';
  });
}

// Expand extra fields if any hidden values are already populated (e.g. when editing)
function syncCustMoreToggle() {
  const extra   = document.getElementById('custExtraFields');
  const toggle  = document.getElementById('custMoreToggle');
  const chevron = document.getElementById('custMoreChevron');
  const label   = document.getElementById('custMoreLabel');
  if (!extra) return;
  const hasExtra = ['custTitle','custAddr','custPostcode','custEmail'].some(id => {
    const el = document.getElementById(id);
    return el && el.value && el.value.trim() !== '';
  });
  extra.style.display = hasExtra ? 'block' : 'none';
  if (toggle)  toggle.setAttribute('aria-expanded', String(hasExtra));
  if (chevron) chevron.style.transform = hasExtra ? 'rotate(180deg)' : '';
  if (label)   label.textContent = hasExtra ? 'Show less' : 'Add more details';
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
      sigText.value = formatSigFromName(document.getElementById('authSig').value);
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
  syncCustMoreToggle(); // expand extra fields if any have values
  setVal('docRef',        q.ref);
  setVal('docDate',       q.date || todayStr());
  setVal('docValidFor',   q.validFor || '14');
  setVal('docValidCustom',q.validCustom || '');
  setVal('quoteNotes',    q.notes);
  setVal('quotePrivateNotes', q.privateNotes);
  setVal('customTerms',   q.customTerms || '');
  const sigName = q.authSig || defaultAuthName();
  setVal('authSig', sigName);
  // Signature preview: saved value, or auto-format from the name as F.Last
  const sigPreview = q.custSigText || (q.authSig ? formatSigFromName(q.authSig) : defaultAuthSig());
  setVal('custSigText', sigPreview);
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

/* Returns the full printed name: "Samantha Clarke" */
function defaultAuthName() {
  const first = (state.company.firstName || '').trim();
  const last  = (state.company.lastName  || '').trim();
  return (first + ' ' + last).trim() || state.company.businessName || '';
}

/* Returns the formatted signature: "S.Clarke" */
function defaultAuthSig() {
  const first = (state.company.firstName || '').trim();
  const last  = (state.company.lastName  || '').trim();
  if (first && last) return first.charAt(0).toUpperCase() + '.' + last;
  return first || last || state.company.businessName || '';
}

/* Formats any "First Last" string into "F.Last" — used when the name field changes */
function formatSigFromName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name || '';
  return parts[0].charAt(0).toUpperCase() + '.' + parts.slice(1).join(' ');
}

function populateAuthSig() {
  const authSigEl = document.getElementById('authSig');
  if (authSigEl && !authSigEl.value) authSigEl.value = defaultAuthName();
  const custSigEl = document.getElementById('custSigText');
  if (custSigEl && !custSigEl.value && !custSigEl.dataset.userEdited) custSigEl.value = defaultAuthSig();
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
        type: q.type,
        invoiceSent: q.type === 'Invoice' || q.type === 'Receipt'
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
      invoiceSent: q.type === 'Invoice' || q.type === 'Receipt',
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
  const popupLabel = isEditing ? "Changes saved. Nice one." : `${docType} saved. Another one sorted.`;

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
  // Display format: Last, First Title  (e.g. "Jones, James Dr")
  const last  = (q.custLastName  || '').trim();
  const first = (q.custFirstName || '').trim();
  const title = (q.custTitle     || '').trim();
  if (last && first) return last + ', ' + first + (title ? ' ' + title : '');
  if (last)          return last + (title ? ' ' + title : '');
  if (first)         return first + (title ? ' ' + title : '');
  return title || '';
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
  // Filter & Sort toggle
  document.getElementById('filterToggleBtn')?.addEventListener('click', () => {
    const bar     = document.getElementById('savedFilterBar');
    const chevron = document.getElementById('filterToggleChevron');
    const label   = document.getElementById('filterToggleLabel');
    const isOpen  = bar.style.display !== 'none';
    bar.style.display = isOpen ? 'none' : 'flex';
    document.getElementById('filterToggleBtn').setAttribute('aria-expanded', String(!isOpen));
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    if (label)   label.textContent = isOpen ? 'Filter & Sort' : 'Filter & Sort';
  });

  // Quick Quote banner — goes straight to a blank quote form, one tap
  document.getElementById('quickQuoteBtn')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    prepareNewQuote();
    showPage('page3');
    // Collapse extra customer fields for a clean start
    const extra   = document.getElementById('custExtraFields');
    const toggle  = document.getElementById('custMoreToggle');
    const chevron = document.getElementById('custMoreChevron');
    const label   = document.getElementById('custMoreLabel');
    if (extra)   extra.style.display = 'none';
    if (toggle)  toggle.setAttribute('aria-expanded', 'false');
    if (chevron) chevron.style.transform = '';
    if (label)   label.textContent = 'Add more details';
  });


  const sel = document.getElementById('savedFilterSelect');
  if (sel) sel.addEventListener('change', () => refreshSavedDocs());

  const sortSel = document.getElementById('savedSortSelect');
  if (sortSel) sortSel.addEventListener('change', () => refreshSavedDocs());

  const expSel = document.getElementById('exportSelect');
  if (expSel) {
    expSel.addEventListener('change', () => {
      const val = expSel.value;
      if (!val) return;
      exportDocsCSV(val);
    });
  }
}

function renderAttentionWidget() {
  const wrap = document.getElementById('attentionWidget');
  if (!wrap) return;
  const today = todayStr();
  const items = [];

  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref = d.invoiceRef || q.ref || d.ref || '';
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = Math.max(0, (d.total || 0) - totalPaid);

    if (outstanding <= 0 || d.paid) return;

    if (d.invoiceSent && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      items.push({ docId: d.id, custName, ref, msg: `Invoice ${days}d overdue`, action: 'chase', color: '#c0392b' });
    } else if (!d.invoiceSent && !d.paid) {
      const docDate = q.date || d.date;
      const qType = (q.type || '').toLowerCase();
      if ((qType === 'estimate' || qType === 'quote') && docDate) {
        const age = Math.floor((new Date(today) - new Date(docDate)) / 86400000);
        if (age >= 14) {
          items.push({ docId: d.id, custName, ref, msg: `${qType === 'quote' ? 'Quote' : 'Estimate'} sent ${age} days ago — no reply`, action: 'send', color: '#e67e22' });
        }
      }
    }
  });

  // Recurring customers — check if they're overdue for a visit
  const groups = buildCustomerGroups();
  const today2 = todayStr();
  groups.forEach(g => {
    const data = getCustData(g.name);
    if (!data.recurringDays) return;
    // Find the most recent job date for this customer
    const lastJobDate = g.docs
      .map(d => d.jobCompletedDate || d.quote?.date || d.date || '')
      .filter(Boolean).sort().pop();
    if (!lastJobDate) return;
    const daysSince = Math.floor((new Date(today2) - new Date(lastJobDate)) / 86400000);
    if (daysSince >= data.recurringDays) {
      const overdueDays = daysSince - data.recurringDays;
      items.push({
        docId: g.docs[0].id, custName: g.name, ref: '',
        msg: `Regular visit ${overdueDays === 0 ? 'due today' : `${overdueDays}d overdue`} (every ${data.recurringDays === 7 ? 'week' : data.recurringDays === 14 ? '2 weeks' : data.recurringDays === 28 ? 'month' : data.recurringDays + ' days'})`,
        action: 'recurring', color: '#8e44ad'
      });
    }
  });

  if (items.length === 0) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <div class="attn-widget">
      <button type="button" class="attn-widget-header" id="attnWidgetHeader" aria-expanded="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${items.length} thing${items.length > 1 ? 's' : ''} need${items.length === 1 ? 's' : ''} your attention</span>
        <svg class="attn-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:auto;transform:rotate(180deg)"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="attn-widget-body" id="attnWidgetBody">
        ${items.map(item => `
          <div class="attn-widget-row">
            <div class="attn-widget-dot" style="background:${item.color}"></div>
            <div class="attn-widget-info">
              <span class="attn-widget-name">${esc(item.custName)}</span>
              <span class="attn-widget-msg">${esc(item.msg)}</span>
            </div>
            ${item.action === 'chase'
              ? `<button type="button" class="attn-action-btn attn-chase" onclick="openChaseForDoc('${esc(item.docId)}')">Chase</button>`
              : item.action === 'recurring'
                ? `<button type="button" class="attn-action-btn attn-recurring" onclick="openCustomerDashboardForDoc('${esc(item.docId)}')">Book In</button>`
                : `<button type="button" class="attn-action-btn attn-send" onclick="openQuoteModal('${esc(item.docId)}')">Follow Up</button>`
            }
          </div>`).join('')}
      </div>
    </div>`;

  // Toggle collapse
  document.getElementById('attnWidgetHeader')?.addEventListener('click', () => {
    const body    = document.getElementById('attnWidgetBody');
    const chevron = wrap.querySelector('.attn-chevron');
    const isOpen  = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  });
}

function refreshSavedDocs() {
  updateChasePaymentsBadge();
  renderAttentionWidget();
  const sel    = document.getElementById('savedFilterSelect');
  const filter = sel ? sel.value : 'all';
  const sortSel = document.getElementById('savedSortSelect');
  const sort   = sortSel ? sortSel.value : 'date-newest';
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

  // Search filter
  const q = getJobSearchQuery();
  if (q) {
    docs = docs.filter(d => {
      const quote = d.quote || {};
      const name = [quote.custFirstName, quote.custLastName].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || (d.ref || quote.ref || '').toLowerCase().includes(q);
    });
  }

  // Sort
  const sortKey = d => {
    const q = d.quote || {};
    const last  = (q.custLastName  || '').toLowerCase();
    const first = (q.custFirstName || '').toLowerCase();
    return last + ' ' + first;
  };
  if (sort === 'name-az') {
    docs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  } else if (sort === 'name-za') {
    docs.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  } else if (sort === 'date-oldest') {
    docs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  } else if (sort === 'next-job') {
    // Accepted jobs with start dates first (soonest), then no-start-date docs at end
    docs.sort((a, b) => {
      const aDate = (a.jobAccepted && a.jobStartDate) ? a.jobStartDate : '9999';
      const bDate = (b.jobAccepted && b.jobStartDate) ? b.jobStartDate : '9999';
      return aDate.localeCompare(bDate);
    });
  } else {
    // date-newest (default): newest date first
    docs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

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
          <span class="saved-doc-name">${esc(buildCustName(doc.quote || {}) || doc.custName || 'Unknown Customer')}</span>
          <div class="saved-doc-ref">${esc(doc.ref || '')} &bull; ${formatDate(doc.date)}</div>
        </div>
        <div style="text-align:right">
          <div class="saved-doc-total">${fmtPrice(doc.total || 0)}</div>
          <button type="button" class="type-badge ${statusBadge}" data-badge-id="${doc.id}" data-badge-status="${statusBadge}">${statusLabel}</button>
        </div>
      </div>
      <div class="job-card-actions">
        <button type="button" class="jca-open" data-id="${doc.id}">Open</button>
        ${statusBadge === 'overdue'
          ? `<button type="button" class="jca-primary jca-chase" data-id="${doc.id}">💰 Chase Payment</button>`
          : statusBadge === 'paid'
            ? `<button type="button" class="jca-primary jca-paid" data-id="${doc.id}">View Receipt</button>`
            : (statusBadge === 'invoiced')
              ? `<button type="button" class="jca-primary jca-invoice" data-id="${doc.id}">Send Invoice</button>`
              : `<button type="button" class="jca-primary jca-send" data-id="${doc.id}">Send ${statusLabel}</button>`
        }
      </div>
      <div class="saved-doc-payment-tally">
        <span class="sdpt-payment-info">
          ${totalPaid > 0
            ? `<span class="sdpt-paid">Paid ${fmtPrice(totalPaid)}</span>${totalPaid < (doc.total || 0) ? `<span class="sdpt-outstanding">&middot; ${fmtPrice(Math.max(0, (doc.total || 0) - totalPaid))} outstanding</span>` : '<span class="sdpt-full">&#10003; Paid in full</span>'}`
            : ''}
        </span>
      </div>
    `;

    container.appendChild(card);

    // Open → customer dashboard
    card.querySelector('.jca-open')?.addEventListener('click', () => openCustomerDashboardForDoc(doc.id));
    // Contextual primary actions
    card.querySelector('.jca-chase')?.addEventListener('click',   () => openChaseForDoc(doc.id));
    card.querySelector('.jca-send')?.addEventListener('click',    () => openQuoteModal(doc.id));
    card.querySelector('.jca-invoice')?.addEventListener('click', () => previewInvoice(doc.id));
    card.querySelector('.jca-paid')?.addEventListener('click',    () => handleReceiptRequest(doc.id));

    card.querySelector('.type-badge')?.addEventListener('click', () => {
      const status = statusBadge;
      if      (status === 'estimate')                    openQuoteModal(doc.id);
      else if (status === 'quote')                       openQuoteModal(doc.id);
      else if (status === 'invoiced' || status === 'invoice' || status === 'overdue') previewInvoice(doc.id);
      else if (status === 'paid')                        handleReceiptRequest(doc.id);
      else if (status === 'receipt')                     handleReceiptRequest(doc.id);
    });
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
  if (!confirm('Lexi says: Are you sure you want to delete this? Once it\'s gone, it\'s gone!')) return;
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
  document.getElementById('closeInvoiceBtn').addEventListener('click', () => {
    document.getElementById('invoiceModal').style.display = 'none';
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('closeReceiptBtn').addEventListener('click', () => {
    document.getElementById('receiptModal').style.display = 'none';
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
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
    document.getElementById('customerDashboardModal').style.display = 'none';
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
    if (document.getElementById('page4')?.classList.contains('active')) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('closeCustEditChoiceBtn')?.addEventListener('click', () => document.getElementById('customerEditChoiceModal').style.display = 'none');
  document.getElementById('custEditDetailsBtn')?.addEventListener('click', () => customerEditPickDoc('details'));
  document.getElementById('custEditJobBtn')?.addEventListener('click', () => customerEditPickDoc('job'));
  document.getElementById('custEditMoneyBtn')?.addEventListener('click', () => customerEditPickDoc('money'));
  document.getElementById('custEditTermsBtn')?.addEventListener('click', () => customerEditPickDoc('terms'));
  document.getElementById('custEditInvoiceBtn')?.addEventListener('click', () => {
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    document.getElementById('customerDashboardModal').style.display = 'none';
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (docId) previewInvoice(docId);
  });
  document.getElementById('custEditReceiptBtn')?.addEventListener('click', () => {
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    // Keep customer dashboard open — warning modal overlays on top; X returns to dashboard
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (docId) handleReceiptRequest(docId);
  });
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
    const docId = activeEditDocId || activeCustomerGroup?.docs[0]?.id;
    if (!docId) return;
    if (!confirm('Lexi says: Are you sure you want to delete this? Once it\'s gone, it\'s gone!')) return;
    // Only close modals after user confirms
    document.getElementById('customerEditChoiceModal').style.display = 'none';
    document.getElementById('customerDashboardModal').style.display = 'none';
    state.saved = state.saved.filter(d => d.id !== docId);
    save();
    updateSavedBadge();
    refreshSavedDocs();
    toast('Document deleted.');
  });
  document.getElementById('closeCustDetailsEditBtn')?.addEventListener('click', () => document.getElementById('customerDetailsEditModal').style.display = 'none');
  document.getElementById('saveCustDetailsBtn')?.addEventListener('click', saveCustomerDetails);
  document.getElementById('nextToJobDetailsBtn')?.addEventListener('click', () => {
    persistCustomerDetailsForm();                                        // save before leaving
    document.getElementById('customerDetailsEditModal').style.display = 'none';
    const docId = activeEditDocId || (activeCustomerGroup?.docs[0]?.id);
    if (docId) openJobDetailsEdit(docId);
  });
  document.getElementById('closeJobDetailsEditBtn')?.addEventListener('click', () => document.getElementById('jobDetailsEditModal').style.display = 'none');
  document.getElementById('backToCustDetailsBtn')?.addEventListener('click', () => {
    persistJobDetailsForm();                                           // save before leaving
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    if (activeJobDetailsDocId) openCustomerDetailsEdit(activeJobDetailsDocId);
  });
  document.getElementById('saveJobDetailsBtn')?.addEventListener('click', saveJobDetails);
  document.getElementById('nextToJobTermsBtn')?.addEventListener('click', () => {
    persistJobDetailsForm();                                           // save before leaving
    document.getElementById('jobDetailsEditModal').style.display = 'none';
    if (activeJobDetailsDocId) openJobTermsEdit(activeJobDetailsDocId);
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
    // If in a customer dashboard context, open the full edit menu (gives access to Jobs, Terms, Signature etc.)
    if (activeCustomerGroup && docId) {
      document.getElementById('customerDashboardModal').style.display = 'flex';
      openCustomerEditChoice(docId);
      return;
    }
    // Otherwise fall back to direct edit
    if (type === 'quote' && docId) {
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
    showSavedPopup("Saved. Another one off your plate.");
  });

  document.getElementById('previewSendBtn').addEventListener('click', () => {
    const { type } = previewContext;
    if (type === 'quote') {
      // Send via the modal function so the cover message is included
      closePreview();
      sendQuoteFromModal();
    } else if (type === 'invoice') {
      closePreview();
      sendInvoiceFromModal();
    } else if (type === 'receipt') {
      closePreview();
      sendReceiptFromModal();
    } else {
      const html = document.getElementById('previewContent').innerHTML;
      sendDocRaw(wrapDoc(html), 'document.html');
    }
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
    // Always show preview first — user can Share or Edit from there
    document.getElementById('quotePreviewBtn').click();
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
    toast('Quote shared!', 'success');
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

  // Quote modal — Edit opens full edit menu if in dashboard context, otherwise page3 builder
  document.getElementById('quoteEditBtn')?.addEventListener('click', () => {
    document.getElementById('quoteModal').style.display = 'none';
    if (activeCustomerGroup && activeDocId) {
      document.getElementById('customerDashboardModal').style.display = 'flex';
      openCustomerEditChoice(activeDocId);
    } else if (activeDocId) {
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
    showSavedPopup("Done. I've got it.");
  });

  // Invoice modal — Edit opens full edit menu if in dashboard context, otherwise quote modal
  document.getElementById('invEditBtn')?.addEventListener('click', () => {
    document.getElementById('invoiceModal').style.display = 'none';
    if (activeCustomerGroup && activeDocId) {
      document.getElementById('customerDashboardModal').style.display = 'flex';
      openCustomerEditChoice(activeDocId);
    } else if (activeDocId) {
      openQuoteModal(activeDocId);
    }
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
    showSavedPopup("Invoice saved. Nice one.");
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
    showSavedPopup("Receipt saved. Job done.");
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
    const amount      = parseFloat(getVal('mpAmount')) || 0;
    const date        = getVal('mpDate') || todayStr();
    const paymentType = getVal('mpPaymentType') || 'Full Payment';
    if (amount <= 0) { toast('Enter an amount received.', 'error'); return; }
    // Migrate legacy single-payment docs
    if (!Array.isArray(doc.payments)) doc.payments = getDocPayments(doc);
    doc.payments.push({ amount, date, type: paymentType });
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
    if (doc.paid) {
      showSavedPopup('Get in. That one is paid in full.', () => {
        maybeAskForReview(doc);
      }, 2000);
    } else {
      showSavedPopup("Payment logged. I've got it.");
    }
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
  if (document.getElementById('page4')?.classList.contains('active')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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
  withBizCheck(docId, id => {
    activeDocId = id;
    const doc = state.saved.find(d => d.id === id);
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
    openPreview(html, 'receipt', id);
  });
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
  withBizCheck(docId, id => {
    activeDocId = id;
    activeQuoteDraftDoc = null;
    const doc = state.saved.find(d => d.id === id);
    if (!doc) return;
    const html = buildDocHtml(doc, 'quote');
    openPreview(html, 'quote', id);
  });
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
  withBizCheck(docId, id => {
    activeDocId = id;
    const doc = state.saved.find(d => d.id === id);
    if (!doc) return;
    const invRef     = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
    const _t         = (doc.quote?.selectedTerms || []);
    const _tDays     = _t.includes('payment30') ? 30 : _t.includes('payment14') ? 14 : _t.includes('payment7') ? 7 : 30;
    const _base      = doc.jobCompletedDate || todayStr();
    const dueDate    = doc.invoiceDueDate || addDays(_base, _tDays);
    const html = buildDocHtml(doc, 'invoice', { invRef, invDate: todayStr(), dueDate });
    openPreview(html, 'invoice', id);
  });
}

function openInvoiceModal(docId) {
  activeDocId = docId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const invRef = doc.invoiceRef || doc.ref || nextRef('INV', KEY_INV);
  const q = doc.quote || {};
  setVal('invRef',     invRef);
  setVal('invDate',    todayStr());
  // Auto-calculate due date: completion date + payment terms days (falls back to today + 30)
  const _terms      = (doc.quote?.selectedTerms || []);
  const _termDays   = _terms.includes('payment30') ? 30 : _terms.includes('payment14') ? 14 : _terms.includes('payment7') ? 7 : 30;
  const _baseDate   = doc.jobCompletedDate || todayStr();
  setVal('invDueDate', doc.invoiceDueDate || addDays(_baseDate, _termDays));
  setVal('invCustFirst', q.custFirstName || '');
  setVal('invCustLast', q.custLastName || '');
  const storedMethods = Array.isArray(doc.invoicePayMethods) ? doc.invoicePayMethods
    : (doc.invoicePayMethod ? [doc.invoicePayMethod] : []);
  document.querySelectorAll('input[name="invPayMethod"]').forEach(cb => {
    cb.checked = storedMethods.includes(cb.value);
  });
  document.getElementById('invIncludePhotos').checked = false;
  setVal('invNotes',   '');
  document.getElementById('invoiceModal').style.display = 'flex';
  renderInvJobPicker(doc);
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
      showSavedPopup('Removed. All updated.');
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
  const items = [];
  document.querySelectorAll('#invItemsList .jde-item-row').forEach(row => {
    const name  = (row.querySelector('.jde-item-name')?.value || '').trim();
    const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
    if (name || price) items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
  });
  return {
    invRef:    getVal('invRef'),
    invDate:   getVal('invDate'),
    dueDate:   getVal('invDueDate'),
    custFirstName: getVal('invCustFirst'),
    custLastName:  getVal('invCustLast'),
    items,
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

  if (data.items != null && Array.isArray(data.items) && data.items.length) {
    q.items = data.items;
  } else if (data.itemsText != null) {
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

/* ===== SEND CHOICE ===== */
const BIZ_SECTIONS  = ['contact', 'phone', 'companyNum', 'vatNum'];
const PAY_SECTIONS  = ['bank', 'paypal', 'cash', 'other'];

function openSendChoiceModal() {
  document.getElementById('sendChoiceModal').style.display = 'flex';
}

function setupSendChoice() {
  document.getElementById('closeSendChoiceBtn')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
  });
  document.getElementById('sendChoiceModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('sendChoiceEstimate')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    // Open the quote send modal for the active doc
    if (activeDocId) {
      const doc = state.saved.find(d => d.id === activeDocId);
      if (doc) populateQuoteSendModal(doc);
    }
  });
  document.getElementById('sendChoiceBusiness')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    openBizInfoModal('business');
  });
  document.getElementById('sendChoicePayment')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    openBizInfoModal('payment');
  });
  document.getElementById('sendChoiceQuals')?.addEventListener('click', () => {
    document.getElementById('sendChoiceModal').style.display = 'none';
    openBizInfoModal('qualifications');
  });
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
    checked: false
  });

  // ── Phone ────────────────────────────────────────────────────
  if (c.phone) {
    sections.push({ id: 'phone', label: `Phone:  ${c.phone}`, text: `Phone: ${c.phone}`, checked: false });
  }

  // ── Company / Registration number ────────────────────────────
  if (c.companyNumber) {
    sections.push({ id: 'companyNum', label: `Company Number:  ${c.companyNumber}`, text: `Company / Registration Number: ${c.companyNumber}`, checked: false });
  }

  // ── VAT Registration number ──────────────────────────────────
  if (c.vatNumber) {
    sections.push({ id: 'vatNum', label: `VAT Reg No:  ${c.vatNumber}`, text: `VAT Registration Number: ${c.vatNumber}`, checked: false });
  }

  // ── Bank transfer ────────────────────────────────────────────
  if (methods.includes('bank') && c.bankAcc) {
    const bankLines = ['Bank Transfer'];
    if (c.bankAccHolder) bankLines.push(`Account Name: ${c.bankAccHolder}`);
    if (c.bankName)      bankLines.push(`Bank: ${c.bankName}`);
    if (c.bankSort)      bankLines.push(`Sort Code: ${c.bankSort}`);
    bankLines.push(`Account Number: ${c.bankAcc}`);
    sections.push({ id: 'bank', label: 'Bank Transfer details', text: bankLines.join('\n'), checked: false });
  }

  // ── PayPal ───────────────────────────────────────────────────
  if (methods.includes('paypal') && c.paypalRef) {
    sections.push({ id: 'paypal', label: `PayPal:  ${c.paypalRef}`, text: `PayPal: ${c.paypalRef}`, checked: false });
  }

  // ── Cash ─────────────────────────────────────────────────────
  if (methods.includes('cash')) {
    sections.push({ id: 'cash', label: 'Cash on Completion', text: 'Cash on Completion accepted', checked: false });
  }

  // ── Other payment method ─────────────────────────────────────
  if (methods.includes('other') && c.payOther) {
    sections.push({ id: 'other', label: c.payOther, text: c.payOther, checked: false });
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

function openBizInfoModal(filter) {
  // filter: 'business' | 'payment' | 'qualifications' | undefined (all)
  const allSections = bizInfoSections();
  const container   = document.getElementById('bizInfoOptions');
  const titleEl     = document.querySelector('#bizInfoModal .modal-title');
  const previewWrap = document.getElementById('bizInfoPreviewWrap');
  const footerEl    = document.querySelector('#bizInfoModal .modal-footer');
  if (!container) return;

  // Qualifications-only view — no text preview needed
  if (filter === 'qualifications') {
    const quals = state.company.qualifications || [];
    if (titleEl) titleEl.textContent = 'My Qualifications';
    container.innerHTML = quals.length === 0
      ? `<p style="color:#999;text-align:center;padding:20px 0;font-size:0.9rem">No qualifications uploaded yet.<br><small>Add them from <strong>Edit My Business</strong>.</small></p>`
      : quals.map((q, i) => `
          <div class="biz-info-qual-row">
            <span class="biz-info-qual-name" title="${esc(q.name)}">${esc(q.name)}</span>
            <div class="biz-info-qual-btns">
              <button type="button" class="btn btn-sm btn-outline" onclick="viewQual(${i})">View</button>
              <button type="button" class="btn btn-sm btn-primary" onclick="shareQual(${i})">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Share
              </button>
            </div>
          </div>`).join('');
    if (previewWrap) previewWrap.style.display = 'none';
    if (footerEl)    footerEl.style.display    = 'none';
    document.getElementById('bizInfoModal').style.display = 'flex';
    return;
  }

  // Text-based view — filter sections
  if (previewWrap) previewWrap.style.display = '';
  if (footerEl)    footerEl.style.display    = '';

  let sections = allSections;
  if (filter === 'business') {
    sections = allSections.filter(s => BIZ_SECTIONS.includes(s.id));
    if (titleEl) titleEl.textContent = 'Send Business Details';
  } else if (filter === 'payment') {
    sections = allSections.filter(s => PAY_SECTIONS.includes(s.id));
    if (titleEl) titleEl.textContent = 'Send Payment Details';
  } else {
    if (titleEl) titleEl.textContent = 'Send My Business Info';
  }

  if (sections.length === 0) {
    container.innerHTML = `<p style="color:#999;text-align:center;padding:20px 0;font-size:0.9rem">No ${filter === 'payment' ? 'payment' : 'business'} details saved yet.<br><small>Add them from <strong>Edit My Business</strong>.</small></p>`;
    if (previewWrap) previewWrap.style.display = 'none';
    if (footerEl)    footerEl.style.display    = 'none';
    document.getElementById('bizInfoModal').style.display = 'flex';
    return;
  }

  container.innerHTML = `
    <label class="checkbox-label biz-info-check biz-info-select-all">
      <input type="checkbox" id="bizSelectAll"> Select All
    </label>
    <hr style="border:none;border-top:1px solid #eee;margin:4px 0 8px">
    ${sections.map(s => `
    <label class="checkbox-label biz-info-check">
      <input type="checkbox" name="bizInfo" value="${s.id}"
             data-text="${s.text.replace(/"/g, '&quot;')}"
             ${s.checked ? 'checked' : ''}>
      ${s.label}
    </label>`).join('')}`;

  const selectAll = document.getElementById('bizSelectAll');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      container.querySelectorAll('input[name="bizInfo"]').forEach(cb => cb.checked = selectAll.checked);
      updateBizInfoPreview();
    });
  }

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

function buildCustomerJobSection(d, jobNum = 0) {
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

  // Payment due date & dynamic status badge
  const payTerms    = (q.selectedTerms || []);
  const payTermDays = payTerms.includes('payment30') ? 30 : payTerms.includes('payment14') ? 14 : payTerms.includes('payment7') ? 7 : 30;
  const payDueStr   = d.invoiceDueDate || (d.jobCompletedDate ? addDays(d.jobCompletedDate, payTermDays) : '');
  const todayNow    = todayStr();
  let payStatusHtml = '';
  if (outstanding === 0 && totalPaid > 0) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-paid">Paid in full</span>`;
  } else if (payDueStr && todayNow > payDueStr) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-overdue">Payment overdue</span>`;
  } else if (payDueStr) {
    payStatusHtml = `<span class="cdv-pay-status cdv-pay-status-due">Due ${formatDate(payDueStr)}</span>`;
  }

  const payIcon = `<svg class="cdv-icon cdv-icon-label" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
  const payLabelRow = `<div class="cdv-section-label cdv-section-label-row"><span>${payIcon} Payments <span class="nav-beta-badge">Beta</span></span>${payStatusHtml}</div>`;

  const paymentsHtml = payments.length ? `
    <div class="cdv-section">
      ${payLabelRow}
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
      ${payLabelRow}
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

  // Work out which stage rank this doc is currently at
  // Cross-check the saved flags AND q.type so docs created directly as Invoice/Receipt
  // still show the correct step even if the invoiceSent flag wasn't set via the modal.
  const qTypeLower = (q.type || 'Estimate').toLowerCase();
  const stageRank = d.paid                                   ? 3
    : (d.receiptRef  || qTypeLower === 'receipt')            ? 3
    : (d.invoiceSent || qTypeLower === 'invoice')            ? 2
    : (qTypeLower === 'quote')                               ? 1
    :                                                          0;
  const tubeStages = [
    { letter: 'A', label: 'Estimate', action: 'quote',   cls: 'stage-estimate' },
    { letter: 'B', label: 'Quote',    action: 'quote',   cls: 'stage-quote'    },
    { letter: 'C', label: 'Invoice',  action: 'invoice', cls: 'stage-invoice'  },
    { letter: 'D', label: 'Receipt',  action: 'receipt', cls: 'stage-receipt'  },
  ];
  const progressionHtml = `
    <div class="cdv-tube-map">
      <div class="cdv-prog-label">Job Status</div>
      <div class="cdv-tube-row">
        ${tubeStages.map((s, i) => {
          const isDone   = i < stageRank;
          const isActive = i === stageRank;
          const dotCls   = isDone ? 'done' : isActive ? `active ${s.cls}` : '';
          const lblCls   = (isDone || isActive) ? 'lit' : '';
          const seg      = i < tubeStages.length - 1
            ? `<div class="cdv-tube-seg${isDone ? ' done' : ''}"></div>`
            : '';
          return `<div class="cdv-tube-station">
            <button type="button" class="cdv-tube-dot ${dotCls}"
              data-prog-doc-id="${esc(d.id)}"
              data-prog-action="${s.action}">${s.letter}</button>
            <span class="cdv-tube-lbl ${lblCls}">${s.label}</span>
          </div>${seg}`;
        }).join('')}
        <div class="cdv-tube-arrow-end">&#8250;</div>
      </div>
    </div>`;

  const scheduleHtml = `
    <div class="cdv-job-schedule">
      <div class="cdv-schedule-row">
        <label class="cdv-accepted-label">
          <input type="checkbox" class="cdv-accepted-cb" data-doc-id="${esc(d.id)}"${d.jobAccepted ? ' checked' : ''}>
          Job Accepted
        </label>
        <div class="cdv-start-date-wrap"${!d.jobAccepted ? ' style="display:none"' : ''}>
          <span class="cdv-start-date-label">Date Started</span>
          <input type="date" class="cdv-start-date-input" data-doc-id="${esc(d.id)}"
            value="${esc(d.jobStartDate || '')}">
        </div>
      </div>
      <div class="cdv-schedule-row">
        <label class="cdv-accepted-label">
          <input type="checkbox" class="cdv-completed-cb" data-doc-id="${esc(d.id)}"${d.jobCompleted ? ' checked' : ''}>
          Job Completed
        </label>
        <div class="cdv-start-date-wrap"${!(d.jobCompleted && d.jobCompletedDate) ? ' style="display:none"' : ''}>
          <span class="cdv-start-date-label">Date Completed</span>
          <input type="date" class="cdv-completed-date-input" data-doc-id="${esc(d.id)}"
            value="${esc(d.jobCompletedDate || '')}">
        </div>
      </div>
      <div class="cdv-completed-prompt" data-doc-id="${esc(d.id)}"${!(d.jobCompleted && !d.jobCompletedDate) ? ' style="display:none"' : ''}>
        <p class="cdv-prompt-msg">Please tell me when the job was completed so I can help you track when payment is due.</p>
        <div class="cdv-prompt-actions">
          <button type="button" class="cdv-today-btn" data-doc-id="${esc(d.id)}">Today</button>
          <span class="cdv-prompt-or">or select a date</span>
          <input type="date" class="cdv-prompt-date" data-doc-id="${esc(d.id)}">
        </div>
      </div>
    </div>`;

  return `
    <div class="cdv-job-card">
      <div class="cdv-job-header">
        <div class="cdv-job-meta">
          <span class="cdv-job-ref">${jobNum ? `<span class="cdv-job-num">Job ${jobNum}:</span> ` : ''}${esc(ref)}</span>
          ${docDate ? `<span class="cdv-job-date">${formatDate(docDate)}</span>` : ''}
        </div>
        <button type="button" class="type-badge ${statusClass} cdv-status-btn"
          data-prog-doc-id="${esc(d.id)}" data-prog-action="${statusClass === 'paid' ? 'receipt' : statusClass === 'invoiced' || statusClass === 'overdue' ? 'invoice' : 'quote'}"
          title="Open ${statusLabel}">${esc(statusLabel)}</button>
      </div>
      <div class="cdv-items">${itemsHtml}</div>
      ${totalsHtml}
      ${progressionHtml}
      ${scheduleHtml}
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

  // Contact action buttons (Email / WhatsApp / Phone)
  const dashPhone = q.custPhone || '';
  const dashEmail = q.custEmail || '';
  const dashDocId = firstDoc.id;
  const DSVG_EMAIL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const DSVG_WA    = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const DSVG_PHONE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const DSVG_SHARE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
  const contactBtns = `
    <div class="cdv-contact-btns">
      <button type="button" class="cal-icon-btn cal-icon-email cdv-labeled${!dashEmail ? ' cal-btn-disabled' : ''}"
        ${dashEmail ? `onclick="openCalEmailComposer('${esc(dashDocId)}','dashboard','email')"` : ''}
        title="${dashEmail ? 'Email ' + esc(group.name) : 'No email address saved'}">${DSVG_EMAIL}<span>Email</span></button>
      <button type="button" class="cal-icon-btn cal-icon-whatsapp cdv-labeled${!dashPhone ? ' cal-btn-disabled' : ''}"
        ${dashPhone ? `onclick="openCalEmailComposer('${esc(dashDocId)}','dashboard','whatsapp')"` : ''}
        title="${dashPhone ? 'WhatsApp ' + esc(group.name) : 'No phone number saved'}">${DSVG_WA}<span>WhatsApp</span></button>
      ${dashPhone
        ? `<a href="tel:${esc(dashPhone)}" class="cal-icon-btn cal-icon-phone cdv-labeled" title="Call ${esc(group.name)}">${DSVG_PHONE}<span>Phone</span></a>`
        : `<button type="button" class="cal-icon-btn cal-icon-phone cdv-labeled cal-btn-disabled" title="No phone number saved">${DSVG_PHONE}<span>Phone</span></button>`}
      <button type="button" class="cal-icon-btn cal-icon-share cdv-labeled" onclick="openSendChoiceModal()" title="Share my details with this customer">${DSVG_SHARE}<span>Share My Details</span></button>
    </div>`;

  // contentHtml = pure dashboard content (used for download — no buttons)
  const contentHtml = `
    <div class="customer-dashboard-card printable-customer-dashboard">
      <div class="cdv-header">
        ${contactBtns}
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
        ${group.docs.map((d, i) => buildCustomerJobSection(d, group.docs.length > 1 ? i + 1 : 0)).join('')}
      </div>
      ${buildCustomerExtras(group.name)}
    </div>`;

  body.innerHTML = contentHtml;
  wireCustomerExtras(body, group.name);

  // Wire modal-header action buttons
  const firstDocId = group.docs[0]?.id;
  const modal = document.getElementById('customerDashboardModal');

  const dashEditBtn = document.getElementById('custDashEditBtn');
  if (dashEditBtn) dashEditBtn.onclick = () =>
    openCustomerEditChoice(group.docs.length === 1 ? firstDocId : null);

  // Job status progression — event delegation
  body.addEventListener('click', e => {
    const btn = e.target.closest('[data-prog-doc-id]');
    if (!btn) return;
    const docId  = btn.dataset.progDocId;
    const action = btn.dataset.progAction;
    if (action === 'receipt') {
      // Keep dashboard open — warning modal overlays on top; X returns to dashboard
      handleReceiptRequest(docId);
    } else {
      document.getElementById('customerDashboardModal').style.display = 'none';
      if      (action === 'quote')   openQuoteModal(docId);
      else if (action === 'invoice') previewInvoice(docId);
    }
  });

  // Job Accepted checkbox — show/hide date, auto-fill today, save
  body.addEventListener('change', e => {
    const cb = e.target.closest('.cdv-accepted-cb');
    if (!cb) return;
    const doc = state.saved.find(d => d.id === cb.dataset.docId);
    if (!doc) return;
    doc.jobAccepted = cb.checked;
    const wrap = cb.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (wrap) {
      wrap.style.display = cb.checked ? '' : 'none';
      if (cb.checked) {
        const inp = wrap.querySelector('.cdv-start-date-input');
        if (inp && !inp.value) { inp.value = todayStr(); doc.jobStartDate = inp.value; }
      }
    }
    save();
  });

  // Helper: date confirmed — hide prompt, show compact date wrap
  function applyCompletedDate(docId, dateStr) {
    const doc = state.saved.find(d => d.id === docId);
    if (!doc) return;
    doc.jobCompleted      = true;
    doc.jobCompletedDate  = dateStr;
    save();
    const prompt   = body.querySelector(`.cdv-completed-prompt[data-doc-id="${docId}"]`);
    const cb       = body.querySelector(`.cdv-completed-cb[data-doc-id="${docId}"]`);
    const dateWrap = cb?.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (prompt)   prompt.style.display   = 'none';
    if (dateWrap) {
      dateWrap.style.display = '';
      const inp = dateWrap.querySelector('.cdv-completed-date-input');
      if (inp) inp.value = dateStr;
    }
  }

  // Job Completed checkbox
  body.addEventListener('change', e => {
    const cb = e.target.closest('.cdv-completed-cb');
    if (!cb) return;
    const docId = cb.dataset.docId;
    const doc   = state.saved.find(d => d.id === docId);
    if (!doc) return;
    doc.jobCompleted = cb.checked;
    const prompt   = body.querySelector(`.cdv-completed-prompt[data-doc-id="${docId}"]`);
    const dateWrap = cb.closest('.cdv-schedule-row')?.querySelector('.cdv-start-date-wrap');
    if (cb.checked) {
      if (doc.jobCompletedDate) {
        // Date already stored — just show the compact wrap
        if (dateWrap) dateWrap.style.display = '';
        if (prompt)   prompt.style.display   = 'none';
      } else {
        // No date yet — show the prompt
        if (dateWrap) dateWrap.style.display = 'none';
        if (prompt)   prompt.style.display   = '';
      }
    } else {
      // Unchecked — hide everything
      if (dateWrap) dateWrap.style.display = 'none';
      if (prompt)   prompt.style.display   = 'none';
      doc.jobCompletedDate = '';
    }
    save();
  });

  // "Today" button inside the completion prompt
  body.addEventListener('click', e => {
    const btn = e.target.closest('.cdv-today-btn');
    if (!btn) return;
    applyCompletedDate(btn.dataset.docId, todayStr());
  });

  // Manual date pick from the prompt calendar
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-prompt-date');
    if (!inp || !inp.value) return;
    applyCompletedDate(inp.dataset.docId, inp.value);
  });

  // Start Date input — save on change
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-start-date-input');
    if (!inp) return;
    const doc = state.saved.find(d => d.id === inp.dataset.docId);
    if (!doc) return;
    doc.jobStartDate = inp.value || '';
    save();
  });

  // Completed Date input (compact view) — save on change
  body.addEventListener('change', e => {
    const inp = e.target.closest('.cdv-completed-date-input');
    if (!inp) return;
    const doc = state.saved.find(d => d.id === inp.dataset.docId);
    if (!doc) return;
    doc.jobCompletedDate = inp.value || '';
    save();
  });

}

/* ===== CUSTOMER EDIT CHOICE ===== */
let activeEditDocId = null; // docId pre-selected when Edit is clicked on a specific job card

function openUpdateFromCal(docId) {
  // Set up activeCustomerGroup so the edit choice modal works correctly
  const groups = buildCustomerGroups();
  const group  = groups.find(g => g.docs.some(d => d.id === docId));
  if (!group) return;
  activeCustomerGroup = group;
  activeEditDocId     = docId;
  openCustomerEditChoice(docId);
}

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
    openJobTermsEdit(docId);
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

// Persist whatever is currently in the Customer Details form — no UI side-effects.
// Called by both the Save button and any Next button that moves past this screen.
function persistCustomerDetailsForm() {
  const group = activeCustomerGroup;
  if (!group) return;
  const sharedUpdates = {
    custTitle:     getVal('cdeCustTitle'),
    custFirstName: getVal('cdeCustFirst'),
    custLastName:  getVal('cdeCustLast'),
    custAddr:      getVal('cdeCustAddr'),
    custPostcode:  getVal('cdeCustPostcode'),
    custPhone:     getVal('cdeCustPhone'),
    custEmail:     getVal('cdeCustEmail'),
  };
  const privateNotes = getVal('cdeCustPrivateNotes');
  const targetDocId  = activeEditDocId || (group.docs[0] && group.docs[0].id);
  group.docs.forEach(doc => {
    if (!doc.quote) doc.quote = {};
    Object.assign(doc.quote, sharedUpdates);
    if (doc.id === targetDocId) doc.quote.privateNotes = privateNotes;
    doc.custName = buildCustName(doc.quote);
  });
  group.name = buildCustName(sharedUpdates).trim() || group.name;
  save();
  refreshSavedDocs();
}

function saveCustomerDetails() {
  persistCustomerDetailsForm();

  // Close edit modals and return to dashboard
  document.getElementById('customerDetailsEditModal').style.display = 'none';
  document.getElementById('customerEditChoiceModal').style.display  = 'none';

  // Re-render and show the customer dashboard
  const group        = activeCustomerGroup;
  const updatedGroups = buildCustomerGroups();
  const updatedGroup  = updatedGroups.find(g => g.docs.some(d => group.docs.some(gd => gd.id === d.id))) || group;
  activeCustomerGroup = updatedGroup;
  renderSingleCustomerDashboard(updatedGroup, updatedGroups);
  document.getElementById('customerDashboardModal').style.display = 'flex';

  showSavedPopup("Got it. Details saved.");
}

/* ===== JOB TERMS EDIT MODAL ===== */
let activeJobTermsDocId = null;

function openJobTermsEdit(docId) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  activeJobTermsDocId = docId;
  const q = doc.quote || {};

  // Subtitle
  const custName = buildCustName(q) || doc.custName || '';
  const subtitleEl = document.getElementById('jobTermsEditSubtitle');
  if (subtitleEl) subtitleEl.textContent = custName ? `Job: ${custName}` : '';

  // Doc type
  const typeVal = (q.type || 'Estimate');
  document.querySelectorAll('input[name="jteDocType"]').forEach(r => { r.checked = r.value === typeVal; });

  // Discount
  const discSel = document.getElementById('jteDiscount');
  const discCustom = document.getElementById('jteDiscountCustom');
  const discVal = q.discount || '0';
  const standardDiscs = ['0','5','10','20'];
  if (standardDiscs.includes(String(discVal))) {
    discSel.value = discVal;
    discCustom.style.display = 'none';
  } else {
    discSel.value = 'custom';
    discCustom.style.display = '';
    discCustom.value = discVal;
  }

  // VAT
  const vatSel = document.getElementById('jteVat');
  const vatCustomEl = document.getElementById('jteVatCustom');
  const vatVal = q.vatRate || '0';
  const standardVats = ['0','5','10','20'];
  if (standardVats.includes(String(vatVal))) {
    vatSel.value = vatVal;
    vatCustomEl.style.display = 'none';
  } else {
    vatSel.value = 'custom';
    vatCustomEl.style.display = '';
    vatCustomEl.value = q.vatCustom || vatVal;
  }

  // Valid For
  const validSel = document.getElementById('jteValidFor');
  const validCustomGrp = document.getElementById('jteValidCustomGroup');
  const validCustomEl = document.getElementById('jteValidCustom');
  const validVal = q.validFor || '14';
  if (['7','14','30'].includes(String(validVal))) {
    validSel.value = validVal;
    validCustomGrp.style.display = 'none';
  } else {
    validSel.value = 'custom';
    validCustomGrp.style.display = '';
    validCustomEl.value = q.validCustom || validVal;
  }

  // Terms checkboxes
  const selectedTerms = q.selectedTerms || [];
  document.querySelectorAll('input[name="jteTerms"]').forEach(cb => {
    cb.checked = selectedTerms.includes(cb.value);
  });

  // Custom terms
  document.getElementById('jteCustomTerms').value = q.customTerms || '';

  // Signature
  document.getElementById('jteAuthSig').value = q.authSig || defaultAuthName();

  // Live totals
  jteUpdateTotals();

  document.getElementById('jobTermsEditModal').style.display = 'flex';
}

function jteGetSubtotal() {
  const doc = state.saved.find(d => d.id === activeJobTermsDocId);
  if (!doc) return 0;
  const items = (doc.quote?.items || doc.items || []);
  return items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
}

function jteUpdateTotals() {
  const subtotal = jteGetSubtotal();
  const discSel = document.getElementById('jteDiscount');
  const discCustom = document.getElementById('jteDiscountCustom');
  const vatSel = document.getElementById('jteVat');
  const vatCustomEl = document.getElementById('jteVatCustom');

  const discPct = discSel.value === 'custom' ? (parseFloat(discCustom.value) || 0) : (parseFloat(discSel.value) || 0);
  const vatPct  = vatSel.value  === 'custom' ? (parseFloat(vatCustomEl.value) || 0) : (parseFloat(vatSel.value) || 0);

  const discAmt  = subtotal * discPct / 100;
  const afterDisc = subtotal - discAmt;
  const vatAmt   = afterDisc * vatPct / 100;
  const total    = afterDisc + vatAmt;

  document.getElementById('jteSubtotal').textContent   = fmtPrice(subtotal);
  document.getElementById('jteDiscountAmt').textContent = '-' + fmtPrice(discAmt);
  document.getElementById('jteVatAmt').textContent      = fmtPrice(vatAmt);
  document.getElementById('jteTotal').textContent       = fmtPrice(total);
  document.getElementById('jteDiscountRow').style.display = discAmt > 0 ? '' : 'none';
  document.getElementById('jteVatRow').style.display      = vatAmt > 0 ? '' : 'none';
}

// Pure data-save for the Job Terms form — no UI side-effects.
function persistJobTermsForm() {
  const docId = activeJobTermsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;
  if (!doc.quote) doc.quote = {};
  const typeEl = document.querySelector('input[name="jteDocType"]:checked');
  if (typeEl) { doc.quote.type = typeEl.value; doc.type = typeEl.value; }
  const discSel = document.getElementById('jteDiscount');
  doc.quote.discount = discSel.value === 'custom'
    ? (parseFloat(document.getElementById('jteDiscountCustom').value) || 0)
    : parseFloat(discSel.value) || 0;
  const vatSel = document.getElementById('jteVat');
  if (vatSel.value === 'custom') {
    doc.quote.vatRate   = 'custom';
    doc.quote.vatCustom = parseFloat(document.getElementById('jteVatCustom').value) || 0;
  } else {
    doc.quote.vatRate   = vatSel.value;
    doc.quote.vatCustom = '';
  }
  const validSel = document.getElementById('jteValidFor');
  if (validSel.value === 'custom') {
    doc.quote.validFor    = 'custom';
    doc.quote.validCustom = document.getElementById('jteValidCustom').value || '';
  } else {
    doc.quote.validFor    = validSel.value;
    doc.quote.validCustom = '';
  }
  doc.quote.selectedTerms = [...document.querySelectorAll('input[name="jteTerms"]:checked')].map(cb => cb.value);
  doc.quote.customTerms   = document.getElementById('jteCustomTerms').value || '';
  doc.quote.authSig       = document.getElementById('jteAuthSig').value || '';
  const subtotal  = jteGetSubtotal();
  const discPct   = parseFloat(doc.quote.discount) || 0;
  const afterDisc = subtotal * (1 - discPct / 100);
  const vatRate   = doc.quote.vatRate === 'custom' ? (parseFloat(doc.quote.vatCustom) || 0) : (parseFloat(doc.quote.vatRate) || 0);
  doc.total = afterDisc * (1 + vatRate / 100);
  save();
  refreshSavedDocs();
}

function saveJobTermsEdit() {
  persistJobTermsForm();
  const docId = activeJobTermsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;

  document.getElementById('jobTermsEditModal').style.display = 'none';

  // Re-render and show customer dashboard
  try {
    const groups = buildCustomerGroups();
    const updatedGroup = groups.find(g => g.docs.some(d => d.id === docId)) || activeCustomerGroup;
    if (updatedGroup) {
      activeCustomerGroup = updatedGroup;
      renderSingleCustomerDashboard(updatedGroup, groups);
    }
  } catch(e) {}
  document.getElementById('customerDashboardModal').style.display = 'flex';
  showSavedPopup("Saved. Looking good.");
}

function setupJobTermsEdit() {
  document.getElementById('closeJobTermsEditBtn')?.addEventListener('click', () => {
    document.getElementById('jobTermsEditModal').style.display = 'none';
  });
  document.getElementById('backToJobDetailsFromTermsBtn')?.addEventListener('click', () => {
    persistJobTermsForm();                                             // save before leaving
    document.getElementById('jobTermsEditModal').style.display = 'none';
    if (activeJobTermsDocId) openJobDetailsEdit(activeJobTermsDocId);
  });
  document.getElementById('saveJobTermsEditBtn')?.addEventListener('click', saveJobTermsEdit);

  // Live totals on discount/VAT change
  ['jteDiscount','jteDiscountCustom','jteVat','jteVatCustom'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', jteUpdateTotals);
    document.getElementById(id)?.addEventListener('change', jteUpdateTotals);
  });

  // Show/hide custom discount
  document.getElementById('jteDiscount')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteDiscount').value === 'custom';
    document.getElementById('jteDiscountCustom').style.display = isCustom ? '' : 'none';
    jteUpdateTotals();
  });

  // Show/hide custom VAT
  document.getElementById('jteVat')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteVat').value === 'custom';
    document.getElementById('jteVatCustom').style.display = isCustom ? '' : 'none';
    jteUpdateTotals();
  });

  // Show/hide custom valid for
  document.getElementById('jteValidFor')?.addEventListener('change', () => {
    const isCustom = document.getElementById('jteValidFor').value === 'custom';
    document.getElementById('jteValidCustomGroup').style.display = isCustom ? '' : 'none';
  });
}

/* ===== BUSINESS DETAILS CHOICE ===== */

const BIZ_COMPARE_KEYS = ['businessName', 'firstName', 'lastName', 'address', 'postcode', 'phone', 'email', 'website', 'companyNumber', 'logo'];

function bizDetailsChanged(doc) {
  if (!doc || !doc.company) return false; // no snapshot = always uses current state
  if (state.company.bizChoiceMade === 'old') return false; // user said "always use old"
  const old = doc.company;
  const cur = state.company;
  return BIZ_COMPARE_KEYS.some(k => (old[k] || '') !== (cur[k] || ''));
}

let _bizChoiceCallback = null;
let _bizChoiceDocId    = null;

function withBizCheck(docId, callback) {
  const doc = state.saved.find(d => d.id === docId);
  if (!doc || !bizDetailsChanged(doc)) {
    callback(docId);
    return;
  }
  _bizChoiceDocId    = docId;
  _bizChoiceCallback = callback;
  // Populate modal with old vs new name for context
  const oldBiz = doc.company;
  const oldName = (oldBiz.businessName || [oldBiz.firstName, oldBiz.lastName].filter(Boolean).join(' ') || 'Original details').trim();
  const newName = (state.company.businessName || [state.company.firstName, state.company.lastName].filter(Boolean).join(' ') || 'Current details').trim();
  document.getElementById('bizChoiceOldSub').textContent = oldName;
  document.getElementById('bizChoiceNewSub').textContent = newName;
  // Reset radio + checkboxes
  const oldRadio = document.querySelector('input[name="bizChoice"][value="old"]');
  if (oldRadio) oldRadio.checked = true;
  document.getElementById('bizChoiceOldAll').checked = false;
  document.getElementById('bizChoiceNewAll').checked = false;
  document.getElementById('bizChoiceModal').style.display = 'flex';
}

function applyBizChoice(docId, useNew, forAll, callback) {
  if (useNew) {
    const companySnapshot = { ...state.company };
    // Derive the new authorised name (first+last, or business name as fallback)
    const newAuthName = [(companySnapshot.firstName||''), (companySnapshot.lastName||'')].filter(Boolean).join(' ')
      || companySnapshot.businessName || '';

    const updateDoc = d => {
      d.company = { ...companySnapshot };
      if (d.quote) {
        // Update the printed auth name
        d.quote.authSig = newAuthName;
        // Update the signature preview to F.Last format, but only if it was already set
        if (d.quote.custSigText) d.quote.custSigText = formatSigFromName(newAuthName);
      }
    };

    if (forAll) {
      state.saved.forEach(updateDoc);
      toast('All documents updated with your current business details.');
    } else {
      const doc = state.saved.find(d => d.id === docId);
      if (doc) updateDoc(doc);
    }
    save();
  } else {
    // Use old — no data change needed
    if (forAll) {
      state.company.bizChoiceMade = 'old';
      save();
      toast('Your existing documents will keep their original business details.');
    }
  }
  if (callback) callback(docId);
}

function setupBizChoiceModal() {
  const closeModal = () => {
    document.getElementById('bizChoiceModal').style.display = 'none';
    _bizChoiceCallback = null;
    _bizChoiceDocId    = null;
  };

  document.getElementById('closeBizChoiceBtn')?.addEventListener('click', closeModal);
  document.getElementById('bizChoiceCancelBtn')?.addEventListener('click', closeModal);

  document.getElementById('bizChoiceContinueBtn')?.addEventListener('click', () => {
    const useNew  = document.querySelector('input[name="bizChoice"]:checked')?.value === 'new';
    const forAll  = useNew
      ? document.getElementById('bizChoiceNewAll').checked
      : document.getElementById('bizChoiceOldAll').checked;
    document.getElementById('bizChoiceModal').style.display = 'none';
    const cb  = _bizChoiceCallback;
    const id  = _bizChoiceDocId;
    _bizChoiceCallback = null;
    _bizChoiceDocId    = null;
    applyBizChoice(id, useNew, forAll, cb);
  });

  // Clicking the "do this for all" checkbox auto-selects its matching radio
  document.getElementById('bizChoiceOldAll')?.addEventListener('change', () => {
    const r = document.querySelector('input[name="bizChoice"][value="old"]');
    if (r) r.checked = true;
  });
  document.getElementById('bizChoiceNewAll')?.addEventListener('change', () => {
    const r = document.querySelector('input[name="bizChoice"][value="new"]');
    if (r) r.checked = true;
  });

  // Click outside to close
  document.getElementById('bizChoiceModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('bizChoiceModal')) closeModal();
  });
}

/* ===== INVOICE JOB PICKER ===== */

function renderInvJobPicker(doc) {
  const q = doc.quote || {};
  const items = (q.items && q.items.length) ? q.items : ((doc.items && doc.items.length) ? doc.items : []);
  const calcedTotal = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
  const displayTotal = items.length ? calcedTotal : (doc.total || 0);
  const body = document.getElementById('invJobsBody');
  if (!body) return;
  const hasPriceList = state.priceList && state.priceList.length > 0;
  body.innerHTML = `
    ${hasPriceList ? `
    <p class="jde-section-label">Add from Price List</p>
    <input type="text" id="invPickerSearch" class="search-input" placeholder="Search your price list…" style="margin-bottom:6px">
    <div id="invPickerList" class="jde-picker-list picker-list"></div>
    <div class="jde-divider"></div>` : ''}
    <p class="jde-section-label">Job Items</p>
    <div class="jde-item-headers"><span>Description</span><span>Price</span><span></span></div>
    <div id="invItemsList" class="jde-items-list">
      ${items.length
        ? items.map(item => jdeItemRowHtml(item)).join('')
        : '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>'}
    </div>
    <button type="button" class="btn btn-sage btn-sm" id="invAddItemBtn" style="margin-top:8px">+ One-off Item</button>
    <div class="form-group" style="margin-top:14px">
      <label for="invTotalOverride">Total <span class="jde-total-hint">(auto-calculated, or set manually)</span></label>
      <div class="input-pfx" style="margin:0">
        <span class="pfx-symbol">£</span>
        <input type="number" id="invTotalOverride" min="0" step="any" placeholder="0.00" value="${displayTotal > 0 ? displayTotal.toFixed(2) : ''}">
      </div>
    </div>`;

  wireInvRemoveButtons();
  document.getElementById('invAddItemBtn').addEventListener('click', invAddItem);
  body.addEventListener('input', e => {
    if (e.target.classList.contains('jde-item-price')) invUpdateTotal();
  });

  if (hasPriceList) {
    invRenderPicker('');
    document.getElementById('invPickerSearch').addEventListener('input', e => invRenderPicker(e.target.value));
    document.getElementById('invPickerList').addEventListener('click', e => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const jobId  = actionBtn.dataset.jobId;
        const action = actionBtn.dataset.action;
        if (action === 'add')         invAddFromPriceList(jobId);
        else if (action === 'remove') invRemoveFromPriceList(jobId);
        return;
      }
      const item = e.target.closest('.pick-item:not(.added)');
      if (item) invAddFromPriceList(item.dataset.jobId);
    });
  }
}

function invRenderPicker(searchVal) {
  const q = (searchVal || '').toLowerCase();
  const filtered = state.priceList.filter(j => j.name.toLowerCase().includes(q));
  const container = document.getElementById('invPickerList');
  if (!container) return;
  if (!filtered.length) {
    container.innerHTML = '<p style="color:#888;font-size:0.85rem;padding:6px 0">No jobs match your search.</p>';
    return;
  }
  const qtyCounts = {};
  document.querySelectorAll('#invItemsList .jde-item-name').forEach(el => {
    const name = el.value.trim().toLowerCase();
    if (name) qtyCounts[name] = (qtyCounts[name] || 0) + 1;
  });
  container.innerHTML = filtered.map(item => {
    const qty = qtyCounts[item.name.toLowerCase()] || 0;
    const counterHtml = qty === 0
      ? `<button type="button" class="pick-add-btn" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add ${esc(item.name)}">+</button>`
      : `<div class="pick-counter">
           <button type="button" class="pick-qty-btn pick-qty-minus" data-action="remove" data-job-id="${esc(item.id)}" aria-label="Remove one">−</button>
           <span class="pick-qty-num">${qty}</span>
           <button type="button" class="pick-qty-btn pick-qty-plus" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add one more">+</button>
         </div>`;
    return `
      <div class="pick-item${qty > 0 ? ' added' : ''}" data-job-id="${esc(item.id)}">
        <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        ${counterHtml}
      </div>`;
  }).join('');
}

function invAddFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('invItemsList');
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: job.name, unitPrice: job.price });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>';
    }
    invUpdateTotal();
    invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  });
  invUpdateTotal();
  invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function invRemoveFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('invItemsList');
  if (!list) return;
  const rows = [...list.querySelectorAll('.jde-item-row')];
  const matching = rows.filter(r => r.querySelector('.jde-item-name')?.value.trim().toLowerCase() === job.name.toLowerCase());
  if (!matching.length) return;
  matching[matching.length - 1].remove();
  if (!list.querySelector('.jde-item-row')) {
    list.innerHTML = '<p class="jde-empty-hint">No items yet. Add from your price list above or use the button below.</p>';
  }
  invUpdateTotal();
  invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
}

function invUpdateTotal() {
  const prices = [...document.querySelectorAll('#invItemsList .jde-item-price')].map(el => parseFloat(el.value) || 0);
  if (prices.length > 0) {
    const totalEl = document.getElementById('invTotalOverride');
    if (totalEl) totalEl.value = prices.reduce((s, p) => s + p, 0).toFixed(2);
  }
}

function wireInvRemoveButtons() {
  document.querySelectorAll('#invItemsList .jde-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.jde-item-row');
      if (row) row.remove();
      const list = document.getElementById('invItemsList');
      if (list && !list.querySelector('.jde-item-row')) {
        list.innerHTML = '<p class="jde-empty-hint">No items yet. Add one below.</p>';
      }
      invUpdateTotal();
      invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
    });
  });
}

function invAddItem() {
  const list = document.getElementById('invItemsList');
  const hint = list.querySelector('.jde-empty-hint');
  if (hint) hint.remove();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = jdeItemRowHtml({ name: '', unitPrice: '' });
  const row = wrapper.firstElementChild;
  list.appendChild(row);
  row.querySelector('.jde-item-remove').addEventListener('click', () => {
    row.remove();
    if (!list.querySelector('.jde-item-row')) {
      list.innerHTML = '<p class="jde-empty-hint">No items yet. Add one below.</p>';
    }
    invUpdateTotal();
    invRenderPicker(document.getElementById('invPickerSearch')?.value || '');
  });
  row.querySelector('.jde-item-name').focus();
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
      // Check for explicit +/− action buttons first
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const jobId  = actionBtn.dataset.jobId;
        const action = actionBtn.dataset.action;
        if (action === 'add')    jdeAddFromPriceList(jobId);
        else if (action === 'remove') jdeRemoveFromPriceList(jobId);
        return;
      }
      // Clicking the name/price area of a 0-qty item also adds it
      const item = e.target.closest('.pick-item:not(.added)');
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
  // Count how many times each job appears in the current items list
  const qtyCounts = {};
  document.querySelectorAll('#jdeItemsList .jde-item-name').forEach(el => {
    const name = el.value.trim().toLowerCase();
    if (name) qtyCounts[name] = (qtyCounts[name] || 0) + 1;
  });

  container.innerHTML = filtered.map(item => {
    const qty = qtyCounts[item.name.toLowerCase()] || 0;
    const counterHtml = qty === 0
      ? `<button type="button" class="pick-add-btn" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add ${esc(item.name)}">+</button>`
      : `<div class="pick-counter">
           <button type="button" class="pick-qty-btn pick-qty-minus" data-action="remove" data-job-id="${esc(item.id)}" aria-label="Remove one">−</button>
           <span class="pick-qty-num">${qty}</span>
           <button type="button" class="pick-qty-btn pick-qty-plus" data-action="add" data-job-id="${esc(item.id)}" aria-label="Add one more">+</button>
         </div>`;
    return `
      <div class="pick-item${qty > 0 ? ' added' : ''}" data-job-id="${esc(item.id)}">
        <div class="pick-name">${esc(item.name)}${item.unit ? `<span class="pick-unit">(${esc(item.unit)})</span>` : ''}</div>
        <span class="pick-price">${fmtPrice(item.price)}</span>
        ${counterHtml}
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

function jdeRemoveFromPriceList(jobId) {
  const job = state.priceList.find(j => j.id === jobId);
  if (!job) return;
  const list = document.getElementById('jdeItemsList');
  if (!list) return;
  const rows = [...list.querySelectorAll('.jde-item-row')];
  // Remove the last matching row (most recently added)
  const matching = rows.filter(r => r.querySelector('.jde-item-name')?.value.trim().toLowerCase() === job.name.toLowerCase());
  if (matching.length === 0) return;
  matching[matching.length - 1].remove();
  if (!list.querySelector('.jde-item-row')) {
    list.innerHTML = '<p class="jde-empty-hint">No items yet - add from your price list above or use the button below.</p>';
  }
  jdeUpdateTotal();
  jdeRenderPicker(document.getElementById('jdePickerSearch')?.value || '');
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

// Pure data-save for the Job Details form — no UI side-effects.
function persistJobDetailsForm() {
  const docId = activeJobDetailsDocId;
  const doc = state.saved.find(d => d.id === docId);
  if (!doc) return;
  const items = [];
  document.querySelectorAll('#jdeItemsList .jde-item-row').forEach(row => {
    const name  = (row.querySelector('.jde-item-name')?.value  || '').trim();
    const price = parseFloat(row.querySelector('.jde-item-price')?.value) || 0;
    if (name || price) items.push({ id: uid(), name, unitPrice: price, unit: '', qty: 1 });
  });
  const notes         = document.getElementById('jdeNotes')?.value || '';
  const totalOverride = parseFloat(document.getElementById('jdeTotalOverride')?.value) || 0;
  if (!doc.quote) doc.quote = {};
  doc.quote.items = items;
  doc.quote.notes = notes;
  if (items.length > 0) {
    const subtotal  = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0);
    const discPct   = parseFloat(doc.quote.discount) || 0;
    const afterDisc = subtotal * (1 - discPct / 100);
    const vatPct    = parseFloat(doc.quote.vatRate)   || 0;
    doc.total = afterDisc * (1 + vatPct / 100);
  } else if (totalOverride > 0) {
    doc.total = totalOverride;
  }
  doc.custName = buildCustName(doc.quote);
  save();
  refreshSavedDocs();
}

function saveJobDetails() {
  persistJobDetailsForm();
  const docId = activeJobDetailsDocId;
  const doc   = state.saved.find(d => d.id === docId);
  if (!doc) return;

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
  .doc-header{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:12px 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  /* Logo cell stretches to full header height */
  .doc-logo-cell{display:flex;align-items:center;align-self:stretch;min-width:48px;max-width:140px}
  .doc-logo{display:block;height:100%;width:auto;max-width:140px;min-height:40px;object-fit:contain}
  .doc-logo-placeholder{width:64px;height:100%;min-height:48px;border:1.5px dashed rgba(255,255,255,0.45);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;color:rgba(255,255,255,0.65)}
  /* Business name — always one line, font scales down to fit */
  .doc-biz-name{font-weight:700;text-align:center;line-height:1.2;white-space:normal;word-break:break-word;font-size:2rem}
  /* Doc type badge — background set inline with accent colour */
  .doc-type-label{font-size:1.05rem;font-weight:800;text-align:center;text-transform:uppercase;letter-spacing:0.07em;line-height:1.2;padding:8px 14px;border-radius:7px;white-space:nowrap;-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* ── PREPARED BY / FOR (two cols, no dividers) ── */
  .doc-info{display:grid;grid-template-columns:1fr 1fr}
  .doc-info-col{padding:10px 18px}
  .doc-info-col h3{font-size:0.83rem;font-weight:700;margin-bottom:5px;text-transform:none;letter-spacing:0}
  .doc-info-col p{font-size:0.83rem;line-height:1.6;white-space:pre-wrap;color:#333}

  /* ── REFERENCE ROW — no internal borders; border-bottom = line above Itemised Breakdown ── */
  .doc-ref-row{display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #c4c4c4}
  .doc-ref-cell{padding:6px 18px;font-size:0.83rem;display:flex;flex-direction:column;gap:2px}
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
  .totals-sep td{border-top:1.5px solid #bbb!important;border-bottom:none!important;border-right:none!important;padding:6px 0 0!important;background:transparent}
  .totals-row td{padding:3px 10px;font-size:0.82rem;border:none!important;background:transparent}
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
  .doc-accept-heading{font-size:0.88rem;font-weight:700;padding-bottom:4px;margin-bottom:16px;text-transform:none;letter-spacing:0}
  .doc-accept-body>p{font-size:0.83rem;line-height:1.3;color:#333;margin-bottom:32px}
  .doc-sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:32px}
  .doc-sig-box{min-height:72px;display:flex;flex-direction:column;justify-content:flex-end}
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

    /* Header: tighten at small widths */
    .doc-header{gap:6px;padding:8px 10px}
    .doc-logo-cell{max-width:72px}
    .doc-logo{max-width:72px}
    .doc-biz-name{font-size:1.2rem}
    .doc-type-label{font-size:0.8rem;padding:5px 8px;letter-spacing:0.04em}

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

  // ── Names — prefer live state so name changes always show immediately ──
  const liveFullName = [(state.company.firstName||''), (state.company.lastName||'')].filter(Boolean).join(' ');
  const snapFullName = [(co.firstName||''), (co.lastName||'')].filter(Boolean).join(' ');
  const authFullName = liveFullName || snapFullName;
  const bizName      = state.company.businessName || co.businessName || authFullName;
  const custName     = [q.custTitle, q.custFirstName, q.custLastName].filter(Boolean).join(' ');

  // ── Address blocks ───────────────────────────────────────────────
  const vatNum    = state.company.vatNumber || co.vatNumber || '';
  const bizLines  = [authFullName, co.address, co.postcode, co.phone, co.email, co.website, vatNum ? `VAT Reg No: ${vatNum}` : ''].filter(Boolean).join('\n');
  const custLines = [custName, q.custAddr, q.custPostcode, q.custEmail, q.custPhone].filter(Boolean).join('\n');

  // ── Logo — prefer doc snapshot, fall back to live state so it always shows ──
  const logoSrc = co.logo || state.company.logo || '';
  // ── Header text colours — auto dark/light based on header and accent backgrounds ──
  const headerTextCol  = isColorLight(primary) ? '#1a1a1a' : '#ffffff';
  const accentTextCol  = isColorLight(accent)  ? '#1a1a1a' : '#ffffff';
  const logoPlaceholderStyle = isColorLight(primary)
    ? 'border:1.5px dashed rgba(0,0,0,0.3);color:rgba(0,0,0,0.5)'
    : 'border:1.5px dashed rgba(255,255,255,0.45);color:rgba(255,255,255,0.65)';
  // Logo wrapped in a flex cell so it stretches to the full header height
  const logoHtml = `<div class="doc-logo-cell">${
    logoSrc
      ? `<img src="${logoSrc}" alt="Logo" class="doc-logo">`
      : `<div class="doc-logo-placeholder" style="${logoPlaceholderStyle}">Logo</div>`
  }</div>`;

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
    `<tr><td colspan="4" style="text-align:center;color:#aaa;padding:14px;font-style:italic">No items added. Go back and add jobs in Step 2.</td></tr>`;

  // ── Totals — label in col 3 (right-aligned), amount in col 4 (right-aligned) ──
  const tCell = (label, value, bold = false) =>
    `<tr class="totals-row">
      <td colspan="2" style="border:none;padding:0"></td>
      <td style="text-align:right;padding:3px 10px;font-size:0.79rem;${bold?'font-weight:700':''}">${label}</td>
      <td style="text-align:right;padding:3px 10px;font-size:0.82rem;">${value}</td>
    </tr>`;
  const discRow = disc > 0 ? tCell(`Discount (${disc}%):`, `-${fmtPrice(sub*disc/100)}`) : '';
  const totalsRows = `
    <tr class="totals-sep"><td colspan="4"></td></tr>
    ${tCell('Subtotal:', fmtPrice(afterDisc), true)}
    ${discRow}
    ${tCell(`VAT${vatRate>0?` (${vatRate}%)`:'  (if applicable)'}:`, vatRate>0?fmtPrice(vatAmt):'-')}
    <tr class="totals-total" style="background:${accent}">
      <td colspan="3" style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">TOTAL:</td>
      <td style="text-align:right;padding:8px 10px;font-size:0.9rem;font-weight:700;color:#fff;border:none">${fmtPrice(total)}</td>
    </tr>`;

  // ── Description of work — only shown when a description was entered ──
  const descHtml = q.notes
    ? `<div class="doc-section-heading">Description of Work</div>
       <div class="doc-desc-box filled" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(q.notes)}</div>`
    : '';

  // ── Terms table — not shown on receipts ─────────────────────────
  const termsHtml = docType !== 'receipt' ? buildNewTermsHtml(q) : '';

  // ── Invoice / receipt extras ────────────────────────────────────
  let extraHtml = '';
  if (docType === 'invoice') {
    // Prior payments (deposits / part payments made before invoice was generated)
    const priorPayments = getDocPayments(doc).filter(p => p.amount > 0);
    if (priorPayments.length > 0) {
      const totalPrior = priorPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const balance    = Math.max(0, (doc.total || 0) - totalPrior);
      const payLines   = priorPayments.map(p => {
        const label = p.type && p.type !== 'Full Payment' ? p.type : 'Payment Received';
        return `${label}: <strong>${fmtPrice(p.amount)}</strong> on ${formatDate(p.date)}`;
      }).join('<br>');
      extraHtml += `<div class="section"><h3>Payments Already Received</h3><p>${payLines}</p><p style="margin-top:6px">Total Received: <strong>${fmtPrice(totalPrior)}</strong><br>Balance Due: <strong>${fmtPrice(balance)}</strong></p></div>`;
    }
    if (extra.dueDate) extraHtml += `<div class="section"><h3>Payment Due</h3><p>${formatDate(extra.dueDate)}</p>${refLabel ? `<p style="margin-top:6px;font-size:0.85em;color:#666">Please use <strong>${esc(refLabel)}</strong> as your payment reference to help us process your payment quickly.</p>` : '<p style="margin-top:6px;font-size:0.85em;color:#666">Please use the invoice number as your payment reference to help us process your payment quickly.</p>'}</div>`;
    extraHtml += buildPaymentSection(co, docType, extra.payMethod);
    if (extra.notes)   extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  } else if (docType === 'receipt') {
    const methodLine = extra.method ? `<br>Paid by: ${esc(extra.method)}` : '';
    extraHtml = `<div class="section"><h3>Payment Received</h3><p>Amount: <strong>${fmtPrice(parseFloat(extra.amount)||0)}</strong><br>Date: ${formatDate(extra.date||todayStr())}${methodLine}</p></div>`;
    if (extra.notes) extraHtml += `<div class="section"><h3>Notes</h3><p>${esc(extra.notes)}</p></div>`;
  }

  // ── Sig block for invoice/receipt ───────────────────────────────
  const sigHtml = !isQuote ? buildSigSection(q, co, docType) : '';

  // ── QR code ──────────────────────────────────────────────────────
  const qrSrc = state.company.qrCode || co.qrCode || '';
  const qrHtml = qrSrc ? `
    <div class="section doc-qr-section" style="text-align:center;padding-top:10px">
      <img src="${qrSrc}" alt="QR Code" style="width:90px;height:90px;object-fit:contain">
    </div>` : '';

  // ── Photos ───────────────────────────────────────────────────────
  const photosHtml = extra.includePhotos ? buildPhotosSection(doc) : '';

  // ── Acceptance page (quotes / estimates) ────────────────────────
  let acceptancePage = '';
  if (isQuote) {
    const sigText    = q.custSigText || '';
    const authName   = q.authSig || authFullName || bizName;
    const sigContent = sigText ? `<span class="doc-sig-typed">${esc(sigText)}</span>` : '';
    acceptancePage = `
      <div class="doc-accept" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">
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
    <div class="doc-wrap" style="background:${bgCol};-webkit-print-color-adjust:exact;print-color-adjust:exact">
      <div class="doc-header" style="background:${primary};-webkit-print-color-adjust:exact;print-color-adjust:exact">
        ${logoHtml}
        <div class="doc-biz-name" style="color:${headerTextCol}" id="docBizName">${esc(bizName)}</div>
        <div class="doc-type-label" style="background:${accent};color:${accentTextCol}">${esc(docLabel)}</div>
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
        <div class="doc-ref-cell">${isQuote ? `<span class="ref-label">Valid for:</span><span class="ref-value">${esc(validForText)}</span>` : ''}</div>
      </div>
      <div class="doc-body">
        ${descHtml}
        <table class="doc-items-table">
          <thead><tr style="background:${accent}">
            <th>Itemised Breakdown</th>
            <th class="r">Qty</th>
            <th class="r">Unit Price</th>
            <th class="r" style="border-right:none">Total</th>
          </tr></thead>
          <tbody>${itemsHtml}${totalsRows}</tbody>
        </table>
        ${extraHtml}
        ${termsHtml}
        ${sigHtml}
        ${qrHtml}
        ${photosHtml}
      </div>
      ${isQuote ? '' : '<div class="doc-footer">Powered by LexiHandlesIt.com</div>'}
    </div>
    ${acceptancePage}
    <script>
    (function(){
      var el = document.getElementById('docBizName');
      if(!el) return;
      var run = function(){
        var fs = 32;
        el.style.fontSize = fs + 'px';
        var parent = el.parentElement;
        while(el.scrollWidth > el.offsetWidth + 1 && fs > 8){
          fs -= 0.5;
          el.style.fontSize = fs + 'px';
        }
      };
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', run);
      } else { run(); }
    })();
    </script>`;
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
  const liveFullName = [(state.company.firstName||''), (state.company.lastName||'')].filter(Boolean).join(' ');
  const snapFullName = [(co.firstName||''), (co.lastName||'')].filter(Boolean).join(' ');
  const authFullName = liveFullName || snapFullName;

  // Receipts: just show the authorised name in cursive — no stored sig text, no customer box
  if (docType === 'receipt') {
    if (!authFullName) return '';
    return `
      <div class="sig-block">
        <div class="sig-box">
          <span class="sig-typed">${esc(authFullName)}</span>
          <div style="font-size:0.9rem;font-weight:600">${esc(authFullName)}</div>
          <div class="sig-label">Authorised Signature</div>
        </div>
      </div>`;
  }

  // Invoice / quote: use stored sig text
  const sigText = q.custSigText || document.getElementById('custSigText')?.value || '';
  if (!q.authSig && !sigText && !authFullName) return '';
  const authName = authFullName || q.authSig || co.businessName || '';
  const authSigContent = sigText ? `<span class="sig-typed">${esc(sigText)}</span>` : '';

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

function formatWhatsAppNumber(phone) {
  // Strip spaces, dashes, brackets, plus signs
  let n = (phone || '').replace(/[\s\-().+]/g, '');
  // UK number: leading 0 -> replace with country code 44
  if (n.startsWith('0')) n = '44' + n.slice(1);
  return n;
}

/* ===================================================
   CALENDAR
   =================================================== */

const CAL_COLORS = {
  startDate:  '#7D5730',  // walnut  — accepted job start date
  completed:  '#6B7C5C',  // sage    — job completed
  estimate:   '#E8B84B',  // gold    — estimate/quote awaiting response
  invoiceDue: '#E67E22',  // orange  — invoice due soon
  overdue:    '#C0392B',  // red     — invoice overdue
  paid:       '#2E7D32',  // green   — payment received
};

let calCurrentYear  = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calSelectedDate = null;

// ---- Events map ----
function getCalendarEvents() {
  // Returns: { 'YYYY-MM-DD': [ { docId, type, color, label, custName, ref, doc } ] }
  const events = {};

  function addEvent(dateStr, ev) {
    if (!dateStr || dateStr.length < 8) return;
    if (!events[dateStr]) events[dateStr] = [];
    events[dateStr].push(ev);
  }

  const today = todayStr();

  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Unknown Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
    const base = { docId: d.id, custName, ref, doc: d };

    // 1. Job start date (accepted jobs with a start date set)
    if (d.jobAccepted && d.jobStartDate) {
      addEvent(d.jobStartDate, { ...base, type: 'startDate', color: CAL_COLORS.startDate, label: 'Job Starts' });
    }

    // 1b. Job completion date
    if (d.jobCompletedDate) {
      addEvent(d.jobCompletedDate, { ...base, type: 'completed', color: CAL_COLORS.completed, label: 'Job Completed' });
      // If invoice not yet sent, also mark the expected payment due date as a reminder
      if (!d.invoiceSent && !d.paid) {
        const terms    = (q.selectedTerms || []);
        const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
        const expDue   = addDays(d.jobCompletedDate, termDays);
        addEvent(expDue, { ...base, type: 'invoiceDue', color: CAL_COLORS.invoiceDue, label: 'Invoice Not Yet Raised' });
      }
    }

    // 2. Estimate / Quote — gold dot on doc creation date if not yet invoiced
    if (!d.invoiceSent && !d.paid) {
      const qType = (q.type || 'Estimate').toLowerCase();
      if (qType === 'estimate' || qType === 'quote') {
        const dateStr = q.date || d.date;
        if (dateStr) {
          addEvent(dateStr, { ...base, type: 'estimate', color: CAL_COLORS.estimate, label: qType === 'quote' ? 'Quote Sent' : 'Estimate Created' });
        }
      }
    }

    // 3. Invoice due date
    if (d.invoiceSent && !d.paid && d.invoiceDueDate) {
      const isOverdue = today > d.invoiceDueDate;
      addEvent(d.invoiceDueDate, {
        ...base,
        type: isOverdue ? 'overdue' : 'invoiceDue',
        color: isOverdue ? CAL_COLORS.overdue : CAL_COLORS.invoiceDue,
        label: isOverdue ? 'Invoice Overdue' : 'Invoice Due',
      });
    }

    // 4. Payment received dates — green dot
    getDocPayments(d).forEach(p => {
      if (p.amount > 0 && p.date) {
        const lbl = p.type && p.type !== 'Full Payment' ? p.type + ' Received' : 'Payment Received';
        addEvent(p.date, { ...base, type: 'paid', color: CAL_COLORS.paid, label: lbl });
      }
    });
  });

  return events;
}

// ---- Render the full calendar page ----
function renderCalendar() {
  const wrap = document.getElementById('calPageWrap');
  if (!wrap) return;

  const events  = getCalendarEvents();
  const today   = todayStr();
  const year    = calCurrentYear;
  const month   = calCurrentMonth;

  // --- Needs Attention panel ---
  const attentionItems = [];
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Unknown Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';

    if (d.invoiceSent && !d.paid && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.overdue, desc: `Invoice ${days} day${days === 1 ? '' : 's'} overdue`, doc: d, type: 'overdue' });
    } else if (!d.invoiceSent && !d.paid && d.jobCompletedDate) {
      // Job finished but no invoice sent — check if expected due date has passed
      const terms    = (q.selectedTerms || []);
      const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
      const expDue   = addDays(d.jobCompletedDate, termDays);
      if (today >= expDue) {
        const days = Math.floor((new Date(today) - new Date(expDue)) / 86400000);
        attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.invoiceDue, desc: `Job completed. Invoice not yet raised (${days === 0 ? 'due today' : days + ' day' + (days === 1 ? '' : 's') + ' overdue'})`, doc: d, type: 'invoiceDue' });
      }
    } else if (!d.invoiceSent && !d.paid) {
      const qType = (q.type || '').toLowerCase();
      const docDate = q.date || d.date;
      if ((qType === 'estimate' || qType === 'quote') && docDate) {
        const age = Math.floor((new Date(today) - new Date(docDate)) / 86400000);
        if (age >= 7) {
          attentionItems.push({ docId: d.id, custName, ref, color: CAL_COLORS.estimate, desc: `${qType === 'quote' ? 'Quote' : 'Estimate'} sent ${age} day${age === 1 ? '' : 's'} ago with no response yet`, doc: d, type: 'estimate' });
        }
      }
    }
  });

  const attentionHtml = attentionItems.length ? `
    <div class="cal-attention">
      <div class="cal-attention-header" onclick="toggleCalAttention()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span class="cal-attention-title">Needs Attention</span>
        <span class="cal-attention-badge">${attentionItems.length}</span>
      </div>
      <div class="cal-attention-body" id="calAttentionBody">
        ${attentionItems.map(item => {
          const phone = item.doc?.quote?.custPhone || '';
          const email = item.doc?.quote?.custEmail || '';
          const SVG_EMAIL_A = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
          const SVG_WA_A    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
          const SVG_PHONE_A = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
          return `<div class="cal-attention-item">
            <div class="cal-attn-dot" style="background:${item.color}"></div>
            <div class="cal-attn-content">
              <div class="cal-attn-ref">${esc(item.ref)}</div>
              <div class="cal-attn-name">${esc(item.custName)}</div>
              <div class="cal-attn-desc">${esc(item.desc)}</div>
            </div>
            <div class="cal-attn-actions">
              <button type="button" class="cal-icon-btn cal-icon-email${!email ? ' cal-btn-disabled' : ''}"
                ${email ? `onclick="openCalEmailComposer('${esc(item.docId)}','${item.type}','email')"` : ''}
                title="${email ? 'Email customer' : 'No email address saved'}">${SVG_EMAIL_A}</button>
              <button type="button" class="cal-icon-btn cal-icon-whatsapp${!phone ? ' cal-btn-disabled' : ''}"
                ${phone ? `onclick="openCalEmailComposer('${esc(item.docId)}','${item.type}','whatsapp')"` : ''}
                title="${phone ? 'WhatsApp customer' : 'No phone number saved'}">${SVG_WA_A}</button>
              ${phone
                ? `<a href="tel:${esc(phone)}" class="cal-icon-btn cal-icon-phone" title="Call customer">${SVG_PHONE_A}</a>`
                : `<button type="button" class="cal-icon-btn cal-icon-phone cal-btn-disabled" title="No phone number saved">${SVG_PHONE_A}</button>`}
              <button type="button" class="cal-view-cust-btn" onclick="openUpdateFromCal('${esc(item.docId)}')" title="Update job">Update</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // --- Month grid ---
  const monthName = new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  // UK weeks start Monday: Sun=0 -> offset 6, Mon=1 -> offset 0
  let firstDow = new Date(year, month, 1).getDay();
  firstDow = (firstDow + 6) % 7;
  const daysInMonth    = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const dayHeaders     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const d   = daysInPrevMonth - i;
    const pm  = month === 0 ? 11 : month - 1;
    const py  = month === 0 ? year - 1 : year;
    cells.push({ day: d, dateStr: `${py}-${String(pm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: false });
  }
  const rem = cells.length % 7;
  if (rem > 0) {
    const fill = 7 - rem;
    for (let d = 1; d <= fill; d++) {
      const nm = month === 11 ? 0 : month + 1;
      const ny = month === 11 ? year + 1 : year;
      cells.push({ day: d, dateStr: `${ny}-${String(nm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, other: true });
    }
  }

  const gridHtml = cells.map(cell => {
    const evs        = events[cell.dateStr] || [];
    const isToday    = cell.dateStr === today;
    const isSelected = cell.dateStr === calSelectedDate;
    // Deduplicate dot colours so we don't show 5 green dots for 5 payments
    const uniqueColors = [...new Set(evs.map(e => e.color))];
    const dots = uniqueColors.map(c => `<div class="cal-dot" style="background:${c}"></div>`).join('');
    return `<div class="cal-cell${cell.other ? ' other-month' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${evs.length ? ' has-events' : ''}"
      onclick="openCalDayPanel('${cell.dateStr}')">
      <div class="cal-day-num">${cell.day}</div>
      ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
    </div>`;
  }).join('');

  const monthHtml = `
    <div class="cal-month-card">
      <div class="cal-month-nav">
        <button class="cal-nav-btn" onclick="calChangeMonth(-1)" aria-label="Previous month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="cal-month-title">${monthName}</span>
        <button class="cal-nav-btn" onclick="calChangeMonth(1)" aria-label="Next month">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="cal-grid-wrap">
        <div class="cal-day-headers">${dayHeaders.map(h => `<div class="cal-day-header">${h}</div>`).join('')}</div>
        <div class="cal-grid">${gridHtml}</div>
      </div>
    </div>`;

  // --- Day panel ---
  const dayPanelHtml = calSelectedDate
    ? buildCalDayPanel(calSelectedDate, events[calSelectedDate] || [])
    : '';

  // --- Legend ---
  const legendHtml = `
    <div class="cal-legend">
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.startDate}"></div> Job Start</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.completed}"></div> Job Completed</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.estimate}"></div> Estimate/Quote</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.invoiceDue}"></div> Invoice Due</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.overdue}"></div> Overdue</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:${CAL_COLORS.paid}"></div> Payment</div>
    </div>`;

  wrap.innerHTML = attentionHtml + monthHtml + dayPanelHtml + legendHtml;
}

function toggleCalAttention() {
  const body = document.getElementById('calAttentionBody');
  if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
}

function calChangeMonth(delta) {
  calCurrentMonth += delta;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  if (calCurrentMonth < 0)  { calCurrentMonth = 11; calCurrentYear--; }
  renderCalendar();
}

function openCalDayPanel(dateStr) {
  calSelectedDate = (calSelectedDate === dateStr) ? null : dateStr;
  renderCalendar();
  if (calSelectedDate) {
    const panel = document.querySelector('.cal-day-panel');
    if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }
}

function buildCalDayPanel(dateStr, evs) {
  const displayDate = new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const SVG_EMAIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
  const SVG_WA    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const SVG_PHONE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.44 2 2 0 0 1 3.57 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l1.12-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

  const eventsHtml = evs.length
    ? evs.map(ev => {
        const phone = ev.doc?.quote?.custPhone || '';
        const email = ev.doc?.quote?.custEmail || '';
        let desc = '';
        if (ev.type === 'estimate')   desc = 'Follow up to check they have seen it';
        if (ev.type === 'completed')  desc = 'Work finished. Raise invoice if not yet done';
        if (ev.type === 'invoiceDue') desc = ev.label === 'Invoice Not Yet Raised' ? 'Job complete but invoice not yet sent' : 'Payment due today';
        if (ev.type === 'overdue')    desc = 'Payment overdue';
        if (ev.type === 'startDate')  desc = 'Job confirmed to start today';

        const phoneBtn = phone
          ? `<a href="tel:${esc(phone)}" class="cal-icon-btn cal-icon-phone" title="Call customer">${SVG_PHONE}</a>`
          : `<button type="button" class="cal-icon-btn cal-icon-phone cal-btn-disabled" title="No phone number saved">${SVG_PHONE}</button>`;

        return `<div class="cal-day-event">
          <div class="cal-event-stripe" style="background:${ev.color}"></div>
          <div class="cal-event-content">
            <div class="cal-event-type">${esc(ev.label)}</div>
            <div class="cal-event-name">${esc(ev.custName)}</div>
            <div class="cal-event-ref">${esc(ev.ref)}</div>
            ${desc ? `<div class="cal-event-desc">${esc(desc)}</div>` : ''}
          </div>
          <div class="cal-event-btns">
            <div class="cal-icon-btns">
              <button type="button" class="cal-icon-btn cal-icon-email${!email ? ' cal-btn-disabled' : ''}"
                ${email ? `onclick="openCalEmailComposer('${esc(ev.docId)}','${ev.type}','email')"` : ''}
                title="${email ? 'Email customer' : 'No email address saved'}">${SVG_EMAIL}</button>
              <button type="button" class="cal-icon-btn cal-icon-whatsapp${!phone ? ' cal-btn-disabled' : ''}"
                ${phone ? `onclick="openCalEmailComposer('${esc(ev.docId)}','${ev.type}','whatsapp')"` : ''}
                title="${phone ? 'WhatsApp customer' : 'No phone number saved'}">${SVG_WA}</button>
              ${phoneBtn}
            </div>
            <button type="button" class="cal-view-cust-btn" onclick="openCustomerDashboardForDoc('${esc(ev.docId)}')">View Customer</button>
          </div>
        </div>`;
      }).join('')
    : `<p class="cal-day-empty">Nothing on this day.</p>`;

  return `<div class="cal-day-panel">
    <div class="cal-day-panel-header">
      <span class="cal-day-panel-title">${esc(displayDate)}</span>
      <button class="cal-day-panel-close" onclick="openCalDayPanel('${esc(dateStr)}')">&times;</button>
    </div>
    ${eventsHtml}
  </div>`;
}

// ---- Email / WhatsApp composer ----
let calEmailDocId = null;
let calEmailSelectedTemplate = null;
let calEmailAddr = '';
let calEmailChannel = 'email';   // 'email' | 'whatsapp'
let calEmailPhone = '';

function openCalEmailComposer(docId, eventType, channel) {
  const doc = (state.saved || []).find(d => d.id === docId);
  if (!doc) return;

  calEmailDocId  = docId;
  calEmailChannel = channel || 'email';

  const q          = doc.quote || {};
  const co         = state.company || {};
  const custFirst  = q.custFirstName || 'there';
  const custName   = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
  const traderName = [co.firstName, co.lastName].filter(Boolean).join(' ') || (co.firstName || 'your tradesperson');
  const ref        = doc.invoiceRef || doc.receiptRef || q.ref || doc.ref || '';
  const dueDate    = doc.invoiceDueDate ? formatDate(doc.invoiceDueDate) : 'as agreed';
  const total      = fmtPrice(doc.total || 0);
  const jobDesc    = (q.items || []).map(i => i.name).filter(Boolean).join(', ') || 'your recent work';
  const qTypeName  = (q.type || 'Estimate').toLowerCase();
  calEmailAddr     = q.custEmail || '';
  calEmailPhone    = formatWhatsAppNumber(q.custPhone || '');

  const templates = [
    {
      id: 'follow_up',
      title: 'Quote Follow-up',
      desc: 'Check if they\'ve had a chance to look it over',
      subject: `Following up on your ${qTypeName} — ${ref}`,
      body:
`Hi ${custFirst},

Just following up on the ${qTypeName} I sent over for ${jobDesc}.

Reference: ${ref}
Total: ${total}

Have you had a chance to look it over? Happy to answer any questions or tweak anything.

Looking forward to hearing from you.

Thanks,
${traderName}`,
    },
    {
      id: 'invoice_reminder',
      title: 'Invoice Reminder',
      desc: 'A friendly nudge that payment is due or overdue',
      subject: `Invoice reminder — ${ref}`,
      body:
`Hi ${custFirst},

Just a friendly reminder that invoice ${ref} for ${total} is due ${dueDate}.

If you've already sent payment please ignore this. Any questions, just give me a shout.

Thanks for your business,
${traderName}`,
    },
    {
      id: 'job_confirmed',
      title: 'Job Confirmation',
      desc: 'Let them know the job is confirmed and you\'re ready',
      subject: `Your job is confirmed — ${ref}`,
      body:
`Hi ${custFirst},

Great news — I'm confirmed to carry out the work for ${jobDesc}.

Reference: ${ref}
Total: ${total}

I'll be in touch with the exact start details. If you need anything before then, just reply here or give me a call.

Looking forward to working with you.

${traderName}`,
    },
    {
      id: 'payment_thanks',
      title: 'Payment Thanks',
      desc: 'A warm thank-you once the money comes in',
      subject: `Payment received, thank you! (${ref})`,
      body:
`Hi ${custFirst},

Thank you for your payment for ${ref}. Really appreciate it.

It was a pleasure working with you. If you ever need anything else, don't hesitate to get in touch.

Thanks again,
${traderName}`,
    },
  ];

  // Pre-select the most relevant template
  const defaultMap = {
    estimate:   'follow_up',
    invoiceDue: 'invoice_reminder',
    overdue:    'invoice_reminder',
    paid:       'payment_thanks',
    startDate:  'job_confirmed',
  };
  const defaultId = defaultMap[eventType] || 'follow_up';
  calEmailSelectedTemplate = templates.find(t => t.id === defaultId) || templates[0];

  // Update modal title and send button based on channel
  const titleEl = document.getElementById('calEmailModalTitle');
  const sendBtn = document.getElementById('sendCalEmailBtn');
  if (calEmailChannel === 'whatsapp') {
    if (titleEl) titleEl.textContent = 'WhatsApp Templates';
    if (sendBtn) sendBtn.textContent = 'Open in WhatsApp';
  } else {
    if (titleEl) titleEl.textContent = 'Email Templates';
    if (sendBtn) sendBtn.textContent = 'Open in Email App';
  }

  const descEl = document.getElementById('calEmailModalDesc');
  if (calEmailChannel === 'whatsapp') {
    if (descEl) descEl.textContent = `To: ${custName}${calEmailPhone ? ' (' + (doc.quote?.custPhone || '') + ')' : '. No phone number saved.'}`;
  } else {
    if (descEl) descEl.textContent = `To: ${custName}${calEmailAddr ? ' (' + calEmailAddr + ')' : '. No email address saved.'}`;
  }

  const listEl = document.getElementById('calTemplateList');
  if (listEl) {
    listEl.innerHTML = templates.map(t => `
      <button type="button" class="cal-template-btn${calEmailSelectedTemplate?.id === t.id ? ' selected' : ''}"
        onclick="calSelectTemplate('${t.id}')"
        data-tmpl-id="${t.id}"
        data-subj="${encodeURIComponent(t.subject)}"
        data-body="${encodeURIComponent(t.body)}">
        <div class="cal-template-btn-title">${t.title}</div>
        <div class="cal-template-btn-desc">${t.desc}</div>
      </button>`).join('') + `
      <button type="button" class="cal-template-btn${calEmailSelectedTemplate?.id === 'custom' ? ' selected' : ''}"
        onclick="calSelectTemplate('custom')"
        data-tmpl-id="custom" data-subj="" data-body="">
        <div class="cal-template-btn-title">Write Your Own</div>
        <div class="cal-template-btn-desc">Opens your ${calEmailChannel === 'whatsapp' ? 'WhatsApp' : 'email'} app with a blank message</div>
      </button>`;
  }

  updateCalEmailPreview();
  document.getElementById('calEmailModal').style.display = 'flex';
}

function calSelectTemplate(templateId) {
  // "Write Your Own" fires immediately without showing subject/body fields
  if (templateId === 'custom') {
    document.getElementById('calEmailModal').style.display = 'none';
    if (calEmailChannel === 'whatsapp') {
      // Use location.href for reliable mobile WhatsApp deep-link (contact chooser, no pre-filled message)
      window.location.href = 'https://wa.me/';
    } else {
      if (!calEmailAddr) { showSavedPopup('No email address saved for this customer.'); return; }
      window.location.href = 'mailto:' + calEmailAddr;
    }
    return;
  }

  document.querySelectorAll('.cal-template-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.tmplId === templateId);
  });
  const btn = document.querySelector(`.cal-template-btn[data-tmpl-id="${templateId}"]`);
  if (btn) {
    calEmailSelectedTemplate = {
      id:      templateId,
      subject: decodeURIComponent(btn.dataset.subj || ''),
      body:    decodeURIComponent(btn.dataset.body || ''),
    };
  }
  updateCalEmailPreview();
}

function updateCalEmailPreview() {
  const previewEl = document.getElementById('calEmailPreview');
  if (!calEmailSelectedTemplate || !previewEl) return;
  previewEl.style.display = 'block';
  previewEl.textContent = calEmailSelectedTemplate.body || '';
}

function sendCalEmail() {
  if (!calEmailSelectedTemplate) return;

  if (calEmailChannel === 'whatsapp') {
    const text = encodeURIComponent(calEmailSelectedTemplate.body || '');
    window.open(`https://wa.me/?text=${text}`, '_blank');
  } else {
    if (!calEmailAddr) {
      showSavedPopup('No email address saved for this customer.');
      return;
    }
    const subject = encodeURIComponent(calEmailSelectedTemplate.subject || '');
    const body    = encodeURIComponent(calEmailSelectedTemplate.body || '');
    window.location.href = `mailto:${calEmailAddr}?subject=${subject}&body=${body}`;
  }

  document.getElementById('calEmailModal').style.display = 'none';
}

function setupCalendar() {
  // Calendar nav button
  const menuCalendar = document.getElementById('menuCalendar');
  if (menuCalendar) {
    menuCalendar.addEventListener('click', () => {
      // Close the slide-out nav menu
      const hamburger = document.getElementById('hamburgerBtn');
      const navMenu   = document.getElementById('navMenu');
      const overlay   = document.getElementById('navMenuOverlay');
      hamburger?.classList.remove('open');
      navMenu?.classList.remove('open');
      overlay?.classList.remove('open');
      hamburger?.setAttribute('aria-expanded', 'false');
      navMenu?.setAttribute('aria-hidden', 'true');
      showPage('page-calendar');
    });
  }

  // Close email/WhatsApp modal
  function closeCalEmailModalFn() {
    document.getElementById('calEmailModal').style.display = 'none';
    calEmailSelectedTemplate = null;
    calEmailChannel = 'email';
  }
  ['closeCalEmailModal', 'closeCalEmailModalBtn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', closeCalEmailModalFn);
  });

  // Send email button
  document.getElementById('sendCalEmailBtn')?.addEventListener('click', sendCalEmail);

  // Close on overlay click
  document.getElementById('calEmailModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCalEmailModalFn();
  });

  // Calendar sync modal
  document.getElementById('calSyncBtn')?.addEventListener('click', () => {
    document.getElementById('calSyncModal').style.display = 'flex';
  });
  document.getElementById('closeCalSyncBtn')?.addEventListener('click', () => {
    document.getElementById('calSyncModal').style.display = 'none';
  });
  document.getElementById('calSyncModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('downloadIcsBtn')?.addEventListener('click', downloadIcsFile);
}

/* ===== CALENDAR EXPORT (.ics) ===== */
function formatIcsDate(dateStr) {
  // dateStr is YYYY-MM-DD → YYYYMMDD
  return (dateStr || '').replace(/-/g, '');
}

function downloadIcsFile() {
  const docs = state.saved || [];
  const co   = state.company || {};
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lexi Handles It//Jobs//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  docs.forEach(d => {
    const q        = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref      = d.invoiceRef || d.receiptRef || q.ref || d.ref || 'Job';
    const startRaw = d.jobStartDate || q.date || d.date;
    const endRaw   = d.jobCompletedDate || startRaw;
    if (!startRaw) return; // skip undated docs

    const start = formatIcsDate(startRaw);
    const end   = formatIcsDate(endRaw || startRaw);
    // iCal DTEND for all-day is exclusive (day+1)
    const endExcl = formatIcsDate(
      new Date(new Date(endRaw || startRaw).getTime() + 86400000).toISOString().slice(0, 10)
    );

    const desc  = (q.items || []).map(i => i.name).join(', ') || ref;
    const status = d.paid ? 'Paid' : d.invoiceSent ? 'Invoiced' : (q.type || 'Estimate');
    const uid   = `${ref}-${d.id}@lexi-handles-it`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString().slice(0,10))}T000000Z`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${endExcl}`);
    lines.push(`SUMMARY:${ref} – ${custName}`);
    lines.push(`DESCRIPTION:${status} | ${desc}`);
    if (q.custAddr) lines.push(`LOCATION:${q.custAddr}${q.custPostcode ? ', ' + q.custPostcode : ''}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'lexi-jobs.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showSavedPopup('Calendar exported — open the file in Google, Outlook or Apple Calendar.', null, 4000);
}

/* ═══════════════════════════════════════════════════════════
   CHASE PAYMENTS
   ═══════════════════════════════════════════════════════════ */

const SEASONAL_TRADES = [
  'garden','gardener','gardening','landscape','landscaper','landscaping',
  'roofer','roofing','roof','exterior','painter','decorator','window',
  'tree surgeon','tree','fencer','fencing','driveway','paving','paver'
];

function isSeasonalTrade() {
  const t = (state.company?.trade || '').toLowerCase();
  return SEASONAL_TRADES.some(k => t.includes(k));
}

function getOverdueInvoices() {
  const today = todayStr();
  const results = [];
  (state.saved || []).forEach(d => {
    const q = d.quote || {};
    const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'Customer';
    const ref = d.invoiceRef || d.receiptRef || q.ref || d.ref || '-';
    const payments = getDocPayments(d);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const outstanding = Math.max(0, (d.total || 0) - totalPaid);
    if (outstanding <= 0 || d.paid) return;

    // Invoiced and overdue
    if (d.invoiceSent && d.invoiceDueDate && today > d.invoiceDueDate) {
      const days = Math.floor((new Date(today) - new Date(d.invoiceDueDate)) / 86400000);
      results.push({ docId: d.id, custName, ref, amount: outstanding, days, phone: q.custPhone || '', email: q.custEmail || '', urgency: days >= 30 ? 'critical' : days >= 14 ? 'warning' : 'gentle', doc: d });
    }
    // Job complete, no invoice raised and past expected due date
    else if (!d.invoiceSent && d.jobCompletedDate) {
      const terms = (q.selectedTerms || []);
      const termDays = terms.includes('payment30') ? 30 : terms.includes('payment14') ? 14 : terms.includes('payment7') ? 7 : 30;
      const expDue = addDays(d.jobCompletedDate, termDays);
      if (today >= expDue) {
        const days = Math.floor((new Date(today) - new Date(expDue)) / 86400000);
        results.push({ docId: d.id, custName, ref, amount: outstanding, days, phone: q.custPhone || '', email: q.custEmail || '', urgency: 'invoice-needed', doc: d });
      }
    }
  });
  // Sort: most overdue first
  results.sort((a, b) => b.days - a.days);
  return results;
}

function updateChasePaymentsBadge() {
  const overdue = getOverdueInvoices();
  const badge = document.getElementById('chasePaymentsBadge');
  if (!badge) return;
  if (overdue.length > 0) {
    badge.textContent = overdue.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function buildChaseMessage(item, channel) {
  const traderName = state.company?.preferredName || state.company?.firstName || 'your tradesperson';
  const custFirst = (item.custName || '').split(' ')[0] || item.custName;

  if (item.urgency === 'invoice-needed') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, hope all's good! Just wanted to let you know I'll be sending over your invoice for ${item.ref} shortly. Give me a shout if you have any questions. Cheers, ${traderName}`
      : { subject: `Invoice coming — ${item.ref}`, body: `Hi ${custFirst},\n\nHope you're well. I'll be sending your invoice for job ${item.ref} (£${fmtPrice(item.amount)}) over shortly.\n\nGive me a shout if you have any questions.\n\nThanks,\n${traderName}` };
  }
  if (item.urgency === 'gentle') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, hope you're well! Just a friendly nudge — invoice ${item.ref} for ${fmtPrice(item.amount)} is now due. No rush, just wanted to make sure you got it. Cheers, ${traderName}`
      : { subject: `Payment reminder — ${item.ref}`, body: `Hi ${custFirst},\n\nHope all is good with you. Just a gentle reminder that invoice ${item.ref} for ${fmtPrice(item.amount)} is now due.\n\nLet me know if you have any questions.\n\nThanks,\n${traderName}` };
  }
  if (item.urgency === 'warning') {
    return channel === 'whatsapp'
      ? `Hi ${custFirst}, just chasing invoice ${item.ref} for ${fmtPrice(item.amount)} which is now ${item.days} days overdue. Could you let me know when to expect payment? Thanks, ${traderName}`
      : { subject: `Overdue invoice — ${item.ref}`, body: `Hi ${custFirst},\n\nI'm just following up on invoice ${item.ref} for ${fmtPrice(item.amount)}, which is now ${item.days} days overdue.\n\nCould you please let me know when I can expect payment?\n\nThanks,\n${traderName}` };
  }
  // critical (30+ days)
  return channel === 'whatsapp'
    ? `Hi ${custFirst}, I need to chase invoice ${item.ref} for ${fmtPrice(item.amount)} which is now ${item.days} days overdue. Please could you make payment or get in touch to discuss. Thanks, ${traderName}`
    : { subject: `Urgent: overdue invoice ${item.ref}`, body: `Hi ${custFirst},\n\nI'm writing to chase invoice ${item.ref} for ${fmtPrice(item.amount)}, which is now ${item.days} days overdue.\n\nPlease could you arrange payment or contact me to discuss.\n\nThanks,\n${traderName}` };
}

function urgencyLabel(item) {
  if (item.urgency === 'invoice-needed') return { text: 'Invoice not sent', cls: 'chase-tag-invoice' };
  if (item.urgency === 'gentle')         return { text: `${item.days}d overdue`, cls: 'chase-tag-gentle' };
  if (item.urgency === 'warning')        return { text: `${item.days}d overdue`, cls: 'chase-tag-warning' };
  return { text: `${item.days}d overdue`, cls: 'chase-tag-critical' };
}

function openChaseForDoc(docId) {
  // Open chase modal pre-filtered — the relevant customer will be at the top (sorted by overdue days)
  openChasePaymentsModal();
  // Scroll to this customer's row after the modal renders
  setTimeout(() => {
    const row = document.querySelector(`.chase-row [data-id="${docId}"]`);
    if (row) row.closest('.chase-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

function openChasePaymentsModal() {
  const overdue = getOverdueInvoices();
  const body = document.getElementById('chaseModalBody');
  const sub  = document.getElementById('chaseModalSub');
  if (!body) return;

  const totalOwed = overdue.reduce((s, i) => s + i.amount, 0);

  if (sub) {
    sub.textContent = overdue.length
      ? `${overdue.length} outstanding — ${fmtPrice(totalOwed)} owed`
      : 'All payments up to date';
  }

  if (overdue.length === 0) {
    body.innerHTML = `
      <div style="padding:32px 20px;text-align:center">
        <div style="font-size:2.4rem;margin-bottom:10px">🎉</div>
        <p style="font-weight:700;color:var(--sage);margin:0 0 6px">Nothing to chase!</p>
        <p style="color:#888;font-size:0.88rem;margin:0">All your invoices are paid up. Nice work.</p>
      </div>`;
  } else {
    body.innerHTML = overdue.map(item => {
      const tag = urgencyLabel(item);
      const hasPhone = !!item.phone;
      const hasEmail = !!item.email;
      return `
        <div class="chase-row">
          <div class="chase-row-top">
            <div class="chase-row-name">${esc(item.custName)}</div>
            <span class="chase-tag ${tag.cls}">${tag.text}</span>
          </div>
          <div class="chase-row-ref">${esc(item.ref)} &bull; <strong>${fmtPrice(item.amount)}</strong> outstanding</div>
          <div class="chase-row-btns">
            <button type="button" class="chase-wa-btn${hasPhone ? '' : ' chase-btn-disabled'}"
              ${hasPhone ? `onclick="sendChase('${esc(item.docId)}','whatsapp')"` : ''}
              title="${hasPhone ? 'Send WhatsApp chase' : 'No phone number saved'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Chase by WhatsApp
            </button>
            <button type="button" class="chase-email-btn${hasEmail ? '' : ' chase-btn-disabled'}"
              ${hasEmail ? `onclick="sendChase('${esc(item.docId)}','email')"` : ''}
              title="${hasEmail ? 'Send email chase' : 'No email address saved'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              Email
            </button>
          </div>
        </div>`;
    }).join('');
  }

  document.getElementById('chasePaymentsModal').style.display = 'flex';
}

function sendChase(docId, channel) {
  const overdue = getOverdueInvoices();
  const item = overdue.find(i => i.docId === docId);
  if (!item) return;
  const msg = buildChaseMessage(item, channel);
  if (channel === 'whatsapp') {
    const text = encodeURIComponent(msg);
    window.open(`https://wa.me/${item.phone.replace(/\D/g,'')}?text=${text}`, '_blank');
  } else {
    const m = msg;
    window.location.href = `mailto:${item.email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  }
}

/* ═══════════════════════════════════════════════════════════
   WINTER PAUSE
   ═══════════════════════════════════════════════════════════ */

const KEY_PAUSE = 'lexi_paused';

function isPaused() {
  try { return !!JSON.parse(localStorage.getItem(KEY_PAUSE)); } catch { return false; }
}

function getPauseData() {
  try { return JSON.parse(localStorage.getItem(KEY_PAUSE)) || null; } catch { return null; }
}

function openPauseModal() {
  const docs = state.saved || [];
  const custCount = buildCustomerGroups().length;
  const totalJobs = docs.length;
  const totalOwed = getOverdueInvoices().reduce((s, i) => s + i.amount, 0);
  const overdueCount = getOverdueInvoices().length;

  // Build stats row
  const statsRow = document.getElementById('pauseStatsRow');
  if (statsRow) {
    statsRow.innerHTML = `
      <div class="pause-stat"><span class="pause-stat-num">${custCount}</span><span class="pause-stat-lbl">Customers</span></div>
      <div class="pause-stat"><span class="pause-stat-num">${totalJobs}</span><span class="pause-stat-lbl">Jobs</span></div>
      <div class="pause-stat"><span class="pause-stat-num">${fmtPrice(docs.reduce((s,d)=>s+(d.total||0),0))}</span><span class="pause-stat-lbl">Billed</span></div>`;
  }

  // Warn about outstanding invoices
  const chaseWrap = document.getElementById('chaseBeforePause');
  const chaseText = document.getElementById('chaseBeforePauseText');
  if (chaseWrap && chaseText) {
    if (overdueCount > 0) {
      chaseText.textContent = `You have ${overdueCount} outstanding invoice${overdueCount>1?'s':''} totalling ${fmtPrice(totalOwed)}. Chase them before you pause?`;
      chaseWrap.style.display = 'flex';
    } else {
      chaseWrap.style.display = 'none';
    }
  }

  document.getElementById('pauseWinterModal').style.display = 'flex';
}

function confirmPause() {
  const pauseData = { since: todayStr(), custCount: buildCustomerGroups().length, jobCount: (state.saved||[]).length };
  localStorage.setItem(KEY_PAUSE, JSON.stringify(pauseData));
  document.getElementById('pauseWinterModal').style.display = 'none';
  // Close menu overlay cleanly before showing the paused screen
  document.getElementById('navMenu')?.classList.remove('open');
  document.getElementById('navMenuOverlay')?.classList.remove('active');
  document.getElementById('hamburgerBtn')?.setAttribute('aria-expanded','false');
  setTimeout(showPausedScreen, 250);
}

function showPausedScreen() {
  const data = getPauseData();
  if (!data) return;

  const sub   = document.getElementById('pausedSub');
  const stats = document.getElementById('pausedStats');
  const since = document.getElementById('pausedSince');

  if (sub) sub.textContent = `Your ${data.custCount} customers and ${data.jobCount} jobs are safe and waiting for you.`;
  if (stats) {
    const totalOwed = getOverdueInvoices().reduce((s,i)=>s+i.amount,0);
    stats.innerHTML = totalOwed > 0
      ? `<div class="paused-stat-note">💰 You have <strong>${fmtPrice(totalOwed)}</strong> outstanding — chase it below even while paused.</div>`
      : `<div class="paused-stat-note">✅ All payments up to date. Enjoy the break.</div>`;
  }
  if (since) since.textContent = `Paused since ${formatDate(data.since)}`;

  document.getElementById('pausedScreen').style.display = 'flex';
}

function resumeLexi() {
  localStorage.removeItem(KEY_PAUSE);
  document.getElementById('pausedScreen').style.display = 'none';
  const name = state.company?.preferredName || state.company?.firstName || '';
  showSavedPopup(`Welcome back${name ? ', ' + name : ''}! Ready when you are. 💪`, null, 4000);
  updateChasePaymentsBadge();
  refreshSavedDocs();
}

function checkSeasonalPrompt() {
  const month = new Date().getMonth(); // 0=Jan … 11=Dec
  const isSeason = isSeasonalTrade();

  // Pause for Winter menu item — November only (month 10)
  const pauseBtn = document.getElementById('menuPauseWinter');
  if (pauseBtn) {
    pauseBtn.style.display = (month === 10 && !isPaused()) ? '' : 'none';
  }

  // Seasonal banner in My Jobs page — August (7), September (8), October (9)
  const banner = document.getElementById('seasonalBanner');
  if (banner) {
    const showBanner = isSeason && [7, 8, 9].includes(month) && !isPaused()
      && !localStorage.getItem('lexi_seasonal_dismissed');
    banner.style.display = showBanner ? 'flex' : 'none';
  }
}

/* ── Wire up Chase + Pause in setupModals ── */
function setupChaseAndPause() {
  // Chase payments menu
  document.getElementById('menuChasePayments')?.addEventListener('click', () => {
    if (!hasRequiredSetup()) { requireSetupGuard(); return; }
    closeMenu();
    setTimeout(openChasePaymentsModal, 180);
  });
  document.getElementById('closeChaseModalBtn')?.addEventListener('click', () => {
    document.getElementById('chasePaymentsModal').style.display = 'none';
  });
  document.getElementById('chasePaymentsModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Pause for winter menu
  document.getElementById('menuPauseWinter')?.addEventListener('click', () => {
    closeMenu();
    setTimeout(openPauseModal, 180);
  });
  document.getElementById('closePauseModalBtn')?.addEventListener('click', () => {
    document.getElementById('pauseWinterModal').style.display = 'none';
  });
  document.getElementById('pauseWinterModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('confirmPauseBtn')?.addEventListener('click', confirmPause);

  // Chase before pausing shortcut
  document.getElementById('chaseBeforePauseBtn')?.addEventListener('click', () => {
    document.getElementById('pauseWinterModal').style.display = 'none';
    openChasePaymentsModal();
  });

  // Seasonal banner
  document.getElementById('seasonalBannerBtn')?.addEventListener('click', () => {
    document.getElementById('seasonalBanner').style.display = 'none';
    openPauseModal();
  });
  document.getElementById('seasonalBannerClose')?.addEventListener('click', () => {
    document.getElementById('seasonalBanner').style.display = 'none';
    localStorage.setItem('lexi_seasonal_dismissed', '1');
  });

  // Paused screen
  document.getElementById('resumeLexiBtn')?.addEventListener('click', resumeLexi);
  document.getElementById('pausedChaseBtn')?.addEventListener('click', () => {
    document.getElementById('pausedScreen').style.display = 'none';
    openChasePaymentsModal();
  });

  // Check if already paused on load
  if (isPaused()) showPausedScreen();

  // Show seasonal banner if applicable
  checkSeasonalPrompt();

  // Update chase badge
  updateChasePaymentsBadge();
}

/* ═══════════════════════════════════════════════════════════
   SEARCH
   ═══════════════════════════════════════════════════════════ */
function setupJobSearch() {
  const input = document.getElementById('jobSearchInput');
  if (!input) return;
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshSavedDocs(), 200);
  });
}

function getJobSearchQuery() {
  return (document.getElementById('jobSearchInput')?.value || '').trim().toLowerCase();
}

/* ═══════════════════════════════════════════════════════════
   REVIEW REQUEST
   ═══════════════════════════════════════════════════════════ */
let _reviewDoc = null;

function maybeAskForReview(doc) {
  const reviewLink = state.company.reviewLink || '';
  const q = doc.quote || {};
  const custName = [q.custFirstName, q.custLastName].filter(Boolean).join(' ') || 'your customer';
  const traderName = state.company.preferredName || state.company.firstName || '';
  const msg = document.getElementById('reviewRequestMsg');
  if (msg) msg.textContent = `${custName}'s job is paid in full. Want to ask them for a Google review while they're happy?`;
  _reviewDoc = doc;
  document.getElementById('reviewRequestModal').style.display = 'flex';
  document.getElementById('reviewWhatsappBtn').onclick = () => {
    const text = reviewLink
      ? `Hi ${q.custFirstName || custName}, glad you're happy with the work! If you have two minutes, a Google review would really help my business: ${reviewLink} — thanks so much! ${traderName}`
      : `Hi ${q.custFirstName || custName}, really glad you're happy with the work! If you get a chance, a Google review would mean the world to me. Thanks! ${traderName}`;
    window.location.href = 'https://wa.me/' + (q.custPhone || '').replace(/\D/g,'') + '?text=' + encodeURIComponent(text);
    document.getElementById('reviewRequestModal').style.display = 'none';
  };
  document.getElementById('reviewLaterBtn').onclick = () => {
    document.getElementById('reviewRequestModal').style.display = 'none';
  };
}

function setupReviewModal() {
  document.getElementById('reviewRequestModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}

/* ═══════════════════════════════════════════════════════════
   CUSTOMER STICKY NOTES + RECURRING JOBS
   Rendered inside the customer dashboard
   ═══════════════════════════════════════════════════════════ */
function buildCustomerExtras(groupName) {
  const data = getCustData(groupName);
  const note = data.note || '';
  const recurringDays = data.recurringDays || 0;

  const recurringOptions = [
    { val: 0,  label: 'Not a regular customer' },
    { val: 7,  label: 'Weekly' },
    { val: 14, label: 'Every 2 weeks' },
    { val: 28, label: 'Monthly' },
    { val: 42, label: 'Every 6 weeks' },
  ];

  return `
    <div class="cdv-extras-section">
      <div class="cdv-extras-row">
        <label class="cdv-extras-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Customer Notes
        </label>
        <textarea class="cdv-sticky-note" data-cust="${esc(groupName)}" rows="3"
          placeholder="e.g. Dog in garden, parking at front, prefers WhatsApp…">${esc(note)}</textarea>
      </div>
      <div class="cdv-extras-row">
        <label class="cdv-extras-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Regular Visit
        </label>
        <select class="cdv-recurring-select" data-cust="${esc(groupName)}">
          ${recurringOptions.map(o => `<option value="${o.val}"${o.val === recurringDays ? ' selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>`;
}

function wireCustomerExtras(body, groupName) {
  // Sticky note — auto-save on change
  let noteTimer;
  body.querySelector('.cdv-sticky-note')?.addEventListener('input', e => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      saveCustData(groupName, { note: e.target.value });
    }, 600);
  });
  // Recurring — save immediately on change
  body.querySelector('.cdv-recurring-select')?.addEventListener('change', e => {
    saveCustData(groupName, { recurringDays: parseInt(e.target.value) || 0 });
    updateChasePaymentsBadge(); // refresh badge in case recurring state changed
    renderAttentionWidget();
  });
}

/* ═══════════════════════════════════════════════════════════
   EARNINGS SUMMARY
   ═══════════════════════════════════════════════════════════ */
function openEarningsModal() {
  const body = document.getElementById('earningsModalBody');
  if (!body) return;

  const docs = state.saved || [];
  const now  = new Date();
  // UK tax year: 6 Apr to 5 Apr
  const taxYearStart = new Date(now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6)
    ? now.getFullYear() - 1 : now.getFullYear(), 3, 6); // April = month 3

  let totalInvoiced = 0, totalPaid = 0, totalOutstanding = 0, jobCount = 0;
  const byMonth = {};

  docs.forEach(d => {
    const q = d.quote || {};
    const docDate = q.date || d.date;
    if (!docDate) return;
    const dDate = new Date(docDate);
    if (dDate < taxYearStart) return; // only this tax year

    const payments = getDocPayments(d);
    const paid     = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const total    = d.total || 0;
    const outstanding = Math.max(0, total - paid);

    totalInvoiced   += total;
    totalPaid       += paid;
    totalOutstanding += outstanding;
    jobCount++;

    // Monthly breakdown by invoice date
    const monthKey = docDate.slice(0, 7); // YYYY-MM
    if (!byMonth[monthKey]) byMonth[monthKey] = { invoiced: 0, paid: 0 };
    byMonth[monthKey].invoiced += total;
    byMonth[monthKey].paid     += paid;
  });

  const months = Object.keys(byMonth).sort();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const taxYearLabel = `${taxYearStart.getFullYear()}–${taxYearStart.getFullYear() + 1}`;

  body.innerHTML = `
    <p style="color:#888;font-size:0.8rem;margin:0 0 14px">Tax year ${taxYearLabel} (6 Apr – 5 Apr)</p>
    <div class="earn-summary-grid">
      <div class="earn-stat">
        <span class="earn-stat-num">${fmtPrice(totalInvoiced)}</span>
        <span class="earn-stat-lbl">Total Invoiced</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num earn-paid">${fmtPrice(totalPaid)}</span>
        <span class="earn-stat-lbl">Collected</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num ${totalOutstanding > 0 ? 'earn-owed' : ''}">${fmtPrice(totalOutstanding)}</span>
        <span class="earn-stat-lbl">Outstanding</span>
      </div>
      <div class="earn-stat">
        <span class="earn-stat-num">${jobCount}</span>
        <span class="earn-stat-lbl">Jobs</span>
      </div>
    </div>

    ${months.length ? `
    <div class="earn-breakdown">
      <div class="earn-breakdown-title">Month by month</div>
      ${months.map(m => {
        const [yr, mo] = m.split('-');
        const label = monthNames[parseInt(mo) - 1] + ' ' + yr;
        const d = byMonth[m];
        return `<div class="earn-month-row">
          <span class="earn-month-name">${label}</span>
          <span class="earn-month-invoiced">${fmtPrice(d.invoiced)}</span>
          <span class="earn-month-paid ${d.paid < d.invoiced ? 'earn-partial' : 'earn-full'}">${fmtPrice(d.paid)} collected</span>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="earn-tax-note">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      These figures are for reference only. Always check with your accountant at tax time.
    </div>

    <button type="button" class="btn btn-outline w-100" id="exportEarningsBtn" style="margin-top:14px">Download as Text</button>`;

  // Wire export button
  document.getElementById('exportEarningsBtn')?.addEventListener('click', () => {
    const lines = [
      `Lexi Handles It — Earnings Summary`,
      `Tax year ${taxYearLabel}`,
      ``,
      `Total invoiced:   ${fmtPrice(totalInvoiced)}`,
      `Total collected:  ${fmtPrice(totalPaid)}`,
      `Outstanding:      ${fmtPrice(totalOutstanding)}`,
      `Number of jobs:   ${jobCount}`,
      ``,
      `Month-by-month:`,
      ...months.map(m => {
        const [yr, mo] = m.split('-');
        return `  ${monthNames[parseInt(mo)-1]} ${yr}: invoiced ${fmtPrice(byMonth[m].invoiced)}, collected ${fmtPrice(byMonth[m].paid)}`;
      }),
      ``,
      `Generated by Lexi Handles It`
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `lexi-earnings-${taxYearLabel}.txt`; a.click();
  });

  document.getElementById('earningsModal').style.display = 'flex';
}

function setupEarnings() {
  document.getElementById('menuEarnings')?.addEventListener('click', () => {
    closeMenu();
    setTimeout(openEarningsModal, 180);
  });
  document.getElementById('closeEarningsBtn')?.addEventListener('click', () => {
    document.getElementById('earningsModal').style.display = 'none';
  });
  document.getElementById('earningsModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}


