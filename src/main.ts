import "reflect-metadata";

import { readFileSync } from "node:fs";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";

import { AppModule } from "./app.module.ts";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.ts";
import { setupSwagger } from "./config/swagger.config.ts";
import { assertValidEnv } from "./config/validate-env.ts";
import { ResponseCryptoService } from "./secure-transport/response-crypto.service.ts";
import { secureTransport } from "./secure-transport/secure-transport.middleware.ts";

async function bootstrap() {
  assertValidEnv();
  // Optional built-in HTTPS. Without these the server speaks plain HTTP, so put a
  // TLS-terminating proxy (Caddy, nginx, a tunnel) in front of it.
  const tlsKey = process.env.TLS_KEY_PATH?.trim();
  const tlsCert = process.env.TLS_CERT_PATH?.trim();
  const httpsOptions =
    tlsKey && tlsCert
      ? { key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }
      : undefined;
  const app = await NestFactory.create(AppModule, { rawBody: true, httpsOptions });
  // Trust X-Forwarded-* from a reverse proxy so HSTS / secure-request detection work.
  if (process.env.TRUST_PROXY === "1") {
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set("trust proxy", 1);
  }
  app.useWebSocketAdapter(new IoAdapter(app));
  // CORS_ORIGINS="https://app.example.com,https://admin.example.com" restricts browser
  // origins. Unset keeps the old behaviour (any origin), which is fine for local dev only.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });
  app.use(secureTransport(app.get(ResponseCryptoService)));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  setupSwagger(app);

  const config = app.get(ConfigService);
  const port = config.get<number>("port", 3000);

  await app.listen(port, "0.0.0.0");
  Logger.log(`Server running at http://localhost:${port}`, "Bootstrap");
  Logger.log(`LAN: http://192.168.1.165:${port}`, "Bootstrap");
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, "Bootstrap");
}


bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
