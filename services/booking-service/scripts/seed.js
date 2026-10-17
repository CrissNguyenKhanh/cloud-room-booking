import { loadConfig } from "../src/config/env.js";
import { createPool } from "../src/config/database.js";
import { addDays, nightsBetween, todayInVietnam } from "../src/utils/stay.js";
const config = loadConfig();
const pool = createPool(config);
const rooms = [
  {
    number: "801",
    name: "Deluxe Skyline",
    type: "deluxe",
    price: 1650000,
    capacity: 2,
    size: 34,
    bed: "1 giường King",
    view: "Toàn cảnh thành phố",
    floor: 8,
    featured: true,
    amenities: [
      "Bữa sáng",
      "Bồn tắm",
      "Wi-Fi tốc độ cao",
      "Smart TV",
      "Minibar",
    ],
    description:
      "Không gian thư thái trên tầng cao với cửa sổ tràn viền, chất liệu gỗ ấm và góc đọc sách nhìn ra đường chân trời.",
    palette: ["#a9c7c2", "#ead9bc", "#234d5f"],
  },
  {
    number: "503",
    name: "Premier Garden",
    type: "premier",
    price: 1850000,
    capacity: 2,
    size: 38,
    bed: "1 giường King",
    view: "Vườn nhiệt đới",
    floor: 5,
    featured: true,
    amenities: [
      "Ban công riêng",
      "Bữa sáng",
      "Máy pha cà phê",
      "Áo choàng tắm",
    ],
    description:
      "Một khoảng xanh riêng tư giữa thành phố, với ban công rộng và thiết kế nhẹ nhàng lấy cảm hứng từ thiên nhiên.",
    palette: ["#79967d", "#e8dfc9", "#173f39"],
  },
  {
    number: "606",
    name: "Family Haven",
    type: "family",
    price: 2650000,
    capacity: 4,
    size: 52,
    bed: "1 King + 2 giường đơn",
    view: "Hồ bơi & sân trong",
    floor: 6,
    featured: true,
    amenities: [
      "Phòng khách",
      "Bồn tắm",
      "Bữa sáng 4 khách",
      "Bàn ăn",
      "Nôi theo yêu cầu",
    ],
    description:
      "Căn phòng rộng rãi dành cho gia đình, tách biệt khu nghỉ và khu sinh hoạt để mọi thành viên đều thoải mái.",
    palette: ["#d4a574", "#efe3ce", "#2d5966"],
  },
  {
    number: "1002",
    name: "Executive River",
    type: "executive",
    price: 2350000,
    capacity: 2,
    size: 42,
    bed: "1 giường King",
    view: "Hướng sông",
    floor: 10,
    featured: false,
    amenities: [
      "Executive lounge",
      "Bữa sáng",
      "Bàn làm việc",
      "Late check-out",
    ],
    description:
      "Tĩnh lặng, riêng tư và đầy đủ tiện nghi cho chuyến công tác hoặc kỳ nghỉ cuối tuần sang trọng.",
    palette: ["#7596a5", "#ddc9a7", "#17384d"],
  },
  {
    number: "1201",
    name: "CloudStay Suite",
    type: "suite",
    price: 3450000,
    capacity: 3,
    size: 68,
    bed: "1 King + sofa giường",
    view: "Góc nhìn 270°",
    floor: 12,
    featured: true,
    amenities: [
      "Phòng khách riêng",
      "Bồn tắm lớn",
      "Bữa sáng",
      "Quầy bar",
      "Butler theo giờ",
    ],
    description:
      "Hạng phòng đặc trưng của CloudStay với phòng khách riêng, tầm nhìn rộng và từng chi tiết được chăm chút.",
    palette: ["#b48a5a", "#eadfcf", "#1b4051"],
  },
  {
    number: "407",
    name: "Twin Comfort",
    type: "twin",
    price: 1250000,
    capacity: 2,
    size: 30,
    bed: "2 giường đơn",
    view: "Khu phố yên tĩnh",
    floor: 4,
    featured: false,
    amenities: ["Wi-Fi tốc độ cao", "Smart TV", "Vòi sen mưa", "Két an toàn"],
    description:
      "Lựa chọn gọn gàng và tiện nghi cho hai người, với hai giường riêng cùng ánh sáng tự nhiên dễ chịu.",
    palette: ["#8aa6b1", "#eee4d2", "#315565"],
  },
];

