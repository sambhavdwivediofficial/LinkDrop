import React, { useState, useRef, useCallback, useEffect } from "react";
import { createSocket, sha256, formatBytes, buildMeta, SenderPeer } from "../lib/peer";
import {
  IconUpload, IconFile, IconText, IconLock,
  IconCopy, IconCheck, IconX, IconEye, IconEyeOff, IconWifi, IconAlert
} from "../lib/icons";
import "../index.css";

const STEPS = {
  COMPOSE:   "compose",
  WAITING:   "waiting",
  SENDING:   "sending",
  SENT:      "sent",
  DONE:      "done",
};
const MAX_FILES = 5;

// ── Admin Toast (Fixed Timer) ────────────────────────────────────────────────────
function AdminToast({ message, onClose }) {
  const timerRef = useRef(null);

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Set new 30-second timer
    timerRef.current = setTimeout(() => {
      onClose();
    }, 50000); // exactly 50 seconds

    // Cleanup on unmount or before re-run
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [message]); // Only depend on message, not onClose

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 10,
        left: "auto",
        transform: "none",
        zIndex: 99999,
        width: "fit-content",
        maxWidth: "90%",
        minWidth: 280,
        display: "flex",
        flexDirection: "column",
        borderRadius: 6,
        background: "rgba(0,0,0,0.95)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(108,108,255,0.4)",
        // boxShadow: "0 0 20px rgba(108,108,255,0.15)",
        padding: "0px",
        color: "#eee",
        fontSize: 14,
        wordBreak: "break-word",
      }}
    >
      {/* Top row: ADMIN MESSAGE + close button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 4px 14px",
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: 2,
            color: "#6c6cff",
            fontWeight: 500,
          }}
        >
          ADMIN MESSAGE
        </span>
        <button
          onClick={onClose}
          style={{
            background: "rgba(220, 40, 40, 0.9)",
            border: "none",
            width: 20,
            height: 20,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            fontSize: 10,
            fontWeight: "bold",
            flexShrink: 0,
            padding: 0,
            lineHeight: 1,
            boxShadow: "0 0 6px rgba(220,40,40,0.5)",
            transition: "background 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "rgba(220,40,40,0.9)")}
          onMouseOut={(e) => (e.currentTarget.style.background = "rgba(224, 11, 11, 0.43)")}
        >
          ✕
        </button>
      </div>

      {/* Message box with thin border */}
      <div
        style={{
          margin: "4px 14px 12px 14px",
          padding: "12px 14px",
          border: "1px solid rgba(108,108,255,0.25)",
          borderRadius: 4,
          background: "rgba(0,0,0,0.2)",
          color: "#ffffff",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>
    </div>
  );
}

