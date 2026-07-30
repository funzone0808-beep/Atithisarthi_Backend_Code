const { z } = require("zod");

const staffQrItemSchema = z.object({
  menuItemId: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  quantity: z.number().int().min(1).max(25),
  publicItemReference: z.string().uuid().optional(),
  note: z.string().trim().max(300).optional()
}).strict();

const staffQrCorrectionSchema = z.object({
  action: z.enum(["edit", "approve", "reject", "cancel"]),
  clientRequestId: z.string().trim().min(12).max(160),
  expectedVersion: z.number().int().min(1).max(1000000),
  items: z.array(staffQrItemSchema).min(1).max(40).optional(),
  note: z.string().trim().max(1000).optional(),
  reason: z.string().trim().max(500).optional()
}).strict().superRefine((value, context) => {
  if (value.action === "edit" && !value.items?.length) {
    context.addIssue({ code: "custom", path: ["items"], message: "Edited items are required." });
  }
  if (["reject", "cancel"].includes(value.action) && String(value.reason || "").trim().length < 3) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A correction reason is required." });
  }
  const totalQuantity = (value.items || []).reduce((sum, item) => sum + item.quantity, 0);
  if (totalQuantity > 100) {
    context.addIssue({ code: "custom", path: ["items"], message: "The total quantity cannot exceed 100." });
  }
});

module.exports = { staffQrCorrectionSchema };
