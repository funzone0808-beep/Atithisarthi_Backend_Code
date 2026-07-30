"use strict";

const { z } = require("zod");

const optionalText = (max) => z.string().trim().max(max).optional().nullable();
const safeUrl = z
  .union([z.string().trim().max(2000), z.literal(""), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    const candidate = String(value || "").trim();
    if (!candidate) return;

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:") throw new Error("Unsafe protocol");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL must use https://"
      });
    }
  });

const roomCheckoutBillFormatSchema = z.object({
  templateName: optionalText(120),
  paperWidth: z.enum(["58", "80"]).optional(),
  companyName: optionalText(180),
  propertySubtitle: optionalText(180),
  logoUrl: safeUrl,
  logoStoragePath: optionalText(500),
  logoAltText: optionalText(240),
  addressLine1: optionalText(240),
  addressLine2: optionalText(240),
  city: optionalText(120),
  state: optionalText(120),
  postalCode: optionalText(40),
  country: optionalText(120),
  phone: optionalText(60),
  alternatePhone: optionalText(60),
  email: z
    .union([z.string().trim().email().max(320), z.literal(""), z.null()])
    .optional(),
  websiteUrl: safeUrl,
  taxId: optionalText(120),
  licenceNumber: optionalText(120),
  registrationNumber: optionalText(120),
  billTitle: optionalText(180),
  labels: z.record(z.string(), z.string().trim().max(80)).optional(),
  privacy: z
    .object({
      showGuestName: z.boolean().optional(),
      maskGuestPhone: z.boolean().optional(),
      maskGuestEmail: z.boolean().optional(),
      maskGuestId: z.boolean().optional(),
      showGuestAddress: z.boolean().optional(),
      showGuestCount: z.boolean().optional(),
      showSignatureLines: z.boolean().optional()
    })
    .strict()
    .optional(),
  display: z
    .object({
      showHotelLogo: z.boolean().optional(),
      showRoomType: z.boolean().optional(),
      showPaymentMethod: z.boolean().optional(),
      showCashier: z.boolean().optional(),
      showQrCode: z.boolean().optional(),
      showDiscount: z.boolean().optional(),
      showAdvance: z.boolean().optional(),
      showBalance: z.boolean().optional(),
      showPaymentBreakdown: z.boolean().optional(),
      hideZeroTotals: z.boolean().optional()
    })
    .strict()
    .optional(),
  qr: z
    .object({
      enabled: z.boolean().optional(),
      type: z.enum(["website", "feedback", "support"]).optional(),
      value: safeUrl,
      caption: optionalText(160),
      size: z.number().int().min(64).max(320).optional(),
      alignment: z.enum(["left", "center", "right"]).optional()
    })
    .strict()
    .optional(),
  print: z
    .object({
      fontScale: z.number().min(0.8).max(1.3).optional(),
      logoWidthMm: z.number().min(8).max(50).optional(),
      marginMm: z.number().min(0).max(8).optional(),
      lineSpacing: z.number().min(0.9).max(1.5).optional(),
      separatorStyle: z.enum(["dashed", "dotted", "solid"]).optional(),
      printCopies: z.number().int().min(1).max(5).optional(),
      autoPrintAfterCheckout: z.boolean().optional()
    })
    .strict()
    .optional(),
  messages: z
    .object({
      thankYou: optionalText(500),
      feedback: optionalText(500),
      support: optionalText(500),
      footer: optionalText(1000),
      legalNote: optionalText(1000)
    })
    .strict()
    .optional()
}).strict();

const roomCheckoutBillReprintSchema = z.object({
  reason: z.string().trim().min(2).max(500)
}).strict();

module.exports = {
  roomCheckoutBillFormatSchema,
  roomCheckoutBillReprintSchema
};