// ---------- Đánh giá mẫu ----------
// Khách mẫu (không có tài khoản thật) để trang chi tiết phòng có sẵn đánh giá hiển thị.
const DEMO_GUESTS = [
  { id: "d0000000-0000-4000-8000-000000000001", name: "Minh Anh" },
  { id: "d0000000-0000-4000-8000-000000000002", name: "Quốc Bảo" },
  { id: "d0000000-0000-4000-8000-000000000003", name: "Thu Hà" },
];
// daysAgo = số ngày trước hôm nay mà khách trả phòng; các kỳ lưu trú của cùng một phòng không chồng nhau.
const DEMO_STAYS = [
  {
    code: "BK-SEED-REVIEW-01",
    room: "801",
    guest: 0,
    nights: 2,
    daysAgo: 42,
    rating: 5,
    title: "Tầm nhìn tuyệt đẹp",
    comment:
      "Phòng sạch sẽ, nhìn ra thành phố rất đẹp vào buổi tối. Nhân viên nhiệt tình, bữa sáng ngon.",
  },
  {
    code: "BK-SEED-REVIEW-02",
    room: "801",
    guest: 1,
    nights: 3,
    daysAgo: 30,
    rating: 4,
    title: "Rất đáng tiền",
    comment:
      "Giường êm, bồn tắm thoải mái. Chỉ tiếc là thang máy hơi đông vào giờ cao điểm.",
  },
  {
    code: "BK-SEED-REVIEW-03",
    room: "503",
    guest: 2,
    nights: 2,
    daysAgo: 35,
    rating: 5,
    title: "Ban công xanh mát",
    comment: "Ban công rộng nhìn ra vườn, rất yên tĩnh. Sẽ quay lại.",
  },
  {
    code: "BK-SEED-REVIEW-04",
    room: "606",
    guest: 0,
    nights: 4,
    daysAgo: 25,
    rating: 4,
    title: "Hợp cho gia đình",
    comment:
      "Phòng rộng, các bé rất thích. Bữa sáng phong phú, đủ chỗ cho 4 người.",
  },
  {
    code: "BK-SEED-REVIEW-05",
    room: "1201",
    guest: 1,
    nights: 2,
    daysAgo: 20,
    rating: 5,
    title: "Trải nghiệm đáng nhớ",
    comment: "Suite rộng và sang trọng, tầm nhìn 270° thật sự ấn tượng.",
  },
  {
    code: "BK-SEED-REVIEW-06",
    room: "407",
    guest: 2,
    nights: 1,
    daysAgo: 15,
    rating: 3,
    title: "Ổn cho một đêm",
    comment: "Phòng gọn gàng, đủ tiện nghi nhưng hơi nhỏ so với hình ảnh.",
  },
];

async function roomsByNumber(pool) {
  const { rows } = await pool.query(
    "SELECT id, room_number, price_per_night FROM booking.rooms",
  );
  return new Map(rows.map((room) => [room.room_number, room]));
}

// Tạo lịch đặt trong quá khứ (không thể tạo qua API vì API chặn ngày nhận phòng ở quá khứ).
async function insertStay(
  pool,
  {
    code,
    room,
    userId,
    checkIn,
    checkOut,
    status = "CONFIRMED",
    guests = 2,
    later = false,
  },
) {
  const existing = await pool.query(
    "SELECT id FROM booking.bookings WHERE booking_code = $1",
    [code],
  );
  if (existing.rowCount) return { id: existing.rows[0].id, created: false };
  // Nhiều tài khoản có thể cùng chạy seed trên một DB: dời khoảng ngày (về quá khứ, hoặc về tương lai nếu `later`)
  // cho đến khi không chồng với lịch CONFIRMED nào khác của phòng, nếu không sẽ vi phạm bookings_no_overlap.
  const nights = nightsBetween(checkIn, checkOut);
  if (status === "CONFIRMED") {
    const step = (later ? 1 : -1) * (nights + 1);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const clash = await pool.query(
        `SELECT 1 FROM booking.bookings WHERE room_id = $1 AND status = 'CONFIRMED'
           AND daterange(check_in_date, check_out_date, '[)') && daterange($2::date, $3::date, '[)')`,
        [room.id, checkIn, checkOut],
      );
      if (!clash.rowCount) break;
      checkIn = addDays(checkIn, step);
      checkOut = addDays(checkOut, step);
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO booking.bookings (room_id, user_id, status, idempotency_key, request_hash, booking_code,
       check_in_date, check_out_date, guests, nights, price_per_night, total_price, cancel_reason)
     VALUES ($1, $2, $3, $4, 'seed', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      room.id,
      userId,
      status,
      `seed-${code}`,
      code,
      checkIn,
      checkOut,
      guests,
      nights,
      room.price_per_night,
      room.price_per_night * nights,
      status === "CANCELLED" ? "Dữ liệu mẫu" : null,
    ],
  );
  return { id: rows[0].id, created: true };
}

async function seedDemoReviews(pool) {
  const rooms = await roomsByNumber(pool);
  const today = todayInVietnam();
  let created = 0;
  for (const stay of DEMO_STAYS) {
    const room = rooms.get(stay.room);
    if (!room) continue;
    const guest = DEMO_GUESTS[stay.guest];
    const checkOut = addDays(today, -stay.daysAgo);
    const booking = await insertStay(pool, {
      code: stay.code,
      room,
      userId: guest.id,
      checkIn: addDays(checkOut, -stay.nights),
      checkOut,
    });
    const result = await pool.query(
      `INSERT INTO booking.reviews (booking_id, room_id, user_id, rating, title, comment, reviewer_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (booking_id) DO NOTHING`,
      [
        booking.id,
        room.id,
        guest.id,
        stay.rating,
        stay.title,
        stay.comment,
        guest.name,
      ],
    );
    created += result.rowCount;
  }
  return created;
}

