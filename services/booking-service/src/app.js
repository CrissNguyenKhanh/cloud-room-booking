import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { BookingRepository } from './repositories/booking-repository.js';
import { ReviewRepository } from './repositories/review-repository.js';
import { BookingService } from './services/booking-service.js';
import { ReviewService } from './services/review-service.js';
import { PaymentService } from './services/payment-service.js';
import { MockPaymentProvider } from './services/payment-provider.js';
import { createIdentityClient, createNotificationClient } from './services/service-clients.js';
import { OutboxDispatcher } from './services/outbox-dispatcher.js';
import { createMediaStorage } from './services/media-storage.js';
import { MediaService } from './services/media-service.js';
import { createMediaController } from './controllers/media-controller.js';
import { createBookingController } from './controllers/booking-controller.js';
import { createReviewController } from './controllers/review-controller.js';
import { createRoutes } from './routes/index.js';
import { requestContext } from './middleware/request-context.js';
import { errorHandler, notFound } from './middleware/error-handler.js';

export function createApp({ pool, config, repository = new BookingRepository(pool),
  reviewRepository = new ReviewRepository(pool), reviewService, reviewController,
  identityClient = createIdentityClient(config), notificationClient = createNotificationClient(config), dispatcher,
  paymentProvider = new MockPaymentProvider(), mediaStorage = createMediaStorage(config) }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(requestContext(config.serviceName));
  const activeDispatcher = dispatcher || new OutboxDispatcher(repository, notificationClient, config);
  const bookingService = new BookingService(repository, identityClient);
  const paymentService = new PaymentService(repository, paymentProvider);
  const activeReviewService = reviewService || new ReviewService(reviewRepository, repository);
  const controller = createBookingController({ bookingService, paymentService, reviewService: activeReviewService,
    repository, dispatcher: activeDispatcher });
  const mediaService = new MediaService(repository, mediaStorage, config);
  const mediaController = createMediaController({ mediaService });
  const activeReviewController = reviewController || createReviewController({ reviewService: activeReviewService });
  app.use(createRoutes({ controller, mediaController, reviewController: activeReviewController, pool, config }));
  app.use(notFound);
  app.use(errorHandler(config));
  return app;
}
