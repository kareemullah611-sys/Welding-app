export function getOfflineFormReadinessError(params: {
  isOnline: boolean;
  currencyCount: number;
  moduleTitle: string;
}): string | null {
  if (params.isOnline) return null;
  if (params.currencyCount > 0) return null;
  return `Offline ${params.moduleTitle} setup is not ready on this device yet. Connect internet once and open ${params.moduleTitle}, then you can use it offline.`;
}
