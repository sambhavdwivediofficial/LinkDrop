import { io } from "socket.io-client";

const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || "";
const CHUNK      = 256 * 1024; // 256KB chunks
const ICE        = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

export function createSocket() {
  return io(SIGNAL_URL, { transports: ["websocket", "polling"] });
}

export async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

export function formatBytes(b) {
  if (!b) return "0 B";
  const k = 1024, s = ["B","KB","MB","GB","TB","PB"], i = Math.floor(Math.log(b)/Math.log(k));
  return `${parseFloat((b/Math.pow(k,i)).toFixed(2))} ${s[i]}`;
}

export function buildMeta(files, text) {
  return {
    hasFiles:    !!(files && files.length),
    hasText:     !!(text && text.trim()),
    files:       files ? files.map(f=>({ name:f.name, size:f.size, type:f.type||"application/octet-stream" })) : [],
    totalSize:   files ? files.reduce((a,f)=>a+f.size,0) : 0,
    textLength:  text ? text.trim().length : 0,
    textPreview: text ? text.trim().slice(0,80) : null,
  };
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

async function readChunk(file, start, size) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload  = ()=>res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file.slice(start, start+size));
  });
}

// ── SENDER (Initiator) ────────────────────────────────────────────────────────
export class SenderPeer {
  constructor({ socket, files, text, onPeerConnected, onProgress, onDone, onError }) {
    this.socket          = socket;
    this.files           = files || [];
    this.text            = text ? text.trim() : null;
    this.onPeerConnected = onPeerConnected;
    this.onProgress      = onProgress;
    this.onDone          = onDone;
    this.onError         = onError;
    this.pcMap           = new Map();
    this.dcMap           = new Map();
  }

  async handlePeerJoined({ peerId }) {
    try {
      const pc = new RTCPeerConnection(ICE);
      const dc = pc.createDataChannel("transfer", { ordered: true });
      this.pcMap.set(peerId, pc);
      this.dcMap.set(peerId, dc);

      pc.onicecandidate = e => {
        if (e.candidate) this.socket.emit("signal", { to: peerId, data: { type:"candidate", candidate: e.candidate } });
      };

      dc.onopen = () => {
        this.onPeerConnected(peerId);
        this._sendAll(dc, peerId);
      };

      dc.onerror = e => this.onError(e.error?.message || "DataChannel error");

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit("signal", { to: peerId, data: { type:"offer", sdp: offer } });
    } catch(e) { this.onError(e.message); }
  }

  async receiveSignal({ from, data }) {
    const pc = this.pcMap.get(from);
    if (!pc) return;
    try {
      if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch(e) { this.onError(e.message); }
  }

  async _sendAll(dc, peerId) {
    const send = (data) => new Promise((res) => {
      const check = () => {
        if (dc.bufferedAmount < 2 * 1024 * 1024) { dc.send(data); res(); }
        else setTimeout(check, 20);
      };
      check();
    });

    const sendJson = async (obj) => { await send(JSON.stringify(obj)); await sleep(30); };

    try {
      // Send text
      if (this.text) {
        const bytes = new TextEncoder().encode(this.text);
        await sendJson({ cmd:"meta-text", size: bytes.byteLength });
        for (let off=0; off<bytes.byteLength; off+=CHUNK) {
          await send(bytes.slice(off, off+CHUNK).buffer);
        }
        await sendJson({ cmd:"text-done" });
        await sleep(80);
      }

      // Send files
      for (let fi=0; fi<this.files.length; fi++) {
        const file = this.files[fi];
        await sendJson({ cmd:"meta-file", index:fi, total:this.files.length, name:file.name, size:file.size, type:file.type||"application/octet-stream" });
        let offset = 0;
        while (offset < file.size) {
          const buf = await readChunk(file, offset, CHUNK);
          await send(buf);
          offset += buf.byteLength;
          this.onProgress(peerId, fi, Math.round((offset/file.size)*100), offset, file.size, file.name);
        }
        await sendJson({ cmd:"file-done", index:fi });
        await sleep(80);
      }

      await sendJson({ cmd:"all-done" });
      this.onDone(peerId);
    } catch(e) { this.onError(e.message); }
  }

  destroy() {
    this.dcMap.forEach(dc => { try { dc.close(); } catch {} });
    this.pcMap.forEach(pc => { try { pc.close(); } catch {} });
    this.dcMap.clear(); this.pcMap.clear();
  }
}

// ── RECEIVER (Non-initiator) ──────────────────────────────────────────────────
export class ReceiverPeer {
  constructor({ socket, hostId, onText, onFileStart, onFileProgress, onFileDone, onAllDone, onError }) {
    this.socket         = socket;
    this.hostId         = hostId;
    this.onText         = onText;
    this.onFileStart    = onFileStart;
    this.onFileProgress = onFileProgress;
    this.onFileDone     = onFileDone;
    this.onAllDone      = onAllDone;
    this.onError        = onError;

    this.pc             = null;
    this.mode           = "idle";
    this.textBufs       = []; this.textSize = 0; this.textRecv = 0;
    this.fileBufs       = []; this.fileMeta = null; this.fileRecv = 0;

    this._init();
  }

