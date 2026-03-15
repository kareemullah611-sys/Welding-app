import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MRF Hardware Management",
    short_name: "MRF Hardware",
    description: "Multi-city sales, inventory & financial management",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0F172A",
    theme_color: "#6B0F1A",
    orientation: "portrait",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
