/**
 * Sale status constants — single source of truth.
 *
 * Fix C5: lot-completion was filtering revenue by `status: "active"` only, while the
 * dashboard included both `active` and `marked_short`. Centralising the filter here
 * ensures all revenue-aggregation code paths agree.
 */

import { SaleStatus } from "@prisma/client";

export const REVENUE_SALE_STATUSES: SaleStatus[] = ["active", "marked_short"];
export const STOCK_CONSUMING_SALE_STATUSES: SaleStatus[] = ["active", "marked_short"];
