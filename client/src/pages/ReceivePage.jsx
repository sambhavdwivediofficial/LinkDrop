import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { createSocket, sha256, formatBytes, ReceiverPeer } from "../lib/peer";
import { saveSession, loadSession, deleteSession } from "../lib/idb";
import {
  IconLock, IconDownload, IconEye, IconEyeOff,
  IconFile, IconText, IconAlert, IconCheck
} from "../lib/icons";
import "../index.css";

const STEPS = {
  LOADING:    "loading",
  NOT_FOUND:  "not_found",
  LOCK:       "lock",
  CONNECTING: "connecting",
  RECEIVING:  "receiving",
  DONE:       "done",
  ERROR:      "error"
};

// ── Admin Toast ────────────────────────────────────────────────────────────
function AdminToast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 99999,
      background: "rgba(0,0,0,0.95)", border: "1px solid rgba(255,80,80,0.6)",
      padding: "14px 20px", maxWidth: 360, fontSize: 13,
      color: "#ffb0b0", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-start", gap: 12,
      borderRadius: 4, boxShadow: "0 0 20px rgba(255,80,80,0.15)",
      animation: "fadeIn 0.3s ease"
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}></span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: "#ff5050", marginBottom: 4 }}>ADMIN MESSAGE</div>
        <div style={{ color: "#eee", lineHeight: 1.5 }}>{message}</div>
      </div>
      <button onClick={onClose} style={{
        background: "none", border: "none", color: "#888",
        cursor: "pointer", fontSize: 16, flexShrink: 0, padding: 0
      }}>✕</button>
    </div>
  );
}

