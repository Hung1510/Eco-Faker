// app/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dataset } from "@/lib/dataset";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

  let orders = dataset.orders;
  if (status) orders = orders.filter((o) => o.status === status);

  const start = (page - 1) * limit;
  const data = orders.slice(start, start + limit);

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: orders.length,
      totalPages: Math.max(1, Math.ceil(orders.length / limit)),
    },
  });
}
