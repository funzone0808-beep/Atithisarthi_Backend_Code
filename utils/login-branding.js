"use strict";

const BUILT_IN_LOGIN_BRANDING = Object.freeze({
  companyName: "AtithiSarthi",
  shortCompanyName: "AtithiSarthi",
  shortProductLabel: "Hospitality Operating System",
  logoUrl: "",
  logoAlt: "AtithiSarthi logo",
  footerLogoUrl: "",
  footerLogoAlt: "AtithiSarthi",
  heroImageUrl: "",
  heroImageAlt: "",
  backgroundImageUrl: "",
  welcomeBadge: "Hotel • Restaurant • Local Travel",
  welcomeHeading: "Welcome",
  welcomeSubheading: "Your Restaurant Operating System",
  description: "Manage stays, dining and guest service from one connected workspace.",
  tagline: "Serving Success Beyond the Kitchen.",
  loginBadgeText: "Secure Login",
  loginHeading: "Open your hotel billing view",
  loginDescription: "Use the hotel slug and staff PIN created for that hotel.",
  hotelSlugLabel: "Hotel Slug",
  hotelSlugPlaceholder: "Hotel Slug",
  staffPinLabel: "Staff PIN",
  staffPinPlaceholder: "Staff PIN",
  loginButtonText: "Login",
  serviceSectionHeading: "One connected journey",
  enableHotelService: true,
  hotelServiceLabel: "Hotel / Stay",
  enableRestaurantService: true,
  restaurantServiceLabel: "Restaurant / Dine",
  enableTransportService: true,
  transportServiceLabel: "Local Travel",
  footerCompanyName: "AtithiSarthi",
  copyrightText: "Copyright © 2026 AtithiSarthi. All Rights Reserved.",
  legalText: "",
  termsUrl: "",
  privacyUrl: "",
  primaryColor: "#b86647",
  secondaryColor: "#8c3f58",
  accentColor: "#c49b3c",
  backgroundColor: "#f7efe5",
  cardColor: "#fffaf4",
  textColor: "#281813"
});

const PUBLIC_LOGIN_BRANDING_KEYS = Object.freeze(Object.keys(BUILT_IN_LOGIN_BRANDING));

function isMissingLoginBrandingRelationError(error) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("login_page_branding") && (message.includes("does not exist") || message.includes("schema cache"))
  );
}

function buildPublicLoginBranding(config = {}) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const branding = {};

  for (const key of PUBLIC_LOGIN_BRANDING_KEYS) {
    const fallbackValue = BUILT_IN_LOGIN_BRANDING[key];
    const value = source[key];

    if (typeof fallbackValue === "boolean") {
      branding[key] = typeof value === "boolean" ? value : fallbackValue;
      continue;
    }

    branding[key] = typeof value === "string" ? value : fallbackValue;
  }

  return branding;
}

module.exports = {
  BUILT_IN_LOGIN_BRANDING,
  PUBLIC_LOGIN_BRANDING_KEYS,
  buildPublicLoginBranding,
  isMissingLoginBrandingRelationError
};
