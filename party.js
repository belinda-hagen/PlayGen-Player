// ═══════════════════════════════════════════════════════════════════
// PlayGen — Listen Together
// Host-side HTTP server (state sync + audio streaming) and LAN
// discovery over UDP broadcast. Zero external dependencies.
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PROTOCOL = 'playgen-party/1';
const DEFAULT_PORT = 8420;
const PORT_ATTEMPTS = 20;
const DISCOVERY_PORT = 8421;
const ANNOUNCE_INTERVAL = 2000;
const DISCOVERY_TTL = 7000;
const JOIN_GRACE_MS = 20000;   // drop listeners that join but never open the event stream
const MAX_BODY = 64 * 1024;

// Identifies this app instance so we never list our own party as joinable.
const instanceId = crypto.randomUUID();

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

// ── Host state ─────────────────────────────────────────────────────
let server = null;
let party = null;              // { name, hostName, port, address, joinCode, allowGuestControl, ... }
let listeners = new Map();     // listenerId -> { id, name, res, connected, joinedAt }
let snapshot = null;           // last player state pushed by the host renderer
let sweepTimer = null;

const hooks = {
  resolveSong: () => null,     // (songId) => song row from the library
  onListeners: () => {},       // (listeners[]) => void
  onRequest: () => {}          // ({ action, value, listener }) => void
};

// ── Network helpers ────────────────────────────────────────────────
function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8 >>> 0) + (+part), 0) >>> 0;
}

function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Every usable IPv4 interface, best candidate first. Private ranges rank
// above anything else because that is where a listening party lives.
function getLocalAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family !== 'IPv4' && addr.family !== 4) continue;
      if (addr.internal) continue;
      out.push({ name, address: addr.address, netmask: addr.netmask });
    }
  }
  const rank = (ip) => {
    if (ip.startsWith('192.168.')) return 0;
    if (ip.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
    if (ip.startsWith('169.254.')) return 9;
    return 5;
  };
  return out.sort((a, b) => rank(a.address) - rank(b.address));
}

function getBroadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const iface of getLocalAddresses()) {
    if (!iface.netmask) continue;
    try {
      const bcast = (ipToInt(iface.address) | (~ipToInt(iface.netmask) >>> 0)) >>> 0;
      out.add(intToIp(bcast));
    } catch { /* skip malformed interface */ }
  }
  return [...out];
}

// ── HTTP helpers ───────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sanitizeName(value, fallback) {
  const name = String(value ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 32);
  return name || fallback;
}

// ── Listener bookkeeping ───────────────────────────────────────────
function listenerList() {
  return [...listeners.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(l => ({ id: l.id, name: l.name, connected: Boolean(l.connected) }));
}

function sseSend(listener, event, data) {
  if (!listener.res || listener.res.writableEnded) return;
  try {
    listener.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* connection went away; the close handler cleans up */ }
}

function broadcast(event, data) {
  for (const listener of listeners.values()) sseSend(listener, event, data);
}

function broadcastListeners() {
  const list = listenerList();
  broadcast('listeners', { listeners: list });
  hooks.onListeners(list);
}

function dropListener(id, reason) {
  const listener = listeners.get(id);
  if (!listener) return;
  if (reason) sseSend(listener, 'closed', { reason });
  listeners.delete(id);
  try { listener.res?.end(); } catch { /* already gone */ }
  broadcastListeners();
}

// Guests that request a join but never open the event stream (crashed,
// firewalled, or just probing) would otherwise sit in the list forever.
function sweepStaleListeners() {
  const now = Date.now();
  let changed = false;
  for (const listener of [...listeners.values()]) {
    if (listener.connected) continue;
    if (now - listener.joinedAt < JOIN_GRACE_MS) continue;
    listeners.delete(listener.id);
    changed = true;
  }
  if (changed) broadcastListeners();
}

// ── State payload ──────────────────────────────────────────────────
// `sentAt` lets each guest measure how long the message spent in flight
// and on their own event loop, so they can extrapolate the true playhead.
function statePayload() {
  return {
    ...(snapshot || { song: null, isPlaying: false, position: 0, duration: 0 }),
    sentAt: Date.now(),
    allowGuestControl: Boolean(party?.allowGuestControl)
  };
}

// ── File streaming ─────────────────────────────────────────────────
function streamFile(req, res, filePath, { cache = true } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return json(res, 404, { error: 'File not found' });
  }

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache ? 'public, max-age=3600' : 'no-store'
  };

  const range = req.headers.range;
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());

  if (match) {
    let start = match[1] === '' ? null : parseInt(match[1], 10);
    let end = match[2] === '' ? null : parseInt(match[2], 10);

    if (start === null && end === null) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    if (start === null) {                      // suffix range: the last N bytes
      start = Math.max(0, stat.size - end);
      end = stat.size - 1;
    }
    if (end === null || end >= stat.size) end = stat.size - 1;

    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }

    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ── Request routing ────────────────────────────────────────────────
