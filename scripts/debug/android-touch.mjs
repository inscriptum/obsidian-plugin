// Touch driver over CDP for the Android device/emulator webview: real
// touch sequences in CSS coordinates (adb shell `input tap` on this
// emulator takes PHYSICAL pixels — useless for layout-aimed taps).
// Usage (ANDROID_CDP overrides the endpoint, mirrors android-eval.mjs):
//   ANDROID_CDP=http://127.0.0.1:9226 node android-touch.mjs 'down 206 302' 'sleep 450' 'up'
//   node android-touch.mjs 'down 206 302' 'sleep 400' 'move 206 350' 'move 206 500' 'up'
import { chromium } from 'playwright-core';
const cmds = process.argv.slice(2);
const browser = await chromium.connectOverCDP(process.env.ANDROID_CDP ?? 'http://127.0.0.1:9224', { timeout: 8000 });
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http://localhost/'));
if (!page) { console.error('android page not found'); process.exit(1); }
const cdp = await page.context().newCDPSession(page);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (const cmd of cmds) {
  const [op, x, y] = cmd.split(/\s+/);
  if (op === 'down') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: +x, y: +y, id: 1 }] });
  else if (op === 'move') await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: +x, y: +y, id: 1 }] });
  else if (op === 'up') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else if (op === 'sleep') await sleep(+x);
  await sleep(30);
}
console.log('touch sequence done');
await browser.close().catch(() => {});
