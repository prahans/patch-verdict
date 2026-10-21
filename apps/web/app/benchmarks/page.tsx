import type { Metadata } from "next";
import { connection } from "next/server";
import { BenchmarkDashboard } from "@/components/benchmarks/benchmark-dashboard";
import { aggregateBenchmarks } from "@/lib/benchmarks/aggregate";

export const metadata: Metadata = {
  title: "Benchmark Dashboard | PatchVerdict",
  description:
    "Explore how PatchVerdict investigated, repaired, and verified bugs across controlled test repositories.",
};

export const runtime = "nodejs";

export default async function BenchmarksPage() {
  // Read the current saved artifacts for each request, never at build time.
  await connection();
  const data = await aggregateBenchmarks();
  return <BenchmarkDashboard data={data} />;
}
