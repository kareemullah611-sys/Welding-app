export function classifyCustomerBalance(balance: number) {
  if (balance > 0) return { receivable: balance, advance: 0, net: balance };
  if (balance < 0) return { receivable: 0, advance: Math.abs(balance), net: balance };
  return { receivable: 0, advance: 0, net: 0 };
}
