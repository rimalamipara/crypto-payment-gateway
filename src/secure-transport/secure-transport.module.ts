import { Controller, Get, Global, Inject, Module } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { Public } from "../common/decorators/public.decorator.ts";
import { ResponseCryptoService } from "./response-crypto.service.ts";

@ApiTags("crypto")
@Controller("crypto")
export class SecureTransportController {
  constructor(
    @Inject(ResponseCryptoService) private readonly crypto: ResponseCryptoService,
  ) {}

  @Public()
  @Get("public-key")
  @ApiOperation({
    summary:
      "Server public key (ECDH P-256, base64, uncompressed) used to derive the response-encryption key",
  })
  publicKey() {
    return { key: this.crypto.publicKey() };
  }
}

/** Global so the game gateways can seal websocket payloads. */
@Global()
@Module({
  controllers: [SecureTransportController],
  providers: [ResponseCryptoService],
  exports: [ResponseCryptoService],
})
export class SecureTransportModule {}
