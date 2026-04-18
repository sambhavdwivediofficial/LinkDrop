// src/pages/LoginPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!getApps().length) initializeApp(firebaseConfig);
const auth     = getAuth();
const provider = new GoogleAuthProvider();

export default function LoginPage() {
  const navigate  = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // Redirect destination stored in sessionStorage (not URL)
  const redirectTo = sessionStorage.getItem("ld_redirect") || "/";

  useEffect(() => {
    // Already logged in? Skip login
    const raw = localStorage.getItem("ld_session");
    if (!raw) return;
    try {
      const { expiry } = JSON.parse(raw);
      if (Date.now() < expiry) {
        sessionStorage.removeItem("ld_redirect");
        navigate(redirectTo, { replace: true });
      }
    } catch {
      localStorage.removeItem("ld_session");
    }
  }, []);

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const result  = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();

      const res = await fetch("/api/auth/verify", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}));
        throw new Error(msg || "Server verification failed.");
      }

      const { sessionToken, expiresAt } = await res.json();

      localStorage.setItem("ld_session", JSON.stringify({
        token:  sessionToken,
        expiry: expiresAt,
        uid:    result.user.uid,
        email:  result.user.email,
        name:   result.user.displayName,
        photo:  result.user.photoURL,
      }));

      sessionStorage.removeItem("ld_redirect");
      navigate(redirectTo, { replace: true });
    } catch (e) {
      setError(e.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {loading && (
        <div className="shr-creating-overlay">
          <div className="shr-creating-box">
            <div className="shr-creating-spinner">
              <div className="shr-spin-ring" />
              <div className="shr-spin-ring shr-spin-ring-2" />
              <div className="shr-spin-ring shr-spin-ring-3" />
            </div>
            <div className="shr-creating-text">SIGNING IN</div>
            <div className="shr-creating-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}

      <header className="login-header">
        <span className="login-logo">LINKDROP</span>
        <span className="login-mode">SECURE ACCESS</span>
      </header>

      <main className="login-main">
        <div className="login-wrap">

          <div className="login-fade-up">
            <h1 className="login-heading">
              SIGN<br />IN<span className="login-cursor">_</span>
            </h1>
            <p className="login-sub">GOOGLE AUTHENTICATION REQUIRED</p>
          </div>

          <button
            className="login-google-btn login-fade-up-2"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <GoogleIcon />
            {loading ? "SIGNING IN..." : "CONTINUE WITH GOOGLE"}
          </button>

          {error && (
            <div className="login-error login-fade-up-2">⚠ {error}</div>
          )}

          <div className="login-divider login-fade-up-2">
            <div className="login-divider-line" />
            <div className="login-divider-text">SECURITY INFO</div>
            <div className="login-divider-line" />
          </div>

          <div className="login-info-grid login-fade-up-3">
            <div className="login-info-card">
              <div className="login-info-label">SESSION</div>
              <div className="login-info-value">Auto-logout after <span>4 days</span></div>
            </div>
            <div className="login-info-card">
              <div className="login-info-label">TRANSFER</div>
              <div className="login-info-value"><span>P2P Direct</span> — zero server storage</div>
            </div>
            <div className="login-info-card">
              <div className="login-info-label">AUTH</div>
              <div className="login-info-value"><span>Google OAuth</span> via Firebase</div>
            </div>
            <div className="login-info-card">
              <div className="login-info-label">ACCESS</div>
              <div className="login-info-value">Token verified <span>server-side</span></div>
            </div>
          </div>

        </div>
      </main>

      <footer className="login-footer">
        <span>LINKDROP © {new Date().getFullYear()}</span>
        <span>P2P · ZERO SERVER STORAGE</span>
      </footer>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}