// Để tự test API đánh giá, cần một tài khoản thật có lịch đã trả phòng. Đặt SEED_DEMO_USER_ID (uuid từ GET /api/v1/users/me
// của identity-service) hoặc SEED_DEMO_USER_EMAIL (chỉ hoạt động khi booking có quyền đọc schema identity, ví dụ trên Neon).
async function resolveDemoUserId(pool, config) {
  const id = process.env.SEED_DEMO_USER_ID?.trim();
  if (id) return id;
  const email = process.env.SEED_DEMO_USER_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  try {
    const { rows } = await pool.query(
      "SELECT id FROM identity.users WHERE email = $1",
      [email],
    );
    if (rows[0]) return rows[0].id;
    console.warn(
      JSON.stringify({
        service: config.serviceName,
        event: "seed_demo_user_not_found",
        email,
      }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: config.serviceName,
        event: "seed_demo_user_lookup_failed",
        message: error.message,
      }),
    );
  }
  return null;
}

async function seedDemoUserStays(pool, userId) {
  const rooms = await roomsByNumber(pool);
  const today = todayInVietnam();
  const tag = userId.slice(0, 8);
  const plans = [
    // Đã trả phòng, chưa đánh giá => đánh giá được.
    {
      key: "completed_1",
      code: `BK-SEED-DONE1-${tag}`,
      room: "801",
      checkIn: addDays(today, -12),
      checkOut: addDays(today, -10),
    },
    {
      key: "completed_2",
      code: `BK-SEED-DONE2-${tag}`,
      room: "503",
      checkIn: addDays(today, -5),
      checkOut: addDays(today, -3),
    },
    // Chưa đến ngày trả phòng => 409 STAY_NOT_COMPLETED.
    {
      key: "upcoming",
      code: `BK-SEED-NEXT-${tag}`,
      room: "606",
      checkIn: addDays(today, 20),
      checkOut: addDays(today, 22),
      later: true,
    },
    // Đã hủy => 409 BOOKING_NOT_REVIEWABLE.
    {
      key: "cancelled",
      code: `BK-SEED-CANC-${tag}`,
      room: "1002",
      checkIn: addDays(today, -8),
      checkOut: addDays(today, -6),
      status: "CANCELLED",
    },
  ];
  const ids = {};
  for (const plan of plans) {
    const stay = await insertStay(pool, {
      ...plan,
      room: rooms.get(plan.room),
      userId,
    });
    ids[plan.key] = stay.id;
  }
  return ids;
}

// Seed dữ liệu đánh giá: khách mẫu có sẵn đánh giá + (tùy chọn) lịch đã trả phòng cho một tài khoản thật để test API.
async function seedReviews({ pool, config }) {
  const reviewsCreated = await seedDemoReviews(pool);
  console.log(
    JSON.stringify({
      service: config.serviceName,
      event: "seed_reviews_complete",
      reviews_created: reviewsCreated,
    }),
  );
  const demoUserId = await resolveDemoUserId(pool, config);
  if (demoUserId) {
    const bookings = await seedDemoUserStays(pool, demoUserId);
    console.log(
      JSON.stringify({
        service: config.serviceName,
        event: "seed_demo_user_stays_complete",
        user_id: demoUserId,
        bookings,
      }),
    );
  }
}

try {
  for (const r of rooms)
    await pool.query(
      `INSERT INTO booking.rooms (room_number, name, room_type, price_per_night, capacity, size_sqm, bed_type,
       view_label, floor, featured, equipment, description, palette)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (name) DO UPDATE SET room_number = EXCLUDED.room_number, room_type = EXCLUDED.room_type,
       price_per_night = EXCLUDED.price_per_night, capacity = EXCLUDED.capacity, size_sqm = EXCLUDED.size_sqm,
       bed_type = EXCLUDED.bed_type, view_label = EXCLUDED.view_label, floor = EXCLUDED.floor,
       featured = EXCLUDED.featured, equipment = EXCLUDED.equipment, description = EXCLUDED.description,
       palette = EXCLUDED.palette, updated_at = now()`,
      [
        r.number,
        r.name,
        r.type,
        r.price,
        r.capacity,
        r.size,
        r.bed,
        r.view,
        r.floor,
        r.featured,
        JSON.stringify(r.amenities),
        r.description,
        JSON.stringify(r.palette),
      ],
    );
  console.log(
    JSON.stringify({
      service: config.serviceName,
      event: "seed_complete",
      rooms: rooms.length,
    }),
  );
  await seedReviews({ pool, config });
} finally {
  await pool.end();
}
