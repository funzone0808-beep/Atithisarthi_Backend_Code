const { z } = require("zod");

const paymentCartItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  qty: z.number().int().positive().max(200)
});

const paymentOrderContextSchema = z.object({
  orderType: z.string().trim().max(40).optional(),
  tableNumber: z.string().trim().max(80).optional(),
  orderSource: z.string().trim().max(40).optional()
}).optional();

const paymentOrderDraftSchema = z.object({
  hotelName: z.string().trim().min(1).max(150).optional(),
  customerName: z.string().trim().min(2).max(100),
  customerPhone: z.string().trim().min(8).max(20),
  customerAddress: z.string().trim().min(3).max(500),
  note: z.string().trim().max(1000).optional(),
  whatsappMessage: z.string().max(5000).optional()
}).optional();

const paymentInitSchema = z.object({
  hotelSlug: z.string().trim().min(1).max(120),
  paymentMethod: z.string().trim().min(1).max(40).optional(),
  items: z.array(paymentCartItemSchema).min(1).max(100),
  orderContext: paymentOrderContextSchema,
  orderDraft: paymentOrderDraftSchema
});

const paymentOrderIdSchema = z.union([
  z.string().trim().min(1).max(120),
  z.number().int().positive().safe().transform((value) => String(value))
]);

const paymentVerifySchema = z.object({
  hotelSlug: z.string().trim().min(1).max(120).optional(),
  orderId: paymentOrderIdSchema.optional(),
  gatewayOrderId: z.string().trim().min(1).max(200),
  gatewayPaymentId: z.string().trim().min(1).max(200),
  gatewaySignature: z.string().trim().min(10).max(500)
}).refine(
  (data) => !data.orderId || !!data.hotelSlug,
  {
    message: "hotelSlug is required when orderId is provided",
    path: ["hotelSlug"]
  }
);

const paymentReconcileSchema = z.object({
  hotelSlug: z.string().trim().min(1).max(120),
  orderId: paymentOrderIdSchema,
  gatewayOrderId: z.string().trim().min(1).max(200)
});

const paymentFailureSchema = z.object({
  hotelSlug: z.string().trim().min(1).max(120),
  orderId: paymentOrderIdSchema,
  gatewayOrderId: z.string().trim().min(1).max(200),
  gatewayPaymentId: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(500).optional(),
  errorCode: z.string().trim().max(120).optional(),
  errorSource: z.string().trim().max(120).optional(),
  errorStep: z.string().trim().max(120).optional()
});

module.exports = {
  paymentInitSchema,
  paymentVerifySchema,
  paymentReconcileSchema,
  paymentFailureSchema
};
