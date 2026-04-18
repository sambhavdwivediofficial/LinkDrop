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

// Cleanup expired sessions + delete from Firebase every hour
setInterval(async () => {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (data.expiresAt <= now) {
      sessions.delete(token);
      try { await admin.auth().deleteUser(data.uid); } catch {}
    }
  }
}, 60 * 60 * 1000);

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

// ── POST /api/auth/verify ─────────────────────────────────────────────────
app.post("/api/auth/verify", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken is required." });

  try {
    const decoded      = await admin.auth().verifyIdToken(idToken);
    const sessionToken = crypto.randomBytes(48).toString("hex");
    const expiresAt    = Date.now() + SESSION_DURATION_MS;

    sessions.set(sessionToken, {
      uid: decoded.uid, email: decoded.email, name: decoded.name, expiresAt,
    });

    return res.json({ sessionToken, expiresAt });
  } catch {
    return res.status(401).json({ error: "Invalid or expired Google token." });
  }
});

// ── GET /api/auth/session ─────────────────────────────────────────────────
app.get("/api/auth/session", requireAuth, (req, res) => {
  return res.json({
    uid: req.session.uid, email: req.session.email, expiresAt: req.session.expiresAt,
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = (req.headers["authorization"] || "").slice(7);
  sessions.delete(token);
  return res.json({ ok: true });
});

// ── Rooms ─────────────────────────────────────────────────────────────────
const rooms = new Map();

io.on("connection", (socket) => {

  socket.on("check-room", ({ roomId }, cb) => {
    cb({ exists: rooms.has(roomId) });
  });

  socket.on("create-room", ({ passwordHash, meta }, cb) => {
    const roomId = uuidv4().replace(/-/g, "");
    rooms.set(roomId, { passwordHash, hostId: socket.id, meta, peers: new Set() });
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