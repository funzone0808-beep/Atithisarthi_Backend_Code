const { z } = require("zod");

const hotelSlugSchema = z.string().trim().min(2).max(120);
const textSchema = (max = 2000) => z.string().trim().max(max).optional().nullable();
const moneySchema = z.number().finite().min(0).max(99999999.99);
const percentSchema = z.number().finite().min(0).max(100);
const jsonArraySchema = z.array(z.any()).max(100).optional();

const roomStatusSchema = z.enum([
  "available",
  "booked",
  "occupied",
  "cleaning",
  "maintenance",
  "inactive"
]);

const bookingStatusSchema = z.enum([
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show"
]);

const bookingSourceSchema = z.enum([
  "online",
  "walk-in",
  "phone",
  "whatsapp",
  "staff",
  "admin"
]);
const roomBookingOperationalSourceSchema = z.enum([
  "website",
  "manual",
  "legacy",
  "online",
  "walk-in",
  "phone",
  "whatsapp",
  "staff",
  "admin"
]);
const roomBookingPaymentStatusSchema = z.enum([
  "unpaid",
  "partial",
  "paid",
  "refunded"
]);
const roomAdvanceOptionSchema = z.enum([
  "no_advance",
  "partial",
  "full",
  "split"
]);
const roomAdvancePaymentLineSchema = z.object({
  amount: moneySchema.refine((value) => value > 0, {
    message: "Split payment amount must be greater than 0"
  }),
  paymentMethod: z.string().trim().min(1).max(80),
  transactionId: z.string().trim().max(200).optional().nullable(),
  notes: textSchema(1000)
}).strict();

const dateFieldSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");
const guestGstinSchema = z.union([
  z.string().trim().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Guest GSTIN must use the standard 15-character Indian GSTIN structure"),
  z.literal(""),
  z.null()
]).optional();

function isValidDateOnly(value = "") {
  const candidate = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return false;
  }

  const parsedDate = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime());
}

function refineDateRange(data, ctx) {
  const checkInDate = String(data.checkInDate || "").trim();
  const checkOutDate = String(data.checkOutDate || "").trim();

  if (!isValidDateOnly(checkInDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Check-in date must be a valid YYYY-MM-DD date",
      path: ["checkInDate"]
    });
  }

  if (!isValidDateOnly(checkOutDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Check-out date must be a valid YYYY-MM-DD date",
      path: ["checkOutDate"]
    });
  }

  if (!isValidDateOnly(checkInDate) || !isValidDateOnly(checkOutDate)) {
    return;
  }

  const checkInMs = Date.parse(`${checkInDate}T00:00:00.000Z`);
  const checkOutMs = Date.parse(`${checkOutDate}T00:00:00.000Z`);

  if (checkOutMs <= checkInMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Check-out date must be after check-in date",
      path: ["checkOutDate"]
    });
  }
}

function refineNegotiatedRate(data, ctx) {
  const hasRate =
    data.negotiatedNightlyRate !== undefined &&
    data.negotiatedNightlyRate !== null;
  const reason = String(data.negotiatedRateReason || "").trim();

  if (hasRate && reason.length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Negotiated rate reason must be at least 5 characters",
      path: ["negotiatedRateReason"]
    });
  }

  if (!hasRate && reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Negotiated nightly rate is required when a negotiated rate reason is provided",
      path: ["negotiatedNightlyRate"]
    });
  }
}

const roomFeatureSettingsSchema = z.object({
  hotelSlug: hotelSlugSchema,
  enableFoodModule: z.boolean().optional(),
  enableRoomModule: z.boolean().optional(),
  enableFoodOrdering: z.boolean().optional(),
  enableRoomBooking: z.boolean().optional(),
  enableRoomService: z.boolean().optional(),
  enableFoodReports: z.boolean().optional(),
  enableRoomReports: z.boolean().optional(),
  enableCombinedReports: z.boolean().optional(),
  enableCombinedBilling: z.boolean().optional()
});

const roomTypeSchema = z.object({
  hotelSlug: hotelSlugSchema,
  name: z.string().trim().min(2).max(150),
  description: textSchema(4000),
  basePrice: moneySchema.optional(),
  maxAdults: z.number().int().min(0).max(100).optional(),
  maxChildren: z.number().int().min(0).max(100).optional(),
  amenities: jsonArraySchema,
  images: jsonArraySchema,
  cancellationPolicy: textSchema(4000),
  isActive: z.boolean().optional()
});

const partialRoomTypeSchema = roomTypeSchema.omit({ hotelSlug: true }).partial();

