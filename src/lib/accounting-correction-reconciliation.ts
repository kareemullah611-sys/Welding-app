export type ReversibleJournalLine = {
  transactionId: string;
  accountId: number;
  currencyCode: string;
  debit: unknown;
  credit: unknown;
};

function money(value: unknown): string {
  return Number(value || 0).toFixed(2);
}

function signature(line: ReversibleJournalLine): string {
  return [line.accountId, line.currencyCode, money(line.debit), money(line.credit)].join("|");
}

function inverseSignature(line: ReversibleJournalLine): string {
  return [line.accountId, line.currencyCode, money(line.credit), money(line.debit)].join("|");
}

export function excludeExactlyReversedJournalGroups<T extends ReversibleJournalLine>(lines: T[]) {
  const groupedIndexes = new Map<string, number[]>();
  lines.forEach((line, index) => groupedIndexes.set(line.transactionId, [...(groupedIndexes.get(line.transactionId) || []), index]));

  const exactReversalPairs: Array<{ originalTransactionId: string; reversalTransactionId: string }> = [];
  const unmatchedReversalTransactionIds: string[] = [];
  const activeIndexes = new Set(lines.map((_line, index) => index));
  const reversalTransactionIds = [...groupedIndexes.keys()]
    .filter((transactionId) => transactionId.startsWith("REV-") || transactionId.startsWith("CORR-REV-"))
    .sort((left, right) => {
      const leftPriority = left.startsWith("CORR-REV-") ? 1 : 0;
      const rightPriority = right.startsWith("CORR-REV-") ? 1 : 0;
      return leftPriority - rightPriority || left.localeCompare(right);
    });

  for (const reversalTransactionId of reversalTransactionIds) {
    const originalTransactionId = reversalTransactionId.startsWith("CORR-REV-")
      ? reversalTransactionId.slice("CORR-REV-".length)
      : reversalTransactionId.slice("REV-".length);
    const reversalIndexes = (groupedIndexes.get(reversalTransactionId) || []).filter((index) => activeIndexes.has(index));
    const originalIndexes = (groupedIndexes.get(originalTransactionId) || []).filter((index) => activeIndexes.has(index));
    const availableOriginalIndexes = [...originalIndexes];
    const matchedOriginalIndexes: number[] = [];
    let exact = reversalIndexes.length > 0;
    for (const reversalIndex of reversalIndexes) {
      const expected = signature(lines[reversalIndex]);
      const matchAt = availableOriginalIndexes.findIndex((index) => inverseSignature(lines[index]) === expected);
      if (matchAt < 0) {
        exact = false;
        break;
      }
      matchedOriginalIndexes.push(availableOriginalIndexes[matchAt]);
      availableOriginalIndexes.splice(matchAt, 1);
    }
    if (!exact || matchedOriginalIndexes.length !== reversalIndexes.length) {
      unmatchedReversalTransactionIds.push(reversalTransactionId);
      continue;
    }
    reversalIndexes.forEach((index) => activeIndexes.delete(index));
    matchedOriginalIndexes.forEach((index) => activeIndexes.delete(index));
    exactReversalPairs.push({ originalTransactionId, reversalTransactionId });
  }

  return {
    effectiveJournalLines: lines.filter((_line, index) => activeIndexes.has(index)),
    exactReversalPairs: exactReversalPairs.sort((left, right) => left.originalTransactionId.localeCompare(right.originalTransactionId)),
    unmatchedReversalTransactionIds: unmatchedReversalTransactionIds.sort(),
  };
}
