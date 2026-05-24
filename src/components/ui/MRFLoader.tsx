"use client";

import ProcessingLoader, { type ProcessingLoaderProps } from "@/components/ui/ProcessingLoader";

/** @deprecated Use ProcessingLoader — kept for existing imports */
export default function MRFLoader(props: ProcessingLoaderProps) {
  return <ProcessingLoader {...props} />;
}
