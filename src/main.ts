import "reflect-metadata";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { IoAdapter } from "@nestjs/platform-socket.io";

import { AppModule } from "./app.module.ts";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.ts";
import { setupSwagger } from "./config/swagger.config.ts";
import { assertValidEnv } from "./config/validate-env.ts";

async function bootstrap() {
  assertValidEnv();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({
    origin: true,
    credentials: true,
  });
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
