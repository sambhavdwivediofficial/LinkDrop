require("dotenv").config();

const express        = require("express");
const http           = require("http");
const { Server }     = require("socket.io");
const cors           = require("cors");
const { v4: uuidv4 } = require("uuid");
const admin          = require("firebase-admin");
const crypto         = require("crypto");

// ── Firebase Admin init ───────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

admin.initializeApp({
  credential: serviceAccount
    ? admin.credential.cert(serviceAccount)
    : admin.credential.applicationDefault(),
});

// ── Session store ─────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_DURATION_MS = 4 * 24 * 60 * 60 * 1000; // 4 days

// ── Global stats ──────────────────────────────────────────────────────────
const stats = {
  totalBytesTransferred: 0,
  totalTransfers:        0,
  totalLogins:           0,
  serverStartTime:       Date.now(),
};

// ── Cleanup expired sessions + Firebase delete ────────────────────────────
async function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (data.expiresAt <= now) {
      sessions.delete(token);
      try { await admin.auth().deleteUser(data.uid); } catch {}
    }
  }
}

// ── Express + Socket.IO ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth  = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided." });
  const session = sessions.get(token);
  if (!session) return res.status(401).json({ error: "Invalid session." });
  if (Date.now() >= session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: "Session expired." });
  }
  req.session = session;
  next();
}

// ── Admin secret middleware ───────────────────────────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || "linkdrop-admin-secret-2025";
function requireAdmin(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden." });
  next();
}

// ═════════════════════════════════════════════════════════════════════════
// ── ADMIN APIs ────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════

// GET /admin/stats — server stats
app.get("/admin/stats", requireAdmin, (req, res) => {
  res.json({
    totalBytesTransferred: stats.totalBytesTransferred,
    totalTransfers:        stats.totalTransfers,
    totalLogins:           stats.totalLogins,
    activeSessions:        sessions.size,
    activeRooms:           rooms.size,
    uptime:                Date.now() - stats.serverStartTime,
    serverStartTime:       stats.serverStartTime,
  });
});

// GET /admin/sessions — all logged-in users
app.get("/admin/sessions", requireAdmin, (req, res) => {
  const list = [];
  for (const [token, data] of sessions) {
    list.push({
      token:     token.slice(0, 12) + "...",
      fullToken: token,
      uid:       data.uid,
      email:     data.email,
      name:      data.name,
      expiresAt: data.expiresAt,
      loginAt:   data.loginAt,
    });
  }
  res.json(list);
});

// GET /admin/rooms — all active transfer rooms
app.get("/admin/rooms", requireAdmin, (req, res) => {
  const list = [];
  for (const [roomId, room] of rooms) {
    list.push({
      roomId,
      hostId:    room.hostId,
      peers:     [...room.peers],
      meta:      room.meta,
      createdAt: room.createdAt,
      hostEmail: room.hostEmail || null,
    });
  }
  res.json(list);
});

// DELETE /admin/session/:uid — force logout user (delete session by uid)
app.delete("/admin/session/:uid", requireAdmin, (req, res) => {
  const { uid } = req.params;
  let found = false;
  for (const [token, data] of sessions) {
    if (data.uid === uid) {
      sessions.delete(token);
      found = true;
    }
  }
  if (found) return res.json({ ok: true, message: "User force-logged out." });
  res.status(404).json({ error: "Session not found." });
});

