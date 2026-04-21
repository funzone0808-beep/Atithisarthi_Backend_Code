const { z } = require("zod");

const staffLoginSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  pin: z.string().trim().min(4).max(80)
});

module.exports = {
  staffLoginSchema
};
