import { Global, Module } from "@nestjs/common";

import { OxaPayClient } from "./oxapay.client.ts";

@Global()
@Module({
  providers: [OxaPayClient],
  exports: [OxaPayClient],
})
export class OxaPayModule {}
