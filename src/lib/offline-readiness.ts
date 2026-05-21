export function getOfflineFormReadinessError(params: {
  isOnline: boolean;
  currencyCount: number;
  moduleTitle: string;
}): string | null {
  if (params.isOnline) return null;
  if (params.currencyCount > 0) return null;
  return `Offline ${params.moduleTitle} is not ready on this device yet. Connect to the internet once and wait for data sync to finish, then you can use ${params.moduleTitle} offline for extended periods.`;
}
