ALTER TABLE "haji_transfers"
  ADD CONSTRAINT "haji_transfers_party_destination_check"
  CHECK (
    (
      "settlement_destination" <> 'party_account'
      AND "destination_party_type" IS NULL
      AND "destination_supplier_id" IS NULL
      AND "destination_shipping_line_id" IS NULL
      AND "destination_agent_id" IS NULL
      AND "destination_intermediary_id" IS NULL
    )
    OR (
      "settlement_destination" = 'party_account'
      AND "destination_party_type" IS NULL
      AND "destination_supplier_id" IS NULL
      AND "destination_shipping_line_id" IS NULL
      AND "destination_agent_id" IS NULL
      AND "destination_intermediary_id" IS NULL
      AND NULLIF(BTRIM("transferred_to"), '') IS NOT NULL
    )
  );