// DELETE /admin/firebase/:uid — delete user from Firebase
app.delete("/admin/firebase/:uid", requireAdmin, async (req, res) => {
  const { uid } = req.params;
  // Also remove from sessions
  for (const [token, data] of sessions) {
    if (data.uid === uid) sessions.delete(token);
  }
  try {
    await admin.auth().deleteUser(uid);
    res.json({ ok: true, message: "User deleted from Firebase." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /admin/room/:roomId — force kill a transfer room
app.delete("/admin/room/:roomId", requireAdmin, (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: "Room not found." });
  io.to(roomId).emit("host-left");
  rooms.delete(roomId);
  res.json({ ok: true, message: "Room killed." });
});

// GET /admin/firebase/users — list all Firebase users
app.get("/admin/firebase/users", requireAdmin, async (req, res) => {
  try {
    const result = await admin.auth().listUsers(1000);
    const users  = result.users.map(u => ({
      uid:          u.uid,
      email:        u.email,
      displayName:  u.displayName,
      creationTime: u.metadata.creationTime,
      lastSignIn:   u.metadata.lastSignInTime,
      disabled:     u.disabled,
    }));
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/firebase/disable/:uid — disable Firebase user
app.post("/admin/firebase/disable/:uid", requireAdmin, async (req, res) => {
  try {
    await admin.auth().updateUser(req.params.uid, { disabled: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /admin/firebase/enable/:uid — enable Firebase user
app.post("/admin/firebase/enable/:uid", requireAdmin, async (req, res) => {
  try {
    await admin.auth().updateUser(req.params.uid, { disabled: false });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /admin/broadcast — send message to all connected sockets
app.post("/admin/broadcast", requireAdmin, (req, res) => {
  const { message } = req.body;
  io.emit("admin-broadcast", { message });
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════
// ── AUTH APIs (existing) ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════

app.post("/api/auth/verify", async (req, res) => {
  await cleanupExpiredSessions();
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken is required." });
  try {
    const decoded      = await admin.auth().verifyIdToken(idToken);
    const sessionToken = crypto.randomBytes(48).toString("hex");
    const expiresAt    = Date.now() + SESSION_DURATION_MS;
    sessions.set(sessionToken, {
      uid: decoded.uid, email: decoded.email, name: decoded.name,
      expiresAt, loginAt: Date.now(),
    });
    stats.totalLogins++;
    return res.json({ sessionToken, expiresAt });
  } catch {
    return res.status(401).json({ error: "Invalid or expired Google token." });
  }
});

app.get("/api/auth/session", requireAuth, async (req, res) => {
  await cleanupExpiredSessions();
  return res.json({
    uid: req.session.uid, email: req.session.email, expiresAt: req.session.expiresAt,
  });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = (req.headers["authorization"] || "").slice(7);
  sessions.delete(token);
  return res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════
// ── ROOMS + SOCKET.IO (existing) ──────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════

const rooms = new Map();

io.on("connection", (socket) => {

  socket.on("check-room", ({ roomId }, cb) => {
    cb({ exists: rooms.has(roomId) });
  });

  socket.on("create-room", ({ passwordHash, meta }, cb) => {
    const roomId = uuidv4().replace(/-/g, "");
    // Find host email from sessions
    let hostEmail = null;
    for (const [, data] of sessions) {
      if (socket.handshake && data.uid) hostEmail = data.email;
    }
    rooms.set(roomId, {
      passwordHash, hostId: socket.id, meta,
      peers: new Set(), createdAt: Date.now(), hostEmail,
    });
    socket.join(roomId);
    socket.roomId = roomId;
    cb({ roomId });
  });

  socket.on("join-room", ({ roomId, passwordHash }, cb) => {
    const room = rooms.get(roomId);
    if (!room)                              return cb({ error: "Room not found or expired." });
    if (room.passwordHash !== passwordHash) return cb({ error: "Incorrect password." });
    room.peers.add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    io.to(room.hostId).emit("peer-joined", { peerId: socket.id });
    cb({ hostId: room.hostId, meta: room.meta });
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("receiver-saved", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) io.to(room.hostId).emit("receiver-saved");
  });

  socket.on("receiver-downloaded", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      // Track stats
      if (room.meta && room.meta.totalSize) {
        stats.totalBytesTransferred += room.meta.totalSize;
      }
      stats.totalTransfers++;
      io.to(room.hostId).emit("receiver-downloaded");
      rooms.delete(roomId);
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostId === socket.id) {
      io.to(roomId).emit("host-left");
      rooms.delete(roomId);
    } else {
      room.peers.delete(socket.id);
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT);