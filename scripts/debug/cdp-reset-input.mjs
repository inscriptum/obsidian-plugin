// cdp-reset-input.mjs — clear zombie CDP input state in the Obsidian renderer.
//
// A debug session killed while the playwright mouse is pressed (or inside a
// drag loop) leaves the input pipeline stuck: further mouse/evaluate calls
// hang. This releases the button, cancels any intercepted drag and turns
// drag interception off. Zero dependencies (raw CDP WebSocket).
//
// Usage: node local/workflow/scripts/cdp-reset-input.mjs

const ENDPOINT = 'http://127.0.0.1:9223';
const targets = await (await fetch(`${ENDPOINT}/json/list`)).json();
const page = targets.find(
  (t) => t.type === 'page' && t.url === 'app://obsidian.md/index.html',
);
if (page == null) throw new Error('Obsidian page target not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id != null && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error != null ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

for (const step of [
  () => send('Input.cancelDragging'),
  () => send('Input.setInterceptDrags', { enabled: false }),
  () =>
    send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 300,
      y: 300,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    }),
]) {
  await step().catch((error) => console.error('step failed:', error.message));
  await new Promise((r) => setTimeout(r, 200));
}
ws.close();
console.log('input state reset done');