async function handleRequest(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let url;
  try {
    url = new URL(req.url, 'http://playgen.local');
  } catch {
    return json(res, 400, { error: 'Bad request' });
  }

  const route = url.pathname.replace(/\/+$/, '') || '/';

  // Anyone may probe: this is how a guest verifies an address before joining.
  if (route === '/api/ping') {
    return json(res, 200, {
      app: PROTOCOL,
      instanceId,
      party: party && {
        name: party.name,
        hostName: party.hostName,
        requiresCode: Boolean(party.joinCode),
        listeners: listeners.size
      }
    });
  }

  if (!party) return json(res, 503, { error: 'No party is running' });

  if (route === '/api/join' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 413, { error: 'Request too large' });
    }

    if (party.joinCode && String(body.code || '').trim() !== party.joinCode) {
      return json(res, 401, { error: 'Wrong join code' });
    }

    const id = crypto.randomUUID();
    listeners.set(id, {
      id,
      name: sanitizeName(body.name, 'Listener'),
      res: null,
      connected: false,
      joinedAt: Date.now()
    });
    broadcastListeners();

    return json(res, 200, {
      ok: true,
      listenerId: id,
      party: { name: party.name, hostName: party.hostName },
      state: statePayload(),
      listeners: listenerList()
    });
  }

  if (route === '/api/events') {
    const listener = listeners.get(url.searchParams.get('listener') || '');
    if (!listener) return json(res, 403, { error: 'Not joined' });

    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': welcome\n\n');

    listener.res = res;
    listener.connected = true;
    sseSend(listener, 'state', statePayload());
    broadcastListeners();

    req.on('close', () => {
      if (listeners.get(listener.id) === listener) {
        listeners.delete(listener.id);
        broadcastListeners();
      }
    });
    return;
  }

  if (route === '/api/leave' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 413, { error: 'Request too large' });
    }
    dropListener(String(body.listenerId || ''));
    return json(res, 200, { ok: true });
  }

  if (route === '/api/request' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 413, { error: 'Request too large' });
    }
    const listener = listeners.get(String(body.listenerId || ''));
    if (!listener) return json(res, 403, { error: 'Not joined' });
    if (!party.allowGuestControl) return json(res, 403, { error: 'The host has locked the controls' });

    const action = String(body.action || '');
    if (!['toggle', 'next', 'prev', 'seek'].includes(action)) {
      return json(res, 400, { error: 'Unknown action' });
    }
    hooks.onRequest({
      action,
      value: Number(body.value) || 0,
      listener: { id: listener.id, name: listener.name }
    });
    return json(res, 200, { ok: true });
  }

  const track = /^\/api\/track\/([^/]+)\/(audio|cover)$/.exec(route);
  if (track) {
    // The library is only reachable by someone who successfully joined.
    if (!listeners.has(url.searchParams.get('t') || '')) {
      return json(res, 403, { error: 'Not joined' });
    }
    const song = hooks.resolveSong(decodeURIComponent(track[1]));
    if (!song) return json(res, 404, { error: 'Unknown track' });

    if (track[2] === 'cover') {
      if (!song.coverPath) return json(res, 404, { error: 'No cover art' });
      return streamFile(req, res, song.coverPath);
    }
    if (!song.filePath) return json(res, 404, { error: 'No audio file' });
    return streamFile(req, res, song.filePath, { cache: false });
  }

  return json(res, 404, { error: 'Not found' });
}

// ── Host lifecycle ─────────────────────────────────────────────────
function listenOnFreePort(srv, port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      srv.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        resolve(listenOnFreePort(srv, port + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      srv.removeListener('error', onError);
      resolve(port);
    };
    srv.once('error', onError);
    srv.once('listening', onListening);
    srv.listen(port, '0.0.0.0');
  });
}

async function startHost(options = {}) {
  if (server) return { ok: false, error: 'A party is already running' };

  const srv = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.destroy();
    });
  });
  srv.on('clientError', (err, socket) => socket.destroy());

  let port;
  try {
    port = await listenOnFreePort(srv, DEFAULT_PORT, PORT_ATTEMPTS);
  } catch (err) {
    try { srv.close(); } catch { /* never listened */ }
    return {
      ok: false,
      error: err.code === 'EACCES' ? 'The system blocked the network port' : (err.message || String(err))
    };
  }

  server = srv;
  listeners = new Map();
  snapshot = options.state || null;

  const hostName = sanitizeName(options.hostName, 'Host');
  const addresses = getLocalAddresses().map(a => a.address);
  party = {
    name: sanitizeName(options.partyName, `${hostName}'s party`),
    hostName,
    port,
    address: addresses[0] || '127.0.0.1',
    addresses,
    joinCode: options.requireCode ? String(Math.floor(1000 + Math.random() * 9000)) : null,
    allowGuestControl: Boolean(options.allowGuestControl),
    startedAt: Date.now()
  };

  sweepTimer = setInterval(sweepStaleListeners, 5000);
  startAnnounce();

  return { ok: true, party: publicParty() };
}

function stopHost() {
  if (!server) return { ok: true };

  broadcast('closed', { reason: 'ended' });
  for (const listener of listeners.values()) {
    try { listener.res?.end(); } catch { /* already gone */ }
  }
  listeners.clear();

  stopAnnounce();
  clearInterval(sweepTimer);
  sweepTimer = null;

  const srv = server;
  server = null;
  party = null;
  snapshot = null;
  try { srv.closeAllConnections?.(); } catch { /* older runtime */ }
  try { srv.close(); } catch { /* already closing */ }

  return { ok: true };
}

