import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(160deg, #6B0F1A 0%, #4A0A12 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "22%",
          border: "4px solid #D4AF37",
        }}
      >
        <div
          style={{
            color: "#F5E6D3",
            fontSize: 64,
            fontWeight: "bold",
            fontFamily: "Georgia, serif",
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          MRF
        </div>
      </div>
    ),
    { ...size }
  );
}
