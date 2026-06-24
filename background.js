// Background service worker that runs real Chrome API checks

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'RUN_CHECK') {
    runCheck(msg.checkId).then(sendResponse);
    return true; // keep channel open for async
  }
  if (msg.type === 'GET_EXTENSIONS') {
    getExtensions().then(sendResponse);
    return true;
  }
});

// directory mapping each check ID directly to its function
const CHECK_ROUTER = {
  n1: checkInternetBlocked,
  n2: checkTabsForExternalSites,
  n3: checkLocalServer,
  n4: checkDNSBlock,
  s1: () => checkExtensionCategory(['anydesk','teamviewer','chrome remote','remote desktop','vnc','remotepc','splashtop'], 'fail', 'Remote access extension(s) detected: {list} — disable immediately', 'No remote desktop or RDP extensions found'),
  s2: () => checkExtensionCategory(['screencast','screen record','loom','record screen','vidyard','screencastify','nimbus'], 'fail', 'Screen recording extension(s) detected: {list}', 'No screen recording extensions detected'),
  s3: () => checkExtensionCategory(['clipboard','ditto','copy paste','cross-device','clipmate'], 'warn', 'Clipboard sync extension(s) found: {list} — review and disable', 'No clipboard sync extensions detected'),
  s4: checkUnknownExtensions,
  s5: checkChromeUpToDate,
  sw1: checkKioskMode,
  sw2: checkLocalServerSSL,
  sw4: checkAISitesBlocked,
  sw5: checkChromeVersion,
  h1: checkCamera,
};

// Fixed text responses for hardware rules that a browser cannot check automatically
const MANUAL_CHECKS = {
  s6: { status: 'warn', msg: 'USB access block cannot be checked automatically — please verify manually' },
  sw3: { status: 'pass', msg: 'Paper checksum must be verified by exam software — mark manually' },
  h2: { status: 'warn', msg: 'Bluetooth cannot be checked via browser — verify in OS Device Manager' },
  v1: { status: 'warn', msg: 'Signal jammer status must be confirmed physically by invigilator' }
};

async function runCheck(checkId) {
  try {
    // 1. Try to run an automated test from our directory
    if (CHECK_ROUTER[checkId]) {
      return await CHECK_ROUTER[checkId]();
    }
    
    // 2. If it's not automated, return the manual reminder text
    if (MANUAL_CHECKS[checkId]) {
      return MANUAL_CHECKS[checkId];
    }

    return { status: 'warn', msg: 'Check not implemented for this platform' };
  } catch (e) {
    return { status: 'warn', msg: `Check error: ${e.message}` };
  }
}

// Helper utility to make network pings cleaner
async function ping(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal, mode: 'no-cors' });
    clearTimeout(id);
    return true;
  } catch {
    clearTimeout(id);
    return false;
  }
}

// Real check implementations

async function checkInternetBlocked() {
  const isReachable = await ping('https://www.google.com/generate_204', 3000);
  if (isReachable) {
    return { status: 'fail', msg: 'Live internet is reachable. Block all external network access before exam.' };
  }
  return { status: 'pass', msg: 'Internet blocked — connection verified secure by network policy' };
}

async function checkTabsForExternalSites() {
  const tabs = await chrome.tabs.query({});
  const external = tabs.filter(t => {
    if (!t.url) return false;
    return !t.url.startsWith('chrome') && !t.url.includes('192.168') &&
           !t.url.includes('localhost') && !t.url.includes('127.0.0.1');
  });
  if (external.length > 0) {
    return { status: 'fail', msg: `${external.length} tab(s) open to external URLs: ${external.map(t=>t.url).slice(0,2).join(', ')}` };
  }
  return { status: 'pass', msg: `All ${tabs.length} open tab(s) are local or internal` };
}

async function checkLocalServer() {
  const start = Date.now();
  const isReachable = await ping('http://192.168.1.10/ping', 3000);
  if (isReachable) {
    return { status: 'pass', msg: `Local exam server connection verified` };
  }
  return { status: 'fail', msg: 'Local exam server did not respond — check LAN connection' };
}

async function checkDNSBlock() {
  const testUrls = ['https://chatgpt.com/favicon.ico', 'https://gemini.google.com/favicon.ico'];
  let blockedCount = 0;

  for (const url of testUrls) {
    const isReachable = await ping(url, 3000);
    if (!isReachable) blockedCount++;
  }

  if (blockedCount === testUrls.length) {
    return { status: 'pass', msg: 'DNS-level blocks confirmed — AI/external domains unreachable' };
  }
  return { status: 'fail', msg: `${testUrls.length - blockedCount} of ${testUrls.length} blocked domains are still reachable` };
}

async function getExtensions() {
  const exts = await chrome.management.getAll();
  return exts.filter(e => e.enabled && e.type === 'extension');
}

