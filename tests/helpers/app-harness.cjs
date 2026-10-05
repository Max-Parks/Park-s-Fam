const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const appScript = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .find((match) => !/\bsrc\s*=|\btype\s*=\s*["']module["']/i.test(match[1]) && /\bconst\s+ROOM_DEFAULTS\s*=/.test(match[2]))?.[2];
if (!appScript) throw new Error('Could not find the inline room application script.');
const syncScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

const escapeHTML = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// This fixture implements only the DOM operations used by the inline app. It
// does not execute HTML, load resources, or emulate browser layout.
class FixtureElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.listeners = new Map();
    this.captures = new Set();
    this._markup = '';
    this._text = '';
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name) => {
        const added = !this.classList.contains(name);
        this.classList[added ? 'add' : 'remove'](name);
        return added;
      },
    };
  }

  get isConnected() { return Boolean(this._root || this.parentNode?.isConnected); }
  get clientWidth() { return Number.parseFloat(this.style.width) || this._clientWidth || 540; }
  set clientWidth(value) { this._clientWidth = value; }
  get scrollWidth() { return this._scrollWidth || this.clientWidth; }
  set scrollWidth(value) { this._scrollWidth = value; }
  get textContent() { return this._text + this.children.filter((child) => !child._fromMarkup).map((child) => child.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value ?? '');
    this._markup = escapeHTML(this._text);
  }
  get innerHTML() { return this._markup + this.children.filter((child) => !child._fromMarkup).map((child) => child.outerHTML).join(''); }
  set innerHTML(value) {
    this.replaceChildren();
    this._markup = String(value);
    this._text = this._markup.replace(/<[^>]*>/g, '');
    // The catalog attaches a click handler to its button after innerHTML.
    if (/<button\b/i.test(this._markup)) {
      const button = new FixtureElement('button');
      button._fromMarkup = true;
      this.appendChild(button);
    }
  }
  get outerHTML() { return `<${this.tagName.toLowerCase()}>${this.innerHTML}</${this.tagName.toLowerCase()}>`; }
  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    for (const child of children) {
      if (child instanceof FixtureElement) this.appendChild(child);
      else { const node = new FixtureElement('span'); node.textContent = child; this.appendChild(node); }
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._markup = '';
    this._text = '';
    this.append(...children);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) {
    if (selector.startsWith('.')) return selector.slice(1).split('.').every((name) => this.classList.contains(name));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const data = selector.match(/^\[data-([\w-]+)\]$/);
    if (data) return Object.hasOwn(this.dataset, data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== callback));
  }
  dispatch(type, event = {}) {
    event = {target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event, type};
    this[`on${type}`]?.(event);
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  scrollTo({left = 0, top = 0} = {}) { this.scrollLeft = left; this.scrollTop = top; }
}

function makeStorage(seed = {}) {
  const data = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const writes = [];
  return {
    data, writes,
    getItem: (key) => data.get(String(key)) ?? null,
    setItem: (key, value) => { data.set(String(key), String(value)); writes.push({key: String(key), value: String(value)}); },
    removeItem: (key) => data.delete(String(key)),
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
}

function createApp({storage = {}} = {}) {
  const body = new FixtureElement('body');
  body._root = true;
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const node = new FixtureElement(match[1]);
    node.id = match[2];
    node.className = match[0].match(/\bclass="([^"]*)"/)?.[1] || '';
    node.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
    nodes.set(node.id, node);
    body.appendChild(node);
  }
  for (const className of ['stage', 'roomShell']) {
    if (!body.querySelector(`.${className}`)) {
      const node = new FixtureElement(); node.className = className; body.appendChild(node);
    }
  }
  for (const match of html.matchAll(/<button\b[^>]*\bdata-(save|load)="([^"]+)"[^>]*>/gi)) {
    const node = new FixtureElement('button'); node.dataset[match[1]] = match[2]; body.appendChild(node);
  }
  nodes.get('moveStep').value = '50';
  const document = {
    body, visibilityState: 'visible',
    getElementById: (id) => nodes.get(id) || null,
    createElement: (name) => new FixtureElement(name),
    createElementNS: (_, name) => new FixtureElement(name),
    createTextNode: (value) => { const node = new FixtureElement('span'); node.textContent = value; return node; },
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: (...args) => body.addEventListener(...args),
  };
  const localStorage = makeStorage({ttobok_master_v318_migrated: '1', ...storage});
  const sessionStorage = makeStorage();
  const animationFrames = [];
  const timers = new Map();
  const alerts = [];
  let timerSeq = 0;
  let cloudSchedules = 0;
  const window = new FixtureElement('window');
  Object.assign(window, {
    innerWidth: 1800,
    scheduleCloudSave: () => { cloudSchedules += 1; },
    restartCloudRoom: () => {},
    cloudAppendItem: null,
  });
  const context = vm.createContext({
    document, window, localStorage, sessionStorage, console,
    alert: (message) => alerts.push(String(message)), confirm: () => true, prompt: () => null,
    requestAnimationFrame: (callback) => { animationFrames.push(callback); return animationFrames.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (callback) => { const id = ++timerSeq; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  window.document = document;
  const geometryPath = path.join(__dirname, '..', '..', 'geometry-core.js');
  vm.runInContext(fs.readFileSync(geometryPath, 'utf8'), context, {filename: 'geometry-core.js'});
  vm.runInContext(appScript, context, {filename: 'index.html:inline-app'});
  return {
    context, document, window, localStorage, alerts,
    node: (id) => nodes.get(id),
    run: (code) => vm.runInContext(code, context),
    get cloudSchedules() { return cloudSchedules; },
    get pendingTimers() { return timers.size; },
    loadSync(firestore) {
      if (!syncScript) throw new Error('Could not find the Firebase synchronization module.');
      // Keep the production sync implementation, replacing only its network
      // bootstrap with an explicitly supplied Firestore boundary fixture.
      const source = syncScript.replace(/\ninit\(\);\s*$/, '');
      if (source === syncScript) throw new Error('Could not isolate sync startup.');
      context.fixtureFirestore = firestore;
      vm.runInContext(source, context, {filename: 'index.html:sync-module'});
      vm.runInContext('M={f:fixtureFirestore};db={};user={uid:"test-user",email:"komorebi0802@gmail.com"};session=1;window.TTOBOK_IS_LOGGED_IN=true;', context);
    },
    resetActivity() { localStorage.writes.length = 0; cloudSchedules = 0; },
    flushFrames() {
      let count = 0;
      while (animationFrames.length) {
        if (++count > 100) throw new Error('Animation frame loop did not settle.');
        animationFrames.shift()(count);
      }
    },
    dispatchWindow: (type, event) => window.dispatch(type, event),
  };
}

module.exports = {createApp, FixtureElement};
