/**
 * Local visual QA helper.
 * Launches a headless Chromium, signs in with the demo account, and captures
 * screenshots of the main routes. Requires the production server on :8787.
 *
 * Usage: node scripts/capture.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BROWSER =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const BASE = process.env.ASTRA_URL || 'http://127.0.0.1:8787';
const OUT = path.resolve('docs/screenshots');
const PROFILE = path.resolve('.edge-profile/capture');

if (!existsSync(BROWSER)) {
  console.error(`Chromium not found: ${BROWSER}`);
  process.exit(1);
}

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILE, { recursive: true });

const browser = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(150);
  }
  throw new Error('DevTools did not start');
}

await waitForDevtools();

const targetResponse = await fetch(
  `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`,
  { method: 'PUT' },
);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let messageId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) {
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(
        message.params?.exceptionDetails?.exception?.description ||
          message.params?.exceptionDetails?.text ||
          'unknown exception',
      );
    }
    if (
      message.method === 'Runtime.consoleAPICalled' &&
      message.params?.type === 'error'
    ) {
      runtimeErrors.push(
        (message.params.args || []).map((arg) => arg.value || arg.description).join(' '),
      );
    }
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 20_000);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Evaluation failed');
  }
  return result.result?.value;
}

async function waitForSelector(selector, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (found) return true;
    await sleep(120);
  }
  return false;
}

async function goto(url, selector) {
  await send('Page.navigate', { url });
  await sleep(600);
  if (selector) await waitForSelector(selector);
  await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
  await evaluate('window.scrollTo(0, 0)');
  await sleep(650);
}

async function capture(name, full = false) {
  let clip;
  if (full) {
    const width = await evaluate('window.innerWidth');
    const height = await evaluate(
      'Math.min(Math.max(document.documentElement.scrollHeight, 1000), 1800)',
    );
    clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: full,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`captured ${name}.png`);
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{animation-duration:0.001s!important;transition-duration:0.001s!important;scroll-behavior:auto!important}';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    `,
  });

  await goto(`${BASE}/login`, '.login-form');
  await capture('login');

  await evaluate("document.querySelector('.login-submit')?.click()");
  const signedIn = await waitForSelector('.stat-grid', 15_000);
  if (!signedIn) {
    const message = await evaluate(
      "document.querySelector('.form-error')?.textContent || 'login UI did not advance'",
    );
    throw new Error(message);
  }
  const userName = await evaluate(
    "document.querySelector('.user-copy strong')?.textContent || 'unknown'",
  );
  console.log(`signed in via UI as ${userName}`);

  await sleep(1000);
  await capture('dashboard', true);

  await goto(`${BASE}/chat`, '.chat-stage');
  await waitForSelector('.history-item');
  await evaluate("document.querySelector('.history-item')?.click()");
  await sleep(1000);
  await capture('chat');

  await goto(`${BASE}/assistants`, '.assistant-grid');
  await capture('assistants', true);

  await goto(`${BASE}/knowledge`, '.kb-detail');
  await waitForSelector('.doc-row');
  await capture('knowledge');
  await evaluate(
    "[...document.querySelectorAll('button')].find(b => b.textContent.includes('检索配置'))?.click()",
  );
  if (await waitForSelector('.modal', 3000)) {
    await sleep(400);
    await capture('knowledge-config');
    await evaluate("document.querySelector('.modal-head .icon-btn')?.click()");
    await sleep(300);
  }
  await evaluate(
    "[...document.querySelectorAll('.segment')].find(b => b.textContent.includes('混合检索测试'))?.click()",
  );
  await sleep(300);
  await evaluate(`
    (() => {
      const input = document.querySelector('.retrieval-search input');
      if (!input) throw new Error('retrieval input not found');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      ).set;
      setter.call(input, '企业版如何保障数据安全和密钥加密？');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);
  await sleep(200);
  await evaluate(
    "[...document.querySelectorAll('.retrieval-search button')].find(b => b.textContent.includes('检索'))?.click()",
  );
  if (await waitForSelector('.chunk-card', 10_000)) {
    await sleep(400);
    await capture('knowledge-search');
  } else {
    console.warn('retrieval result was not rendered');
  }

  await goto(`${BASE}/providers`, '.provider-grid');
  await capture('providers');

  await goto(`${BASE}/usage`, '.usage-stats');
  await sleep(900);
  await capture('usage', true);

  await goto(`${BASE}/team`, '.team-card');
  await capture('team');

  await goto(`${BASE}/audit`, '.audit-list');
  await capture('audit');

  await goto(`${BASE}/settings`, '.settings-card');
  await capture('settings');

  // Verify RAG citations end-to-end, then remove the test thread.
  await goto(`${BASE}/chat`, '.chat-stage');
  await evaluate("document.querySelector('.assistant-switch-btn')?.click()");
  await sleep(250);
  const switched = await evaluate(`
    (() => {
      const item = [...document.querySelectorAll('.assistant-menu-item')]
        .find(node => node.textContent.includes('客户成功助手'));
      if (!item) return false;
      item.click();
      return true;
    })()
  `);
  console.log(`switched to knowledge assistant: ${switched}`);
  await sleep(350);
  await evaluate(`
    (() => {
      const textarea = document.querySelector('.composer textarea');
      if (!textarea) throw new Error('composer not found');
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      ).set;
      setter.call(textarea, '企业版如何保障数据安全和密钥加密？');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);
  await sleep(250);
  await evaluate("document.querySelector('.send-btn')?.click()");
  await sleep(700);
  const streamingVisible = await evaluate(
    "Boolean(document.querySelector('.stream-caret, .typing'))",
  );
  console.log(`streaming UI visible: ${streamingVisible}`);
  const citationsVisible = await waitForSelector('.message-citations', 20_000);
  console.log(`RAG citations visible: ${citationsVisible}`);
  await evaluate(
    "document.querySelector('.message-citations')?.setAttribute('open', '')",
  );
  await sleep(400);
  await capture('chat-rag');

  const testConversationId = await evaluate(`
    (async () => {
      const headers = { Authorization: 'Bearer ' + localStorage.getItem('astra_token') };
      const response = await fetch('/api/conversations', { headers });
      const payload = await response.json();
      const test = payload.data.find(item => item.title.includes('企业版如何保障'));
      if (!test) return null;
      await fetch('/api/conversations/' + test.id, { method: 'DELETE', headers });
      return test.id;
    })()
  `);
  console.log(`RAG test conversation removed: ${Boolean(testConversationId)}`);

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await goto(`${BASE}/`, '.stat-grid');
  await sleep(900);
  await capture('mobile-dashboard', true);

  if (runtimeErrors.length) {
    console.warn('Runtime console errors:');
    runtimeErrors.forEach((message) => console.warn(` - ${message}`));
  } else {
    console.log('no runtime console errors');
  }
} finally {
  try {
    socket.close();
  } catch {
    // noop
  }
  browser.kill();
  await sleep(300);
}