function publicParty() {
  if (!party) return null;
  return {
    name: party.name,
    hostName: party.hostName,
    port: party.port,
    address: party.address,
    addresses: party.addresses,
    joinCode: party.joinCode,
    allowGuestControl: party.allowGuestControl,
    invite: `${party.address}:${party.port}`,
    listeners: listenerList()
  };
}

function updateState(playerState) {
  if (!party) return { ok: false };
  snapshot = playerState || null;
  broadcast('state', statePayload());
  return { ok: true };
}

function setAllowGuestControl(allow) {
  if (!party) return { ok: false };
  party.allowGuestControl = Boolean(allow);
  broadcast('state', statePayload());
  return { ok: true, allowGuestControl: party.allowGuestControl };
}

function kickListener(listenerId) {
  if (!party) return { ok: false };
  dropListener(String(listenerId || ''), 'removed');
  return { ok: true };
}

function getHostStatus() {
  return { hosting: Boolean(party), party: publicParty() };
}

function setHooks(next = {}) {
  Object.assign(hooks, next);
}

// ── Discovery: announcing ──────────────────────────────────────────
let announceSocket = null;
let announceTimer = null;

function startAnnounce() {
  if (announceSocket) return;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  announceSocket = socket;

  socket.on('error', () => stopAnnounce());
  socket.bind(() => {
    try { socket.setBroadcast(true); } catch { /* some adapters refuse */ }
    const tick = () => {
      if (!party || announceSocket !== socket) return;
      const message = Buffer.from(JSON.stringify({
        proto: PROTOCOL,
        instanceId,
        name: party.name,
        hostName: party.hostName,
        port: party.port,
        listeners: listeners.size,
        requiresCode: Boolean(party.joinCode)
      }));
      for (const target of getBroadcastAddresses()) {
        socket.send(message, DISCOVERY_PORT, target, () => { /* best effort */ });
      }
    };
    tick();
    announceTimer = setInterval(tick, ANNOUNCE_INTERVAL);
  });
}

function stopAnnounce() {
  clearInterval(announceTimer);
  announceTimer = null;
  if (announceSocket) {
    try { announceSocket.close(); } catch { /* already closed */ }
    announceSocket = null;
  }
}

// ── Discovery: browsing ────────────────────────────────────────────
let browseSocket = null;
let browseTimer = null;
let onDiscovered = null;
const discovered = new Map();   // instanceId -> { ...announce, address, seenAt }

function discoveredList() {
  return [...discovered.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({
      id: p.instanceId,
      name: p.name,
      hostName: p.hostName,
      address: p.address,
      port: p.port,
      listeners: p.listeners,
      requiresCode: p.requiresCode
    }));
}

function pushDiscovered() {
  onDiscovered?.(discoveredList());
}

function startBrowsing(callback) {
  if (callback) onDiscovered = callback;
  if (browseSocket) {
    pushDiscovered();
    return { ok: true };
  }

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  browseSocket = socket;

  socket.on('error', () => stopBrowsing());
  socket.on('message', (buf, rinfo) => {
    let data;
    try {
      data = JSON.parse(buf.toString('utf-8'));
    } catch {
      return;
    }
    if (data.proto !== PROTOCOL) return;
    if (!data.instanceId || data.instanceId === instanceId) return;   // never list our own party
    if (!Number.isInteger(data.port)) return;

    const count = Number(data.listeners) || 0;
    const previous = discovered.get(data.instanceId);
    discovered.set(data.instanceId, {
      instanceId: data.instanceId,
      name: sanitizeName(data.name, 'Listening party'),
      hostName: sanitizeName(data.hostName, 'Host'),
      port: data.port,
      address: rinfo.address,
      listeners: count,
      requiresCode: Boolean(data.requiresCode),
      seenAt: Date.now()
    });
    if (!previous || previous.listeners !== count) pushDiscovered();
  });

  socket.bind(DISCOVERY_PORT, () => {
    try { socket.setBroadcast(true); } catch { /* not fatal for receiving */ }
  });

  browseTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of discovered) {
      if (now - entry.seenAt > DISCOVERY_TTL) {
        discovered.delete(id);
        changed = true;
      }
    }
    if (changed) pushDiscovered();
  }, 2000);

  return { ok: true };
}

function stopBrowsing() {
  clearInterval(browseTimer);
  browseTimer = null;
  discovered.clear();
  if (browseSocket) {
    try { browseSocket.close(); } catch { /* already closed */ }
    browseSocket = null;
  }
  return { ok: true };
}

function shutdown() {
  stopHost();
  stopBrowsing();
}

module.exports = {
  DEFAULT_PORT,
  startHost,
  stopHost,
  updateState,
  setAllowGuestControl,
  kickListener,
  getHostStatus,
  setHooks,
  startBrowsing,
  stopBrowsing,
  getDiscovered: discoveredList,
  getLocalAddresses,
  shutdown
};
