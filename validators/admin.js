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
    aiAssistant: z
      .object({
        enabled: z.boolean().optional(),
        title: z.string().trim().max(160).optional(),
        intro: z.string().trim().max(320).optional(),
        tone: z.enum(["default", "friendly", "formal"]).optional(),
        examplePrompt: z.string().trim().max(160).optional(),
        starterPrompts: z.array(z.string().trim().min(1).max(120)).max(6).optional()
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
  category: z.string().trim().min(1).max(120),
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

const safeOptionalImageUrlSchema = z
  .union([z.string().trim().max(2000), z.literal(""), z.null()])
  .optional()
  .refine((value) => {
    const candidate = String(value || "").trim();
    if (!candidate) return true;
    if (candidate.startsWith("/") || candidate.startsWith("./") || candidate.startsWith("../")) {
      return !candidate.startsWith("//") && !/[<>"'`]/.test(candidate);
    }
    try {
      return ["http:", "https:"].includes(new URL(candidate).protocol);
    } catch {
      return false;
    }
  }, "Image URL must be a safe local, HTTP, or HTTPS URL");

const menuCategorySchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  categoryKey: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  staffEnabled: z.boolean().optional(),
  websiteEnabled: z.boolean().optional(),
  qrEnabled: z.boolean().optional(),
  defaultImageUrl: safeOptionalImageUrlSchema,
  defaultThumbnailUrl: safeOptionalImageUrlSchema,
  imageStoragePath: z.string().trim().max(500).optional().nullable(),
  imageAltText: z.string().trim().max(300).optional().nullable()
});

const comboDateFieldSchema = z
  .union([z.string().trim().max(20), z.literal(""), z.null()])
  .optional();

const comboTimeFieldSchema = z
  .union([z.string().trim().max(10), z.literal(""), z.null()])
  .optional();

const comboChildItemSchema = z.object({
  childItemId: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(50).optional(),
  sortOrder: z.number().int().min(0).optional()
});

function isValidOptionalDateValue(value = "") {
  const candidate = String(value || "").trim();

  if (!candidate) {
    return true;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && Number.isFinite(Date.parse(candidate));
}

function isValidOptionalTimeValue(value = "") {
  const candidate = String(value || "").trim();

  if (!candidate) {
    return true;
  }

  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(candidate);
}

function refineComboMenuSchema(data, ctx) {
  const childItems = Array.isArray(data.childItems) ? data.childItems : [];

  if (data.childItems !== undefined && childItems.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one child menu item is required",
      path: ["childItems"]
    });
  }

  const seenChildItemIds = new Set();

  childItems.forEach((childItem, index) => {
    const childItemId = String(childItem?.childItemId || "").trim();

    if (!childItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Child item id is required",
        path: ["childItems", index, "childItemId"]
      });
      return;
    }

    if (seenChildItemIds.has(childItemId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate child item ids are not allowed in one combo",
        path: ["childItems", index, "childItemId"]
      });
      return;
    }

    seenChildItemIds.add(childItemId);

    if (data.itemId && childItemId === String(data.itemId).trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A combo cannot include itself as a child item",
        path: ["childItems", index, "childItemId"]
      });
    }
  });

  if (!isValidOptionalDateValue(data.startDate || "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must use YYYY-MM-DD",
      path: ["startDate"]
    });
  }

  if (!isValidOptionalDateValue(data.endDate || "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must use YYYY-MM-DD",
      path: ["endDate"]
    });
  }

  if (!isValidOptionalTimeValue(data.startTime || "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start time must use HH:MM or HH:MM:SS",
      path: ["startTime"]
    });
  }

  if (!isValidOptionalTimeValue(data.endTime || "")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End time must use HH:MM or HH:MM:SS",
      path: ["endTime"]
    });
  }

  const startDateMs = String(data.startDate || "").trim()
    ? Date.parse(`${String(data.startDate).trim()}T00:00:00Z`)
    : null;
  const endDateMs = String(data.endDate || "").trim()
    ? Date.parse(`${String(data.endDate).trim()}T00:00:00Z`)
    : null;

  if (
    Number.isFinite(startDateMs) &&
    Number.isFinite(endDateMs) &&
    endDateMs < startDateMs
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must be after or equal to the start date",
      path: ["endDate"]
    });
  }
}

const comboMenuItemBaseSchema = z.object({
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
  sortOrder: z.number().int().min(0).optional(),
  childItems: z.array(comboChildItemSchema).min(1),
  startDate: comboDateFieldSchema,
  endDate: comboDateFieldSchema,
  startTime: comboTimeFieldSchema,
  endTime: comboTimeFieldSchema
});

const comboMenuItemSchema = comboMenuItemBaseSchema.superRefine(refineComboMenuSchema);
const partialComboMenuItemSchema = comboMenuItemBaseSchema
  .partial()
  .superRefine(refineComboMenuSchema);

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

const popupDisplayModeSchema = z.enum([
  "every_visit",
  "once_per_session",
  "once_per_day"
]);

