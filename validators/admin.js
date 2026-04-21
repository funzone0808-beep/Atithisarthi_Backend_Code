const { z } = require("zod");

const jsonRecordSchema = z.record(z.string(), z.any());
const shortCssValueSchema = z.string().trim().max(80);
const presetThemeValueSchema = z.string().trim().max(50);
const themeSectionIdSchema = z.enum([
  "about",
  "menu",
  "reservation",
  "events",
  "gallery",
  "testimonials",
  "contact"
]);

const hotelThemeSchema = z
  .object({
    colors: z
      .object({
        primary: shortCssValueSchema.optional(),
        primaryLight: shortCssValueSchema.optional(),
        primaryDark: shortCssValueSchema.optional(),
        background: shortCssValueSchema.optional(),
        backgroundAlt: shortCssValueSchema.optional(),
        text: shortCssValueSchema.optional(),
        textMuted: shortCssValueSchema.optional()
      })
      .passthrough()
      .optional(),
    radius: z
      .object({
        base: shortCssValueSchema.optional(),
        small: shortCssValueSchema.optional()
      })
      .passthrough()
      .optional(),
    typography: z
      .object({
        preset: z.enum(["default", "system"]).optional()
      })
      .passthrough()
      .optional(),
    hero: z
      .object({
        layoutVariant: z.enum(["default", "split", "stacked"]).optional()
      })
      .passthrough()
      .optional(),
    layout: z
      .object({
        containerPreset: z.enum(["compact", "default", "wide"]).optional()
      })
      .passthrough()
      .optional(),
    buttons: z
      .object({
        preset: z.enum(["default", "solid", "crisp"]).optional()
      })
      .passthrough()
      .optional(),
    payment: z
      .object({
        upiDiscountPercent: z.number().min(0).max(100).optional()
      })
      .passthrough()
      .optional(),
    content: z
      .object({
        navLabels: z
          .object({
            about: z.string().trim().max(80).optional(),
            menu: z.string().trim().max(80).optional(),
            gallery: z.string().trim().max(80).optional(),
            events: z.string().trim().max(80).optional(),
            testimonials: z.string().trim().max(80).optional(),
            contact: z.string().trim().max(80).optional(),
            reservation: z.string().trim().max(80).optional()
          })
          .passthrough()
          .optional(),
        menuCategories: z
          .object({
            starters: z.string().trim().max(80).optional(),
            mains: z.string().trim().max(80).optional(),
            desserts: z.string().trim().max(80).optional(),
            drinks: z.string().trim().max(80).optional()
          })
          .passthrough()
          .optional(),
        menuSection: z
          .object({
            eyebrow: z.string().trim().max(320).optional(),
            title: z.string().trim().max(320).optional(),
            subtitle: z.string().trim().max(320).optional(),
            fullEyebrow: z.string().trim().max(320).optional(),
            fullTitle: z.string().trim().max(320).optional(),
            fullSubtitle: z.string().trim().max(320).optional(),
            viewFullMenu: z.string().trim().max(320).optional()
          })
          .passthrough()
          .optional(),
        ctaLabels: z
          .object({
            heroPrimary: z.string().trim().max(160).optional(),
            heroReservation: z.string().trim().max(160).optional(),
            aboutReservation: z.string().trim().max(160).optional(),
            cartButton: z.string().trim().max(160).optional(),
            menuScrollHint: z.string().trim().max(160).optional(),
            loadMore: z.string().trim().max(160).optional(),
            loadMoreHint: z.string().trim().max(160).optional()
          })
          .passthrough()
          .optional(),
        footerLabels: z
          .object({
            exploreHeading: z.string().trim().max(160).optional(),
            about: z.string().trim().max(160).optional(),
            menu: z.string().trim().max(160).optional(),
            gallery: z.string().trim().max(160).optional(),
            events: z.string().trim().max(160).optional(),
            reviews: z.string().trim().max(160).optional(),
            reservationsHeading: z.string().trim().max(160).optional(),
            bookTable: z.string().trim().max(160).optional(),
            privateDining: z.string().trim().max(160).optional(),
            contact: z.string().trim().max(160).optional(),
            openingHoursHeading: z.string().trim().max(160).optional(),
            findUsHeading: z.string().trim().max(160).optional(),
            copyrightSuffix: z.string().trim().max(160).optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional(),
    sections: z
      .object({
        about: z.boolean().optional(),
        events: z.boolean().optional(),
        gallery: z.boolean().optional(),
        order: z.array(themeSectionIdSchema).max(7).optional(),
        reservation: z.boolean().optional(),
        testimonials: z.boolean().optional()
      })
      .passthrough()
      .optional(),
    meta: z
      .object({
        version: presetThemeValueSchema.optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const hotelSchema = z.object({
  slug: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(150),
  whatsappNumber: z.string().trim().max(30).optional().nullable(),
  upiId: z.string().trim().max(120).optional().nullable(),
  gstPercent: z.number().min(0).max(100).optional(),
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  subdomain: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional()
});

const menuItemSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(50),
  itemId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(150),
  description: z.string().max(2000).optional().nullable(),
  price: z.number().nonnegative(),
  image: z.string().trim().max(2000).optional().nullable(),
  alt: z.string().trim().max(300).optional().nullable(),
  badge: z.string().trim().max(100).optional().nullable(),
  tag: z.string().trim().max(100).optional().nullable(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
});

const galleryLayoutVariantSchema = z.enum(["standard", "large", "tall", "wide"]);

const galleryItemSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  imageUrl: z.string().trim().min(1).max(2000),
  storagePath: z.string().trim().max(500).optional().nullable(),
  alt: z.string().trim().max(300).optional().nullable(),
  layoutVariant: galleryLayoutVariantSchema.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional()
});

const testimonialSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(150),
  role: z.string().trim().max(150).optional().nullable(),
  text: z.string().trim().min(2).max(4000),
  stars: z.number().int().min(1).max(5).optional(),
  avatar: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isApproved: z.boolean().optional()
});

const notificationOwnerEmailSchema = z
  .union([z.string().trim().email().max(320), z.literal(""), z.null()])
  .optional();

const hotelNotificationSettingsSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  emailEnabled: z.boolean().optional(),
  ownerEmail: notificationOwnerEmailSchema,
  notifyOnNewOrder: z.boolean().optional(),
  notifyOnNewReservation: z.boolean().optional(),
  notifyOnNewInquiry: z.boolean().optional()
});

const hotelPaymentRouteSettingsSchema = z
  .object({
    hotelSlug: z.string().trim().min(2).max(120),
    provider: z.enum(["razorpay"]).optional(),
    routeEnabled: z.boolean().optional(),
    razorpayLinkedAccountId: z
      .string()
      .trim()
      .max(120)
      .optional()
      .nullable()
  })
  .superRefine((data, ctx) => {
    const linkedAccountId = String(data.razorpayLinkedAccountId || "").trim();

    if (linkedAccountId && !/^acc_[A-Za-z0-9]+$/.test(linkedAccountId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Razorpay linked account id must look like acc_xxxxx",
        path: ["razorpayLinkedAccountId"]
      });
    }

    if (data.routeEnabled && !linkedAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Razorpay linked account id is required when Route is enabled",
        path: ["razorpayLinkedAccountId"]
      });
    }
  });

const hotelProfileSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  hotelName: z.string().trim().min(2).max(150),
  tagline: z.string().max(500).optional().nullable(),
  ownerWhatsAppNumber: z.string().trim().max(30).optional().nullable(),
  ownerUpiId: z.string().trim().max(120).optional().nullable(),
  gstPercent: z.number().min(0).max(100).optional(),
  contact: jsonRecordSchema.optional(),
  branding: jsonRecordSchema.optional(),
  theme: hotelThemeSchema.optional(),
  hero: jsonRecordSchema.optional(),
  about: jsonRecordSchema.optional(),
  features: z.array(z.any()).optional(),
  events: jsonRecordSchema.optional(),
  reservation: jsonRecordSchema.optional(),
  contactSection: jsonRecordSchema.optional(),
  location: jsonRecordSchema.optional(),
  footer: jsonRecordSchema.optional(),
  social: jsonRecordSchema.optional()
});

const partialHotelSchema = hotelSchema.partial();
const partialMenuItemSchema = menuItemSchema.partial();
const partialGalleryItemSchema = galleryItemSchema.partial();
const partialTestimonialSchema = testimonialSchema.partial();


module.exports = {
  hotelSchema,
  partialHotelSchema,
  galleryItemSchema,
  partialGalleryItemSchema,
  hotelPaymentRouteSettingsSchema,
  hotelNotificationSettingsSchema,
  menuItemSchema,
  partialMenuItemSchema,
  hotelProfileSchema,
  testimonialSchema,
  partialTestimonialSchema
};
