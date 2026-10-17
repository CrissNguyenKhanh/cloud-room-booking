import { Router } from "express";
import { asyncHandler } from "../utils/errors.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

export function createRoutes({ controller, mediaController, pool, config }) {
  const router = Router();
  const auth = authMiddleware(config);
  const admin = [auth, requireRole("ADMIN")];
  router.get("/health", (_req, res) =>
    res.json({ status: "ok", service: config.serviceName }),
  );
  router.get(
    "/ready",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ready", service: config.serviceName });
    }),
  );
  router.get("/api/v1/rooms", asyncHandler(controller.listRooms));
  router.get("/api/v1/rooms/search", asyncHandler(controller.searchRooms));
  router.get(
    "/api/v1/rooms/:id/media",
    asyncHandler(mediaController.listPublicMedia),
  );
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
  router.get("/api/v1/bookings/me", auth, asyncHandler(controller.myBookings));
  router.get(
    "/api/v1/bookings/:id",
    auth,
    asyncHandler(controller.getMyBooking),
  );
  router.post(
    "/api/v1/bookings/:id/payments",
    auth,
    asyncHandler(controller.createPayment),
  );
  router.get(
    "/api/v1/bookings/:id/payment",
    auth,
    asyncHandler(controller.getPayment),
  );
  router.post(
    "/api/v1/bookings/:id/cancel",
    auth,
    asyncHandler(controller.cancelMine),
  );
  router.post(
    "/api/v1/admin/rooms",
    ...admin,
    asyncHandler(controller.createRoom),
  );
  router.get(
    "/api/v1/admin/rooms",
    ...admin,
    asyncHandler(controller.listAdminRooms),
  );
  router.patch(
    "/api/v1/admin/rooms/:id",
    ...admin,
    asyncHandler(controller.updateRoom),
  );
  router.post(
    "/api/v1/admin/rooms/:id/media",
    ...admin,
    asyncHandler(mediaController.uploadMedia),
  );
  router.get(
    "/api/v1/admin/rooms/:id/media",
    ...admin,
    asyncHandler(mediaController.listMedia),
  );
  router.put(
    "/api/v1/admin/rooms/:id/media/:mediaId/file",
    ...admin,
    asyncHandler(mediaController.replaceMediaFile),
  );
  router.patch(
    "/api/v1/admin/rooms/:id/media/:mediaId",
    ...admin,
    asyncHandler(mediaController.updateMedia),
  );
  router.delete(
    "/api/v1/admin/rooms/:id/media/:mediaId",
    ...admin,
    asyncHandler(mediaController.deleteMedia),
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
