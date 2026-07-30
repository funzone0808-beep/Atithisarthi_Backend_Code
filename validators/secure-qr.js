const { z } = require("zod");

const secureQrItemSchema = z.object({
  menuItemId: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  quantity: z.number().int().min(1).max(25),
  variantId: z.union([z.string(), z.number()]).optional().nullable(),
  addonIds: z.array(z.union([z.string(), z.number()])).max(12).optional(),
  note: z.string().trim().max(300).optional()
}).strict();

const secureQrOrderSchema = z.object({
  clientRequestId: z.string().trim().min(12).max(160),
  expectedSessionVersion: z.number().int().min(1).max(1000000).default(1),
  customerName: z.string().trim().min(1).max(100).default("Table Guest"),
  customerPhone: z.string().trim().max(20).default(""),
  note: z.string().trim().max(1000).optional(),
  paymentMethod: z.enum(["COD", "Google Pay / UPI"]).default("COD"),
  paymentConfirmed: z.boolean().optional(),
  items: z.array(secureQrItemSchema).min(1).max(40)
}).strict().superRefine((value, context) => {
  const totalQuantity = value.items.reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > 100) {
    context.addIssue({
      code: "custom",
      path: ["items"],
      message: "The total quantity cannot exceed 100 items."
    });
  }
});

const secureQrEditSchema = z.object({
  clientRequestId: z.string().trim().min(12).max(160),
  expectedRoundVersion: z.number().int().min(1).max(1000000),
  note: z.string().trim().max(1000).optional(),
  items: z.array(secureQrItemSchema.extend({
    publicItemReference: z.string().uuid().optional()
  })).min(1).max(40)
}).strict();


module.exports = { secureQrEditSchema, secureQrOrderSchema };
