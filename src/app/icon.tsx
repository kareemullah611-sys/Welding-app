import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          border: "8px solid #D4AF37",
        }}
      >
        <div
          style={{
            color: "#F5E6D3",
            fontSize: 180,
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
