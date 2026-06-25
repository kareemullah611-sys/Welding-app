"use client";

import { BrandLoader } from "@/components/ui/BrandLoader";

/** @deprecated Use BrandLoader */
export default function MRFLoader({
  label = "Loading",
}: {
  variant?: string;
  visible?: boolean;
  onAnimationComplete?: () => void;
  label?: string;
  productImageSrc?: string;
}) {
  return <BrandLoader fullscreen size="lg" label={label} />;
}
