"use strict";

const { z } = require("zod");
const text = (max) => z.string().trim().max(max);
const money = z.number().finite().min(0).max(99999999.99);
const rate = z.number().finite().min(0).max(100);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

const roomTaxSettingsSchema = z.object({
  gstEnabled: z.boolean(),
  gstRegistered: z.boolean(),
  gstin: text(15).optional().default(""),
  legalBusinessName: text(240).optional().default(""),
  stateName: text(120).optional().default(""),
  stateCode: text(12).optional().default(""),
  placeOfSupply: text(160).optional().default(""),
  accommodationSac: text(24).optional().default(""),
  defaultTaxMode: z.enum(["inclusive", "exclusive"]),
  defaultSupplyType: z.enum(["intrastate", "interstate"]),
  invoiceType: z.enum(["tax_invoice", "guest_folio", "receipt"]),
  roundingRule: z.enum(["half_up", "nearest_rupee", "none"]),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("INR"),
  expectedVersion: z.number().int().positive().optional()
}).strict().superRefine((value, ctx) => {
  if (value.gstRegistered && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.gstin)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstin"], message: "GSTIN must use the standard 15-character Indian GSTIN structure" });
  }
  if (value.gstEnabled && !value.legalBusinessName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["legalBusinessName"], message: "Legal business name is required when Room GST is enabled" });
  }
  if (value.gstEnabled && !value.gstRegistered) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstRegistered"], message: "GST cannot be enabled unless the hotel is marked GST registered" });
  }
  if (value.gstEnabled && !value.stateCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stateCode"], message: "Hotel state code is required when Room GST is enabled" });
  }
  if (value.gstEnabled && !value.accommodationSac) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accommodationSac"], message: "Room accommodation SAC is required when Room GST is enabled" });
  }
});

const roomTaxRuleFields = z.object({
  ruleName: z.string().trim().min(2).max(160),
  accommodationCategory: text(80).default("room_accommodation"),
  calculationBasis: z.enum(["transaction_value", "configured_taxable_value"]).default("transaction_value"),
  minimumTaxableValue: money.default(0),
  maximumTaxableValue: money.optional().nullable(),
  cgstRate: rate.default(0),
  sgstRate: rate.default(0),
  igstRate: rate.default(0),
  cessRate: rate.default(0),
  isExempt: z.boolean().default(false),
  exemptionReason: text(500).default(""),
  taxInclusive: z.boolean().default(false),
  effectiveFrom: date,
  effectiveTo: date.optional().nullable(),
  status: z.enum(["draft", "active", "retired"]).default("draft")
}).strict();

function refineRule(value, ctx) {
  if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveTo"], message: "Effective-to date cannot be before effective-from date" });
  }
  if (value.maximumTaxableValue != null && value.maximumTaxableValue < value.minimumTaxableValue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumTaxableValue"], message: "Maximum taxable value cannot be below the minimum" });
  }
  if (value.isExempt && !value.exemptionReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exemptionReason"], message: "An exemption reason is required for a zero-tax exemption rule" });
  }
  if (value.isExempt && [value.cgstRate, value.sgstRate, value.igstRate, value.cessRate]
    .filter((rateValue) => rateValue !== undefined)
    .some((rateValue) => Number(rateValue) !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["isExempt"], message: "Exempt rules must use zero tax rates" });
  }
}

const roomTaxRuleCreateSchema = roomTaxRuleFields.superRefine(refineRule);
const roomTaxRuleUpdateSchema = roomTaxRuleFields.partial()
  .extend({ expectedVersion: z.number().int().positive() })
  .refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), { message: "At least one tax-rule field must be changed" })
  .superRefine(refineRule);
const roomTaxRuleActionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const roomTaxPreviewSchema = z.object({
  amount: money,
  effectiveDate: date,
  guestPlaceOfSupply: text(24).optional().default(""),
  ruleId: z.number().int().positive().optional()
}).strict();
const roomRefundSchema = z.object({
  amount: money.refine((value) => value > 0, "Refund amount must be greater than zero"),
  reason: z.string().trim().min(2).max(2000),
  paymentMethod: z.string().trim().min(1).max(80),
  transactionId: text(200).optional().default(""),
  idempotencyKey: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
}).strict();

module.exports = {
  roomRefundSchema,
  roomTaxPreviewSchema,
  roomTaxRuleActionSchema,
  roomTaxRuleCreateSchema,
  roomTaxRuleUpdateSchema,
  roomTaxSettingsSchema
};
