/* --- Firebase 準備構成 --- */
const firebaseConfig = {
  apiKey: "AIzaSyBaFLcUB-1RGj5rxObwe1myL0gpfAVMJ04",
  authDomain: "totonoeru.firebaseapp.com",
  projectId: "totonoeru",
  storageBucket: "totonoeru.firebasestorage.app",
  messagingSenderId: "161575735872",
  appId: "1:161575735872:web:1a8835063001ae5cfb05a5",
  measurementId: "G-6YG4FEB56R"
};

const useFirebase = true; 
let db = null; let auth = null; let provider = null;
let firebaseDocId = "local_user";

async function initFirebase() {
    if (!useFirebase || !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") return false;
    try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js");
        const { getFirestore, doc, getDoc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js");
        const app = initializeApp(firebaseConfig); db = getFirestore(app); auth = getAuth(app); provider = new GoogleAuthProvider();
        window.fbSetDoc = setDoc; window.fbGetDoc = getDoc; window.fbDoc = doc;
        window.fbSignIn = () => signInWithPopup(auth, provider); window.fbSignOut = () => signOut(auth); window.fbOnAuth = onAuthStateChanged;
        return true;
    } catch (e) { return false; }
}

/* --- 初期設定・状態管理 --- */
Chart.defaults.color = '#8e8e93'; Chart.defaults.borderColor = '#333';
let appState = null;
let currentDate = new Date().toISOString().split('T')[0];
let calDate = new Date(); let calSelectedDate = currentDate;
let activeTab = 'view-today';
let isMealMode = false;
let lastTapDate = null; let lastTapTime = 0; // ダブルタップ判定用
let charts = {};
window.jumpToDate = jumpToDate;

async function loadState() {
    if (useFirebase && db && firebaseDocId !== "local_user") { try { const snap = await window.fbGetDoc(window.fbDoc(db, "users", firebaseDocId)); if (snap.exists()) return snap.data(); } catch(e){} }
    return JSON.parse(localStorage.getItem('lifeos_pro'));
}
async function saveState() {
    if (useFirebase && db && firebaseDocId !== "local_user") { try { await window.fbSetDoc(window.fbDoc(db, "users", firebaseDocId), appState); } catch(e){} } 
    else { localStorage.setItem('lifeos_pro', JSON.stringify(appState)); }
}
async function setState(updater, reRender = true) { updater(appState); await saveState(); if (reRender) renderActiveTab(); }

function initData() {
    if (!appState) appState = { dates: {}, memos:[], finance:[] };
    if (!appState.settings) appState.settings = {};
    if (!appState.settings.theme) appState.settings.theme = 'default';
    if (!appState.settings.categories) appState.settings.categories =[ { name: "食費", budget: 30000 }, { name: "日用品", budget: 10000 }, { name: "交際費", budget: 15000 }, { name: "交通", budget: 10000 }, { name: "趣味", budget: 10000 }, { name: "その他", budget: 5000 } ];
    if (!appState.settings.paymentMethods) appState.settings.paymentMethods =["現金", "クレカ", "PayPay"];
    
    const cmStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    if (!appState.settings.subscriptions) appState.settings.subscriptions =[];
    appState.settings.subscriptions.forEach(s => { 
        if(s.isActive === undefined) s.isActive = true; 
        if(s.startMonth === undefined) s.startMonth = cmStr; // サブスク開始月のマイグレーション
    });

    if (!appState.settings.mealCategories) {
        appState.settings.mealCategories =[
            { id: "dorm_bf", name: "寮食(朝)", price: 300 }, { id: "dorm_lu", name: "寮食(昼)", price: 400 }, { id: "dorm_di", name: "寮食(夜)", price: 500 },
            { id: "out", name: "外食", price: 1000 }, { id: "store", name: "コンビニ", price: 500 }, { id: "cook", name: "自炊", price: 300 }, { id: "none", name: "なし", price: 0 }
        ];
    }
    appState.finance.forEach(f => {
        if (!f.carriers) f.carriers =[{ name: "メイン", limit: 30, used: 0 }];
        f.expenses.forEach(e => { if (!e.id) e.id = Date.now(); if (!e.payment) e.payment = "現金"; if (!e.tags) e.tags =[]; if (!e.rating) e.rating = 2; });
    });
    Object.values(appState.dates).forEach(d => {
        if (d.tasks) d.tasks.forEach(t => { if(t.remindAt===undefined) t.remindAt=""; });
        if (d.meals) {['bf', 'lu', 'di'].forEach(k => { let m = d.meals[k]; if (m && m.type && !m.categoryId) { m.categoryId = (m.type==='dorm'?`dorm_${k}`:m.type); delete m.type; } }); }
    });
}

function ensureDate(dateStr) {
    if (!appState.dates[dateStr]) appState.dates[dateStr] = {}; const d = appState.dates[dateStr];
    if (!d.tasks) d.tasks =[]; if (!d.todayMemo) d.todayMemo = "";
    if (!d.meals) d.meals = {};['bf', 'lu', 'di'].forEach(k => { if (!d.meals[k]) d.meals[k] = { categoryId: 'none', amount: 0, memo: '' }; });
}
function ensureFinanceMonth(monthStr) {
    let f = appState.finance.find(x => x.month === monthStr);
    if (!f) { f = { month: monthStr, income: 0, extraIncome: 0, fixed: 0, loan: 0, savings: 0, investment: 0, expenses: [], carriers:[{ name: "メイン", limit: 30, used: 0 }] }; appState.finance.push(f); }
}

// サブスク自動登録 (開始月・稼働中を考慮)
function processAutoSubscriptions() {
    if (!appState.settings.subscriptions || appState.settings.subscriptions.length === 0) return;
    const today = new Date(); const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`; const currentDay = today.getDate();
    ensureFinanceMonth(monthStr); const finMonth = appState.finance.find(f => f.month === monthStr);
    let updated = false;

    appState.settings.subscriptions.forEach(sub => {
        if (sub.isActive && sub.startMonth <= monthStr && currentDay >= sub.day) {
            const exists = finMonth.expenses.some(e => e.isSubscription === true && e.name === sub.name);
            if (!exists) {
                finMonth.expenses.push({
                    id: Date.now() + Math.random(), date: String(sub.day).padStart(2, '0'),
                    name: sub.name, amount: sub.amount, category: "固定費", payment: "クレカ",
                    tags: ["サブスク", "自動"], rating: 2, isAdvance: false, isSubscription: true, memo: "自動追加"
                });
                updated = true;
            }
        }
    });
    if (updated) saveState();
}

window.addEventListener('DOMContentLoaded', async () => {
    const isFbReady = await initFirebase();
    if (useFirebase && isFbReady) {
        window.fbOnAuth(auth, async (user) => {
            if (user) { firebaseDocId = user.uid; document.getElementById('login-screen').style.display = 'none'; document.getElementById('app-screen').style.display = 'block'; await startApp(); } 
            else { document.getElementById('login-screen').style.display = 'flex'; document.getElementById('app-screen').style.display = 'none'; }
        });
        document.getElementById('btn-login').addEventListener('click', async () => { try { await window.fbSignIn(); } catch(e) {} });
        document.getElementById('btn-logout').addEventListener('click', async () => { await window.fbSignOut(); location.reload(); });
    } else { document.getElementById('login-screen').style.display = 'none'; document.getElementById('app-screen').style.display = 'block'; await startApp(); }
});

function applyTheme(theme) {
    document.body.className = '';
    if(theme === 'nerv_magi') document.body.classList.add('theme-nerv_magi');
    else if(theme === 'nerv_term') document.body.classList.add('theme-nerv_term');
}

async function startApp() {
    appState = await loadState(); initData(); processAutoSubscriptions();
    applyTheme(appState.settings.theme);
    
    ensureDate(currentDate); ensureFinanceMonth(currentDate.slice(0,7));
    document.getElementById('input-date').value = currentDate;
    document.getElementById('task-date').value = currentDate; // タスク日付のデフォルト
    if (!window.appStarted) { setupEventListeners(); window.appStarted = true; }
    renderActiveTab();
}

function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            e.currentTarget.classList.add('active'); activeTab = e.currentTarget.dataset.target;
            document.getElementById(activeTab).classList.add('active'); renderActiveTab();
        });
    });
    document.getElementById('input-date').addEventListener('change', e => jumpToDate(e.target.value));
    document.getElementById('btn-prev-day').addEventListener('click', () => jumpToDate(shiftDate(currentDate, -1)));
    document.getElementById('btn-next-day').addEventListener('click', () => jumpToDate(shiftDate(currentDate, 1)));
    
    // リマインダー追加
    document.getElementById('btn-add-task').addEventListener('click', () => {
        const text = document.getElementById('task-text').value.trim();
        const tDate = document.getElementById('task-date').value;
        const tTime = document.getElementById('task-time').value;
        const remindAt = (tDate && tTime) ? `${tDate} ${tTime}` : (tDate ? tDate : "");
        
        if(text) setState(s => s.dates[currentDate].tasks.push({ id: Date.now(), text, category: document.getElementById('task-cat').value, remindAt, done: false }));
        document.getElementById('task-text').value = ""; document.getElementById('task-time').value = "";
    });
    document.getElementById('today-memo').addEventListener('input', e => setState(s => s.dates[currentDate].todayMemo = e.target.value, false));
    
    // 食事一括モードのトグル
    document.getElementById('toggle-cal-meal-mode').addEventListener('change', e => {
        isMealMode = e.target.checked;
        document.getElementById('cal-meal-toolbar').style.display = isMealMode ? 'grid' : 'none';
        if(isMealMode) {
            ['cal-bulk-bf', 'cal-bulk-lu', 'cal-bulk-di'].forEach(id => {
                const sel = document.getElementById(id); sel.innerHTML = "";
                appState.settings.mealCategories.forEach(c => sel.appendChild(new Option(c.name, c.id)));
            });
        }
        renderCalendar();
    });

    document.getElementById('cal-prev').addEventListener('click', () => { calDate.setMonth(calDate.getMonth()-1); renderCalendar(); });
    document.getElementById('cal-next').addEventListener('click', () => { calDate.setMonth(calDate.getMonth()+1); renderCalendar(); });
    document.getElementById('btn-save-memo').addEventListener('click', () => {
        const title = document.getElementById('memo-title').value.trim() || "無題"; const content = document.getElementById('memo-content').value.trim();
        if(content) setState(s => s.memos.push({ id: Date.now(), title, content, date: currentDate }));
        document.getElementById('memo-title').value = ""; document.getElementById('memo-content').value = "";
    });
    document.getElementById('memo-search').addEventListener('input', renderMemos);
    document.getElementById('btn-export-all').addEventListener('click', () => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(appState, null, 2)], {type: "application/json"}));
        a.download = `LifeOS_ProMax_${currentDate}.json`; a.click();
    });
    document.getElementById('file-import').addEventListener('change', importData);
    document.getElementById('settings-theme').addEventListener('change', e => setState(s => { s.settings.theme = e.target.value; applyTheme(s.settings.theme); }));
    setupModals();
}

function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const k in attrs) {
        if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
        else if (k === 'className') e.className = attrs[k]; else e[k] = attrs[k];
    }
    children.forEach(c => { if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(c)); else if (c instanceof Node) e.appendChild(c); });
    return e;
}
function shiftDate(dateStr, days) { let d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; }
function jumpToDate(dateStr) { currentDate = dateStr; document.getElementById('input-date').value = currentDate; document.getElementById('task-date').value = currentDate; ensureDate(currentDate); if(activeTab==='view-today') renderToday(); }
function renderActiveTab() {
    if (activeTab === 'view-today') { renderToday(); renderUpcomingReminders(); }
    else if (activeTab === 'view-calendar') renderCalendar();
    else if (activeTab === 'view-memo') renderMemos();
    else if (activeTab === 'view-finance') renderFinance();
    else if (activeTab === 'view-settings') renderSettings();
}

function getCatColorClass(cat) {
    if(cat==='注意') return 'bg-warn'; if(cat==='リマインダー') return 'bg-purple'; if(cat==='業務') return 'bg-primary'; if(cat==='私用') return 'bg-sub'; return 'bg-gray';
}

/* --- 1. 今日タブ --- */
function renderToday() {
    ensureDate(currentDate); const d = appState.dates[currentDate];
    document.getElementById('today-memo').value = d.todayMemo || "";
    
    let mealTotal = 0;['bf', 'lu', 'di'].forEach(k => mealTotal += Number(d.meals[k]?.amount || 0));
    let expTotal = 0; const finMonth = appState.finance.find(f => f.month === currentDate.slice(0,7));
    if (finMonth) expTotal = finMonth.expenses.filter(e => e.date === currentDate.slice(8,10) && !e.isAdvance).reduce((sum, e) => sum + Number(e.amount), 0);
    document.getElementById('today-total').innerText = `¥${(mealTotal + expTotal).toLocaleString()}`;
    document.getElementById('today-breakdown').innerText = `ご飯: ¥${mealTotal.toLocaleString()} / その他(変動費): ¥${expTotal.toLocaleString()}`;

    const list = document.getElementById('task-list'); list.innerHTML = "";
    [...(d.tasks || [])].sort((a, b) => a.done - b.done).forEach(t => {
        let timeStr = t.remindAt ? ` 🕒${t.remindAt}` : '';
        list.appendChild(el('div', { className: `task-item ${t.done ? 'done' : ''}` },
            el('input', { type: 'checkbox', className: 'task-checkbox', checked: t.done, onChange: () => setState(s => { const x = s.dates[currentDate].tasks.find(x=>x.id===t.id); if(x) x.done = !x.done; }) }),
            el('span', { className: `badge ${getCatColorClass(t.category)}` }, t.category),
            el('span', { className: 'text', style: 'flex-grow:1' }, t.text + timeStr),
            el('button', { className: 'btn-del', onClick: () => setState(s => s.dates[currentDate].tasks = s.dates[currentDate].tasks.filter(x=>x.id!==t.id)) }, "✕")
        ));
    });

    const mc = document.getElementById('meal-container'); mc.innerHTML = "";
    const mealKeys =['bf', 'lu', 'di']; const mealLabels = ['🌅', '☀️', '🌙'];
    mealKeys.forEach((k, i) => {
        const mObj = d.meals[k];
        const sel = el('select', { onChange: e => setState(s => { const catId = e.target.value; s.dates[currentDate].meals[k].categoryId = catId; const catInfo = s.settings.mealCategories.find(x => x.id === catId); s.dates[currentDate].meals[k].amount = catInfo ? catInfo.price : 0; }) },
            ...appState.settings.mealCategories.map(c => el('option', {value: c.id, selected: mObj.categoryId === c.id}, c.name))
        );
        const inpAmt = el('input', { type: 'number', placeholder: '金額', value: mObj.amount, onChange: e => setState(s => s.dates[currentDate].meals[k].amount = Number(e.target.value)) });
        const inpMemo = el('input', { type: 'text', placeholder: 'メモ', value: mObj.memo, onChange: e => setState(s => s.dates[currentDate].meals[k].memo = e.target.value, false) });
        const row = el('div', {className: 'meal-grid'}); row.append(el('div', {className: 'meal-icon'}, mealLabels[i]), sel, inpAmt, inpMemo); mc.appendChild(row);
    });
}

function renderUpcomingReminders() {
    const list = document.getElementById('upcoming-reminders-list'); list.innerHTML = "";
    let upcoming = [];
    Object.keys(appState.dates).forEach(ds => {
        if(ds < currentDate) return;
        appState.dates[ds].tasks.forEach(t => { if(!t.done && t.remindAt) upcoming.push({ date: ds, ...t }); });
    });
    upcoming.sort((a,b) => a.remindAt.localeCompare(b.remindAt));
    if(upcoming.length === 0) { list.innerHTML = '<div style="color:var(--gray); font-size:0.8rem;">予定されているリマインダーはありません</div>'; return; }
    
    upcoming.forEach(t => {
        list.appendChild(el('div', { className: 'task-item', style: 'padding:8px 0; border-bottom:1px dashed #333; font-size:0.9rem;' },
            el('span', { className: `badge ${getCatColorClass(t.category)}` }, t.category),
            el('span', { style:'color:var(--purple); font-weight:bold;' }, t.remindAt),
            el('span', { className: 'text' }, t.text)
        ));
    });
}

/* --- 2. カレンダー --- */
function renderCalendar() {
    const y = calDate.getFullYear(), m = calDate.getMonth(); document.getElementById('cal-title').innerText = `${y}年 ${m+1}月`;
    const firstDay = new Date(y, m, 1).getDay(), lastDate = new Date(y, m+1, 0).getDate();
    const body = document.getElementById('cal-body'); body.innerHTML = "";
    const todayObj = new Date(currentDate);

    for (let i = 0; i < firstDay; i++) body.appendChild(el('div'));
    for (let d = 1; d <= lastDate; d++) {
        const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const data = appState.dates[dateStr] || {};
        const finMonth = appState.finance.find(f => f.month === dateStr.slice(0,7));
        
        let exps = finMonth ? finMonth.expenses.filter(e => e.date === String(d).padStart(2,'0') && !e.isAdvance) :[];
        let hasTask = data.tasks && data.tasks.length > 0; let hasMemo = !!data.todayMemo; let hasExp = exps.length > 0;
        
        let hasSub = false;
        appState.settings.subscriptions.forEach(sub => { if(sub.isActive && sub.startMonth <= dateStr.slice(0,7) && sub.day === d) hasSub = true; });

        const dots = el('div', { className: 'dots' });
        if(hasTask) dots.appendChild(el('div', {className:'dot', style:'background:var(--primary)'}));
        if(hasMemo) dots.appendChild(el('div', {className:'dot', style:'background:var(--sub)'}));
        if(hasExp) dots.appendChild(el('div', {className:'dot', style:'background:var(--warn)'}));
        if(hasSub) dots.appendChild(el('div', {className:'dot', style:'background:var(--purple)'}));

        // 食事が1つでも「none」以外ならハイライト
        let isMealFilled = data.meals && (data.meals.bf?.categoryId !== 'none' || data.meals.lu?.categoryId !== 'none' || data.meals.di?.categoryId !== 'none');

        let isPastOrToday = (y < todayObj.getFullYear()) || (y === todayObj.getFullYear() && m < todayObj.getMonth()) || (y === todayObj.getFullYear() && m === todayObj.getMonth() && d <= todayObj.getDate());
        let isNMD = isPastOrToday && !hasExp && (!data.meals || (data.meals.bf?.amount===0 && data.meals.lu?.amount===0 && data.meals.di?.amount===0));

        let classes = 'cal-day'; 
        if (dateStr === currentDate) classes += ' today'; 
        if (dateStr === calSelectedDate) classes += ' selected';
        if (isMealFilled) classes += ' meal-filled'; // ★ 塗りつぶし状態のクラス

        const dayEl = el('div', { 
            className: classes, 
            onClick: () => { 
                if (isMealMode) {
                    const now = Date.now();
                    // ダブルタップ判定 (400ms以内)
                    if (lastTapDate === dateStr && now - lastTapTime < 400) {
                        setState(s => {
                            if (!s.dates[dateStr]) return;
                            if (!s.dates[dateStr].meals) return;
                            s.dates[dateStr].meals.bf = { categoryId: 'none', amount: 0, memo: "" };
                            s.dates[dateStr].meals.lu = { categoryId: 'none', amount: 0, memo: "" };
                            s.dates[dateStr].meals.di = { categoryId: 'none', amount: 0, memo: "" };
                        });
                        lastTapDate = null; // リセット
                    } else {
                        // シングルタップ (塗りつぶし)
                        const bfId = document.getElementById('cal-bulk-bf').value, luId = document.getElementById('cal-bulk-lu').value, diId = document.getElementById('cal-bulk-di').value;
                        const getP = (id) => appState.settings.mealCategories.find(x=>x.id===id).price;
                        setState(s => {
                            if (!s.dates[dateStr]) s.dates[dateStr] = { tasks:[], todayMemo:"", meals:{ bf:{categoryId:'none',amount:0,memo:''}, lu:{categoryId:'none',amount:0,memo:''}, di:{categoryId:'none',amount:0,memo:''} } };
                            if (!s.dates[dateStr].meals) s.dates[dateStr].meals = { bf:{categoryId:'none',amount:0,memo:''}, lu:{categoryId:'none',amount:0,memo:''}, di:{categoryId:'none',amount:0,memo:''} };
                            s.dates[dateStr].meals.bf = { categoryId: bfId, amount: getP(bfId), memo: "" };
                            s.dates[dateStr].meals.lu = { categoryId: luId, amount: getP(luId), memo: "" };
                            s.dates[dateStr].meals.di = { categoryId: diId, amount: getP(diId), memo: "" };
                        });
                        lastTapDate = dateStr;
                        lastTapTime = now;
                    }
                } else {
                    calSelectedDate = dateStr; renderCalendar(); 
                }
            } 
        }, el('div', {}, d), dots);
        if(isNMD) dayEl.appendChild(el('div', {className:'nmd-icon'}, "👑"));
        body.appendChild(dayEl);
    }
    
    if (isMealMode) { document.getElementById('cal-preview-container').style.display = 'none'; return; }

    document.getElementById('cal-preview-container').style.display = 'block'; document.getElementById('preview-title').innerText = calSelectedDate;
    const content = document.getElementById('preview-content'); content.innerHTML = "";
    const pData = appState.dates[calSelectedDate] || {}; const pFin = appState.finance.find(f => f.month === calSelectedDate.slice(0,7)); const pExps = pFin ? pFin.expenses.filter(e => e.date === calSelectedDate.slice(8,10)) :[];
    
    if (pData.tasks && pData.tasks.length > 0) {
        const div = el('div', {className:'preview-box', style:'margin-bottom:10px;'}); div.appendChild(el('h3', {}, "✅ タスク"));
        pData.tasks.forEach(t => div.appendChild(el('div', {style:'padding:4px 0'}, `${t.done?'[済]':'[未]'} ${t.text}`))); content.appendChild(div);
    }
    if (pData.meals) {
        const div = el('div', {className:'preview-box', style:'border-left:3px solid var(--primary); margin-bottom:10px;'}); div.appendChild(el('h3', {}, "🍚 食事"));
        const getName = (cId) => { const c = appState.settings.mealCategories.find(x=>x.id===cId); return c ? c.name : '未記録'; };
        div.appendChild(el('div', {}, `朝: ${getName(pData.meals.bf?.categoryId)} / 昼: ${getName(pData.meals.lu?.categoryId)} / 夜: ${getName(pData.meals.di?.categoryId)}`)); content.appendChild(div);
    }
    
    let pSubs = [];
    appState.settings.subscriptions.forEach(sub => { if(sub.isActive && sub.startMonth <= calSelectedDate.slice(0,7) && sub.day === Number(calSelectedDate.slice(8,10))) pSubs.push(sub); });
    if(pSubs.length > 0) {
        const div = el('div', {className:'preview-box', style:'border: 1px solid var(--purple); background:rgba(191,90,242,0.1); margin-bottom:10px; padding:8px;'});
        div.appendChild(el('h3', {style:'color:var(--purple); border-bottom:none; margin:0 0 5px 0;'}, "🔄 サブスク予定"));
        pSubs.forEach(s => div.appendChild(el('div', {className:'flex', style:'justify-content:space-between;'}, el('span',{},s.name), el('span',{style:'font-family:monospace;'},`¥${s.amount.toLocaleString()}`))));
        content.appendChild(div);
    }

    if (pExps.length > 0) {
        const div = el('div', {className:'preview-box', style:'border: 1px solid var(--warn); background:rgba(255,69,58,0.05); padding:8px;'}); div.appendChild(el('h3', {style:'border:none; margin:0;'}, "¥ 支出"));
        pExps.forEach(e => div.appendChild(el('div', {className:'flex', style:'justify-content:space-between; padding:4px 0'}, el('span', {}, e.name), el('span', {style:'color:var(--warn); font-family:monospace;'}, `¥${Number(e.amount).toLocaleString()}`)))); content.appendChild(div);
    }
}

/* --- 3,4 メモ/家計 --- */
function renderMemos() {
    const q = document.getElementById('memo-search').value.toLowerCase(); const list = document.getElementById('memo-list'); list.innerHTML = "";
    [...appState.memos].reverse().filter(m => (m.title+m.content).toLowerCase().includes(q)).forEach(m => {
        list.appendChild(el('div', { className: 'card', style:'margin:0 0 10px 0;' },
            el('div', {className:'flex', style:'justify-content:space-between'}, el('strong', {style:'color:var(--sub)'}, m.title), el('button', {className:'btn-del', onClick:()=>setState(s=>s.memos=s.memos.filter(x=>x.id!==m.id))}, "✕")),
            el('div', {style:'font-size:0.9rem; margin-top:8px; white-space:pre-wrap;'}, m.content)
        ));
    });
}

function renderFinance() {
    const sel = document.getElementById('fin-month-select'); sel.innerHTML = ""; appState.finance.sort((a,b)=>a.month>b.month?-1:1).forEach(f => sel.appendChild(el('option', { value: f.month }, f.month)));
    sel.onchange = (e) => drawFinanceMonth(e.target.value);
    const curMonth = sel.value || currentDate.slice(0,7); if(sel.value) sel.value = curMonth; ensureFinanceMonth(curMonth); drawFinanceMonth(curMonth);
}

function drawFinanceMonth(monthStr) {
    const container = document.getElementById('finance-content'); container.innerHTML = "";
    const mIdx = appState.finance.findIndex(f => f.month === monthStr); if(mIdx < 0) return; const f = appState.finance[mIdx]; const getN = (v) => Number(v)||0;

    let mealMonthTotal = 0; const[yy, mm] = monthStr.split('-'); const daysInMonth = new Date(yy, mm, 0).getDate();
    for(let i=1; i<=daysInMonth; i++) { let dStr = `${yy}-${mm}-${String(i).padStart(2,'0')}`; let data = appState.dates[dStr]; if(data && data.meals) mealMonthTotal += getN(data.meals.bf?.amount) + getN(data.meals.lu?.amount) + getN(data.meals.di?.amount); }
    
    let expTotal = 0, creditTotal = 0; 
    (f.expenses||[]).forEach(e => { if (!e.isAdvance) expTotal += getN(e.amount); if (e.payment === "クレカ") creditTotal += getN(e.amount); });
    
    const totalIncome = getN(f.income) + getN(f.extraIncome); const deduct = getN(f.fixed) + getN(f.loan) + getN(f.savings) + getN(f.investment) + mealMonthTotal; const budget = totalIncome - deduct;
    const balance = budget - expTotal;
    const todayObj = new Date(currentDate); let remainingDays = 1;
    if (todayObj.getFullYear() == yy && (todayObj.getMonth() + 1) == mm) remainingDays = daysInMonth - todayObj.getDate() + 1;
    else if (todayObj.getFullYear() < yy || (todayObj.getFullYear() == yy && (todayObj.getMonth() + 1) < mm)) remainingDays = daysInMonth;
    const dailyLimit = remainingDays > 0 ? Math.floor(balance / remainingDays) : 0;

    const sumCard = el('div', {className:'card finance-summary'},
        el('div', {style:'font-size:0.9rem; color:var(--gray);'}, "今月の使えるお金 (予算)"), el('div', {className:'finance-val', style:'color:var(--primary)'}, `¥${budget.toLocaleString()}`),
        el('div', {style:'font-size:0.8rem; color:var(--gray); margin-top:5px;'}, `※全食事代自動計算: -¥${mealMonthTotal.toLocaleString()} 引済`),
        el('div', {className:'grid-2', style:'margin-top:15px; text-align:left;'}, el('div', {}, el('div', {style:'font-size:0.8rem; color:var(--gray);'}, "変動費 残高"), el('div', {style:`font-weight:bold; font-size:1.2rem; color:${balance<0?'var(--warn)':'var(--sub)'}`}, `¥${balance.toLocaleString()}`)), el('div', {}, el('div', {style:'font-size:0.8rem; color:var(--gray);'}, "今日使える額"), el('div', {style:`font-weight:bold; font-size:1.2rem; color:${dailyLimit<0?'var(--warn)':'#fff'}`}, `¥${dailyLimit.toLocaleString()}`))),
        el('div', {style:'margin-top:10px; font-size:0.8rem; color:var(--warn); background:rgba(255,69,58,0.1); padding:8px; border-radius:var(--radius); text-align:left;'}, `💳 今月のクレカ利用額: ¥${creditTotal.toLocaleString()}`)
    );
    const gridDiv = el('div', {className: 'grid-layout'}); const leftCol = el('div', {className: 'col'});
    
    // ★変動費合計の表示を追加
    const expTitle = el('h2', {className:'red', style:'display:flex; justify-content:space-between; align-items:center;'}, 
        el('span', {}, "📝 変動費 (明細)"),
        el('span', {style:'font-size:0.9rem; color:var(--warn); font-family:monospace;'}, `合計: ¥${expTotal.toLocaleString()}`)
    );

    leftCol.appendChild(el('div', {className:'card'},
        expTitle,
        el('button', {className:'btn-primary', onClick:()=>openExpenseModal(null, mIdx)}, "＋ 支出を追加"),
        el('div', {style:'margin-top:15px;'}, ...(f.expenses||[]).sort((a,b)=>b.date-a.date).map(e => 
            el('div', {className:'expense-item', onClick:()=>openExpenseModal(e, mIdx)}, el('div', {}, el('div', {className:'flex'}, el('span', {style:'color:var(--gray); font-size:0.8rem; width:20px;'}, e.date), el('strong', {}, e.name), e.isAdvance ? el('span', {className:'badge bg-sub'}, "立替") : ""), el('div', {style:'font-size:0.75rem; color:var(--gray); margin-top:4px; display:flex; gap:6px;'}, el('span', {className:'badge bg-gray'}, e.category), el('span', {className:'badge bg-gray'}, e.payment))), el('div', {style:'text-align:right;'}, el('div', {style:'font-family:monospace; color:var(--warn); font-weight:bold;'}, `¥${Number(e.amount).toLocaleString()}`), el('div', {style:'font-size:0.8rem; margin-top:4px;'}, e.rating==3?'🤩':e.rating==1?'😞':'😐')))
        ))
    ));
    const rightCol = el('div', {className: 'col'});
    const createAcc = (title, contentEls) => { const wrap = el('div', {className:'card', style:'padding:0; overflow:hidden;'}); const head = el('div', {className:'acc-header', onClick:(e)=>{ e.currentTarget.nextElementSibling.classList.toggle('open'); }}, el('span',{},title), el('span',{},"▼")); const cont = el('div', {className:'acc-content', style:'padding:16px;'}, ...contentEls); wrap.append(head, cont); return wrap; };
    rightCol.appendChild(createAcc("収入・固定費 設定",[ el('div', {className:'grid-2'}, el('div', {}, el('label',{},"月収(基本)"), el('input', {type:'number', value:f.income, onChange:e=>setState(s=>s.finance[mIdx].income=e.target.value)})), el('div', {}, el('label',{},"臨時収入"), el('input', {type:'number', value:f.extraIncome, onChange:e=>setState(s=>s.finance[mIdx].extraIncome=e.target.value)})), el('div', {}, el('label',{},"固定費(家賃等)"), el('input', {type:'number', value:f.fixed, onChange:e=>setState(s=>s.finance[mIdx].fixed=e.target.value)})), el('div', {}, el('label',{},"ローン等"), el('input', {type:'number', value:f.loan, onChange:e=>setState(s=>s.finance[mIdx].loan=e.target.value)}))) ]));
    rightCol.appendChild(createAcc("📱 通信GB アラート管理", [ ...(f.carriers||[]).map((c, cIdx) => { const isAlert = (getN(c.used) / (getN(c.limit)||1)) >= 0.8; return el('div', {className:`grid-3`, style:`align-items:end; margin-bottom:10px; padding:8px; border-radius:var(--radius); background:${isAlert?'rgba(255,69,58,0.2)':'#1c1c1e'};`}, el('div', {}, el('label',{style:'font-size:0.7rem'},"回線名"), el('input', {value:c.name, onChange:e=>setState(s=>s.finance[mIdx].carriers[cIdx].name=e.target.value)})), el('div', {}, el('label',{style:'font-size:0.7rem'},"上限GB"), el('input', {type:'number', value:c.limit, onChange:e=>setState(s=>s.finance[mIdx].carriers[cIdx].limit=e.target.value)})), el('div', {}, el('label',{style:'font-size:0.7rem; color:var(--warn)'},"使用GB"), el('input', {type:'number', value:c.used, onChange:e=>setState(s=>s.finance[mIdx].carriers[cIdx].used=e.target.value)}))); }), el('button', {className:'btn-sub', onClick:()=>setState(s=>s.finance[mIdx].carriers.push({name:"サブ", limit:10, used:0}))}, "＋ 回線追加") ]));
    gridDiv.append(leftCol, rightCol); container.append(sumCard, gridDiv);
}

/* --- 5. 設定 --- */
function renderSettings() {
    document.getElementById('settings-theme').value = appState.settings.theme;

    const mcDiv = document.getElementById('settings-meals'); mcDiv.innerHTML = "";
    appState.settings.mealCategories.forEach((c, idx) => {
        mcDiv.appendChild(el('div', {className:'flex list-item'}, el('span', {className:'drag-handle'}, "☰"),
            el('input', {value:c.name, style:'flex:2;', onChange:e=>setState(s=>s.settings.mealCategories[idx].name=e.target.value, false)}),
            el('input', {type:'number', value:c.price, style:'flex:1;', onChange:e=>setState(s=>s.settings.mealCategories[idx].price=Number(e.target.value), false)}),
            el('button', {className:'btn-del', onClick:()=>setState(s=>s.settings.mealCategories.splice(idx,1))}, "✕")
        ));
    });
    enableDragSort('settings-meals', s => s.settings.mealCategories);
    
    const catDiv = document.getElementById('settings-categories'); catDiv.innerHTML = "";
    appState.settings.categories.forEach((c, idx) => {
        catDiv.appendChild(el('div', {className:'flex list-item'}, el('span', {className:'drag-handle'}, "☰"),
            el('input', {value:c.name, style:'flex:1;', onChange:e=>setState(s=>s.settings.categories[idx].name=e.target.value, false)}),
            el('input', {type:'number', value:c.budget, style:'flex:1;', onChange:e=>setState(s=>s.settings.categories[idx].budget=Number(e.target.value), false)}),
            el('button', {className:'btn-del', onClick:()=>setState(s=>s.settings.categories.splice(idx,1))}, "✕")
        ));
    });
    enableDragSort('settings-categories', s => s.settings.categories);

    // ★サブスク管理（開始月の考慮）
    const subDiv = document.getElementById('settings-subscriptions'); subDiv.innerHTML = "";
    let futureSubTotal = 0; 
    const currentY = new Date().getFullYear();
    const currentM = new Date().getMonth() + 1;
    
    appState.settings.subscriptions.forEach((sub, idx) => {
        // 想定計算
        if (sub.isActive && sub.startMonth) {
            const [sy, sm] = sub.startMonth.split('-').map(Number);
            if (sy < currentY) {
                futureSubTotal += sub.amount * (12 - currentM + 1);
            } else if (sy === currentY) {
                const startCalcMonth = Math.max(currentM, sm);
                futureSubTotal += sub.amount * (12 - startCalcMonth + 1);
            }
        }
        
        subDiv.appendChild(el('div', {className: 'list-item', style: `border-left:4px solid ${sub.isActive?'var(--purple)':'#444'}; opacity:${sub.isActive?1:0.6}; padding:8px;`}, 
            el('div', {className:'flex'}, 
                el('span', {className:'drag-handle'}, "☰"),
                el('input', {value: sub.name, placeholder: '名前', style: 'flex:2;', onChange: e => setState(s => s.settings.subscriptions[idx].name = e.target.value, false)}),
                el('input', {type: 'number', value: sub.amount, placeholder: '金額', style: 'flex:1;', onChange: e => setState(s => s.settings.subscriptions[idx].amount = Number(e.target.value), false)})
            ),
            el('div', {className:'flex', style:'margin-top:4px; margin-left:30px; gap:10px;'},
                el('div', {style:'flex:1'}, el('label', {style:'margin:0;'}, "開始月"), el('input', {type: 'month', value: sub.startMonth, style:'padding:6px;', onChange: e => setState(s => s.settings.subscriptions[idx].startMonth = e.target.value, false)})),
                el('div', {style:'flex:0.5'}, el('label', {style:'margin:0;'}, "支払日"), el('input', {type: 'number', value: sub.day, style:'padding:6px;', onChange: e => setState(s => s.settings.subscriptions[idx].day = Number(e.target.value), false)}))
            ),
            el('div', {className:'flex', style:'margin-top:8px; justify-content:flex-end; padding-right:5px;'},
                el('label', {className:'flex', style:'margin:0; font-weight:bold; color:var(--text);'}, 
                    el('input', {type:'checkbox', checked: sub.isActive, style:'width:18px; height:18px;', onChange: e => setState(s => s.settings.subscriptions[idx].isActive = e.target.checked)}), 
                    el('span', {}, "稼働中")
                ),
                el('button', {className: 'btn-del', style:'padding:4px 8px; margin-left:15px;', onClick: () => setState(s => s.settings.subscriptions.splice(idx, 1))}, "完全削除")
            )
        ));
    });
    document.getElementById('sub-annual-total').innerText = `¥${futureSubTotal.toLocaleString()}`;
    enableDragSort('settings-subscriptions', s => s.settings.subscriptions);

    const payDiv = document.getElementById('settings-payments-list'); payDiv.innerHTML = "";
    appState.settings.paymentMethods.forEach((p, idx) => {
        payDiv.appendChild(el('div', {className: 'flex list-item'}, el('span', {className:'drag-handle'}, "☰"),
            el('input', {value: p, style: 'flex:1;', onChange: e => setState(s => s.settings.paymentMethods[idx] = e.target.value, false)}),
            el('button', {className: 'btn-del', onClick: () => setState(s => s.settings.paymentMethods.splice(idx, 1))}, "✕")
        ));
    });
    enableDragSort('settings-payments-list', s => s.settings.paymentMethods);
}

function setupModals() {
    document.querySelectorAll('.rating-star').forEach(el => { el.addEventListener('click', (e) => { document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('active')); e.currentTarget.classList.add('active'); document.getElementById('exp-rating').value = e.currentTarget.dataset.val; }); });
    document.getElementById('btn-close-expense').addEventListener('click', () => document.getElementById('modal-expense').classList.remove('active'));
    document.getElementById('btn-save-expense').addEventListener('click', saveExpenseFromModal);
    document.getElementById('btn-show-annual').addEventListener('click', openAnnualModal);
    document.getElementById('btn-close-annual').addEventListener('click', () => document.getElementById('modal-annual').classList.remove('active'));
}

function openExpenseModal(exp, mIdx) {
    currentMIdx = mIdx;
    const catSel = document.getElementById('exp-category'); catSel.innerHTML = ""; appState.settings.categories.forEach(c => catSel.appendChild(new Option(c.name, c.name)));
    const paySel = document.getElementById('exp-payment'); paySel.innerHTML = ""; appState.settings.paymentMethods.forEach(p => paySel.appendChild(new Option(p, p)));
    if (exp) {
        document.getElementById('exp-id').value = exp.id; document.getElementById('exp-date').value = exp.date; document.getElementById('exp-name').value = exp.name; document.getElementById('exp-amount').value = exp.amount; document.getElementById('exp-category').value = exp.category; document.getElementById('exp-payment').value = exp.payment; document.getElementById('exp-tags').value = exp.tags.join(','); document.getElementById('exp-advance').checked = exp.isAdvance; document.getElementById('exp-memo').value = exp.memo; document.getElementById('exp-rating').value = exp.rating;
    } else {
        document.getElementById('exp-id').value = ""; document.getElementById('exp-date').value = currentDate.slice(8,10); document.getElementById('exp-name').value = ""; document.getElementById('exp-amount').value = ""; document.getElementById('exp-tags').value = ""; document.getElementById('exp-memo').value = ""; document.getElementById('exp-advance').checked = false; document.getElementById('exp-rating').value = 2;
    }
    document.querySelectorAll('.rating-star').forEach(el => el.classList.toggle('active', el.dataset.val == document.getElementById('exp-rating').value)); document.getElementById('modal-expense').classList.add('active');
}
function saveExpenseFromModal() {
    const id = document.getElementById('exp-id').value;
    const expObj = { id: id ? parseFloat(id) : Date.now(), date: String(document.getElementById('exp-date').value).padStart(2,'0'), name: document.getElementById('exp-name').value, amount: Number(document.getElementById('exp-amount').value), category: document.getElementById('exp-category').value, payment: document.getElementById('exp-payment').value, tags: document.getElementById('exp-tags').value.split(',').map(t=>t.trim()).filter(t=>t), rating: Number(document.getElementById('exp-rating').value), isAdvance: document.getElementById('exp-advance').checked, memo: document.getElementById('exp-memo').value };
    setState(s => { const arr = s.finance[currentMIdx].expenses; if(id) { const idx = arr.findIndex(x=>x.id==id); if(idx>=0) arr[idx] = expObj; } else arr.push(expObj); }); document.getElementById('modal-expense').classList.remove('active');
}

function openAnnualModal() {
    const modal = document.getElementById('modal-annual'); modal.classList.add('active'); const years =[...new Set(appState.finance.map(f => f.month.slice(0,4)))].sort().reverse();
    const sel = document.getElementById('annual-year-select'); sel.innerHTML = ""; years.forEach(y => sel.appendChild(new Option(y+"年", y)));
    const drawChart = () => {
        const targetYear = sel.value; const months =["01","02","03","04","05","06","07","08","09","10","11","12"]; let incomeData =[], expData =[], totalSave = 0;
        months.forEach(m => { const f = appState.finance.find(x => x.month === `${targetYear}-${m}`); if(f) { const inc = Number(f.income) + Number(f.extraIncome); const exps = f.expenses.filter(e=>!e.isAdvance).reduce((sum, e) => sum + Number(e.amount), 0) + Number(f.fixed) + Number(f.loan); const sav = inc - exps; incomeData.push(inc); expData.push(exps); totalSave += sav; } else { incomeData.push(0); expData.push(0); } });
        document.getElementById('annual-total-balance').innerText = `年間貯蓄額: ¥${totalSave.toLocaleString()}`;
        if(charts.annual) charts.annual.destroy(); charts.annual = new Chart(document.getElementById('annual-chart'), { type: 'bar', data: { labels: months.map(m=>m+"月"), datasets:[ { label: '支出', data: expData, backgroundColor: '#ff453a' }, { label: '収入', data: incomeData, backgroundColor: '#0a84ff' } ]}, options: { responsive: true, scales: { x:{stacked:false}, y:{beginAtZero:true} } } });
    }; sel.onchange = drawChart; if(years.length > 0) drawChart();
}

async function importData(e) { if(!e.target.files.length) return; try { const json = JSON.parse(await e.target.files[0].text()); if(json.dates) Object.keys(json.dates).forEach(k => { if(!appState.dates[k]) appState.dates[k] = json.dates[k]; else Object.assign(appState.dates[k], json.dates[k]); }); if(json.memos) appState.memos = json.memos; if(json.finance) json.finance.forEach(f => { let exist = appState.finance.find(x => x.month === f.month); if(exist) Object.assign(exist, f); else appState.finance.push(f); }); initData(); await saveState(); alert("復元・マージ完了しました"); location.reload(); } catch(err) { alert("エラー: 不正なファイルです"); } }
function enableDragSort(containerId, getArray) { const el = document.getElementById(containerId); if (!el) return; new Sortable(el, { animation: 150, handle: '.drag-handle', onEnd: (evt) => { setState(s => { const arr = getArray(s); const [moved] = arr.splice(evt.oldIndex, 1); arr.splice(evt.newIndex, 0, moved); }); } }); }
