'use strict';

const CHECKS = {
  networkChecks: [
    { id:'n1', name:'Internet connectivity blocked',    detail:'Checks if external internet is reachable' },
    { id:'n2', name:'No external tabs open',            detail:'Ensures no tabs are accessing outside URLs' },
    { id:'n3', name:'Local exam server reachable',      detail:'Pings internal LAN exam server' },
    { id:'n4', name:'AI/external domains DNS-blocked',  detail:'Confirms blocked domains are unreachable' },
  ],
  systemChecks: [
    { id:'s1', name:'No remote desktop extensions',    detail:'AnyDesk, TeamViewer, RDP add-ons absent' },
    { id:'s2', name:'No screen recording extensions',  detail:'OBS, Loom, Screencastify absent' },
    { id:'s3', name:'No clipboard sync extensions',    detail:'Cross-device clipboard tools absent' },
    { id:'s4', name:'No AI-assist extensions',         detail:'GPT, Copilot, Grammarly AI absent' },
    { id:'s5', name:'Chrome browser up to date',       detail:'Version ≥ 120 confirmed' },
    { id:'s6', name:'USB storage ports locked',        detail:'Policy-level USB block (verify in OS)' },
  ],
  softwareChecks: [
    { id:'sw1', name:'Kiosk / fullscreen mode active', detail:'Single fullscreen window enforced' },
    { id:'sw2', name:'Exam server SSL valid',          detail:'HTTPS reachable on local server' },
    { id:'sw3', name:'Question paper checksum',        detail:'SHA-256 integrity — verify in exam software' },
    { id:'sw4', name:'AI chatbot sites blocked',       detail:'ChatGPT, Gemini, Claude, etc. unreachable' },
    { id:'sw5', name:'Browser version logged',         detail:'Chrome version recorded for audit trail' },
  ],
  hardwareChecks: [
    { id:'h1', name:'Webcam / camera detected',       detail:'Proctoring camera present and accessible' },
    { id:'h2', name:'Bluetooth state',                detail:'Bluetooth — verify disabled in OS settings' },
  ],
  venueChecks: [
    { id:'v1', name:'Signal jammer status',           detail:'Confirm jammer active — physical check required' },
  ],
};

let running = false;
let auditLog = [];
let results = {};
let settings = {};

// ── Boot ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  renderAllChecks();
  bindUI();
});

function loadSettings() {
  chrome.storage.local.get(['examName','roomId','examType','serverIp'], (s) => {
    settings = s;
    if (s.examName) document.getElementById('examName').value = s.examName;
    if (s.roomId)   document.getElementById('roomId').value   = s.roomId;
    if (s.examType) document.getElementById('examType').value = s.examType;
    if (s.serverIp) document.getElementById('serverIp').value = s.serverIp;
  });
}

function bindUI() {
  document.getElementById('startBtn').addEventListener('click', startAudit);
  document.getElementById('resetBtn').addEventListener('click', resetAudit);
  document.getElementById('exportBtn').addEventListener('click', exportReport);
  document.getElementById('logBtn').addEventListener('click', () => {
    document.getElementById('logArea').classList.toggle('hidden');
  });
  document.getElementById('settingsToggle').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.toggle('hidden');
  });
  document.getElementById('saveSettings').addEventListener('click', () => {
    const s = {
      examName: document.getElementById('examName').value,
      roomId:   document.getElementById('roomId').value,
      examType: document.getElementById('examType').value,
      serverIp: document.getElementById('serverIp').value,
    };
    chrome.storage.local.set(s, () => {
      settings = s;
      document.getElementById('settingsPanel').classList.add('hidden');
    });
  });
}

// ── Render ───────────────────────────────────────────────────────────────

function renderAllChecks() {
  for (const [section, checks] of Object.entries(CHECKS)) {
    const container = document.getElementById(section);
    container.innerHTML = '';
    checks.forEach(c => {
      container.innerHTML += `
        <div class="check-row" id="row-${c.id}">
          <div class="sweep" id="sweep-${c.id}"></div>
          <div class="check-icon" id="icon-${c.id}">⬜</div>
          <div style="flex:1;min-width:0;">
            <div class="check-name">${c.name}</div>
            <div class="check-detail" id="detail-${c.id}">${c.detail}</div>
          </div>
          <div class="check-right">
            <span class="badge badge-pending" id="badge-${c.id}">—</span>
          </div>
        </div>`;
    });
  }
}

