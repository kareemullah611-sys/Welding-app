export type ChequeLedgerRef = {
  chequeNumber: string | null;
  chequeBank: string | null;
};

/** Cash-in-office ledger line for a bank deposit row (signed cashAmount). */
export function formatBankDepositCashLedgerLine(deposit: {
  slipNumber: string | null;
  cashAmount: number;
  cheques: ChequeLedgerRef[];
}): { type: string; detail: string; reference: string | null } {
  const cash = Number(deposit.cashAmount || 0);
  const slip = (deposit.slipNumber || "").trim() || null;
  const cheques = deposit.cheques || [];

  if (cash >= 0) {
    return {
      type: "Bank Deposit",
      detail: slip ? `Cash deposited to bank · Slip #${slip}` : "Cash deposited to bank",
      reference: slip,
    };
  }

  if (cheques.length > 0) {
    const chqParts = cheques.map((c) => {
      const no = (c.chequeNumber || "").trim() || "—";
      const bank = (c.chequeBank || "").trim();
      return bank ? `#${no} (${bank})` : `#${no}`;
    });
    return {
      type: "Cheque from Bank",
      detail: chqParts.length ? `Chq ${chqParts.join(", ")}` : "Cheque withdrawn from bank",
      reference: cheques[0]?.chequeNumber || null,
    };
  }

  return {
    type: "Cash from Bank",
    detail: slip ? `Cash withdrawn from bank · Slip #${slip}` : "Cash withdrawn from bank",
    reference: slip,
  };
}