function isValidPopupCtaLink(value = "") {
  const candidate = String(value || "").trim();

  if (!candidate) {
    return true;
  }

  if (candidate.startsWith("/")) {
    return true;
  }

  try {
    const parsedUrl = new URL(candidate);
    return ["http:", "https:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function isValidOptionalDateTime(value = "") {
  const candidate = String(value || "").trim();
  return !candidate || Number.isFinite(Date.parse(candidate));
}

const popupDateTimeFieldSchema = z
  .union([z.string().trim().max(80), z.literal(""), z.null()])
  .optional();

function refinePopupNotificationSchema(data, ctx) {
    if (!isValidPopupCtaLink(data.ctaLink || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CTA link must be an https/http URL or a relative path like /offers",
        path: ["ctaLink"]
      });
    }

    if (!isValidOptionalDateTime(data.startAt || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must be a valid date/time",
        path: ["startAt"]
      });
    }

    if (!isValidOptionalDateTime(data.endAt || "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be a valid date/time",
        path: ["endAt"]
      });
    }

    const startAtMs = String(data.startAt || "").trim()
      ? Date.parse(String(data.startAt).trim())
      : null;
    const endAtMs = String(data.endAt || "").trim()
      ? Date.parse(String(data.endAt).trim())
      : null;

    if (
      Number.isFinite(startAtMs) &&
      Number.isFinite(endAtMs) &&
      endAtMs < startAtMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after the start date",
        path: ["endAt"]
      });
    }
}

const popupNotificationBaseSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  imageUrl: z.string().trim().max(2000).optional().nullable(),
  storagePath: z.string().trim().max(500).optional().nullable(),
  ctaText: z.string().trim().max(120).optional().nullable(),
  ctaLink: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
  displayMode: popupDisplayModeSchema.optional(),
  startAt: popupDateTimeFieldSchema,
  endAt: popupDateTimeFieldSchema,
  priority: z.number().int().min(0).optional()
});

const popupNotificationSchema = popupNotificationBaseSchema.superRefine(
  refinePopupNotificationSchema
);

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

const hotelOrderingDisabledButtonLinkSchema = z
  .union([z.string().trim().max(2000), z.literal(""), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    const candidate = String(value || "").trim();

    if (!candidate) {
      return;
    }

    if (candidate.startsWith("/")) {
      return;
    }

    try {
      const parsedUrl = new URL(candidate);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled button link must be an https/http URL or a relative path like /contact",
        path: []
      });
    }
  });

const hotelOrderingSettingsSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  customerOrderingEnabled: z.boolean().optional(),
  staffOrderingEnabled: z.boolean().optional(),
  whatsappOrderingEnabled: z.boolean().optional(),
  secureOnlinePaymentEnabled: z.boolean().optional(),
  cashOnDeliveryEnabled: z.boolean().optional(),
  manualUpiPaymentEnabled: z.boolean().optional(),
  disabledTitle: z.string().trim().max(160).optional().nullable(),
  disabledMessage: z.string().trim().max(1000).optional().nullable(),
  disabledButtonText: z.string().trim().max(120).optional().nullable(),
  disabledButtonLink: hotelOrderingDisabledButtonLinkSchema,
  disabledIcon: z.string().trim().max(40).optional().nullable()
}).superRefine((settings, ctx) => {
  if (
    settings.customerOrderingEnabled !== false &&
    settings.secureOnlinePaymentEnabled === false &&
    settings.cashOnDeliveryEnabled === false &&
    settings.manualUpiPaymentEnabled === false
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enable at least one customer payment method while customer ordering is active",
      path: ["cashOnDeliveryEnabled"]
    });
  }
});

const qrLinkSignatureSchema = z.object({
  hotelSlug: z.string().trim().min(2).max(120),
  tableNumber: z.string().trim().min(1).max(80),
  orderSource: z.string().trim().max(40).optional()
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
const hotelDomainSettingsSchema = z.object({
  primaryDomain: z.string().trim().max(255).optional().nullable(),
  subdomain: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional()
});
const partialMenuItemSchema = menuItemSchema.partial();
const partialMenuCategorySchema = menuCategorySchema.partial().omit({ hotelSlug: true, categoryKey: true });
const partialGalleryItemSchema = galleryItemSchema.partial();
const partialTestimonialSchema = testimonialSchema.partial();
const partialPopupNotificationSchema = popupNotificationBaseSchema
  .partial()
  .superRefine(refinePopupNotificationSchema);


module.exports = {
  hotelSchema,
  partialHotelSchema,
  hotelDomainSettingsSchema,
  galleryItemSchema,
  partialGalleryItemSchema,
  hotelPaymentRouteSettingsSchema,
  hotelNotificationSettingsSchema,
  hotelOrderingSettingsSchema,
  qrLinkSignatureSchema,
  popupNotificationSchema,
  partialPopupNotificationSchema,
  menuItemSchema,
  partialMenuItemSchema,
  menuCategorySchema,
  partialMenuCategorySchema,
  comboMenuItemSchema,
  partialComboMenuItemSchema,
  hotelProfileSchema,
  testimonialSchema,
  partialTestimonialSchema
};
