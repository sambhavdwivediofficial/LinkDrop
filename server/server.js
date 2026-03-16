const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const path       = require("path");
const { v4: uuidv4 } = require("uuid");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.use(cors());
app.use(express.json());

// ── Frontend serve karo (client/dist folder) ─────────────────────────────────
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

const rooms = new Map();

io.on("connection", socket => {

  socket.on("create-room", ({ passwordHash, meta }, cb) => {
    const roomId = uuidv4();
    rooms.set(roomId, {
      hostId:       socket.id,
      passwordHash,
      meta,
      createdAt:    Date.now(),
      receiverDone: false,
    });
    socket.join(roomId);
    cb({ roomId });
  });

  socket.on("check-room", ({ roomId }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ exists: false });
    if (!io.sockets.sockets.get(room.hostId)) return cb({ exists: false });
    cb({ exists: true });
  });

  socket.on("join-room", ({ roomId, passwordHash }, cb) => {
    const room = rooms.get(roomId);
    if (!room)                                return cb({ error: "No Data Found" });
    if (room.passwordHash !== passwordHash)   return cb({ error: "Galat password." });
    if (!io.sockets.sockets.get(room.hostId)) return cb({ error: "Sharer offline hai." });
    socket.join(roomId);
    cb({ ok: true, meta: room.meta, hostId: room.hostId });
    io.to(room.hostId).emit("peer-joined", { peerId: socket.id });
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("receiver-saved", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.receiverDone = true;
      io.to(room.hostId).emit("receiver-saved");
    }
  });

  socket.on("receiver-downloaded", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) io.to(room.hostId).emit("receiver-downloaded");
  });

  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      const room = rooms.get(roomId);
      if (!room) continue;
      if (room.hostId === socket.id) {
        if (!room.receiverDone) io.to(roomId).emit("host-left");
        rooms.delete(roomId);
      }
    }
  });

  setInterval(() => {
    const now = Date.now();
    for (const [id, r] of rooms) {
      if (now - r.createdAt > 24 * 60 * 60 * 1000) rooms.delete(id);
    }
  }, 60 * 60 * 1000);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`LinkDrop: http://localhost:${PORT}`));