ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_key" UNIQUE ("name");
ALTER TABLE "shipping_lines" ADD CONSTRAINT "shipping_lines_name_key" UNIQUE ("name");
ALTER TABLE "intermediaries" ADD CONSTRAINT "intermediaries_name_key" UNIQUE ("name");
