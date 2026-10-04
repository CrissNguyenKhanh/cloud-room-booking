import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { UserRepository } from './repositories/user-repository.js';
import { IdentityService } from './services/identity-service.js';
import { createIdentityController } from './controllers/identity-controller.js';
import { createRoutes } from './routes/index.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';

export function createApp({ pool, config, repository = new UserRepository(pool) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(requestContext(config.serviceName));
  const service = new IdentityService(repository, config);
  const controller = createIdentityController(service, repository);
  app.use(createRoutes({ controller, pool, config }));
  app.use(notFound);
  app.use(errorHandler(config));
  return app;
}
