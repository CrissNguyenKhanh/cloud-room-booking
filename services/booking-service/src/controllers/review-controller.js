import { z } from "zod";

const uuid = z.uuid();

const reviewFields = {
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(100).default(""),
  comment: z.string().trim().max(2000).default(""),
  display_name: z.string().trim().min(1).max(60).default("Khách lưu trú"),
};
const reviewCreateSchema = z.object(reviewFields).strict();
const reviewUpdateSchema = z
  .object({
    rating: reviewFields.rating.optional(),
    title: z.string().trim().max(100).optional(),
    comment: z.string().trim().max(2000).optional(),
    display_name: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Cần ít nhất một trường cập nhật",
  )
  .transform(({ display_name: displayName, ...rest }) => ({
    ...rest,
    reviewer_name: displayName,
  }));
const ratingFilter = z.coerce.number().int().min(1).max(5).optional();
const roomReviewsQuerySchema = z.object({
  rating: ratingFilter,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const myReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const adminReviewsQuerySchema = z.object({
  status: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(["VISIBLE", "HIDDEN"]))
    .optional(),
  room_id: uuid.optional(),
  rating: ratingFilter,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const reviewStatusSchema = z
  .object({ status: z.enum(["VISIBLE", "HIDDEN"]) })
  .strict();

// Controller đánh giá: chỉ kiểm tra dữ liệu vào/ra, nghiệp vụ nằm ở ReviewService.
export function createReviewController({ reviewService }) {
  return {
    // ----- Khách -----
    roomReviews: async (req, res) =>
      res.json(
        await reviewService.listRoomReviews(
          uuid.parse(req.params.id),
          roomReviewsQuerySchema.parse(req.query),
        ),
      ),
    createReview: async (req, res) => {
      const review = await reviewService.createReview(
        uuid.parse(req.params.id),
        req.user,
        reviewCreateSchema.parse(req.body),
      );
      res.status(201).json({ data: review });
    },
    getBookingReview: async (req, res) =>
      res.json({
        data: await reviewService.getBookingReview(
          uuid.parse(req.params.id),
          req.user,
        ),
      }),
    myReviews: async (req, res) =>
      res.json(
        await reviewService.listMyReviews(
          req.user.id,
          myReviewsQuerySchema.parse(req.query),
        ),
      ),
    updateReview: async (req, res) => {
      res.json({
        data: await reviewService.updateReview(
          uuid.parse(req.params.id),
          req.user,
          reviewUpdateSchema.parse(req.body),
        ),
      });
    },
    deleteReview: async (req, res) => {
      await reviewService.deleteReview(uuid.parse(req.params.id), req.user);
      res.status(204).end();
    },

    // ----- Admin -----
    listReviewsAdmin: async (req, res) =>
      res.json(
        await reviewService.listAllReviews(
          adminReviewsQuerySchema.parse(req.query),
        ),
      ),
    setReviewStatus: async (req, res) => {
      res.json({
        data: await reviewService.setReviewStatus(
          uuid.parse(req.params.id),
          reviewStatusSchema.parse(req.body).status,
        ),
      });
    },
  };
}
