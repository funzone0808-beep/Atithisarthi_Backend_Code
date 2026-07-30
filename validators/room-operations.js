"use strict";

const { z } = require("zod");

const text = (max = 2000) => z.string().trim().max(max).optional().nullable();
const money = z.number().finite().min(0).max(99999999.99);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTime = z.string().trim().datetime({ offset: true });

const floorCreateSchema = z.object({
  floorCode: z.string().trim().min(1).max(40),
  floorName: z.string().trim().min(1).max(120),
  displayOrder: z.number().int().min(-10000).max(10000).optional(),
  description: text(1000),
  isActive: z.boolean().optional()
}).strict();
const floorUpdateSchema = floorCreateSchema.partial().refine((value) => Object.keys(value).length > 0);

const managerRoomTypeCreateSchema = z.object({
  name: z.string().trim().min(2).max(150),
  shortCode: text(30),
  description: text(4000),
  basePrice: money.optional(),
  baseCapacity: z.number().int().min(0).max(100).optional(),
  maxAdults: z.number().int().min(0).max(100).optional(),
  maxChildren: z.number().int().min(0).max(100).optional(),
  extraAdultRate: money.optional(),
  extraChildRate: money.optional(),
  amenities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  cancellationPolicy: text(4000),
  checkInTime: text(8),
  checkOutTime: text(8),
  isActive: z.boolean().optional()
}).strict();
const managerRoomTypeUpdateSchema = managerRoomTypeCreateSchema.partial().refine((value) => Object.keys(value).length > 0);

const managerRoomCreateSchema = z.object({
  roomTypeId: z.number().int().positive().optional().nullable(),
  floorId: z.number().int().positive().optional().nullable(),
  roomNumber: z.string().trim().min(1).max(80),
  floor: text(80),
  title: text(160),
  capacity: z.number().int().min(0).max(200).optional(),
  maxAdults: z.number().int().min(0).max(100).optional(),
  maxChildren: z.number().int().min(0).max(100).optional(),
  baseOccupancy: z.number().int().min(0).max(100).optional(),
  extraBedLimit: z.number().int().min(0).max(20).optional(),
  bedType: text(120),
  basePrice: money.optional(),
  discountPrice: money.optional().nullable(),
  taxPercent: z.number().finite().min(0).max(100).optional(),
  status: z.enum(["available", "booked", "occupied", "cleaning", "maintenance", "inactive"]).optional(),
  smokingPolicy: z.enum(["unspecified", "smoking", "non_smoking"]).optional(),
  amenities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  description: text(4000),
  notes: text(2000),
  displayOrder: z.number().int().min(-10000).max(10000).optional(),
  isActive: z.boolean().optional()
}).strict();
const managerRoomUpdateSchema = managerRoomCreateSchema.partial().refine((value) => Object.keys(value).length > 0);

const ratePlanFieldsSchema = z.object({
  roomId: z.number().int().positive().optional().nullable(),
  roomTypeId: z.number().int().positive().optional().nullable(),
  planName: z.string().trim().min(2).max(150),
  planCode: z.string().trim().min(1).max(40),
  startDate: date.optional().nullable(),
  endDate: date.optional().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  nightlyPrice: money,
  extraAdultPrice: money.optional(),
  extraChildPrice: money.optional(),
  includedServices: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  cancellationRule: text(4000),
  minimumStay: z.number().int().min(1).max(365).optional(),
  maximumStay: z.number().int().min(1).max(3650).optional().nullable(),
  priority: z.number().int().min(-10000).max(10000).optional(),
  isActive: z.boolean().optional(),
  status: z.enum(["draft", "active", "retired"]).optional()
}).strict();

function refineRatePlan(value, ctx) {
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date must not be before start date" });
  }
  if (value.maximumStay && value.minimumStay && value.maximumStay < value.minimumStay) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumStay"], message: "Maximum stay must be at least minimum stay" });
  }
}

const ratePlanCreateSchema = ratePlanFieldsSchema.superRefine(refineRatePlan);
const ratePlanUpdateSchema = ratePlanFieldsSchema.partial()
  .extend({ expectedVersion: z.number().int().positive().optional() })
  .refine((value) => Object.keys(value).length > 0)
  .superRefine(refineRatePlan);

const amenitySchema = z.object({
  amenityCode: z.string().trim().min(1).max(60),
  amenityName: z.string().trim().min(1).max(120),
  description: text(1000),
  displayOrder: z.number().int().min(-10000).max(10000).optional(),
  isActive: z.boolean().optional()
}).strict();
const amenityUpdateSchema = amenitySchema.partial().refine((value) => Object.keys(value).length > 0);

const maintenanceCreateSchema = z.object({
  roomId: z.number().int().positive(),
  maintenanceType: z.string().trim().min(1).max(100).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  description: z.string().trim().min(2).max(4000),
  startAt: dateTime,
  endAt: dateTime.optional().nullable(),
  assignedTo: text(160),
  cost: money.optional().nullable()
}).strict().superRefine((value, ctx) => {
  if (value.endAt && value.endAt <= value.startAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "Maintenance end must be after its start" });
  }
});
const maintenanceUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "completed", "cancelled"]),
  endAt: dateTime.optional().nullable(),
  assignedTo: text(160),
  cost: money.optional().nullable(),
  description: text(4000)
}).strict();

const housekeepingCreateSchema = z.object({
  roomId: z.number().int().positive(),
  bookingId: z.number().int().positive().optional().nullable(),
  status: z.enum(["dirty", "cleaning", "clean", "inspected"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedTo: text(160),
  notes: text(2000)
}).strict();
const housekeepingUpdateSchema = z.object({
  status: z.enum(["dirty", "cleaning", "clean", "inspected"]),
  assignedTo: text(160),
  notes: text(2000)
}).strict();

const roomShiftSchema = z.object({
  targetRoomId: z.number().int().positive(),
  reason: z.string().trim().min(2).max(2000),
  effectiveAt: dateTime.optional()
}).strict();
const stayExtensionSchema = z.object({
  newCheckOutDate: date,
  reason: text(2000)
}).strict();

module.exports = {
  amenitySchema, amenityUpdateSchema, floorCreateSchema, floorUpdateSchema,
  housekeepingCreateSchema, housekeepingUpdateSchema,
  maintenanceCreateSchema, maintenanceUpdateSchema,
  managerRoomCreateSchema, managerRoomUpdateSchema,
  managerRoomTypeCreateSchema, managerRoomTypeUpdateSchema,
  ratePlanCreateSchema, ratePlanUpdateSchema, roomShiftSchema, stayExtensionSchema
};
