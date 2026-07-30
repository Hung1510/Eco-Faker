// app/api/products/route.ts
//
// A real REST endpoint alongside the RSC pages -- for a mobile client, a
// separate admin dashboard, or a future third-party integration that needs
// JSON over HTTP rather than server-rendered markup.

import { NextRequest, NextResponse } from "next/server";
import { dataset } from "@/lib/dataset";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));

  let products = dataset.products;
  if (q) {
    const needle = q.toLowerCase();
    products = products.filter((p) => p.name.toLowerCase().includes(needle));
  }

  const start = (page - 1) * limit;
  const data = products.slice(start, start + limit);

  return NextResponse.json({
    data,
    pagination: {
      page,
      limit,
      total: products.length,
      totalPages: Math.max(1, Math.ceil(products.length / limit)),
    },
  });
}