// ── Audit ────────────────────────────────────────────────────────────────

async function startAudit() {
  if (running) return;
  running = true;
  auditLog = []; results = {};

  const startBtn = document.getElementById('startBtn');
  startBtn.disabled = true;
  startBtn.innerHTML = `<span class="spin">↻</span> Scanning…`;

  document.getElementById('exportBtn').classList.add('hidden');
  document.getElementById('progressWrap').classList.remove('hidden');
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('summary').classList.add('hidden');
  document.getElementById('logArea').innerHTML = '';
  document.getElementById('metaStatus').textContent = 'Scanning…';
  document.getElementById('metaStatus').className = 'meta-value warn';
  document.getElementById('metaPass').textContent = '0';
  document.getElementById('metaFail').textContent = '0';

  addLog(`Audit started — ${settings.examName || 'Exam'} · ${settings.roomId || 'Room ?'}`);

  const allChecks = Object.values(CHECKS).flat();
  document.getElementById('metaTotal').textContent = allChecks.length;

  let done = 0, passes = 0, fails = 0, warns = 0;

  for (const c of allChecks) {
    setCheckState(c.id, 'running', '…scanning');

    const res = await chrome.runtime.sendMessage({ type: 'RUN_CHECK', checkId: c.id });
    results[c.id] = res;
    done++;

    const pct = Math.round((done / allChecks.length) * 100);
    document.getElementById('progressFill').style.width = pct + '%';

    document.getElementById(`detail-${c.id}`).textContent = res.msg;

    if (res.status === 'pass') {
      passes++;
      setCheckState(c.id, 'pass', 'PASS');
      addLog(`PASS  ${c.name}`, 'ok');
    } else if (res.status === 'warn') {
      warns++;
      setCheckState(c.id, 'warn', 'WARN');
      addLog(`WARN  ${c.name}: ${res.msg}`, 'warn');
    } else {
      fails++;
      setCheckState(c.id, 'fail', 'FAIL');
      addLog(`FAIL  ${c.name}: ${res.msg}`, 'fail');
    }

    document.getElementById('metaPass').textContent = passes;
    document.getElementById('metaFail').textContent = fails + warns;
  }

  // Summary
  const sb = document.getElementById('summary');
  sb.classList.remove('hidden', 'all-pass', 'has-fail', 'has-warn');
  if (fails > 0) {
    sb.classList.add('has-fail');
    document.getElementById('summaryTitle').textContent = '⛔ Exam must NOT start — critical issues found';
    document.getElementById('summaryDetail').textContent =
      `${fails} critical failure(s) and ${warns} warning(s) across ${allChecks.length} checks. Resolve all failures before admitting candidates.`;
    document.getElementById('metaStatus').textContent = 'BLOCKED';
    document.getElementById('metaStatus').className = 'meta-value danger';
  } else if (warns > 0) {
    sb.classList.add('has-warn');
    document.getElementById('summaryTitle').textContent = '⚠ Caution — warnings need acknowledgement';
    document.getElementById('summaryDetail').textContent =
      `All critical checks passed. ${warns} warning(s) require invigilator sign-off before proceeding.`;
    document.getElementById('metaStatus').textContent = 'CAUTION';
    document.getElementById('metaStatus').className = 'meta-value warn';
  } else {
    sb.classList.add('all-pass');
    document.getElementById('summaryTitle').textContent = '✓ All clear — exam can proceed';
    document.getElementById('summaryDetail').textContent =
      `All ${allChecks.length} checks passed. Export and sign this report before distributing login credentials.`;
    document.getElementById('metaStatus').textContent = 'CLEARED';
    document.getElementById('metaStatus').className = 'meta-value ok';
  }

  addLog(`Audit complete — ${passes} passed · ${warns} warned · ${fails} failed`);

  startBtn.disabled = false;
  startBtn.innerHTML = `↻ Re-run Audit`;
  document.getElementById('exportBtn').classList.remove('hidden');
  running = false;
}