export default function SharePage() {
  const [step, setStep]           = useState(STEPS.COMPOSE);
  const [tab, setTab]             = useState("both");
  const [files, setFiles]         = useState([]);
  const [text, setText]           = useState("");
  const [password, setPass]       = useState("");
  const [showPass, setShowP]      = useState(false);
  const [isDrag, setIsDrag]       = useState(false);
  const [error, setError]         = useState("");
  const [shareLink, setLink]      = useState("");
  const [copied, setCopied]       = useState(false);
  const [progMap, setProgMap]     = useState({});
  const [statusMsg, setStat]      = useState("");
  const [overallPct, setOvPct]    = useState(0);
  const [receiverSaved, setRSaved]    = useState(false);
  const [receiverDownloaded, setRDl]  = useState(false);
  const [creating, setCreating]       = useState(false);
  const [adminToast, setAdminToast]   = useState(null);
  const [roomIdRef_]              = useState({ current: "" });

  const socketRef  = useRef(null);
  const senderRef  = useRef(null);
  const fileRef    = useRef(null);
  const folderRef  = useRef(null);
  const roomIdSaved = useRef("");

  // ── Register page + listen for admin events via a persistent socket ────
  useEffect(() => {
    const session = (() => {
      try { return JSON.parse(localStorage.getItem("ld_session") || "{}"); } catch { return {}; }
    })();
    const adminSocket = createSocket();
    adminSocket.on("connect", () => {
      adminSocket.emit("register-page", { page: "share", uid: session.uid || null });
    });
    adminSocket.on("admin-broadcast", ({ message }) => {
      setAdminToast(message);
    });
    adminSocket.on("admin-kicked", ({ reason, action }) => {
      localStorage.removeItem("ld_session");
      setAdminToast(`⚠ ${reason}`);
      setTimeout(() => { window.location.href = "/login"; }, 2000);
    });
    return () => adminSocket.disconnect();
  }, []);

  useEffect(() => {
    const shouldBlock = () =>
      step === STEPS.WAITING || step === STEPS.SENDING || step === STEPS.SENT;
    const handler = (e) => {
      if (shouldBlock() && !receiverSaved) {
        e.preventDefault();
        e.returnValue = "Receiver has not saved the file yet. Closing the page will result in file loss!";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [step, receiverSaved]);

  useEffect(() => () => {
    socketRef.current?.disconnect();
    senderRef.current?.destroy();
  }, []);

  const addFiles = (incoming) => {
    setFiles(prev => {
      const combined = [...prev];
      for (const f of incoming) {
        if (combined.length >= MAX_FILES) break;
        if (!combined.find(x => x.name === f.name && x.size === f.size)) combined.push(f);
      }
      return combined;
    });
    setError("");
  };

  const removeFile = (idx) => setFiles(f => f.filter((_, i) => i !== idx));

  const onDrop = useCallback((e) => {
    e.preventDefault(); setIsDrag(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const onFileInput   = (e) => { if (e.target.files.length) addFiles(Array.from(e.target.files)); };
  const onFolderInput = (e) => { if (e.target.files.length) addFiles(Array.from(e.target.files)); };

  const hasFile = tab === "file" || tab === "both";
  const hasText = tab === "text" || tab === "both";

  const handleCreate = async () => {
    setError("");
    if (hasFile && files.length === 0) return setError("Please select at least one file.");
    if (hasText && !text.trim())       return setError("Please enter text.");
    if (!password.trim())              return setError("Please enter a password.");

    setCreating(true);

    try {
      const hash   = await sha256(password.trim());
      const meta   = buildMeta(hasFile ? files : [], hasText ? text : null);
      const socket = createSocket();
      socketRef.current = socket;

      const session = (() => {
        try { return JSON.parse(localStorage.getItem("ld_session") || "{}"); } catch { return {}; }
      })();

      socket.on("connect", () => {
        socket.emit("register-page", { page: "share", uid: session.uid || null });
        socket.emit("create-room", { passwordHash: hash, meta }, ({ roomId }) => {
          roomIdSaved.current = roomId;
          setLink(`${window.location.origin}/r/${roomId}`);
          setCreating(false);
          setStep(STEPS.WAITING);
        });
      });

      socket.on("peer-joined", ({ peerId }) => {
        setStep(STEPS.SENDING);
        setStat("Receiver connected — sending...");
        senderRef.current.handlePeerJoined({ peerId });
      });

      socket.on("signal", ({ from, data }) => senderRef.current?.receiveSignal({ from, data }));

      socket.on("receiver-saved", () => {
        setRSaved(true);
        setStat("Receiver has saved the file. You may now close the page.");
      });

      socket.on("receiver-downloaded", () => {
        setRDl(true);
        setStep(STEPS.DONE);
      });

      // Admin killed this room — instant reload, no warning
      socket.on("admin-room-killed", ({ reason }) => {
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

      socket.on("connect_error", () => {
        setCreating(false);
        setError("Could not connect to server.");
      });

      const totalBytes = hasFile ? files.reduce((a, f) => a + f.size, 0) : 0;
      let sentBytes = {};

      senderRef.current = new SenderPeer({
        socket,
        files: hasFile ? files : [],
        text:  hasText ? text  : null,
        onPeerConnected: () => setStat("P2P connected — starting transfer..."),
        onProgress: (pid, fi, pct, loaded, total, name) => {
          sentBytes[fi] = loaded;
          const totalSent = Object.values(sentBytes).reduce((a, b) => a + b, 0);
          setOvPct(totalBytes ? Math.round((totalSent / totalBytes) * 100) : pct);
          setProgMap(prev => ({ ...prev, [fi]: pct }));
          setStat(`${name} — ${formatBytes(loaded)} / ${formatBytes(total)}`);
        },
        onDone: () => {
          setOvPct(100);
          setStep(STEPS.SENT);
          setStat("Transfer complete! Waiting for receiver to download...");
        },
        onError: (msg) => { setCreating(false); setError(msg); setStep(STEPS.COMPOSE); },
      });

    } catch (e) { setCreating(false); setError(e.message); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  const reset = () => {
    socketRef.current?.disconnect(); senderRef.current?.destroy();
    setStep(STEPS.COMPOSE); setFiles([]); setText(""); setPass("");
    setError(""); setLink(""); setCopied(false); setProgMap({});
    setOvPct(0); setStat(""); setRSaved(false); setRDl(false); setCreating(false);
    if (fileRef.current)   fileRef.current.value   = "";
    if (folderRef.current) folderRef.current.value = "";
  };

  return (
    <div className="shr-container">

      {/* Admin broadcast toast */}
      {adminToast && (
        <AdminToast message={adminToast} onClose={() => setAdminToast(null)} />
      )}

      {/* ── Creating overlay ── */}
      {creating && (
        <div className="shr-creating-overlay">
          <div className="shr-creating-box">
            <div className="shr-creating-spinner">
              <div className="shr-spin-ring" />
              <div className="shr-spin-ring shr-spin-ring-2" />
              <div className="shr-spin-ring shr-spin-ring-3" />
            </div>
            <div className="shr-creating-text">CREATING LINK</div>
            <div className="shr-creating-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <header className="shr-header">
        <span className="shr-logo">LINKDROP</span>
        <span className="shr-mode">P2P · NO SERVER STORAGE</span>
      </header>

      <main className="shr-main">
        <div className="shr-wrap">

          {/* COMPOSE */}
          {step === STEPS.COMPOSE && (
            <>
              <div className="shr-compose-header shr-fade-up">
                <h1 className="shr-heading shr-heading-xlarge">
                  SHARE<br />ANYTHING<span className="shr-cursor">_</span>
                </h1>
                <p className="shr-compose-sub">FILE · FOLDER · TEXT · ANYTHING · DIRECT P2P</p>
              </div>

              <div className="shr-tabs shr-fade-up1">
                {[
                  ["both", "All-in-One"],
                  ["file", "File + Folder"],
                  ["text", "Text"]
                ].map(([k, l]) => (
                  <button
                    key={k}
                    className={`shr-tab ${tab === k ? "shr-tab-active" : ""}`}
                    onClick={() => setTab(k)}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {hasFile && (
                <div className="shr-file-section shr-fade-up1">
                  <div
                    className={`shr-dropzone ${isDrag ? "shr-drag-active" : ""}`}
                    onDrop={onDrop}
                    onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
                    onDragLeave={() => setIsDrag(false)}
                    onClick={() => fileRef.current?.click()}
                  >
                    <IconUpload size={24} />
                    <div className="shr-dropzone-text">
                      {isDrag ? "Release to drop" : "Drag & drop or click"}
                    </div>
                    <div className="shr-dropzone-hint">
                      Max {MAX_FILES} files · Any extension · Zip · Unlimited size
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      onChange={onFileInput}
                    />
                  </div>

                  {/* <button
                    className="shr-btn-folder"
                    onClick={() => folderRef.current?.click()}
                  >
                    + Select Folder
                    <input
                      ref={folderRef}
                      type="file"
                      webkitdirectory="true"
                      multiple
                      style={{ display: "none" }}
                      onChange={onFolderInput}
                    />
                  </button> */}

                  {files.length > 0 && (
                    <div className="shr-file-list">
                      {files.map((f, i) => (
                        <div key={i} className="shr-file-row">
                          <IconFile size={16} />
                          <div className="shr-file-info">
                            <div className="shr-file-name">{f.name}</div>
                            <div className="shr-file-size">{formatBytes(f.size)}</div>
                          </div>
                          <button className="shr-remove-btn" onClick={() => removeFile(i)}>
                            <IconX size={14} />
                          </button>
                        </div>
                      ))}
                      {files.length < MAX_FILES && (
                        <button
                          className="shr-add-more"
                          onClick={() => fileRef.current?.click()}
                        >
                          + Add More Files ({files.length}/{MAX_FILES}) or Zip
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {hasText && (
                <div className="shr-text-section shr-fade-up2">
                  <div className="shr-input-label">
                    <IconText size={13} />
                    <label>Text Content</label>
                  </div>
                  <textarea
                    className="shr-textarea"
                    placeholder="Enter text to share..."
                    value={text}
                    onChange={(e) => { setText(e.target.value); setError(""); }}
                    rows={4}
                  />
                </div>
              )}

              <div className="shr-password-section shr-fade-up3">
                <div className="shr-input-label">
                  <IconLock size={13} />
                  <label>Password</label>
                </div>
                <div className="shr-input-wrapper">
                  <input
                    className="shr-input"
                    type={showPass ? "text" : "password"}
                    placeholder="Set a password..."
                    value={password}
                    onChange={(e) => { setPass(e.target.value); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                  <button className="shr-input-icon" onClick={() => setShowP(p => !p)}>
                    {showPass ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                  </button>
                </div>
              </div>

              <div className="shr-fade-up3">
                <button className="shr-btn-primary" onClick={handleCreate} disabled={creating}>
                  <IconWifi size={18} /> CREATE LINK
                </button>
              </div>

              {error && (
                <div className="shr-error">
                  <IconAlert size={14} />
                  {error.includes("User-Initiated Abort")
                    ? "Connection closed safely"
                    : error}
                </div>
              )}
            </>
          )}

          {/* WAITING */}
          {step === STEPS.WAITING && (
            <div className="shr-waiting shr-fade-up">
              <div className="shr-waiting-header">
                <span className="shr-live" />
                <span className="shr-waiting-label">WAITING FOR RECEIVER</span>
              </div>
              <h2 className="shr-heading shr-heading-waiting">LINK<br />READY</h2>

              <div className="shr-card">
                <div className="shr-card-label">Shareable Link</div>
                <div className="shr-link-row">
                  <div className="shr-link-box">{shareLink}</div>
                  <button
                    className={`shr-copy-btn ${copied ? "shr-copied" : ""}`}
                    onClick={copyLink}
                  >
                    {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    {copied ? "COPIED" : "COPY"}
                  </button>
                </div>
              </div>

              <div className="shr-warn">
                <div className="shr-warn-title">⚠ DO NOT CLOSE THIS PAGE</div>
                <div className="shr-warn-text">
                  Do not close or reload this page until the receiver has received and downloaded the file.
                  The file only exists in your browser.
                </div>
              </div>

              <button className="shr-btn-secondary shr-btn-block" onClick={reset}>
                Cancel
              </button>
            </div>
          )}

          {/* SENDING */}
          {step === STEPS.SENDING && (
            <div className="shr-sending shr-fade-up">
              <div className="shr-sending-header">
                <span className="shr-live" />
                <span className="shr-sending-label">TRANSFER IN PROGRESS</span>
              </div>
              <h2 className="shr-heading shr-heading-sending">SENDING</h2>

              <div className="shr-card">
                <div className="shr-progress-row">
                  <span className="shr-progress-message">{statusMsg}</span>
                  <span className="shr-progress-percent">{overallPct}%</span>
                </div>
                <div className="shr-progress-track">
                  <div className="shr-progress-fill" style={{ width: `${overallPct}%` }} />
                </div>
                {files.length > 1 && (
                  <div className="shr-file-progress-list">
                    {files.map((f, i) => (
                      <div key={i} className="shr-file-progress">
                        <div className="shr-file-progress-row">
                          <span className="shr-file-progress-name">{f.name}</span>
                          <span className="shr-file-progress-pct">{progMap[i] || 0}%</span>
                        </div>
                        <div className="shr-file-progress-track">
                          <div
                            className="shr-file-progress-fill"
                            style={{ width: `${progMap[i] || 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="shr-warn">
                <div className="shr-warn-title">⚠ DO NOT CLOSE THIS PAGE</div>
                <div className="shr-warn-text">
                  Transfer is in progress — closing the page will result in file loss.
                </div>
              </div>
            </div>
          )}

          {/* SENT */}
          {step === STEPS.SENT && (
            <div className="shr-sent shr-fade-up">
              <div className="shr-sent-header">
                <span className="shr-live" />
                <span className="shr-sent-label">RECEIVER IS DOWNLOADING</span>
              </div>
              <h2 className="shr-heading shr-heading-sent">
                {receiverSaved ? "" : "PLEASE\nWAIT"}
              </h2>

              <div className="shr-card">
                <div className="shr-status-row">
                  <div className={`shr-status-dot ${receiverSaved ? "shr-status-done" : "shr-status-pending"}`} />
                  <span className={receiverSaved ? "shr-status-text-done" : "shr-status-text-pending"}>
                    File is being received in receiver's browser...
                  </span>
                </div>
                <div className="shr-status-row">
                  <div className="shr-status-dot shr-status-pending" />
                  <span className="shr-status-text-pending">Waiting for receiver to download...</span>
                </div>
              </div>

              {receiverSaved ? (
                <div className="shr-warn shr-warn-white">
                  <div className="shr-warn-title">⚠ DO NOT CLOSE THIS PAGE</div>
                  <div className="shr-warn-text">
                    Download is in progress — closing the page will result in file loss.
                  </div>
                </div>
              ) : (
                <div className="shr-warn">
                  <div className="shr-warn-title">⚠ DO NOT CLOSE YET</div>
                  <div className="shr-warn-text">
                    Receiver has not saved the file yet. If you close the page, they will not be able to download it.
                  </div>
                </div>
              )}

              {receiverSaved && (
                <button className="shr-btn-secondary shr-btn-block" onClick={reset}>
                  + Share More
                </button>
              )}
            </div>
          )}

          {/* DONE */}
          {step === STEPS.DONE && (
            <div className="shr-done shr-fade-up">
              <div className="shr-done-icon">
                <IconCheck size={24} />
              </div>
              <h2 className="shr-heading shr-heading-done">DONE!</h2>
              <p className="shr-done-text">Receiver has downloaded everything. You may now close this page.</p>
              <button className="shr-btn-secondary shr-btn-large" onClick={reset}>
                + Share More
              </button>
            </div>
          )}

        </div>
      </main>

      <footer className="shr-footer">
        <span>LINKDROP © {new Date().getFullYear()}</span>
        <span>P2P · ZERO SERVER STORAGE</span>
      </footer>
    </div>
  );
}