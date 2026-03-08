import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0F172A",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "22%",
        }}
      >
        <div
          style={{
            color: "#60A5FA",
            fontSize: 280,
            fontWeight: "bold",
            fontFamily: "sans-serif",
            lineHeight: 1,
          }}
        >
          W
        </div>
      </div>
    ),
    { ...size }
  );
}