function setCheckState(id, state, badgeText) {
  const row    = document.getElementById(`row-${id}`);
  const icon   = document.getElementById(`icon-${id}`);
  const badge  = document.getElementById(`badge-${id}`);

  row.className = 'check-row';
  badge.className = 'badge';

  if (state === 'running') {
    row.classList.add('running');
    icon.innerHTML = `<span class="spin">↻</span>`;
    badge.classList.add('badge-running');
    badge.textContent = badgeText;
  } else if (state === 'pass') {
    row.classList.add('pass');
    icon.textContent = '✅';
    badge.classList.add('badge-pass');
    badge.textContent = badgeText;
  } else if (state === 'warn') {
    row.classList.add('warn-state');
    icon.textContent = '⚠️';
    badge.classList.add('badge-warn');
    badge.textContent = badgeText;
  } else if (state === 'fail') {
    row.classList.add('fail');
    icon.textContent = '❌';
    badge.classList.add('badge-fail');
    badge.textContent = badgeText;
  }
}

function resetAudit() {
  running = false;
  renderAllChecks();
  document.getElementById('metaStatus').textContent = 'Ready';
  document.getElementById('metaStatus').className = 'meta-value';
  document.getElementById('metaPass').textContent = '—';
  document.getElementById('metaFail').textContent = '—';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressWrap').classList.add('hidden');
  document.getElementById('summary').classList.add('hidden');
  document.getElementById('logArea').innerHTML = '';
  document.getElementById('exportBtn').classList.add('hidden');
  const startBtn = document.getElementById('startBtn');
  startBtn.disabled = false;
  startBtn.innerHTML = `▶ Run Full Audit`;
}

// ── Log ──────────────────────────────────────────────────────────────────

function addLog(msg, type = '') {
  const now = new Date().toLocaleTimeString('en-IN', { hour12: false });
  auditLog.push({ t: now, msg, type });
  const la = document.getElementById('logArea');
  const cls = type === 'ok' ? 'log-ok' : type === 'fail' ? 'log-fail' : type === 'warn' ? 'log-warn' : '';
  la.innerHTML += `<div class="${cls}"><span class="log-ts">[${now}]</span>${msg}</div>`;
  la.scrollTop = la.scrollHeight;
}

// ── Export ───────────────────────────────────────────────────────────────

function exportReport() {
  const exam   = settings.examName || 'Untitled Exam';
  const room   = settings.roomId   || 'Room ?';
  const type   = settings.examType || 'CBT';
  const now    = new Date().toLocaleString('en-IN');

  let txt = `╔══════════════════════════════════════════════════════════╗\n`;
  txt    += `║          EXAM SECURITY AUDIT REPORT                     ║\n`;
  txt    += `╚══════════════════════════════════════════════════════════╝\n\n`;
  txt    += `Generated  : ${now}\n`;
  txt    += `Exam       : ${exam}\n`;
  txt    += `Room / Lab : ${room}\n`;
  txt    += `Type       : ${type.toUpperCase()}\n`;
  txt    += `Status     : ${document.getElementById('metaStatus').textContent}\n`;
  txt    += `Passed     : ${document.getElementById('metaPass').textContent}\n`;
  txt    += `Issues     : ${document.getElementById('metaFail').textContent}\n`;
  txt    += `\n${'─'.repeat(60)}\n`;
  txt    += `CHECK RESULTS\n${'─'.repeat(60)}\n`;

  for (const [section, checks] of Object.entries(CHECKS)) {
    txt += `\n[${section.replace('Checks', '').toUpperCase()}]\n`;
    checks.forEach(c => {
      const r = results[c.id];
      if (r) {
        txt += `  [${r.status.toUpperCase().padEnd(4)}]  ${c.name}\n`;
        txt += `           ${r.msg}\n`;
      }
    });
  }

  txt += `\n${'─'.repeat(60)}\n`;
  txt += `AUDIT LOG\n${'─'.repeat(60)}\n`;
  auditLog.forEach(l => { txt += `[${l.t}]  ${l.msg}\n`; });

  txt += `\n${'─'.repeat(60)}\n`;
  txt += `INVIGILATOR SIGN-OFF\n\n`;
  txt += `Name   : ________________________________\n`;
  txt += `Sign   : ________________________________\n`;
  txt += `Date   : ________________________________\n`;
  txt += `\nSuperintendent acknowledgement:\n\n`;
  txt += `Name   : ________________________________\n`;
  txt += `Sign   : ________________________________\n`;

  const blob = new Blob([txt], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const fname = `AuditReport_${exam.replace(/\s+/g,'_')}_${room.replace(/\s+/g,'_')}_${Date.now()}.txt`;
  a.href = url; a.download = fname; a.click();
  URL.revokeObjectURL(url);
}
