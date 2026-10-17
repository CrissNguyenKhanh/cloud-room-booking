import { ApiError } from "../utils/errors.js";
import { todayInVietnam } from "../utils/stay.js";

// Nghiệp vụ đánh giá. Dùng BookingRepository để kiểm tra lịch đặt/phòng, ReviewRepository để đọc ghi đánh giá.
export class ReviewService {
  constructor(reviewRepository, bookingRepository, clock = () => new Date()) {
    this.repository = reviewRepository;
    this.bookings = bookingRepository;
    this.clock = clock;
  }

  // Chỉ lịch đặt CONFIRMED và đã đến ngày trả phòng (theo giờ Việt Nam) mới được đánh giá.
  isReviewable(booking) {
    return (
      booking.status === "CONFIRMED" &&
      booking.check_out_date <= todayInVietnam(this.clock())
    );
  }

  // Trạng thái đánh giá của một lịch đặt, gắn vào chi tiết booking cho FE (hiện nút "Đánh giá" hay không).
  async reviewState(booking) {
    const review = await this.repository.findReviewByBooking(
      this.repository.pool,
      booking.id,
    );
    return {
      can_review: !review && this.isReviewable(booking),
      review_id: review?.id ?? null,
    };
  }

  // ---------- Khách ----------
  async createReview(bookingId, actor, payload) {
    try {
      return await this.repository.transaction(async (db) => {
        const booking = await this.bookings.findBooking(db, bookingId);
        if (!booking || booking.user_id !== actor.id)
          throw new ApiError(
            404,
            "BOOKING_NOT_FOUND",
            "Không tìm thấy lịch đặt",
          );
        if (booking.status !== "CONFIRMED")
          throw new ApiError(
            409,
            "BOOKING_NOT_REVIEWABLE",
            "Lịch đặt đã hủy nên không thể đánh giá",
          );
        if (!this.isReviewable(booking))
          throw new ApiError(
            409,
            "STAY_NOT_COMPLETED",
            "Chỉ được đánh giá sau khi đã đến ngày trả phòng",
          );
        if (await this.repository.findReviewByBooking(db, bookingId)) {
          throw new ApiError(
            409,
            "REVIEW_ALREADY_EXISTS",
            "Lịch đặt này đã được đánh giá",
          );
        }
        return this.repository.insertReview(db, {
          bookingId,
          roomId: booking.room_id,
          userId: actor.id,
          rating: payload.rating,
          title: payload.title,
          comment: payload.comment,
          reviewerName: payload.display_name,
        });
      });
    } catch (error) {
      if (error.code === "23505")
        throw new ApiError(
          409,
          "REVIEW_ALREADY_EXISTS",
          "Lịch đặt này đã được đánh giá",
        );
      throw error;
    }
  }

  async getBookingReview(bookingId, actor) {
    const booking = await this.bookings.getBookingView(
      this.bookings.pool,
      bookingId,
    );
    if (!booking || booking.user_id !== actor.id)
      throw new ApiError(404, "BOOKING_NOT_FOUND", "Không tìm thấy lịch đặt");
    const review = await this.repository.findReviewByBooking(
      this.repository.pool,
      bookingId,
    );
    if (!review)
      throw new ApiError(
        404,
        "REVIEW_NOT_FOUND",
        "Lịch đặt này chưa có đánh giá",
      );
    return this.repository.getReviewView(this.repository.pool, review.id);
  }

  async updateReview(id, actor, patch) {
    return this.repository.transaction(async (db) => {
      const review = await this.repository.findReviewForUpdate(db, id);
      if (!review || review.user_id !== actor.id)
        throw new ApiError(404, "REVIEW_NOT_FOUND", "Không tìm thấy đánh giá");
      return this.repository.updateReview(db, id, patch);
    });
  }

  async deleteReview(id, actor) {
    await this.repository.transaction(async (db) => {
      const review = await this.repository.findReviewForUpdate(db, id);
      if (!review || review.user_id !== actor.id)
        throw new ApiError(404, "REVIEW_NOT_FOUND", "Không tìm thấy đánh giá");
      await this.repository.deleteReview(db, id);
    });
  }

  async listRoomReviews(roomId, query) {
    const room = await this.bookings.getRoom(roomId);
    if (!room)
      throw new ApiError(404, "ROOM_NOT_FOUND", "Không tìm thấy phòng");
    const [{ reviews, total }, summary] = await Promise.all([
      this.repository.listRoomReviews(roomId, query),
      this.repository.getReviewSummary(roomId),
    ]);
    return {
      data: reviews,
      meta: { page: query.page, limit: query.limit, total },
      summary: {
        average_rating: summary.average_rating,
        review_count: summary.review_count,
        distribution: {
          1: summary.r1,
          2: summary.r2,
          3: summary.r3,
          4: summary.r4,
          5: summary.r5,
        },
      },
    };
  }

  async listMyReviews(userId, query) {
    const { reviews, total } = await this.repository.listMyReviews(
      userId,
      query,
    );
    return {
      data: reviews,
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  // ---------- Admin: đánh giá ----------
  async listAllReviews(query) {
    const { reviews, total } = await this.repository.listAdminReviews(query);
    return {
      data: reviews,
      meta: { page: query.page, limit: query.limit, total },
    };
  }
  async setReviewStatus(id, status) {
    const review = await this.repository.setReviewStatus(id, status);
    if (!review)
      throw new ApiError(404, "REVIEW_NOT_FOUND", "Không tìm thấy đánh giá");
    return review;
  }
}
