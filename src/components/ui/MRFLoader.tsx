"use client";

import React, { useEffect, useRef, useState } from "react";

interface MRFLoaderProps {
  /** "login" = always plays full animation, ignores visible prop until minDuration passes.
   *  "global" = controlled by visible prop, same animation */
  variant?: "login" | "global";
  visible?: boolean;
  onAnimationComplete?: () => void;
}

const MIN_LOGIN_DURATION = 5000; // ms — overlay shows for at least 5 seconds on login

export default function MRFLoader({
  variant = "global",
  visible = false,
  onAnimationComplete,
}: MRFLoaderProps) {
  const [show, setShow] = useState(variant === "login");
  const [animating, setAnimating] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const startTimeRef = useRef<number>(0);

  // Login variant: show immediately, record start time
  useEffect(() => {
    if (variant !== "login") return;
    startTimeRef.current = Date.now();
    setShow(true);
    setAnimating(true);
  }, [variant]);

  useEffect(() => {
    if (variant !== "login") return;
    // visible goes false = API done. Keep showing until MIN_LOGIN_DURATION has elapsed.
    if (!visible) {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, MIN_LOGIN_DURATION - elapsed);
      const timer = setTimeout(() => {
        setFadeOut(true);
        setTimeout(() => {
          onAnimationComplete?.();
          setShow(false);
        }, 400);
      }, remaining);
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
      setFadeOut(true);
      setTimeout(() => setShow(false), 400);
    }
  }, [visible, variant]);

  if (!show) return null;

  return (
    <div className={`mrf-overlay ${fadeOut ? "mrf-fade-out" : ""}`} aria-label="Loading">
      <div className={`mrf-container ${animating ? "mrf-animate-in" : ""}`}>
        {/* Ambient glow */}
        <div className="mrf-glow" />
        
        {/* Shield SVG */}
        <svg
          viewBox="0 0 100 110"
          className="mrf-shield"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Shield background fill */}
          <path
            d="M50 5 L95 18 L95 68 Q95 105 50 118 Q5 105 5 68 L5 18 Z"
            fill="url(#shieldGradient)"
            className="mrf-shield-fill"
          />
          {/* Shield border */}
          <path
            d="M50 5 L95 18 L95 68 Q95 105 50 118 Q5 105 5 68 L5 18 Z"
            stroke="#D4AF37"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mrf-shield-border"
          />
          {/* Inner subtle line */}
          <path
            d="M50 12 L88 24 L88 65 Q88 98 50 109 Q12 98 12 65 L12 24 Z"
            stroke="#D4AF37"
            strokeWidth="0.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.3"
            className="mrf-shield-inner"
          />
          
          {/* Gradient definition */}
          <defs>
            <linearGradient id="shieldGradient" x1="5" y1="5" x2="95" y2="118" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6B0F1A" />
              <stop offset="50%" stopColor="#8B1A1A" />
              <stop offset="100%" stopColor="#5C0A12" />
            </linearGradient>
          </defs>
          
          {/* MRF Text */}
          <text
            x="50"
            y="68"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="bold"
            fontSize="32"
            fill="#F5E6D3"
            letterSpacing="2"
            className="mrf-text"
          >
            MRF
          </text>
        </svg>

        {/* HARDWARE text */}
        <p className="mrf-subtitle">HARDWARE</p>
        <p className="mrf-tagline">Management System</p>
        
        {/* Loading progress */}
        <div className="mrf-progress-wrapper">
          <div className="mrf-progress-bar" />
        </div>
      </div>

      <style>{`
        .mrf-overlay {
          position: fixed;
          inset: 0;
          background: linear-gradient(145deg, #1a0505 0%, #2d0a0a 50%, #1a0505 100%);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.4s ease;
        }

        .mrf-fade-out {
          opacity: 0;
        }

        .mrf-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          opacity: 0;
          transform: scale(0.92);
        }

        .mrf-animate-in {
          animation: mrfEnter 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        @keyframes mrfEnter {
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .mrf-glow {
          position: absolute;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(107, 15, 26, 0.15) 0%, transparent 70%);
          border-radius: 50%;
          animation: mrfGlowPulse 3s ease-in-out infinite;
        }

        @keyframes mrfGlowPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }

        .mrf-shield {
          width: 140px;
          height: 154px;
          filter: drop-shadow(0 8px 32px rgba(212, 175, 55, 0.2));
        }

        .mrf-shield-fill {
          opacity: 0;
          animation: mrfFillIn 0.4s ease 0.3s forwards;
        }

        @keyframes mrfFillIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .mrf-shield-border {
          stroke-dasharray: 380;
          stroke-dashoffset: 380;
          animation: mrfTraceDraw 0.8s ease-out 0.15s forwards;
        }

        @keyframes mrfTraceDraw {
          to { stroke-dashoffset: 0; }
        }

        .mrf-shield-inner {
          stroke-dasharray: 320;
          stroke-dashoffset: 320;
          animation: mrfTraceDraw 0.8s ease-out 0.4s forwards;
        }

        .mrf-text {
          opacity: 0;
          filter: blur(12px);
          animation: mrfTextReveal 0.6s ease-out 0.7s forwards;
        }

        @keyframes mrfTextReveal {
          from { opacity: 0; filter: blur(12px); }
          to { opacity: 1; filter: blur(0); }
        }

        .mrf-subtitle {
          color: #D4AF37;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 6px;
          opacity: 0;
          transform: translateY(6px);
          animation: mrfSlideUp 0.4s ease-out 0.9s forwards;
          margin: 0;
        }

        .mrf-tagline {
          color: rgba(212, 175, 55, 0.55);
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 9px;
          letter-spacing: 4px;
          opacity: 0;
          transform: translateY(4px);
          animation: mrfSlideUp 0.4s ease-out 1.05s forwards;
          margin: 0;
        }

        @keyframes mrfSlideUp {
          to { opacity: 1; transform: translateY(0); }
        }

        .mrf-progress-wrapper {
          width: 100px;
          height: 2px;
          background: rgba(212, 175, 55, 0.15);
          border-radius: 1px;
          overflow: hidden;
          margin-top: 8px;
        }

        .mrf-progress-bar {
          width: 30%;
          height: 100%;
          background: linear-gradient(90deg, #D4AF37, #F5D78E, #D4AF37);
          border-radius: 1px;
          animation: mrfProgress 1.5s ease-in-out infinite;
        }

        @keyframes mrfProgress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(250%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
