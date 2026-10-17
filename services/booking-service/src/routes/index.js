import { Router } from "express";
import { asyncHandler } from "../utils/errors.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

export function createRoutes({ controller, reviewController, pool, config }) {
  const router = Router();
  const auth = authMiddleware(config);
  const admin = [auth, requireRole("ADMIN")];
  router.get("/health", (_req, res) =>
    res.json({ status: "ok", service: config.serviceName }),
  );
  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(new Error("Database readiness timeout"), {
                  status: 503,
                  code: "DATABASE_NOT_READY",
                }),
              ),
            2000,
          ),
        ),
      ]);
      res.json({ status: "ready", service: config.serviceName });
    }),
  );
  router.get("/api/v1/rooms", asyncHandler(controller.listRooms));
  router.get("/api/v1/rooms/search", asyncHandler(controller.searchRooms));
  router.get("/api/v1/rooms/:id", asyncHandler(controller.getRoom));
  router.get(
    "/api/v1/rooms/:id/unavailable-dates",
    asyncHandler(controller.unavailableDates),
  );
  router.get(
    "/api/v1/rooms/:id/alternatives",
    asyncHandler(controller.alternatives),
  );
  router.post("/api/v1/bookings", auth, asyncHandler(controller.createBooking));
  router.get(
    "/api/v1/admin/rooms",
    ...admin,
    asyncHandler(controller.listRooms),
  );
  router.get("/api/v1/bookings/me", auth, asyncHandler(controller.myBookings));
  router.get(
    "/api/v1/bookings/:id",
    auth,
    asyncHandler(controller.getMyBooking),
  );
  router.post(
    "/api/v1/bookings/:id/cancel",
    auth,
    asyncHandler(controller.cancelMine),
  );
  router.get(
    "/api/v1/rooms/:id/reviews",
    asyncHandler(reviewController.roomReviews),
  );
  router.post(
    "/api/v1/bookings/:id/review",
    auth,
    asyncHandler(reviewController.createReview),
  );
  router.get(
    "/api/v1/bookings/:id/review",
    auth,
    asyncHandler(reviewController.getBookingReview),
  );
  router.get(
    "/api/v1/reviews/me",
    auth,
    asyncHandler(reviewController.myReviews),
  );
  router.patch(
    "/api/v1/reviews/:id",
    auth,
    asyncHandler(reviewController.updateReview),
  );
  router.delete(
    "/api/v1/reviews/:id",
    auth,
    asyncHandler(reviewController.deleteReview),
  );
  router.post(
    "/api/v1/admin/rooms",
    ...admin,
    asyncHandler(controller.createRoom),
  );
  router.patch(
    "/api/v1/admin/rooms/:id",
    ...admin,
    asyncHandler(controller.updateRoom),
  );
  router.get(
    "/api/v1/admin/bookings",
    ...admin,
    asyncHandler(controller.listBookings),
  );
  router.post(
    "/api/v1/admin/bookings/:id/cancel",
    ...admin,
    asyncHandler(controller.cancelAdmin),
  );
  router.get(
    "/api/v1/admin/reviews",
    ...admin,
    asyncHandler(reviewController.listReviewsAdmin),
  );
  router.patch(
    "/api/v1/admin/reviews/:id/status",
    ...admin,
    asyncHandler(reviewController.setReviewStatus),
  );
  router.get(
    "/api/v1/admin/outbox",
    ...admin,
    asyncHandler(controller.listOutbox),
  );
  router.post(
    "/api/v1/admin/outbox/retry",
    ...admin,
    asyncHandler(controller.retryOutbox),
  );
  return router;
}
