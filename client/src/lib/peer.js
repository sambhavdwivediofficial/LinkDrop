import { io } from "socket.io-client";

const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || "http://localhost:5000";

export function createSocket() {
  return io(SIGNAL_URL, { transports: ["websocket", "polling"] });
}

export function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  let platform = "web-desktop";
  let deviceType = "Desktop";
  let os = "Unknown";
  let browser = "Unknown";

  if (/android/i.test(ua)) { os = "Android"; deviceType = "Mobile"; platform = "web-mobile"; }
  else if (/iphone/i.test(ua)) { os = "iOS"; deviceType = "Mobile"; platform = "web-mobile"; }
  else if (/ipad/i.test(ua)) { os = "iOS"; deviceType = "Tablet"; platform = "web-tablet"; }
  else if (/windows/i.test(ua)) { os = "Windows"; }
  else if (/mac/i.test(ua)) { os = "macOS"; }
  else if (/linux/i.test(ua)) { os = "Linux"; }

  if (/chrome/i.test(ua) && !/edg/i.test(ua)) browser = "Chrome";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
  else if (/edg/i.test(ua)) browser = "Edge";
  else if (/opr|opera/i.test(ua)) browser = "Opera";

  return { platform, deviceType, os, browser, ua: ua.slice(0, 120) };
}

export async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function buildMeta(files, text) {
  return {
    files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
    totalSize: files.reduce((a, f) => a + f.size, 0),
    hasText: !!text,
    textLength: text ? text.length : 0,
  };
}

const CHUNK_SIZE = 64 * 1024;

export class SenderPeer {
  constructor({ socket, files, text, onPeerConnected, onProgress, onDone, onError }) {
    this.socket = socket;
    this.files = files;
    this.text = text;
    this.onPeerConnected = onPeerConnected;
    this.onProgress = onProgress;
    this.onDone = onDone;
    this.onError = onError;
    this.pcs = {};
    this.channels = {};
    this.destroyed = false;
  }

  handlePeerJoined({ peerId }) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
    this.pcs[peerId] = pc;

    const channel = pc.createDataChannel("file-transfer", { ordered: true });
    this.channels[peerId] = channel;

    channel.onopen = () => {
      this.onPeerConnected?.();
      this._sendAll(channel, peerId);
    };
    channel.onerror = (e) => this.onError?.(e.message || "Channel error");

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit("signal", { to: peerId, data: { candidate } });
    };

    pc.createOffer().then((offer) => {
      pc.setLocalDescription(offer);
      this.socket.emit("signal", { to: peerId, data: { sdp: offer } });
    });
  }

  receiveSignal({ from, data }) {
    const pc = this.pcs[from];
    if (!pc) return;
    if (data.sdp) pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.candidate) pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }

  async _sendAll(channel, peerId) {
    try {
      if (this.text) await this._sendText(channel);
      for (let i = 0; i < this.files.length; i++) {
        await this._sendFile(channel, this.files[i], i);
      }
      channel.send(JSON.stringify({ type: "done" }));
      this.onDone?.();
    } catch (e) {
      this.onError?.(e.message);
    }
  }

  async _sendText(channel) {
    channel.send(JSON.stringify({ type: "text", content: this.text }));
    await new Promise((r) => setTimeout(r, 100));
  }

  async _sendFile(channel, file, fileIndex) {
    channel.send(JSON.stringify({ type: "file-start", name: file.name, size: file.size, index: fileIndex }));
    await new Promise((r) => setTimeout(r, 50));

    const buffer = await file.arrayBuffer();
    let offset = 0;

    while (offset < buffer.byteLength) {
      while (channel.bufferedAmount > 8 * 1024 * 1024) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      channel.send(chunk);
      offset += chunk.byteLength;
      const pct = Math.round((offset / buffer.byteLength) * 100);
      this.onProgress?.("peer", fileIndex, pct, offset, buffer.byteLength, file.name);
    }

    channel.send(JSON.stringify({ type: "file-end", name: file.name, index: fileIndex }));
    await new Promise((r) => setTimeout(r, 50));
  }

  destroy() {
    this.destroyed = true;
    Object.values(this.channels).forEach((c) => { try { c.close(); } catch {} });
    Object.values(this.pcs).forEach((pc) => { try { pc.close(); } catch {} });
  }
}

export class ReceiverPeer {
  constructor({ socket, hostId, onText, onFileStart, onFileProgress, onFileDone, onAllDone, onError }) {
    this.socket = socket;
    this.hostId = hostId;
    this.onText = onText;
    this.onFileStart = onFileStart;
    this.onFileProgress = onFileProgress;
    this.onFileDone = onFileDone;
    this.onAllDone = onAllDone;
    this.onError = onError;
    this.pc = null;
    this.currentFile = null;
    this.chunks = [];
    this.receivedBytes = 0;
    this._init();
  }

  _init() {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
    this.pc = pc;

    pc.ondatachannel = ({ channel }) => {
      channel.onmessage = ({ data }) => this._handleMessage(data);
      channel.onerror = (e) => this.onError?.(e.message || "Channel error");
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit("signal", { to: this.hostId, data: { candidate } });
    };
  }

  receiveSignal(data) {
    const pc = this.pc;
    if (!pc) return;
    if (data.sdp) {
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(() => {
        if (data.sdp.type === "offer") {
          pc.createAnswer().then((answer) => {
            pc.setLocalDescription(answer);
            this.socket.emit("signal", { to: this.hostId, data: { sdp: answer } });
          });
        }
      });
    }
    if (data.candidate) pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }

  _handleMessage(data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.type === "text") { this.onText?.(msg.content); }
      else if (msg.type === "file-start") {
        this.currentFile = { name: msg.name, size: msg.size, index: msg.index };
        this.chunks = [];
        this.receivedBytes = 0;
        this.onFileStart?.(this.currentFile);
      } else if (msg.type === "file-end") {
        const blob = new Blob(this.chunks);
        this.onFileDone?.(blob, this.currentFile.name);
        this.currentFile = null;
        this.chunks = [];
        this.receivedBytes = 0;
      } else if (msg.type === "done") {
        this.onAllDone?.();
      }
    } else {
      this.chunks.push(data);
      this.receivedBytes += data.byteLength || data.size || 0;
      if (this.currentFile) {
        const pct = Math.round((this.receivedBytes / this.currentFile.size) * 100);
        this.onFileProgress?.(pct, this.receivedBytes, this.currentFile.size, this.currentFile.name);
      }
    }
  }

  destroy() {
    try { this.pc?.close(); } catch {}
  }
}