const roomSchema = z.object({
  hotelSlug: hotelSlugSchema,
  roomTypeId: z.number().int().positive().optional().nullable(),
  roomNumber: z.string().trim().min(1).max(80),
  floor: textSchema(80),
  title: textSchema(160),
  capacity: z.number().int().min(0).max(200).optional(),
  maxAdults: z.number().int().min(0).max(100).optional(),
  maxChildren: z.number().int().min(0).max(100).optional(),
  bedType: textSchema(120),
  basePrice: moneySchema.optional(),
  discountPrice: moneySchema.optional().nullable(),
  taxPercent: percentSchema.optional(),
  status: roomStatusSchema.optional(),
  amenities: jsonArraySchema,
  images: jsonArraySchema,
  description: textSchema(4000),
  isActive: z.boolean().optional()
});

const partialRoomSchema = roomSchema.omit({ hotelSlug: true }).partial();

const roomAvailabilityQuerySchema = z
  .object({
    hotelSlug: hotelSlugSchema,
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.coerce.number().int().min(0).max(100).optional(),
    children: z.coerce.number().int().min(0).max(100).optional()
  })
  .superRefine(refineDateRange);

const roomBookingListQuerySchema = z.object({
  hotelSlug: hotelSlugSchema.optional(),
  status: bookingStatusSchema.optional(),
  fromDate: dateFieldSchema.optional(),
  toDate: dateFieldSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const staffRoomAvailabilityQuerySchema = z
  .object({
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.coerce.number().int().min(0).max(100).optional(),
    children: z.coerce.number().int().min(0).max(100).optional()
  })
  .superRefine(refineDateRange);

const staffRoomBookingListQuerySchema = z.object({
  status: bookingStatusSchema.optional(),
  paymentStatus: roomBookingPaymentStatusSchema.optional(),
  source: roomBookingOperationalSourceSchema.optional(),
  fromDate: dateFieldSchema.optional(),
  toDate: dateFieldSchema.optional(),
  search: z.string().trim().max(80)
    .regex(/^[\p{L}\p{N}\s@+._'-]*$/u, "Search contains unsupported characters")
    .optional(),
  sort: z.enum([
    "created_desc",
    "created_asc",
    "check_in_asc",
    "check_in_desc",
    "action_required",
    "payment_status"
  ]).optional().default("created_desc"),
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

const publicRoomAvailabilityQuerySchema = z
  .object({
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.coerce.number().int().min(0).max(20).optional(),
    children: z.coerce.number().int().min(0).max(20).optional()
  })
  .superRefine(refineDateRange);

const publicRoomDiscoveryQuerySchema = z
  .object({
    mode: z.enum(["types", "rooms"]).optional().default("types"),
    page: z.coerce.number().int().min(1).max(1000).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(24).optional().default(12),
    search: z.string().trim().max(80).regex(/^[\p{L}\p{N}\s.''-]*$/u).optional(),
    roomTypeId: z.coerce.number().int().positive().optional(),
    adults: z.coerce.number().int().min(0).max(20).optional(),
    children: z.coerce.number().int().min(0).max(20).optional(),
    minPrice: z.coerce.number().min(0).max(10000000).optional(),
    maxPrice: z.coerce.number().min(0).max(10000000).optional(),
    amenity: z.string().trim().max(80).regex(/^[\p{L}\p{N}\s&+.'/-]*$/u).optional(),
    bedType: z.string().trim().max(80).regex(/^[\p{L}\p{N}\s.''/-]*$/u).optional(),
    floor: z.string().trim().max(80).regex(/^[\p{L}\p{N}\s.''/-]*$/u).optional(),
    sort: z.enum(["recommended", "price_asc", "price_desc", "capacity"]).optional().default("recommended"),
    checkInDate: dateFieldSchema.optional(),
    checkOutDate: dateFieldSchema.optional()
  })
  .superRefine((value, context) => {
    if (Boolean(value.checkInDate) !== Boolean(value.checkOutDate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Check-in and check-out dates must be supplied together" });
    }
    if (value.checkInDate && value.checkOutDate) refineDateRange(value, context);
    if (value.minPrice !== undefined && value.maxPrice !== undefined && value.maxPrice < value.minPrice) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Maximum price must be greater than or equal to minimum price" });
    }
  });
const publicRoomBookingCreateSchema = z
  .object({
    roomId: z.number().int().positive(),
    guestName: z.string().trim().min(2).max(160),
    guestPhone: z.string().trim().min(8).max(30),
    guestEmail: z
      .union([z.string().trim().email().max(320), z.literal(""), z.null()])
      .optional(),
    guestCompanyName: textSchema(240),
    guestGstin: guestGstinSchema,
    guestPlaceOfSupply: textSchema(160),
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.number().int().min(1).max(20).optional(),
    children: z.number().int().min(0).max(20).optional(),
    notes: textSchema(1000)
  })
  .superRefine(refineDateRange);

const adminRoomBookingCreateSchema = z
  .object({
    hotelSlug: hotelSlugSchema,
    roomId: z.number().int().positive(),
    guestName: z.string().trim().min(2).max(160),
    guestPhone: z.string().trim().min(8).max(30),
    guestEmail: z
      .union([z.string().trim().email().max(320), z.literal(""), z.null()])
      .optional(),
    guestCompanyName: textSchema(240),
    guestGstin: guestGstinSchema,
    guestPlaceOfSupply: textSchema(160),
    guestIdProof: textSchema(500),
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    advancePaid: moneySchema.optional(),
    advanceOption: roomAdvanceOptionSchema.optional(),
    advanceAmount: moneySchema.optional(),
    advancePayments: z.array(roomAdvancePaymentLineSchema).max(10).optional(),
    bookingStatus: bookingStatusSchema.optional(),
    bookingSource: bookingSourceSchema.optional(),
    paymentMethod: z.string().trim().max(80).optional(),
    notes: textSchema(2000)
  })
  .superRefine(refineDateRange);

const adminRoomBookingStatusUpdateSchema = z.object({
  hotelSlug: hotelSlugSchema.optional(),
  bookingStatus: bookingStatusSchema,
  notes: textSchema(2000)
});

const adminRoomBookingPaymentSchema = z.object({
  hotelSlug: hotelSlugSchema.optional(),
  amount: moneySchema.refine((value) => value > 0, {
    message: "Amount must be greater than 0"
  }),
  paymentMethod: z.string().trim().min(1).max(80),
  paymentStatus: z.literal("paid").optional(),
  transactionId: z.string().trim().max(200).optional().nullable(),
  notes: textSchema(1000),
  idempotencyKey: z.string().trim().min(8).max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Idempotency key contains unsupported characters")
    .optional()
});

const roomCombinedCheckoutSchema = z
  .object({
    amount: moneySchema,
    paymentMethod: z.string().trim().min(1).max(80),
    transactionId: z.string().trim().max(200).optional().nullable(),
    notes: textSchema(2000),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
        "Idempotency key contains unsupported characters"
      ),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3,8}$/, "Currency must use 3 to 8 letters")
      .transform((value) => value.toUpperCase())
      .optional()
  })
  .strict();
const roomAdvancePolicySchema = z.object({
  advanceMode: z.enum(["disabled", "optional", "required"]),
  minimumType: z.enum(["fixed", "percentage"]),
  minimumValue: moneySchema,
  allowZeroAdvance: z.boolean(),
  allowMultiplePayments: z.boolean(),
  allowSplitPayments: z.boolean(),
  allowStaffAdvance: z.boolean(),
  allowedPaymentMethods: z.array(
    z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/)
  ).min(1).max(20),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  automaticCancellationEnabled: z.literal(false),
  version: z.number().int().positive()
}).strict().superRefine((data, ctx) => {
  if (data.minimumType === "percentage" && data.minimumValue > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Percentage minimum cannot exceed 100",
      path: ["minimumValue"]
    });
  }
});

const staffRoomBookingCreateSchema = z
  .object({
    roomId: z.number().int().positive(),
    guestName: z.string().trim().min(2).max(160),
    guestPhone: z.string().trim().min(8).max(30),
    guestEmail: z
      .union([z.string().trim().email().max(320), z.literal(""), z.null()])
      .optional(),
    guestCompanyName: textSchema(240),
    guestGstin: guestGstinSchema,
    guestPlaceOfSupply: textSchema(160),
    guestIdProof: textSchema(500),
    checkInDate: dateFieldSchema,
    checkOutDate: dateFieldSchema,
    adults: z.number().int().min(0).max(100).optional(),
    children: z.number().int().min(0).max(100).optional(),
    bookingSource: bookingSourceSchema.optional(),
    advanceOption: roomAdvanceOptionSchema.optional(),
    advanceAmount: moneySchema.optional(),
    advancePayments: z.array(roomAdvancePaymentLineSchema).max(10).optional(),
    paymentMethod: z.string().trim().max(80).optional(),
    negotiatedNightlyRate: moneySchema
      .refine((value) => value > 0, {
        message: "Negotiated nightly rate must be greater than 0"
      })
      .optional(),
    negotiatedRateReason: z.string().trim().max(500).optional(),
    notes: textSchema(2000)
  })
  .superRefine((data, ctx) => {
    refineDateRange(data, ctx);
    refineNegotiatedRate(data, ctx);
  });

module.exports = {
  adminRoomBookingCreateSchema,
  adminRoomBookingPaymentSchema,
  adminRoomBookingStatusUpdateSchema,
  partialRoomSchema,
  partialRoomTypeSchema,
  roomAvailabilityQuerySchema,
  roomAdvancePolicySchema,
  roomBookingListQuerySchema,
  roomCombinedCheckoutSchema,
  roomFeatureSettingsSchema,
  roomSchema,
  roomStatusSchema,
  roomTypeSchema,
  publicRoomAvailabilityQuerySchema,
  publicRoomDiscoveryQuerySchema,
  publicRoomBookingCreateSchema,
  staffRoomAvailabilityQuerySchema,
  staffRoomBookingCreateSchema,
  staffRoomBookingListQuerySchema
};

