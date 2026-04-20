// src/components/AuthGuard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const SESSION_KEY = "ld_session";

export default function AuthGuard({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const check = async () => {
      const raw = localStorage.getItem(SESSION_KEY);

      // No session at all → go to login immediately
      if (!raw) return redirectToLogin();

      let session;
      try {
        session = JSON.parse(raw);
      } catch {
        localStorage.removeItem(SESSION_KEY);
        return redirectToLogin();
      }

      // Client-side expiry check — instant, no network needed
      if (!session.expiry || Date.now() >= session.expiry) {
        localStorage.removeItem(SESSION_KEY);
        return redirectToLogin();
      }

      // ✅ Client session valid — show page immediately (optimistic)
      setVerified(true);

      // Background server verify — won't block UI
      // If server rejects, THEN kick to login
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SIGNAL_URL}/api/auth/session`,
          {
            headers: { Authorization: `Bearer ${session.token}` },
            signal: AbortSignal.timeout(10000), // 10s max wait
          }
        );
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY);
          redirectToLogin();
        }
      } catch {
        // Network error or server sleeping — allow access
        // Client session is still valid, don't kick user
      }
    };

    const redirectToLogin = () => {
      sessionStorage.setItem("ld_redirect", location.pathname);
      navigate("/login", { replace: true });
    };

    check();
  }, [location.pathname]);

  if (!verified) return null;
  return children;
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() >= s.expiry) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "/login";
}