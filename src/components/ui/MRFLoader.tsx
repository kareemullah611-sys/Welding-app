"use client";

import React, { useEffect, useState } from "react";

interface MRFLoaderProps {
  /** "login" = always plays full animation, ignores visible prop until minDuration passes.
   *  "global" = controlled by visible prop, same animation */
  variant?: "login" | "global";
  visible?: boolean;
  onAnimationComplete?: () => void;
}

const MIN_LOGIN_DURATION = 1800; // ms — full animation runs even if API is fast

export default function MRFLoader({
  variant = "global",
  visible = false,
  onAnimationComplete,
}: MRFLoaderProps) {
  const [show, setShow] = useState(variant === "login");
  const [animating, setAnimating] = useState(false);

  // Login variant: show immediately, hide after MIN_LOGIN_DURATION once visible goes false
  useEffect(() => {
    if (variant !== "login") return;
    setShow(true);
    setAnimating(true);
  }, [variant]);

  useEffect(() => {
    if (variant !== "login") return;
    // visible goes false = API done. Keep showing until animation finishes.
    if (!visible) {
      const elapsed = Date.now();
      const remaining = MIN_LOGIN_DURATION - (elapsed % MIN_LOGIN_DURATION);
      const timer = setTimeout(() => {
        setShow(false);
        onAnimationComplete?.();
      }, remaining > 400 ? remaining : MIN_LOGIN_DURATION);
      return () => clearTimeout(timer);
    }
  }, [visible, variant, onAnimationComplete]);

  // Global variant: controlled
  useEffect(() => {
    if (variant !== "global") return;
    if (visible) {
      setShow(true);
      setAnimating(true);
    } else {
      setShow(false);
      setAnimating(false);
    }
  }, [visible, variant]);

  if (!show) return null;

  return (
    <div className="mrf-overlay" aria-label="Loading">
      <div className={`mrf-badge-wrapper ${animating ? "mrf-badge-enter" : ""}`}>
        {/* Shield SVG */}
        <svg
          viewBox="0 0 120 130"
          className="mrf-shield"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Shield background fill */}
          <path
            d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z"
            fill="#6B0F1A"
            className="mrf-shield-fill"
          />
          {/* Shield border — animated trace */}
          <path
            d="M60 6 L110 22 L110 76 Q110 108 60 124 Q10 108 10 76 L10 22 Z"
            stroke="#D4AF37"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mrf-shield-border"
          />
          {/* Inner gold frame line */}
          <path
            d="M60 14 L102 28 L102 74 Q102 103 60 117 Q18 103 18 74 L18 28 Z"
            stroke="#D4AF37"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.4"
            className="mrf-shield-inner"
          />
          {/* MRF Letters — staggered blur-in */}
          <text
            x="60"
            y="76"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="bold"
            fontSize="38"
            fill="#F5E6D3"
            letterSpacing="2"
            className="mrf-text"
          >
            MRF
          </text>
          {/* Decorative horizontal lines */}
          <line x1="26" y1="46" x2="94" y2="46" stroke="#D4AF37" strokeWidth="0.8" opacity="0.5" className="mrf-deco" />
          <line x1="26" y1="100" x2="94" y2="100" stroke="#D4AF37" strokeWidth="0.8" opacity="0.5" className="mrf-deco" />
        </svg>

        {/* HARDWARE text below shield */}
        <p className="mrf-subtitle">H A R D W A R E</p>
        <p className="mrf-tagline">Management System</p>
      </div>

      <style>{`
        .mrf-overlay {
          position: fixed;
          inset: 0;
          background: #3D0808;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }

        .mrf-badge-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          opacity: 0;
          transform: scale(0.75);
        }

        .mrf-badge-enter {
          animation: mrfBadgeEnter 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s forwards;
        }

        @keyframes mrfBadgeEnter {
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .mrf-shield {
          width: 180px;
          height: 200px;
          filter: drop-shadow(0 0 24px rgba(212, 175, 55, 0.3));
        }

        .mrf-shield-fill {
          opacity: 0;
          animation: mrfFill 0.5s ease 0.5s forwards;
        }

        @keyframes mrfFill {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        .mrf-shield-border {
          stroke-dasharray: 420;
          stroke-dashoffset: 420;
          animation: mrfTrace 0.9s ease-out 0.3s forwards;
        }

        .mrf-shield-inner {
          stroke-dasharray: 380;
          stroke-dashoffset: 380;
          animation: mrfTrace 0.9s ease-out 0.5s forwards;
        }

        @keyframes mrfTrace {
          to { stroke-dashoffset: 0; }
        }

        .mrf-text {
          opacity: 0;
          filter: blur(20px);
          animation: mrfInkReveal 0.7s ease-out 0.85s forwards;
        }

        @keyframes mrfInkReveal {
          0%   { opacity: 0;   filter: blur(20px); letter-spacing: 8px; }
          60%  { opacity: 0.8; filter: blur(4px);  letter-spacing: 3px; }
          100% { opacity: 1;   filter: blur(0px);  letter-spacing: 2px; }
        }

        .mrf-deco {
          stroke-dasharray: 70;
          stroke-dashoffset: 70;
          animation: mrfTrace 0.5s ease-out 1.1s forwards;
        }

        .mrf-subtitle {
          color: #D4AF37;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 5px;
          opacity: 0;
          animation: mrfFadeUp 0.5s ease-out 1.2s forwards;
          margin: 0;
        }

        .mrf-tagline {
          color: rgba(212, 175, 55, 0.5);
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 10px;
          letter-spacing: 3px;
          opacity: 0;
          animation: mrfFadeUp 0.5s ease-out 1.4s forwards;
          margin: 0;
        }

        @keyframes mrfFadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
