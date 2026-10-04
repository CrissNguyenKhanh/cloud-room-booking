import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { BookingRepository } from './repositories/booking-repository.js';
import { BookingService } from './services/booking-service.js';
import { createIdentityClient, createNotificationClient } from './services/service-clients.js';
import { OutboxDispatcher } from './services/outbox-dispatcher.js';
import { createBookingController } from './controllers/booking-controller.js';
import { createRoutes } from './routes/index.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';

export function createApp({ pool, config, repository = new BookingRepository(pool),
  identityClient = createIdentityClient(config), notificationClient = createNotificationClient(config), dispatcher }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(requestContext(config.serviceName));
  const activeDispatcher = dispatcher || new OutboxDispatcher(repository, notificationClient, config);
  const bookingService = new BookingService(repository, identityClient);
  const controller = createBookingController({ bookingService, repository, dispatcher: activeDispatcher });
  app.use(createRoutes({ controller, pool, config }));
  app.use(notFound);
  app.use(errorHandler(config));
  return app;
}
