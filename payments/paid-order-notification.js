"use strict";

const { createNotificationEventSafely } = require("../utils/notifications");

async function notifyPaidOrderAfterFinalization({ db, intent }) {
  if (!intent?.business_order_id) return null;
  const { data: order, error } = await db.from("orders")
    .select("id,hotel_slug,hotel_name,customer_name,customer_phone,customer_address,payment_method,payment_status,billing_status,note,items,totals,whatsapp_message,status,table_number,order_type,order_source")
    .eq("id", intent.business_order_id)
    .eq("hotel_slug", intent.hotel_slug)
    .maybeSingle();
  if (error || !order) return null;
  return createNotificationEventSafely({
    hotelSlug: order.hotel_slug || intent.hotel_slug,
    sourceType: "order",
    sourceId: order.id,
    payload: {
      orderId: order.id,
      hotelName: order.hotel_name || "",
      customerName: order.customer_name || "",
      customerPhone: order.customer_phone || "",
      customerAddress: order.customer_address || "",
      paymentMethod: order.payment_method || "Online Payment",
      paymentStatus: order.payment_status || "paid",
      billingStatus: order.billing_status || null,
      note: order.note || "",
      items: Array.isArray(order.items) ? order.items : [],
      totals: order.totals && typeof order.totals === "object" ? order.totals : {},
      whatsappMessage: order.whatsapp_message || "",
      orderContext: {
        orderType: order.order_type || "",
        tableNumber: order.table_number || "",
        orderSource: order.order_source || ""
      },
      status: order.status || "new"
    }
  });
}

module.exports = { notifyPaidOrderAfterFinalization };
