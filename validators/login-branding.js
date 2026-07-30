"use strict";

const { z } = require("zod");

const optionalText = (max) => z.string()
  .trim()
  .max(max)
  .refine((value) => !/[<>]/.test(value), "HTML markup is not allowed")
  .optional();
const safeColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color").optional();
const safeDisplayUrl = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL contains unsafe characters" });
      return;
    }
    if (value.startsWith("/") && !value.startsWith("//")) return;
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsafe");
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL must use http, https, or a safe relative path" });
    }
  });
const safeLegalUrl = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Legal link contains unsafe characters" });
      return;
    }
    try {
      if (!["http:", "https:"].includes(new URL(value).protocol)) throw new Error("unsafe");
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Legal links must use http or https" });
    }
  });

const loginBrandingConfigSchema = z.object({
  companyName: optionalText(120),
  shortCompanyName: optionalText(60),
  shortProductLabel: optionalText(80),
  logoUrl: safeDisplayUrl,
  logoAlt: optionalText(160),
  footerLogoUrl: safeDisplayUrl,
  footerLogoAlt: optionalText(160),
  heroImageUrl: safeDisplayUrl,
  heroImageAlt: optionalText(200),
  backgroundImageUrl: safeDisplayUrl,
  welcomeBadge: optionalText(100),
  welcomeHeading: optionalText(160),
  welcomeSubheading: optionalText(240),
  description: optionalText(700),
  tagline: optionalText(240),
  loginBadgeText: optionalText(80),
  loginHeading: optionalText(160),
  loginDescription: optionalText(320),
  hotelSlugLabel: optionalText(80),
  hotelSlugPlaceholder: optionalText(120),
  staffPinLabel: optionalText(80),
  staffPinPlaceholder: optionalText(120),
  loginButtonText: optionalText(80),
  serviceSectionHeading: optionalText(160),
  enableHotelService: z.boolean().optional(),
  hotelServiceLabel: optionalText(80),
  enableRestaurantService: z.boolean().optional(),
  restaurantServiceLabel: optionalText(80),
  enableTransportService: z.boolean().optional(),
  transportServiceLabel: optionalText(80),
  footerCompanyName: optionalText(120),
  copyrightText: optionalText(260),
  legalText: optionalText(260),
  termsUrl: safeLegalUrl,
  privacyUrl: safeLegalUrl,
  primaryColor: safeColor,
  secondaryColor: safeColor,
  accentColor: safeColor,
  backgroundColor: safeColor,
  cardColor: safeColor,
  textColor: safeColor
}).strict();

const loginBrandingScopeSchema = z.object({
  scopeType: z.enum(["platform", "hotel"]),
  hotelSlug: z.string().trim().min(2).max(120).regex(/^[a-z0-9][a-z0-9-]*$/).optional()
}).superRefine((data, ctx) => {
  if (data.scopeType === "hotel" && !data.hotelSlug) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hotelSlug"], message: "Hotel slug is required for hotel branding" });
  }
});

const loginBrandingSaveSchema = loginBrandingScopeSchema.and(z.object({
  config: loginBrandingConfigSchema
}));

const loginBrandingImageDeleteSchema = loginBrandingScopeSchema.and(z.object({
  storagePath: z.string().trim().min(1).max(500)
}));

module.exports = {
  loginBrandingConfigSchema,
  loginBrandingScopeSchema,
  loginBrandingSaveSchema,
  loginBrandingImageDeleteSchema
};
