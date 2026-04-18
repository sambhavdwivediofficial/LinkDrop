// src/components/AuthGuard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const SESSION_KEY = "ld_session";

export default function AuthGuard({ children }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const check = async () => {
      const raw = localStorage.getItem(SESSION_KEY);

      if (!raw) return redirectToLogin();

      let session;
      try {
        session = JSON.parse(raw);
      } catch {
        localStorage.removeItem(SESSION_KEY);
        return redirectToLogin();
      }

      if (!session.expiry || Date.now() >= session.expiry) {
        localStorage.removeItem(SESSION_KEY);
        return redirectToLogin();
      }

      try {
        const res = await fetch(`${import.meta.env.VITE_SIGNAL_URL}/api/auth/session`, {
         headers: { "Authorization": `Bearer ${session.token}` },
       });
        if (!res.ok) {
          localStorage.removeItem(SESSION_KEY);
          return redirectToLogin();
        }
      } catch {
        // Network error — allow if client session valid
      }

      setVerified(true);
    };

    const redirectToLogin = () => {
      // Save destination in sessionStorage — URL stays clean
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
    if (Date.now() >= s.expiry) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "/login";
}