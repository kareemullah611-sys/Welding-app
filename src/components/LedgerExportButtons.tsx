"use client";

import { useState } from "react";
import { FileSpreadsheet, Printer } from "lucide-react";
import { openLedgerExport, printLedgerExport, type LedgerExportType } from "@/lib/ledger-export";
import { GlassButton } from "@/components/ui/GlassButton";

type Props = {
  type: LedgerExportType;
  dateFrom?: string;
  dateTo?: string;
  cityId?: string | number;
  customerId?: string | number;
  ledgerType?: string;
  query?: string;
  status?: string;
  disabled?: boolean;
  className?: string;
  onPrintPdf?: () => void | Promise<void>;
};

export function LedgerExportButtons({
  type,
  dateFrom,
  dateTo,
  cityId,
  customerId,
  ledgerType,
  query,
  status,
  disabled,
  className = "",
  onPrintPdf,
}: Props) {
  const [printing, setPrinting] = useState(false);

  const exportParams = { type, dateFrom, dateTo, cityId, customerId, ledgerType, query, status };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      if (onPrintPdf) {
        await onPrintPdf();
        return;
      }
      await printLedgerExport(exportParams);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className={`flex flex-nowrap items-center gap-2 ${className}`}>
      <GlassButton
        variant="xlsx"
        disabled={disabled}
        title={disabled ? "Export requires an internet connection" : undefined}
        onClick={() => openLedgerExport(exportParams)}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.75} />
        Export XLSX
      </GlassButton>
      <GlassButton
        variant="pdf"
        disabled={disabled || printing}
        title={disabled ? "Export requires an internet connection" : undefined}
        onClick={handlePrint}
      >
        <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
        {printing ? "Preparing…" : "Print / PDF"}
      </GlassButton>
    </div>
  );
}
