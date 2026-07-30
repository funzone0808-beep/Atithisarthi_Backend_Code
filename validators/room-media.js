"use strict";

const { z } = require("zod");

const roomImageMetadataSchema = z.object({
  altText: z.string().trim().min(2).max(240),
  caption: z.string().trim().max(500).optional().default(""),
  isPrimary: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true)
}).strict().superRefine((value, ctx) => {
  if (value.isPrimary && !value.isActive) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["isActive"], message: "A primary room image must be active" });
  }
});

const roomImageUpdateSchema = z.object({
  altText: z.string().trim().min(2).max(240).optional(),
  caption: z.string().trim().max(500).optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one room-image field must be changed"
});

const roomImageReorderSchema = z.object({
  imageIds: z.array(z.number().int().positive()).min(1).max(50)
}).strict().superRefine((value, ctx) => {
  if (new Set(value.imageIds).size !== value.imageIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageIds"], message: "Image ids must be unique" });
  }
});

module.exports = {
  roomImageMetadataSchema,
  roomImageReorderSchema,
  roomImageUpdateSchema
};
