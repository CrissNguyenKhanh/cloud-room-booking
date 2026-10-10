import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { NotificationRepository } from './repositories/notification-repository.js';
import { NotificationService } from './services/notification-service.js';
import { createNotificationController } from './controllers/notification-controller.js';
import { createRoutes } from './routes/index.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
export function createApp({ pool, config, repository = new NotificationRepository(pool), realtime = null }) {
  const app = express();
  app.disable('x-powered-by'); app.use(helmet()); app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '32kb' })); app.use(requestContext(config.serviceName));
  app.use(createRoutes({ controller: createNotificationController(new NotificationService(repository, realtime)), pool, config }));
  app.use(notFound); app.use(errorHandler(config)); return app;
}