export default function ReceivePage() {
  const { roomId }          = useParams();
  const [step, setStep]     = useState(STEPS.LOADING);
  const [pw, setPw]         = useState("");
  const [showPw, setShowP]  = useState(false);
  const [error, setError]   = useState("");
  const [meta, setMeta]     = useState(null);
  const [overallPct, setOv] = useState(0);
  const [statusMsg, setStat]= useState("");
  const [receivedText, setRText]   = useState(null);
  const [receivedFiles, setRFiles] = useState([]);
  const [copied, setCopied]        = useState(false);
  const [fromCache, setFromCache]  = useState(false);
  const [allDownloaded, setAllDl]  = useState(false);
  const [unlocking, setUnlocking]  = useState(false);
  const [adminToast, setAdminToast] = useState(null);
  const downloadedCount = useRef(0);
  const socketRef   = useRef(null);
  const receiverRef = useRef(null);

  // ── Register page + persistent admin event listener ───────────────────
  useEffect(() => {
    const session = (() => {
      try { return JSON.parse(localStorage.getItem("ld_session") || "{}"); } catch { return {}; }
    })();
    const adminSocket = createSocket();
    adminSocket.on("connect", () => {
      adminSocket.emit("register-page", { page: "receive", uid: session.uid || null });
    });
    adminSocket.on("admin-broadcast", ({ message }) => {
      setAdminToast(message);
    });
    adminSocket.on("admin-kicked", ({ reason }) => {
      localStorage.removeItem("ld_session");
      setAdminToast(`⚠ ${reason}`);
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    });
    return () => adminSocket.disconnect();
  }, []);

  useEffect(() => {
    loadSession(roomId).then(cached => {
      if (cached && (cached.files?.length > 0 || cached.text)) {
        setRText(cached.text || null);
        setRFiles(cached.files || []);
        setFromCache(true);
        setStep(STEPS.DONE);
        return;
      }

      const socket = createSocket();
      socketRef.current = socket;

      const session = (() => {
        try { return JSON.parse(localStorage.getItem("ld_session") || "{}"); } catch { return {}; }
      })();

      socket.on("connect", () => {
        socket.emit("register-page", { page: "receive", uid: session.uid || null });
        socket.emit("check-room", { roomId }, ({ exists }) => {
          if (!exists) {
            socket.disconnect();
            setStep(STEPS.NOT_FOUND);
          } else {
            socket.disconnect();
            socketRef.current = null;
            setStep(STEPS.LOCK);
          }
        });
      });

      socket.on("connect_error", () => {
        setStep(STEPS.LOCK);
      });
    }).catch(() => setStep(STEPS.LOCK));

    return () => {
      socketRef.current?.disconnect();
      receiverRef.current?.destroy();
    };
  }, [roomId]);

  const notifyDownloaded = (socket) => {
    if (socket) socket.emit("receiver-downloaded", { roomId });
    setAllDl(true);
    deleteSession(roomId);
  };

  const handleUnlock = async () => {
    setError("");
    if (!pw.trim()) return setError("Password is required.");

    setUnlocking(true);

    try {
      const hash   = await sha256(pw.trim());
      const socket = createSocket();
      socketRef.current = socket;

      const session = (() => {
        try { return JSON.parse(localStorage.getItem("ld_session") || "{}"); } catch { return {}; }
      })();

      socket.on("connect", () => {
        socket.emit("register-page", { page: "receive", uid: session.uid || null });
        socket.emit("join-room", { roomId, passwordHash: hash }, async (res) => {
          if (res.error) {
            setUnlocking(false);
            setError(res.error);
            socket.disconnect();
            return;
          }
          setUnlocking(false);
          setMeta(res.meta);
          setStep(STEPS.CONNECTING);
          setStat("Connecting to sender...");

          let totalBytes = res.meta?.totalSize || 0;
          let fileByteMap = {};
          let collectedFiles = [];
          let collectedText  = null;

          const receiver = new ReceiverPeer({
            socket,
            hostId: res.hostId,

            onText: async (txt) => {
              collectedText = txt;
              setRText(txt);
            },

            onFileStart: (fm) => {
              setStep(STEPS.RECEIVING);
              setStat(`${fm.name} is being received...`);
            },

            onFileProgress: (pct, loaded, total, name) => {
              setStep(STEPS.RECEIVING);
              fileByteMap[name] = loaded;
              const sent    = Object.values(fileByteMap).reduce((a,b)=>a+b, 0);
              const overall = totalBytes ? Math.round((sent/totalBytes)*100) : pct;
              setOv(overall);
              setStat(`${name} — ${formatBytes(loaded)} / ${formatBytes(total)}`);
            },

            onFileDone: (blob, name) => {
              const item = { blob, name, size: blob.size };
              collectedFiles.push(item);
              setRFiles(prev => [...prev, item]);
            },

            onAllDone: async () => {
              setOv(100);
              await saveSession(roomId, { text: collectedText, files: collectedFiles });
              socket.emit("receiver-saved", { roomId });
              setStep(STEPS.DONE);
            },

            onError: (msg) => { setUnlocking(false); setError(msg); setStep(STEPS.ERROR); },
          });
          receiverRef.current = receiver;

          socket.on("signal", ({ data }) => receiver.receiveSignal(data));

          socket.on("host-left", () => {
            if (step !== STEPS.DONE && step !== STEPS.RECEIVING) {
              setError("Sender went offline.");
              setStep(STEPS.ERROR);
            }
          });

          // Admin killed this room — instant reload
          socket.on("admin-room-killed", () => {
            window.location.reload();
          });

          // Admin broadcast
          socket.on("admin-broadcast", ({ message }) => {
            setAdminToast(message);
          });

          // Admin kicked this user
          socket.on("admin-kicked", ({ reason }) => {
            localStorage.removeItem("ld_session");
            setAdminToast(`⚠ ${reason}`);
            setTimeout(() => { window.location.href = "/login"; }, 2000);
          });
        });
      });

      socket.on("connect_error", () => {
        setUnlocking(false);
        setError("Could not connect to server.");
      });
    } catch(e) { setUnlocking(false); setError(e.message); }
  };

  const downloadFile = (item) => {
    const url = URL.createObjectURL(item.blob);
    const a   = document.createElement("a");
    a.href = url; a.download = item.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    downloadedCount.current += 1;
    if (downloadedCount.current >= receivedFiles.length) notifyDownloaded(socketRef.current);
  };

  const downloadAll = () => {
    receivedFiles.forEach((f, i) => {
      setTimeout(() => {
        const url = URL.createObjectURL(f.blob);
        const a   = document.createElement("a");
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, i * 300);
    });
    notifyDownloaded(socketRef.current);
  };

  const copyText = () => {
    navigator.clipboard.writeText(receivedText).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2500); });
    if (!receivedFiles.length) notifyDownloaded(socketRef.current);
  };

  return (
    <div className="rcv-container">

      {/* Admin broadcast toast */}
      {adminToast && (
        <AdminToast message={adminToast} onClose={() => setAdminToast(null)} />
      )}

      {/* ── Unlocking overlay ── */}
      {unlocking && (
        <div className="shr-creating-overlay">
          <div className="shr-creating-box">
            <div className="shr-creating-spinner">
              <div className="shr-spin-ring" />
              <div className="shr-spin-ring shr-spin-ring-2" />
              <div className="shr-spin-ring shr-spin-ring-3" />
            </div>
            <div className="shr-creating-text">UNLOCKING</div>
            <div className="shr-creating-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <header className="rcv-header">
        <a href="/" className="rcv-logo">LINKDROP</a>
        <span className="rcv-mode">RECEIVE MODE</span>
      </header>

      <main className="rcv-main">
        <div className="rcv-wrap">

          {step === STEPS.LOADING && (
            <div className="rcv-loading">
              <div className="rcv-spinner" />
              <div className="rcv-loading-text">Checking...</div>
            </div>
          )}

          {step === STEPS.NOT_FOUND && (
            <div className="rcv-not-found rcv-fade-up">
              <div className="rcv-404">404</div>
              <h2 className="rcv-heading rcv-heading-large">LINK NOT FOUND</h2>
              <p className="rcv-not-found-text">
                This link may have expired, the sender may have closed the page,<br/>
                or the link is incorrect.
              </p>
              <a href="/"><button className="rcv-btn-secondary rcv-btn-large">GO BACK</button></a>
            </div>
          )}

          {step === STEPS.LOCK && (
            <div className="rcv-lock rcv-fade-up">
              <div className="rcv-lock-header">
                <h1 className="rcv-heading rcv-heading-xlarge">
                  ENTER<br/>PASSWORD<span className="rcv-cursor">_</span>
                </h1>
                <p className="rcv-lock-sub">ENTER PASSWORD TO ACCESS CONTENT</p>
              </div>
              <div className="rcv-input-group">
                <div className="rcv-input-label">
                  <IconLock size={13} />
                  <label>Password</label>
                </div>
                <div className="rcv-input-wrapper">
                  <input
                    className="rcv-input"
                    type={showPw ? "text" : "password"}
                    placeholder="Enter password"
                    value={pw}
                    onChange={(e) => { setPw(e.target.value); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                    autoFocus
                  />
                  <button className="rcv-input-icon" onClick={() => setShowP(p => !p)}>
                    {showPw ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                  </button>
                </div>
              </div>
              <button className="rcv-btn-primary" onClick={handleUnlock} disabled={unlocking}>
                <IconLock size={18} /> UNLOCK
              </button>
              {error && (
                <div className="rcv-error">
                  <IconAlert size={14} /> {error}
                </div>
              )}
            </div>
          )}

          {step === STEPS.CONNECTING && (
            <div className="rcv-connecting rcv-fade-up">
              <div className="rcv-spinner" />
              <div className="rcv-connecting-title">CONNECTING...</div>
              <div className="rcv-connecting-status">{statusMsg}</div>
              {meta && (
                <div className="rcv-card rcv-card-left">
                  <div className="rcv-card-label">Incoming content</div>
                  {meta.files?.map((f, i) => (
                    <div key={i} className="rcv-meta-row">
                      <IconFile size={14} />
                      <span>{f.name} ({formatBytes(f.size)})</span>
                    </div>
                  ))}
                  {meta.hasText && (
                    <div className="rcv-meta-row">
                      <IconText size={14} />
                      <span>{meta.textLength} characters of text</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === STEPS.RECEIVING && (
            <div className="rcv-receiving rcv-fade-up">
              <div className="rcv-receiving-header">
                <span className="rcv-live" />
                <span className="rcv-receiving-label">RECEIVING</span>
              </div>
              <h2 className="rcv-heading rcv-heading-receiving">RECEIVING</h2>
              <div className="rcv-card">
                <div className="rcv-progress-row">
                  <span className="rcv-progress-message">{statusMsg}</span>
                  <span className="rcv-progress-percent">{overallPct}%</span>
                </div>
                <div className="rcv-progress-track">
                  <div className="rcv-progress-fill" style={{ width: `${overallPct}%` }} />
                </div>
              </div>
            </div>
          )}

          {step === STEPS.DONE && (
            <div className="rcv-done rcv-fade-up">
              <div className="rcv-done-badge">
                <div className="rcv-done-icon">
                  <IconCheck size={16} />
                </div>
                <div>
                  <span className="rcv-done-label">CONTENT READY</span>
                  {fromCache && <span className="rcv-done-cache"></span>}
                </div>
              </div>
              <h2 className="rcv-heading rcv-heading-done">DOWNLOAD</h2>
              {receivedFiles.length > 0 && (
                <div className="rcv-card">
                  <div className="rcv-card-label">Files ({receivedFiles.length})</div>
                  <div className="rcv-file-list">
                    {receivedFiles.map((f, i) => (
                      <div key={i} className="rcv-file-row">
                        <IconFile size={15} />
                        <div className="rcv-file-info">
                          <div className="rcv-file-name">{f.name}</div>
                          <div className="rcv-file-size">{formatBytes(f.size)}</div>
                        </div>
                        <button className="rcv-btn-small" onClick={() => downloadFile(f)}>
                          <IconDownload size={12} /> SAVE
                        </button>
                      </div>
                    ))}
                  </div>
                  {receivedFiles.length > 1 && (
                    <button className="rcv-btn-primary rcv-btn-block" onClick={downloadAll}>
                      <IconDownload size={16} /> DOWNLOAD ALL
                    </button>
                  )}
                </div>
              )}
              {receivedText !== null && (
                <div className="rcv-card">
                  <div className="rcv-text-header">
                    <div className="rcv-text-label">
                      <IconText size={14} />
                      <span>Received Text</span>
                    </div>
                    <button
                      className={`rcv-copy-btn ${copied ? "rcv-copied" : ""}`}
                      onClick={copyText}
                    >
                      {copied && <IconCheck size={11} />}
                      {copied ? "COPIED" : "COPY"}
                    </button>
                  </div>
                  <div className="rcv-text-content">{receivedText}</div>
                </div>
              )}
              <a href="/" className="rcv-more-link">
                <button className="rcv-btn-secondary rcv-btn-block">+ Receive More</button>
              </a>
            </div>
          )}

          {step === STEPS.ERROR && (
            <div className="rcv-error-page rcv-fade-up">
              <h2 className="rcv-heading rcv-heading-error">ERROR</h2>
              <div className="rcv-error-box">
                <IconAlert size={14} /> {typeof error === "string" && error.includes("User-Initiated Abort") ? "Connection closed. Please reload the page." : error}
              </div>
              <a href="/"><button className="rcv-btn-secondary rcv-btn-large">GO BACK</button></a>
            </div>
          )}

        </div>
      </main>

      <footer className="rcv-footer">
        <span>LINKDROP © {new Date().getFullYear()}</span>
        <span>P2P · ZERO SERVER STORAGE</span>
      </footer>
    </div>
  );
}