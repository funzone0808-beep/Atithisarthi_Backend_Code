const { z } = require("zod");

const staffLoginSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  pin: z.string().trim().min(4).max(80)
});

const staffTableOrderItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  qty: z.number().int().positive().max(100)
});

const staffTableOrderSchema = z.object({
  tableNumber: z.string().trim().min(1).max(80),
  customerName: z.string().trim().max(100).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  note: z.string().trim().max(1000).optional(),
  items: z.array(staffTableOrderItemSchema).min(1).max(100)
});

module.exports = {
  staffLoginSchema,
  staffTableOrderSchema
};