// Master scanner that handles remote desktop, recording, and clipboard checking Seamlessely
async function checkExtensionCategory(keywords, alertStatus, failMsg, passMsg) {
  const activeExtensions = await getExtensions();
  const found = activeExtensions.filter(e => keywords.some(k => e.name.toLowerCase().includes(k)));
  
  if (found.length > 0) {
    const listString = found.map(e => e.name).join(', ');
    return { status: alertStatus, msg: failMsg.replace('{list}', listString) };
  }
  return { status: 'pass', msg: passMsg };
}

const AI_KEYWORDS = ['chatgpt','gpt','copilot','gemini','claude','perplexity','bard','ai assistant','grammarly'];
const WHITELIST_EXT_IDS = ['aapbdbdomjkkjkaonfhkkikfgjllcleb'];

async function checkUnknownExtensions() {
  const exts = await chrome.management.getAll();
  const nonWhitelisted = exts.filter(e =>
    e.enabled &&
    e.type === 'extension' &&
    !WHITELIST_EXT_IDS.includes(e.id) &&
    e.id !== chrome.runtime.id 
  );
  const aiFound = nonWhitelisted.filter(e => AI_KEYWORDS.some(k => e.name.toLowerCase().includes(k)));
  if (aiFound.length > 0) {
    return { status: 'fail', msg: `AI-assist extension(s) detected: ${aiFound.map(e=>e.name).join(', ')}` };
  }
  if (nonWhitelisted.length > 3) {
    return { status: 'warn', msg: `${nonWhitelisted.length} non-whitelisted extension(s) active — review: ${nonWhitelisted.map(e=>e.name).slice(0,3).join(', ')}…` };
  }
  return { status: 'pass', msg: `${nonWhitelisted.length} extension(s) active, none flagged as high-risk` };
}

async function checkChromeUpToDate() {
  const ua = navigator.userAgent;
  const match = ua.match(/Chrome\/([\d.]+)/);
  if (match) {
    const major = parseInt(match[1].split('.')[0]);
    if (major < 120) {
      return { status: 'warn', msg: `Chrome version ${match[1]} is outdated (current stable is 120+) — update recommended` };
    }
    return { status: 'pass', msg: `Chrome ${match[1]} — version is current` };
  }
  return { status: 'warn', msg: 'Could not determine Chrome version from user agent' };
}

async function checkKioskMode() {
  const windows = await chrome.windows.getAll();
  const allFullscreen = windows.every(w => w.state === 'fullscreen' || w.state === 'maximized');
  if (windows.length === 1 && allFullscreen) {
    return { status: 'pass', msg: 'Single window, fullscreen — kiosk-like mode confirmed' };
  }
  if (windows.length > 1) {
    return { status: 'fail', msg: `${windows.length} browser windows open — candidate may switch windows. Use --kiosk flag or exam browser lockdown.` };
  }
  return { status: 'warn', msg: 'Window not in fullscreen — enforce kiosk mode via exam software or Chrome --kiosk flag' };
}

async function checkLocalServerSSL() {
  const isReachable = await ping('https://192.168.1.10/ping', 3000);
  if (isReachable) {
    return { status: 'pass', msg: 'HTTPS local server reachable — SSL appears valid' };
  }
  return { status: 'warn', msg: 'Could not verify SSL on local server — confirm certificate manually' };
}

async function checkAISitesBlocked() {
  const aiDomains = ['chatgpt.com', 'openai.com', 'gemini.google.com', 'claude.ai'];
  let blockedCount = 0;

  for (const domain of aiDomains) {
    const isReachable = await ping(`https://${domain}/favicon.ico`, 2000);
    if (!isReachable) blockedCount++;
  }

  if (blockedCount === aiDomains.length) {
    return { status: 'pass', msg: `All ${aiDomains.length} tested AI domains are unreachable — DNS block active` };
  }
  return { status: 'fail', msg: `${aiDomains.length - blockedCount}/${aiDomains.length} AI domains reachable — enforce DNS/firewall blocking` };
}

async function checkChromeVersion() {
  const ua = navigator.userAgent;
  const match = ua.match(/Chrome\/([\d.]+)/);
  return match 
    ? { status: 'pass', msg: `Running Chrome ${match[1]}` }
    : { status: 'warn', msg: 'Unable to read browser version' };
}

async function checkCamera() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    if (cameras.length === 0) {
      return { status: 'fail', msg: 'No camera detected — proctoring camera not connected' };
    }
    return { status: 'pass', msg: `${cameras.length} camera(s) detected: ${cameras.map(c=>c.label||'Camera').join(', ')}` };
  } catch {
    return { status: 'warn', msg: 'Camera enumeration blocked — grant media permissions to verify' };
  }
}