  _init() {
    try {
      const pc = new RTCPeerConnection(ICE);
      this.pc = pc;

      pc.onicecandidate = e => {
        if (e.candidate) this.socket.emit("signal", { to: this.hostId, data: { type:"candidate", candidate: e.candidate } });
      };

      pc.ondatachannel = e => {
        const dc = e.channel;
        dc.binaryType = "arraybuffer";
        dc.onmessage  = ev => this._onData(ev.data);
        dc.onerror    = err => this.onError(err.error?.message || "DataChannel error");
      };
    } catch(e) { this.onError(e.message); }
  }

  async receiveSignal(data) {
    const pc = this.pc;
    if (!pc) return;
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit("signal", { to: this.hostId, data: { type:"answer", sdp: answer } });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === "candidate") {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch(e) { this.onError(e.message); }
  }

  _tryJson(data) {
    if (typeof data !== "string") return null;
    try { return JSON.parse(data); } catch { return null; }
  }

  _onData(raw) {
    const cmd = this._tryJson(raw);
    if (cmd) {
      if (cmd.cmd === "meta-text")  { this.mode="text"; this.textBufs=[]; this.textSize=cmd.size; this.textRecv=0; return; }
      if (cmd.cmd === "text-done")  {
        const out = new Uint8Array(this.textRecv); let o=0;
        for (const b of this.textBufs) { const a=new Uint8Array(b); out.set(a,o); o+=a.length; }
        this.onText(new TextDecoder().decode(out));
        this.mode="idle"; return;
      }
      if (cmd.cmd === "meta-file")  { this.mode="file"; this.fileMeta=cmd; this.fileBufs=[]; this.fileRecv=0; this.onFileStart(cmd); return; }
      if (cmd.cmd === "file-done")  {
        const blob = new Blob(this.fileBufs, { type: this.fileMeta.type });
        this.onFileDone(blob, this.fileMeta.name, this.fileMeta.index);
        this.fileBufs=[]; this.fileRecv=0; this.mode="idle"; return;
      }
      if (cmd.cmd === "all-done")   { this.onAllDone(); return; }
      return;
    }

    // Binary chunk
    const buf = raw instanceof ArrayBuffer ? raw : raw.buffer;
    if (this.mode === "text") {
      this.textBufs.push(buf); this.textRecv += buf.byteLength;
    } else if (this.mode === "file") {
      this.fileBufs.push(buf); this.fileRecv += buf.byteLength;
      const pct = this.fileMeta ? Math.round((this.fileRecv/this.fileMeta.size)*100) : 0;
      this.onFileProgress(pct, this.fileRecv, this.fileMeta?.size||0, this.fileMeta?.name||"");
    }
  }

  destroy() { try { this.pc?.close(); } catch {} }
}